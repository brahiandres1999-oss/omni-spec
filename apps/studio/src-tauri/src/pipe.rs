//! Named pipe server of the host (plan §1.8, §10.2, decisions D-1 and D-2).
//!
//! Rust is the server and the engine the only client. Four defences hold together:
//! 1. `FILE_FLAG_FIRST_PIPE_INSTANCE`: creation fails if the name already exists (no silent retry);
//! 2. `PIPE_REJECT_REMOTE_CLIENTS`;
//! 3. a DACL with a single ACE for the current user's SID;
//! 4. the client PID must be the launched engine, followed by a mutual HMAC handshake over a secret
//!    that travelled on the engine's stdin.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::{broadcast, oneshot};

use crate::error::{Result, StudioError};
use crate::protocol::{
    FrameDecoder, MAX_FRAME_BYTES, PROTOCOL_VERSION, encode_frame, handshake_proof, is_hex64,
    random_hex, verify_proof,
};

/// Timeout of one engine call unless the caller configures another (PP-10).
pub const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(10);
/// Time the engine has to answer `studio.challenge`.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const PIPE_PREFIX: &str = r"\\.\pipe\omnispec-";
const READ_CHUNK: usize = 64 * 1024;
const NOTIFICATION_BACKLOG: usize = 256;

/// `\\.\pipe\omnispec-{uuid v4}`, with the UUID drawn from the OS CSPRNG.
pub fn new_pipe_name() -> String {
    format!("{PIPE_PREFIX}{}", uuid::Uuid::new_v4().hyphenated())
}

/// True for `^\\\\\.\\pipe\\omnispec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
pub fn is_valid_pipe_name(name: &str) -> bool {
    let Some(uuid) = name.strip_prefix(PIPE_PREFIX) else {
        return false;
    };
    let groups: Vec<&str> = uuid.split('-').collect();
    groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(group, len)| {
            group.len() == len
                && group
                    .bytes()
                    .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        })
}

/// Server options the pipe was created with (PP-03).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PipeOptions {
    pub first_pipe_instance: bool,
    pub reject_remote_clients: bool,
    pub max_instances: u32,
}

const OPTIONS: PipeOptions = PipeOptions {
    first_pipe_instance: true,
    reject_remote_clients: true,
    max_instances: 1,
};

#[cfg(windows)]
mod sys {
    //! DACL construction and inspection.
    use std::os::windows::io::{AsRawHandle, RawHandle};

    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::{
        ConvertSidToStringSidW, GetSecurityInfo, SE_KERNEL_OBJECT,
    };
    use windows::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION, ACL_SIZE_INFORMATION,
        AclSizeInformation, AddAccessAllowedAce, DACL_SECURITY_INFORMATION, GetAce,
        GetAclInformation, GetLengthSid, GetTokenInformation, InitializeAcl,
        InitializeSecurityDescriptor, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES,
        SECURITY_DESCRIPTOR, SetSecurityDescriptorDacl, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows::core::PWSTR;

    use crate::error::{Result, StudioError};

    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    const SECURITY_DESCRIPTOR_REVISION: u32 = 1;

    /// Security attributes whose DACL grants access to the current user only. The buffers must
    /// outlive the `CreateNamedPipeW` call that uses [`OwnerOnly::attributes`].
    pub struct OwnerOnly {
        _token_user: Vec<u64>,
        _acl: Vec<u64>,
        _descriptor: Box<SECURITY_DESCRIPTOR>,
        attributes: SECURITY_ATTRIBUTES,
    }

    impl OwnerOnly {
        pub fn new() -> Result<OwnerOnly> {
            let token_user = current_user()?;
            // SAFETY: the buffer holds a TOKEN_USER written by GetTokenInformation.
            let sid = unsafe { (*token_user.as_ptr().cast::<TOKEN_USER>()).User.Sid };
            // SAFETY: `sid` points into `token_user`, which is alive.
            let sid_len = unsafe { GetLengthSid(sid) } as usize;
            let acl_len =
                size_of::<ACL>() + size_of::<ACCESS_ALLOWED_ACE>() - size_of::<u32>() + sid_len;
            let mut acl = vec![0u64; acl_len.div_ceil(8)];
            let acl_ptr = acl.as_mut_ptr().cast::<ACL>();
            // SAFETY: `acl` is at least `acl_len` bytes, 8-byte aligned.
            unsafe { InitializeAcl(acl_ptr, acl_len as u32, ACL_REVISION) }
                .map_err(|e| StudioError::win32("InitializeAcl", &e))?;
            // SAFETY: initialised ACL with room for exactly one ACE of this SID.
            unsafe { AddAccessAllowedAce(acl_ptr, ACL_REVISION, FILE_ALL_ACCESS.0, sid) }
                .map_err(|e| StudioError::win32("AddAccessAllowedAce", &e))?;
            let mut descriptor = Box::new(SECURITY_DESCRIPTOR::default());
            let psd = PSECURITY_DESCRIPTOR((&raw mut *descriptor).cast());
            // SAFETY: `psd` points to a SECURITY_DESCRIPTOR-sized buffer.
            unsafe { InitializeSecurityDescriptor(psd, SECURITY_DESCRIPTOR_REVISION) }
                .map_err(|e| StudioError::win32("InitializeSecurityDescriptor", &e))?;
            // SAFETY: the absolute descriptor references `acl`, which lives as long as self.
            unsafe { SetSecurityDescriptorDacl(psd, true, Some(acl_ptr), false) }
                .map_err(|e| StudioError::win32("SetSecurityDescriptorDacl", &e))?;
            let attributes = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: psd.0,
                bInheritHandle: false.into(),
            };
            Ok(OwnerOnly {
                _token_user: token_user,
                _acl: acl,
                _descriptor: descriptor,
                attributes,
            })
        }

        pub fn attributes(&mut self) -> *mut core::ffi::c_void {
            (&raw mut self.attributes).cast()
        }
    }

    /// TOKEN_USER of the current process token, in an 8-byte aligned buffer.
    fn current_user() -> Result<Vec<u64>> {
        let mut token = HANDLE::default();
        // SAFETY: pseudo-handle of the current process; `token` is closed below.
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
            .map_err(|e| StudioError::win32("OpenProcessToken", &e))?;
        let mut needed = 0u32;
        // SAFETY: size query with no buffer.
        let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut needed) };
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8).max(1)];
        // SAFETY: the buffer holds at least `needed` bytes.
        let result = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                Some(buffer.as_mut_ptr().cast()),
                needed,
                &mut needed,
            )
        };
        // SAFETY: opened above, closed exactly once.
        let _ = unsafe { CloseHandle(token) };
        result.map_err(|e| StudioError::win32("GetTokenInformation", &e))?;
        Ok(buffer)
    }

    fn sid_string(sid: PSID) -> Result<String> {
        let mut text = PWSTR::null();
        // SAFETY: valid SID; the returned string is freed with LocalFree.
        unsafe { ConvertSidToStringSidW(sid, &mut text) }
            .map_err(|e| StudioError::win32("ConvertSidToStringSidW", &e))?;
        // SAFETY: ConvertSidToStringSidW returned a null-terminated string.
        let value = unsafe { text.to_string() };
        // SAFETY: allocated by ConvertSidToStringSidW.
        let _ = unsafe { LocalFree(Some(HLOCAL(text.0.cast()))) };
        value.map_err(|_| StudioError::Io {
            op: "ConvertSidToStringSidW",
            message: "SID is not valid UTF-16".to_owned(),
        })
    }

    /// SIDs of the access-allowed ACEs of the object's DACL (`GetSecurityInfo`).
    pub fn dacl_sids(handle: RawHandle) -> Result<Vec<String>> {
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        // SAFETY: valid handle; the descriptor is freed with LocalFree below.
        let status = unsafe {
            GetSecurityInfo(
                HANDLE(handle),
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(&mut dacl),
                None,
                Some(&mut descriptor),
            )
        };
        if status.is_err() {
            return Err(StudioError::Win32 {
                op: "GetSecurityInfo",
                code: status.0,
            });
        }
        let result = (|| {
            if dacl.is_null() {
                return Ok(Vec::new());
            }
            let mut size = ACL_SIZE_INFORMATION::default();
            // SAFETY: `dacl` points into `descriptor`; out buffer sized for the class.
            unsafe {
                GetAclInformation(
                    dacl,
                    (&raw mut size).cast(),
                    size_of::<ACL_SIZE_INFORMATION>() as u32,
                    AclSizeInformation,
                )
            }
            .map_err(|e| StudioError::win32("GetAclInformation", &e))?;
            let mut sids = Vec::new();
            for index in 0..size.AceCount {
                let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
                // SAFETY: index < AceCount.
                unsafe { GetAce(dacl, index, &mut ace) }
                    .map_err(|e| StudioError::win32("GetAce", &e))?;
                // SAFETY: every ACE starts with an ACE_HEADER.
                let header = unsafe { *ace.cast::<ACE_HEADER>() };
                if header.AceType == ACCESS_ALLOWED_ACE_TYPE {
                    // SAFETY: access-allowed ACE; its SID starts at SidStart.
                    let sid = unsafe { &raw mut (*ace.cast::<ACCESS_ALLOWED_ACE>()).SidStart };
                    sids.push(sid_string(PSID(sid.cast()))?);
                }
            }
            Ok(sids)
        })();
        // SAFETY: allocated by GetSecurityInfo.
        let _ = unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
        result
    }

    /// PID of the process connected to the pipe (`GetNamedPipeClientProcessId`).
    pub fn client_pid(pipe: &impl AsRawHandle) -> Result<u32> {
        use windows::Win32::System::Pipes::GetNamedPipeClientProcessId;
        let mut pid = 0u32;
        // SAFETY: valid connected server handle.
        unsafe { GetNamedPipeClientProcessId(HANDLE(pipe.as_raw_handle()), &mut pid) }
            .map_err(|e| StudioError::win32("GetNamedPipeClientProcessId", &e))?;
        Ok(pid)
    }
}

/// The single, hardened instance of the host pipe, before the engine connects.
#[cfg(windows)]
#[derive(Debug)]
pub struct PipeServer {
    name: String,
    pipe: tokio::net::windows::named_pipe::NamedPipeServer,
}

#[cfg(windows)]
impl PipeServer {
    /// Creates the pipe. Must run inside a Tokio runtime.
    ///
    /// # Errors
    /// [`StudioError::PipeSquatted`] when the name already exists; [`StudioError::Win32`] otherwise.
    pub fn create(name: &str) -> Result<PipeServer> {
        use tokio::net::windows::named_pipe::ServerOptions;
        const ERROR_ACCESS_DENIED: i32 = 5;
        const ERROR_PIPE_BUSY: i32 = 231;
        let mut security = sys::OwnerOnly::new()?;
        let mut options = ServerOptions::new();
        options
            .first_pipe_instance(OPTIONS.first_pipe_instance)
            .reject_remote_clients(OPTIONS.reject_remote_clients)
            .max_instances(OPTIONS.max_instances as usize)
            .access_inbound(true)
            .access_outbound(true);
        // SAFETY: `security` (descriptor and ACL) outlives the call.
        let created =
            unsafe { options.create_with_security_attributes_raw(name, security.attributes()) };
        match created {
            Ok(pipe) => Ok(PipeServer {
                name: name.to_owned(),
                pipe,
            }),
            // FILE_FLAG_FIRST_PIPE_INSTANCE on an existing name fails with ACCESS_DENIED (or
            // PIPE_BUSY when every instance is taken): report the squatting, never retry.
            Err(error)
                if matches!(
                    error.raw_os_error(),
                    Some(ERROR_ACCESS_DENIED | ERROR_PIPE_BUSY)
                ) =>
            {
                Err(StudioError::PipeSquatted)
            }
            Err(error) => Err(StudioError::io("CreateNamedPipeW", &error)),
        }
    }

    /// Pipe name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The hardened options the pipe was created with.
    pub fn options(&self) -> PipeOptions {
        OPTIONS
    }

    /// SIDs of the access ACEs of the pipe's DACL, read back with `GetSecurityInfo`.
    ///
    /// # Errors
    /// [`StudioError::Win32`] when the security information cannot be read.
    pub fn dacl_sids(&self) -> Result<Vec<String>> {
        use std::os::windows::io::AsRawHandle;
        sys::dacl_sids(self.pipe.as_raw_handle())
    }

    /// Waits for the engine, checks its PID and runs the handshake (plan §5): `studio.challenge`
    /// with a host nonce, verification of the engine proof, then `studio.hello` with the host proof.
    ///
    /// # Errors
    /// [`StudioError::PeerRejected`] for another PID; [`StudioError::HandshakeFailed`] for a wrong
    /// proof, a malformed reply or a timeout. In both cases the client is disconnected without
    /// receiving any further frame.
    pub async fn accept(self, expected_pid: u32, secret: &str) -> Result<PipeConnection> {
        self.pipe
            .connect()
            .await
            .map_err(|e| StudioError::io("ConnectNamedPipe", &e))?;
        let pid = sys::client_pid(&self.pipe)?;
        if pid != expected_pid {
            let _ = self.pipe.disconnect();
            return Err(StudioError::PeerRejected { pid });
        }
        let pipe = Arc::new(self.pipe);
        let mut reader = FrameReader::new();
        let hello = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            handshake(&pipe, &mut reader, pid, secret),
        )
        .await
        .unwrap_or(Err(StudioError::HandshakeFailed));
        match hello {
            Ok(()) => Ok(PipeConnection::start(pipe, reader)),
            Err(error) => {
                let _ = pipe.disconnect();
                Err(error)
            }
        }
    }
}

#[cfg(windows)]
async fn handshake(
    pipe: &tokio::net::windows::named_pipe::NamedPipeServer,
    reader: &mut FrameReader,
    pid: u32,
    secret: &str,
) -> Result<()> {
    let nonce = random_hex(32)?;
    let challenge = json!({
        "jsonrpc": "2.0",
        "id": 0,
        "method": "studio.challenge",
        "params": { "protocolVersion": PROTOCOL_VERSION, "nonce": nonce },
    });
    write_message(pipe, &challenge).await?;
    let reply = reader
        .next(pipe)
        .await?
        .ok_or(StudioError::HandshakeFailed)?;
    let reply: Value = serde_json::from_str(&reply).map_err(|_| StudioError::HandshakeFailed)?;
    let result = &reply["result"];
    let proof = result["proof"].as_str().unwrap_or_default();
    let engine_nonce = result["nonce"].as_str().unwrap_or_default();
    let accepted = reply["jsonrpc"] == "2.0"
        && reply["id"] == 0
        && result["protocolVersion"] == PROTOCOL_VERSION
        && result["pid"] == pid
        && is_hex64(engine_nonce)
        && verify_proof(secret, "engine", &nonce, proof);
    if !accepted {
        return Err(StudioError::HandshakeFailed);
    }
    let hello = json!({
        "jsonrpc": "2.0",
        "method": "studio.hello",
        "params": { "proof": handshake_proof(secret, "host", engine_nonce)? },
    });
    write_message(pipe, &hello).await
}

#[cfg(windows)]
type Pipe = tokio::net::windows::named_pipe::NamedPipeServer;

/// Reads whole frames from the pipe.
struct FrameReader {
    decoder: FrameDecoder,
    ready: std::collections::VecDeque<String>,
    buffer: Vec<u8>,
}

impl FrameReader {
    fn new() -> FrameReader {
        FrameReader {
            decoder: FrameDecoder::new(MAX_FRAME_BYTES),
            ready: std::collections::VecDeque::new(),
            buffer: vec![0; READ_CHUNK],
        }
    }

    /// The next frame, or `None` at end of stream.
    #[cfg(windows)]
    async fn next(&mut self, pipe: &Pipe) -> Result<Option<String>> {
        loop {
            if let Some(frame) = self.ready.pop_front() {
                return Ok(Some(frame));
            }
            pipe.readable()
                .await
                .map_err(|e| StudioError::io("ReadFile", &e))?;
            match pipe.try_read(&mut self.buffer) {
                Ok(0) => return Ok(None),
                Ok(read) => self.ready.extend(self.decoder.push(&self.buffer[..read])?),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                // Broken pipe / not connected: the peer is gone.
                Err(error) if matches!(error.raw_os_error(), Some(109 | 232 | 233)) => {
                    return Ok(None);
                }
                Err(error) => return Err(StudioError::io("ReadFile", &error)),
            }
        }
    }
}

#[cfg(windows)]
async fn write_message(pipe: &Pipe, message: &Value) -> Result<()> {
    let frame = encode_frame(&message.to_string())?;
    let mut written = 0;
    while written < frame.len() {
        pipe.writable()
            .await
            .map_err(|e| StudioError::io("WriteFile", &e))?;
        match pipe.try_write(&frame[written..]) {
            Ok(n) => written += n,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(StudioError::io("WriteFile", &error)),
        }
    }
    Ok(())
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>;

/// An authenticated connection to the engine: JSON-RPC calls with per-call timeouts and the
/// engine's notifications.
#[cfg(windows)]
#[derive(Debug)]
pub struct PipeConnection {
    pipe: Arc<Pipe>,
    write_lock: tokio::sync::Mutex<()>,
    next_id: AtomicU64,
    pending: Pending,
    closed: Arc<AtomicBool>,
    notifications: broadcast::Sender<Value>,
    reader: tokio::task::JoinHandle<()>,
}

#[cfg(windows)]
impl PipeConnection {
    fn start(pipe: Arc<Pipe>, mut reader: FrameReader) -> PipeConnection {
        let pending: Pending = Arc::default();
        let closed = Arc::new(AtomicBool::new(false));
        let (notifications, _) = broadcast::channel(NOTIFICATION_BACKLOG);
        let task = {
            let (pipe, pending, closed, notifications) = (
                Arc::clone(&pipe),
                Arc::clone(&pending),
                Arc::clone(&closed),
                notifications.clone(),
            );
            tokio::spawn(async move {
                while let Ok(Some(text)) = reader.next(&pipe).await {
                    route(&text, &pending, &notifications);
                }
                closed.store(true, Ordering::SeqCst);
                fail_pending(&pending, || StudioError::EngineDisconnected);
            })
        };
        PipeConnection {
            pipe,
            write_lock: tokio::sync::Mutex::new(()),
            next_id: AtomicU64::new(1),
            pending,
            closed,
            notifications,
            reader: task,
        }
    }

    /// Calls `method` with [`DEFAULT_CALL_TIMEOUT`].
    ///
    /// # Errors
    /// See [`PipeConnection::call_with_timeout`].
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.call_with_timeout(method, params, DEFAULT_CALL_TIMEOUT)
            .await
    }

    /// Sends a request and waits up to `timeout` for its reply. A timeout leaves the engine alive:
    /// a late reply is discarded.
    ///
    /// # Errors
    /// [`StudioError::EngineTimeout`], [`StudioError::EngineDisconnected`], or
    /// [`StudioError::Engine`] with the engine's domain error.
    pub async fn call_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(StudioError::EngineDisconnected);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        lock(&self.pending).insert(id, sender);
        let request = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(error) = self.send(&request).await {
            lock(&self.pending).remove(&id);
            return Err(error);
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(StudioError::EngineDisconnected),
            Err(_) => {
                lock(&self.pending).remove(&id);
                Err(StudioError::EngineTimeout {
                    method: method.to_owned(),
                })
            }
        }
    }

    /// Sends a notification (`fs.changed`, `fs.rescan`).
    ///
    /// # Errors
    /// [`StudioError::EngineDisconnected`] or a write failure.
    pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(StudioError::EngineDisconnected);
        }
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }

    /// Notifications pushed by the engine (`project.changed`, `finops.tick`).
    pub fn notifications(&self) -> broadcast::Receiver<Value> {
        self.notifications.subscribe()
    }

    /// True once the engine side closed or [`PipeConnection::close`] ran.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Ends every in-flight request with the error `make` builds.
    pub fn abort_pending(&self, make: impl Fn() -> StudioError) {
        fail_pending(&self.pending, make);
    }

    /// Disconnects the pipe; in-flight requests end with `ENGINE_DISCONNECTED`.
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.reader.abort();
        let _ = self.pipe.disconnect();
        fail_pending(&self.pending, || StudioError::EngineDisconnected);
    }

    async fn send(&self, message: &Value) -> Result<()> {
        let _guard = self.write_lock.lock().await;
        write_message(&self.pipe, message).await.map_err(|error| {
            if matches!(
                error,
                StudioError::Win32 {
                    code: 109 | 232 | 233,
                    ..
                }
            ) {
                StudioError::EngineDisconnected
            } else {
                error
            }
        })
    }
}

#[cfg(windows)]
impl Drop for PipeConnection {
    fn drop(&mut self) {
        self.reader.abort();
        let _ = self.pipe.disconnect();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn fail_pending(pending: &Pending, make: impl Fn() -> StudioError) {
    let senders: Vec<_> = lock(pending).drain().map(|(_, sender)| sender).collect();
    for sender in senders {
        let _ = sender.send(Err(make()));
    }
}

/// Delivers a reply to its caller or broadcasts a notification. Unknown ids (late replies after a
/// timeout) are dropped.
fn route(text: &str, pending: &Pending, notifications: &broadcast::Sender<Value>) {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return;
    };
    if let Some(id) = message.get("id").and_then(Value::as_u64)
        && (message.get("result").is_some() || message.get("error").is_some())
    {
        let Some(sender) = lock(pending).remove(&id) else {
            return;
        };
        let outcome = match message.get("error") {
            Some(error) => Err(engine_error(error)),
            None => Ok(message["result"].clone()),
        };
        let _ = sender.send(outcome);
        return;
    }
    if message.get("method").and_then(Value::as_str).is_some() && message.get("id").is_none() {
        let _ = notifications.send(message);
    }
}

fn engine_error(error: &Value) -> StudioError {
    StudioError::Engine {
        code: error["data"]["code"]
            .as_str()
            .unwrap_or("ENGINE_ERROR")
            .to_owned(),
        message: error["message"].as_str().unwrap_or_default().to_owned(),
        error: error.clone(),
    }
}

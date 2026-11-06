//! Atomic spawn into a Job Object (plan §1.7, §10.1, decision D-3).
//!
//! `CreateProcessW` receives a `STARTUPINFOEXW` whose attribute list carries
//! `PROC_THREAD_ATTRIBUTE_JOB_LIST`, so the child is a member of the job from its first instruction:
//! there is no window in which it could start grandchildren outside the job, and no
//! suspend/assign/resume dance. The same list carries `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE` for
//! ConPTY shells and `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`, so a child inherits only its own pipes.

use std::ffi::OsString;
use std::fs::File;
use std::os::windows::io::OwnedHandle;
use std::path::PathBuf;
use std::time::Duration;

use windows::Win32::Foundation::{
    HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, SetHandleInformation, WAIT_OBJECT_0,
    WAIT_TIMEOUT,
};
use windows::Win32::System::Console::HPCON;
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, INFINITE, InitializeProcThreadAttributeList,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, PROCESS_INFORMATION,
    STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW, TerminateProcess,
    UpdateProcThreadAttribute, WaitForSingleObject,
};
use windows::core::{PCWSTR, PWSTR};

use super::job::Job;
use super::{own, raw, wide};
use crate::error::{Result, StudioError};

/// What a standard stream of the child is connected to.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum StdioMode {
    /// Not redirected: the child uses its own (hidden) console.
    #[default]
    Console,
    /// The `NUL` device.
    Null,
    /// An anonymous pipe; the parent end is available from [`ChildProcess`].
    Piped,
}

/// Everything needed to start one process inside a job.
#[derive(Debug, Clone, Default)]
pub struct SpawnSpec {
    /// Executable to run (an absolute path, or a name resolved by `CreateProcessW`).
    pub program: PathBuf,
    /// Arguments, quoted with the MSVC rules.
    pub args: Vec<String>,
    /// Working directory; the host's when `None`.
    pub cwd: Option<PathBuf>,
    /// Variables added to (or overriding) the inherited environment.
    pub env: Vec<(OsString, OsString)>,
    /// Standard input of the child.
    pub stdin: StdioMode,
    /// Standard output of the child.
    pub stdout: StdioMode,
    /// Standard error of the child.
    pub stderr: StdioMode,
    /// Attach the child to this pseudoconsole (ConPTY); the stdio modes are then ignored.
    pub pseudoconsole: Option<HPCON>,
}

/// A process started by [`spawn_in_job`]. Dropping it closes the handles but does not kill it
/// (the job does that).
#[derive(Debug)]
pub struct ChildProcess {
    pid: u32,
    process: OwnedHandle,
    stdin: Option<File>,
    stdout: Option<File>,
    stderr: Option<File>,
}

impl ChildProcess {
    /// Process identifier.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Waits up to `timeout` and returns the exit code, or `None` while it keeps running.
    /// `Duration::MAX` waits forever.
    ///
    /// # Errors
    /// [`StudioError::Win32`] from `WaitForSingleObject` or `GetExitCodeProcess`.
    pub fn wait(&self, timeout: Duration) -> Result<Option<u32>> {
        let millis = u32::try_from(timeout.as_millis()).unwrap_or(INFINITE);
        // SAFETY: the process handle is valid for the lifetime of self.
        let event = unsafe { WaitForSingleObject(raw(&self.process), millis) };
        if event == WAIT_TIMEOUT {
            return Ok(None);
        }
        if event != WAIT_OBJECT_0 {
            return Err(StudioError::win32(
                "WaitForSingleObject",
                &windows::core::Error::from_thread(),
            ));
        }
        let mut code = 0u32;
        // SAFETY: valid handle and out pointer.
        unsafe { GetExitCodeProcess(raw(&self.process), &mut code) }
            .map_err(|e| StudioError::win32("GetExitCodeProcess", &e))?;
        Ok(Some(code))
    }

    /// Terminates the process (`TerminateProcess`, exit code 1).
    ///
    /// # Errors
    /// [`StudioError::Win32`] from `TerminateProcess`, except when it had already exited.
    pub fn kill(&self) -> Result<()> {
        // SAFETY: the process handle is valid for the lifetime of self.
        match unsafe { TerminateProcess(raw(&self.process), 1) } {
            Ok(()) => Ok(()),
            Err(error) => {
                if self.wait(Duration::ZERO)?.is_some() {
                    Ok(())
                } else {
                    Err(StudioError::win32("TerminateProcess", &error))
                }
            }
        }
    }

    /// The parent end of a piped stdin (once).
    pub fn take_stdin(&mut self) -> Option<File> {
        self.stdin.take()
    }

    /// The parent end of a piped stdout (once).
    pub fn take_stdout(&mut self) -> Option<File> {
        self.stdout.take()
    }

    /// The parent end of a piped stderr (once).
    pub fn take_stderr(&mut self) -> Option<File> {
        self.stderr.take()
    }
}

/// Quotes one argument for `CommandLineToArgvW` / the MSVC CRT.
fn quote_arg(arg: &str, out: &mut String) {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\u{b}', '"']) {
        out.push_str(arg);
        return;
    }
    out.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat_n('\\', backslashes * 2));
    out.push('"');
}

fn command_line(spec: &SpawnSpec) -> Vec<u16> {
    let mut line = String::new();
    quote_arg(&spec.program.to_string_lossy(), &mut line);
    for arg in &spec.args {
        line.push(' ');
        quote_arg(arg, &mut line);
    }
    wide(line.as_ref())
}

/// UTF-16 environment block: the host's variables plus `overrides`, sorted case-insensitively.
fn environment_block(overrides: &[(OsString, OsString)]) -> Vec<u16> {
    let key = |name: &OsString| name.to_string_lossy().to_uppercase();
    let mut vars: Vec<(OsString, OsString)> = std::env::vars_os()
        .filter(|(name, _)| !overrides.iter().any(|(o, _)| key(o) == key(name)))
        .collect();
    vars.extend(overrides.iter().cloned());
    vars.sort_by_key(|(name, _)| key(name));
    let mut block = Vec::new();
    for (name, value) in vars {
        let mut entry = name;
        entry.push("=");
        entry.push(value);
        block.extend(wide(&entry));
    }
    block.push(0);
    block
}

/// Owns an initialised attribute list and deletes it on drop.
struct AttributeList {
    buffer: Vec<u64>,
}

impl AttributeList {
    fn new(count: u32) -> Result<AttributeList> {
        let mut size = 0usize;
        // SAFETY: size query; the call is expected to fail with ERROR_INSUFFICIENT_BUFFER.
        let _ = unsafe { InitializeProcThreadAttributeList(None, count, None, &mut size) };
        let mut list = AttributeList {
            buffer: vec![0u64; size.div_ceil(8).max(1)],
        };
        // SAFETY: the buffer is at least `size` bytes and 8-byte aligned.
        unsafe { InitializeProcThreadAttributeList(Some(list.ptr()), count, None, &mut size) }
            .map_err(|e| {
                list.buffer.clear();
                StudioError::win32("InitializeProcThreadAttributeList", &e)
            })?;
        Ok(list)
    }

    fn ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        LPPROC_THREAD_ATTRIBUTE_LIST(self.buffer.as_mut_ptr().cast())
    }

    /// # Safety
    /// `value` must stay valid until `CreateProcessW` returns (the list stores the pointer).
    unsafe fn set(
        &mut self,
        attribute: u32,
        value: *const core::ffi::c_void,
        size: usize,
    ) -> Result<()> {
        // SAFETY: guaranteed by the caller; the list was initialised in new().
        unsafe {
            UpdateProcThreadAttribute(
                self.ptr(),
                0,
                attribute as usize,
                Some(value),
                size,
                None,
                None,
            )
        }
        .map_err(|e| StudioError::win32("UpdateProcThreadAttribute", &e))
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        if !self.buffer.is_empty() {
            // SAFETY: the list was initialised and is deleted exactly once.
            unsafe { DeleteProcThreadAttributeList(self.ptr()) };
        }
    }
}

/// An anonymous pipe as (read end, write end), both non-inheritable.
pub(crate) fn anonymous_pipe() -> Result<(OwnedHandle, OwnedHandle)> {
    let mut read = HANDLE::default();
    let mut write = HANDLE::default();
    // SAFETY: valid out pointers; both handles are owned right away.
    unsafe { CreatePipe(&mut read, &mut write, None, 0) }
        .map_err(|e| StudioError::win32("CreatePipe", &e))?;
    // SAFETY: both handles were just created and are closed only by OwnedHandle.
    Ok(unsafe { (own(read), own(write)) })
}

fn make_inheritable(handle: &OwnedHandle) -> Result<()> {
    // SAFETY: valid handle owned by the caller.
    unsafe { SetHandleInformation(raw(handle), HANDLE_FLAG_INHERIT.0, HANDLE_FLAG_INHERIT) }
        .map_err(|e| StudioError::win32("SetHandleInformation", &e))
}

/// The child end of one standard stream and, for pipes, the parent end.
fn child_stream(mode: StdioMode, child_reads: bool) -> Result<(OwnedHandle, Option<File>)> {
    match mode {
        StdioMode::Piped => {
            let (read, write) = anonymous_pipe()?;
            let (child, parent) = if child_reads {
                (read, write)
            } else {
                (write, read)
            };
            Ok((child, Some(File::from(parent))))
        }
        StdioMode::Console | StdioMode::Null => {
            let nul = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open("NUL")
                .map_err(|e| StudioError::io("open NUL", &e))?;
            Ok((OwnedHandle::from(nul), None))
        }
    }
}

/// Starts `spec` as a member of `job`, atomically (`PROC_THREAD_ATTRIBUTE_JOB_LIST`).
///
/// # Errors
/// [`StudioError::Win32`] with the failing call, e.g. `{ op: "CreateProcessW", code: 2 }` for a
/// missing executable.
pub fn spawn_in_job(job: &Job, spec: SpawnSpec) -> Result<ChildProcess> {
    let redirect = spec.pseudoconsole.is_none()
        && [spec.stdin, spec.stdout, spec.stderr]
            .iter()
            .any(|mode| *mode != StdioMode::Console);
    let mut parent_ends = (None, None, None);
    let mut child_ends: Vec<OwnedHandle> = Vec::new();
    if redirect {
        let (stdin, parent_stdin) = child_stream(spec.stdin, true)?;
        let (stdout, parent_stdout) = child_stream(spec.stdout, false)?;
        let (stderr, parent_stderr) = child_stream(spec.stderr, false)?;
        parent_ends = (parent_stdin, parent_stdout, parent_stderr);
        child_ends = vec![stdin, stdout, stderr];
        for handle in &child_ends {
            make_inheritable(handle)?;
        }
    }
    let inherited: Vec<HANDLE> = child_ends.iter().map(raw).collect();
    let jobs = [raw(job.handle())];

    let mut attributes = AttributeList::new(if spec.pseudoconsole.is_some() || redirect {
        2
    } else {
        1
    })?;
    // SAFETY: `jobs`, `inherited` and the HPCON value outlive CreateProcessW below.
    unsafe {
        attributes.set(
            PROC_THREAD_ATTRIBUTE_JOB_LIST,
            jobs.as_ptr().cast(),
            size_of_val(&jobs),
        )?;
        if let Some(hpc) = spec.pseudoconsole {
            // The PSEUDOCONSOLE attribute takes the HPCON value itself as the "pointer".
            attributes.set(
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                hpc.0 as *const core::ffi::c_void,
                size_of::<HPCON>(),
            )?;
        } else if redirect {
            attributes.set(
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                inherited.as_ptr().cast(),
                size_of_val(inherited.as_slice()),
            )?;
        }
    }

    let mut startup = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: size_of::<STARTUPINFOEXW>() as u32,
            ..Default::default()
        },
        lpAttributeList: attributes.ptr(),
    };
    if spec.pseudoconsole.is_some() {
        // Never let the shell fall back to the host's own (possibly redirected) stdio.
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
        startup.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
        startup.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
    } else if redirect {
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = inherited[0];
        startup.StartupInfo.hStdOutput = inherited[1];
        startup.StartupInfo.hStdError = inherited[2];
    }

    let mut flags = EXTENDED_STARTUPINFO_PRESENT;
    if spec.pseudoconsole.is_none() {
        flags |= CREATE_NO_WINDOW;
    }
    let environment = (!spec.env.is_empty()).then(|| environment_block(&spec.env));
    if environment.is_some() {
        flags |= CREATE_UNICODE_ENVIRONMENT;
    }
    let application = spec
        .program
        .is_absolute()
        .then(|| wide(spec.program.as_os_str()));
    let mut line = command_line(&spec);
    let cwd = spec.cwd.as_ref().map(|dir| wide(dir.as_os_str()));
    let mut info = PROCESS_INFORMATION::default();
    // SAFETY: every pointer refers to a live, null-terminated buffer or struct of this frame.
    unsafe {
        CreateProcessW(
            application
                .as_ref()
                .map_or(PCWSTR::null(), |a| PCWSTR(a.as_ptr())),
            Some(PWSTR(line.as_mut_ptr())),
            None,
            None,
            redirect,
            flags,
            environment.as_ref().map(|block| block.as_ptr().cast()),
            cwd.as_ref().map_or(PCWSTR::null(), |c| PCWSTR(c.as_ptr())),
            &raw const startup.StartupInfo,
            &mut info,
        )
    }
    .map_err(|e| StudioError::win32("CreateProcessW", &e))?;
    drop(attributes);
    drop(child_ends);
    // SAFETY: both handles were returned by CreateProcessW and are owned here.
    let (process, thread) = unsafe { (own(info.hProcess), own(info.hThread)) };
    drop(thread);
    Ok(ChildProcess {
        pid: info.dwProcessId,
        process,
        stdin: parent_ends.0,
        stdout: parent_ends.1,
        stderr: parent_ends.2,
    })
}

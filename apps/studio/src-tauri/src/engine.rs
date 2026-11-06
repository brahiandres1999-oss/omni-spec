//! Engine supervisor (plan §10.3, decisions D-1, D-4, D-12).
//!
//! The host resolves Node.js, creates the hardened pipe, launches
//! `node <entry> studio-engine --pipe <name>` inside its own Job Object, writes the 256-bit secret
//! on the engine's stdin (which stays open: its EOF tells the engine the host died) and completes
//! the handshake. Crashes are restarted with a 250 ms·2ⁿ backoff, at most 3 times in 60 s; after
//! that the supervisor settles in `ENGINE_DEAD`.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::error::{Result, StudioError};

/// A `major.minor.patch` Node.js version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct NodeVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl NodeVersion {
    /// Oldest supported Node.js (`node:sqlite` without a flag).
    pub const MINIMUM: NodeVersion = NodeVersion {
        major: 22,
        minor: 19,
        patch: 0,
    };

    /// Parses `node --version` output (`v24.22.1\r\n`, or without the `v`).
    ///
    /// # Errors
    /// [`StudioError::NodeUnsupported`] carrying the unparsable text.
    pub fn parse(text: &str) -> Result<NodeVersion> {
        let trimmed = text.trim();
        let digits = trimmed.strip_prefix('v').unwrap_or(trimmed);
        let unsupported = || StudioError::NodeUnsupported {
            found: trimmed.to_owned(),
        };
        let parts: Vec<&str> = digits.split('.').collect();
        let [major, minor, patch] = parts.as_slice() else {
            return Err(unsupported());
        };
        let number = |part: &str| {
            if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
                return Err(unsupported());
            }
            part.parse::<u32>().map_err(|_| unsupported())
        };
        Ok(NodeVersion {
            major: number(major)?,
            minor: number(minor)?,
            patch: number(patch)?,
        })
    }
}

impl std::fmt::Display for NodeVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "v{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// The Node.js executable Studio will run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedNode {
    pub path: PathBuf,
    pub version: NodeVersion,
}

/// Resolves Node.js: `OMNI_STUDIO_NODE` first (never falling back when it is unsupported), then
/// `node.exe` on `PATH`. The version must be at least [`NodeVersion::MINIMUM`].
///
/// # Errors
/// [`StudioError::NodeUnsupported`] or [`StudioError::NodeNotFound`].
pub fn resolve_node(
    env: impl Fn(&str) -> Option<String>,
    path_lookup: impl Fn(&str) -> Option<PathBuf>,
    version_of: impl Fn(&Path) -> Result<String>,
) -> Result<ResolvedNode> {
    let path = match env("OMNI_STUDIO_NODE").filter(|value| !value.trim().is_empty()) {
        Some(custom) => PathBuf::from(custom.trim()),
        None => path_lookup("node.exe").ok_or(StudioError::NodeNotFound)?,
    };
    let version = NodeVersion::parse(&version_of(&path)?)?;
    if version < NodeVersion::MINIMUM {
        return Err(StudioError::NodeUnsupported {
            found: version.to_string(),
        });
    }
    Ok(ResolvedNode { path, version })
}

/// Finds `name` in the directories of `PATH`.
pub fn path_lookup(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// Output of `<node> --version`, run without a console window.
///
/// # Errors
/// [`StudioError::NodeNotFound`] when it cannot run.
pub fn node_version_output(node: &Path) -> Result<String> {
    let mut command = std::process::Command::new(node);
    command.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().map_err(|_| StudioError::NodeNotFound)?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Resolves Node.js from the real environment.
///
/// # Errors
/// See [`resolve_node`].
pub fn resolve_system_node() -> Result<ResolvedNode> {
    resolve_node(
        |key| std::env::var(key).ok(),
        path_lookup,
        node_version_output,
    )
}

/// The bundled CLI `<resources>/omni-spec/bin/omni-spec.mjs`, whose `package.json` version must be
/// the app version (D-4).
///
/// # Errors
/// [`StudioError::EngineMissing`] or [`StudioError::EngineMismatch`].
pub fn engine_entry(resources: &Path) -> Result<PathBuf> {
    let core = resources.join("omni-spec");
    let entry = core.join("bin").join("omni-spec.mjs");
    if !entry.is_file() {
        return Err(StudioError::EngineMissing { path: entry });
    }
    let manifest = core.join("package.json");
    let package: serde_json::Value = std::fs::read_to_string(&manifest)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or(StudioError::EngineMissing { path: manifest })?;
    let bundled = package["version"].as_str().unwrap_or("unknown");
    let app = env!("CARGO_PKG_VERSION");
    if bundled != app {
        return Err(StudioError::EngineMismatch {
            bundled: bundled.to_owned(),
            app: app.to_owned(),
        });
    }
    Ok(entry)
}

/// Restart budget: delays of 250 ms·2ⁿ, at most 3 restarts inside any 60 s window. Exhausting it
/// is terminal.
#[derive(Debug, Clone, Default)]
pub struct Backoff {
    crashes: VecDeque<Instant>,
    dead: bool,
}

impl Backoff {
    const BASE: Duration = Duration::from_millis(250);
    const WINDOW: Duration = Duration::from_secs(60);
    const MAX_RESTARTS: usize = 3;

    pub fn new() -> Backoff {
        Backoff::default()
    }

    /// Records a crash at `now` and returns the delay before the restart.
    ///
    /// # Errors
    /// [`StudioError::EngineDead`] once the budget is exhausted, and forever after.
    pub fn on_crash(&mut self, now: Instant) -> Result<Duration> {
        if self.dead {
            return Err(StudioError::EngineDead);
        }
        while self
            .crashes
            .front()
            .is_some_and(|first| now.saturating_duration_since(*first) >= Self::WINDOW)
        {
            self.crashes.pop_front();
        }
        if self.crashes.len() >= Self::MAX_RESTARTS {
            self.dead = true;
            return Err(StudioError::EngineDead);
        }
        let delay = Self::BASE * 2u32.pow(self.crashes.len() as u32);
        self.crashes.push_back(now);
        Ok(delay)
    }

    /// True once the budget is exhausted.
    pub fn is_dead(&self) -> bool {
        self.dead
    }
}

/// Size of the engine stderr ring buffer shown in the Error view (EG-05).
pub const STDERR_RING_BYTES: usize = 256 * 1024;

/// The last [`STDERR_RING_BYTES`] bytes written by the engine.
#[derive(Debug, Default)]
pub struct StderrRing {
    bytes: std::sync::Mutex<VecDeque<u8>>,
}

impl StderrRing {
    pub fn push(&self, chunk: &[u8]) {
        let mut bytes = self
            .bytes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        bytes.extend(chunk);
        let excess = bytes.len().saturating_sub(STDERR_RING_BYTES);
        bytes.drain(..excess);
    }

    pub fn clear(&self) {
        self.bytes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    /// The buffered text, starting at a character boundary.
    pub fn tail(&self) -> String {
        let bytes = self
            .bytes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let skip = bytes
            .iter()
            .take(3)
            .take_while(|b| (0x80..0xC0).contains(*b))
            .count();
        let contiguous: Vec<u8> = bytes.iter().skip(skip).copied().collect();
        String::from_utf8_lossy(&contiguous).into_owned()
    }
}

#[cfg(windows)]
pub use supervisor::{EngineConfig, EngineExit, EngineState, Supervisor};

#[cfg(windows)]
mod supervisor {
    use std::fs::File;
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex, MutexGuard, Weak};
    use std::time::{Duration, Instant};

    use serde_json::{Value, json};
    use tokio::sync::{broadcast, watch};

    use super::{Backoff, StderrRing};
    use crate::error::{Result, StudioError};
    use crate::pipe::{DEFAULT_CALL_TIMEOUT, PipeConnection, PipeServer, new_pipe_name};
    use crate::protocol::random_hex;
    use crate::security::is_method_allowed;
    use crate::win32::job::Job;
    use crate::win32::spawn::{ChildProcess, SpawnSpec, StdioMode, spawn_in_job};

    /// How the engine is launched.
    #[derive(Debug, Clone)]
    pub struct EngineConfig {
        /// `node.exe` (see [`super::resolve_node`]).
        pub node: PathBuf,
        /// `bin/omni-spec.mjs` (see [`super::engine_entry`]).
        pub entry: PathBuf,
        /// Project root, used as the engine's working directory.
        pub root: PathBuf,
        /// Per-call timeout (PP-10).
        pub call_timeout: Duration,
        /// Spawn-to-handshake limit.
        pub handshake_timeout: Duration,
        /// Time the engine gets to exit after the pipe closes before the job kills it (EG-06).
        pub exit_grace: Duration,
    }

    impl EngineConfig {
        pub fn new(node: PathBuf, entry: PathBuf, root: PathBuf) -> EngineConfig {
            EngineConfig {
                node,
                entry,
                root,
                call_timeout: DEFAULT_CALL_TIMEOUT,
                handshake_timeout: Duration::from_secs(10),
                exit_grace: Duration::from_secs(1),
            }
        }
    }

    /// Lifecycle state shown by the UI.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum EngineState {
        Starting,
        Running,
        Restarting,
        /// The restart budget is exhausted (`ENGINE_DEAD`).
        Dead,
        Stopped,
    }

    /// How a shut-down engine ended.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct EngineExit {
        /// Process exit code, when it could be read.
        pub code: Option<i32>,
        /// True when the engine ignored the closed pipe and closing its job killed it.
        pub killed_by_job: bool,
        /// Time from the start of the shutdown to the process exit.
        pub elapsed: Duration,
    }

    struct Instance {
        pid: u32,
        connection: Arc<PipeConnection>,
        child: Arc<ChildProcess>,
        job: Option<Job>,
        stdin: Option<File>,
        exit: watch::Receiver<Option<i32>>,
        forwarder: tokio::task::JoinHandle<()>,
    }

    struct Shared {
        config: EngineConfig,
        state: EngineState,
        generation: u64,
        instance: Option<Instance>,
        pipe_name: String,
        backoff: Backoff,
    }

    struct Inner {
        shared: Mutex<Shared>,
        lifecycle: tokio::sync::Mutex<()>,
        stderr: Arc<StderrRing>,
        events: broadcast::Sender<Value>,
    }

    impl Inner {
        fn shared(&self) -> MutexGuard<'_, Shared> {
            self.shared
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
        }

        /// Publishes a lifecycle change as an `engine.state` notification, next to the engine's own
        /// notifications, so the UI can show "restarting" and refresh when the engine is back.
        fn announce(&self, state: &str) {
            let _ = self.events.send(json!({
                "jsonrpc": "2.0",
                "method": "engine.state",
                "params": { "state": state },
            }));
        }
    }

    /// Owns the engine process of the active project.
    pub struct Supervisor {
        inner: Arc<Inner>,
    }

    impl std::fmt::Debug for Supervisor {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("Supervisor")
                .field("state", &self.state())
                .field("pid", &self.engine_pid())
                .finish()
        }
    }

    impl Supervisor {
        /// Launches the engine and completes the handshake.
        ///
        /// # Errors
        /// Pipe, spawn or handshake errors of the first launch (no restart for those).
        pub async fn start(config: EngineConfig) -> Result<Supervisor> {
            let (events, _) = broadcast::channel(256);
            let inner = Arc::new(Inner {
                shared: Mutex::new(Shared {
                    config,
                    state: EngineState::Starting,
                    generation: 0,
                    instance: None,
                    pipe_name: String::new(),
                    backoff: Backoff::new(),
                }),
                lifecycle: tokio::sync::Mutex::new(()),
                stderr: Arc::default(),
                events,
            });
            {
                let _lifecycle = inner.lifecycle.lock().await;
                launch(&inner).await?;
            }
            Ok(Supervisor { inner })
        }

        /// PID of the running engine.
        pub fn engine_pid(&self) -> Option<u32> {
            self.inner.shared().instance.as_ref().map(|i| i.pid)
        }

        /// Pipe of the current (or last) engine.
        pub fn pipe_name(&self) -> String {
            self.inner.shared().pipe_name.clone()
        }

        /// Current lifecycle state.
        pub fn state(&self) -> EngineState {
            self.inner.shared().state
        }

        /// Project root served by the engine.
        pub fn root(&self) -> PathBuf {
            self.inner.shared().config.root.clone()
        }

        /// The last 256 KiB of engine stderr (EG-05).
        pub fn stderr_tail(&self) -> String {
            self.inner.stderr.tail()
        }

        /// Notifications from the engine (`project.changed`, `finops.tick`), across restarts.
        pub fn subscribe(&self) -> broadcast::Receiver<Value> {
            self.inner.events.subscribe()
        }

        /// Forwards a frontend request. Methods outside the allowlist never reach the engine.
        ///
        /// # Errors
        /// `METHOD_NOT_ALLOWED`, `ENGINE_DEAD`, `ENGINE_RESTARTING`, `ENGINE_TIMEOUT`,
        /// `PROJECT_SWITCHED` or the engine's domain error.
        pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
            if !is_method_allowed(method) {
                return Err(StudioError::MethodNotAllowed {
                    method: method.to_owned(),
                });
            }
            let (connection, timeout) = self.connection()?;
            connection.call_with_timeout(method, params, timeout).await
        }

        /// Sends a host notification (`fs.changed`, `fs.rescan`) to the engine.
        ///
        /// # Errors
        /// Same availability errors as [`Supervisor::call`].
        pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
            let (connection, _) = self.connection()?;
            connection.notify(method, params).await
        }

        fn connection(&self) -> Result<(Arc<PipeConnection>, Duration)> {
            let shared = self.inner.shared();
            match (&shared.instance, shared.state) {
                (_, EngineState::Dead) => Err(StudioError::EngineDead),
                (Some(instance), _) => {
                    Ok((Arc::clone(&instance.connection), shared.config.call_timeout))
                }
                (None, EngineState::Stopped) => Err(StudioError::EngineDisconnected),
                (None, _) => Err(StudioError::EngineRestarting),
            }
        }

        /// Closes the pipe and stdin; the engine must exit within the grace period, otherwise
        /// closing its job kills it (EG-06).
        ///
        /// # Errors
        /// Win32 errors while waiting for the process.
        pub async fn shutdown(&self) -> Result<EngineExit> {
            let _lifecycle = self.inner.lifecycle.lock().await;
            let (instance, grace) = {
                let mut shared = self.inner.shared();
                shared.generation += 1;
                shared.state = EngineState::Stopped;
                (shared.instance.take(), shared.config.exit_grace)
            };
            match instance {
                Some(instance) => stop(instance, grace, || StudioError::EngineDisconnected).await,
                None => Ok(EngineExit {
                    code: None,
                    killed_by_job: false,
                    elapsed: Duration::ZERO,
                }),
            }
        }

        /// Replaces the engine with one serving `root`, with a new pipe and a new secret.
        /// In-flight requests of the previous engine end with `PROJECT_SWITCHED` (EG-08).
        ///
        /// # Errors
        /// Launch errors of the new engine (the supervisor is then `Stopped`).
        pub async fn switch_project(&self, root: &Path) -> Result<()> {
            let _lifecycle = self.inner.lifecycle.lock().await;
            let (previous, grace) = {
                let mut shared = self.inner.shared();
                shared.generation += 1;
                shared.state = EngineState::Starting;
                (shared.instance.take(), shared.config.exit_grace)
            };
            if let Some(previous) = previous {
                stop(previous, grace, || StudioError::ProjectSwitched).await?;
            }
            {
                let mut shared = self.inner.shared();
                shared.config.root = root.to_path_buf();
                shared.backoff = Backoff::new();
            }
            self.inner.stderr.clear();
            if let Err(error) = launch(&self.inner).await {
                self.inner.shared().state = EngineState::Stopped;
                return Err(error);
            }
            Ok(())
        }
    }

    /// Starts one engine and installs it as the current instance. Caller holds `lifecycle`.
    async fn launch(inner: &Arc<Inner>) -> Result<()> {
        let (config, generation) = {
            let mut shared = inner.shared();
            shared.generation += 1;
            (shared.config.clone(), shared.generation)
        };
        let mut instance = spawn_engine(&config, &inner.stderr).await?;
        let exit = instance.exit.clone();
        instance.forwarder = forward(&instance.connection, inner.events.clone());
        {
            let mut shared = inner.shared();
            shared.pipe_name = instance.connection_name.clone();
            shared.instance = Some(instance.into_instance());
            shared.state = EngineState::Running;
        }
        monitor(Arc::downgrade(inner), generation, exit);
        Ok(())
    }

    /// Watches the engine of `generation` and handles its exit. A plain function, so the
    /// launch -> monitor -> launch cycle does not make the futures' `Send` proof recursive.
    fn monitor(weak: Weak<Inner>, generation: u64, mut exit: watch::Receiver<Option<i32>>) {
        tokio::spawn(async move {
            let _ = exit.wait_for(Option::is_some).await;
            on_exit(weak, generation).await;
        });
    }

    fn forward(
        connection: &PipeConnection,
        events: broadcast::Sender<Value>,
    ) -> tokio::task::JoinHandle<()> {
        let mut notifications = connection.notifications();
        tokio::spawn(async move {
            loop {
                match notifications.recv().await {
                    Ok(message) => {
                        let _ = events.send(message);
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    }

    /// Crash handling for the engine of `generation`: restart with backoff or settle in Dead.
    async fn on_exit(weak: Weak<Inner>, generation: u64) {
        let Some(inner) = weak.upgrade() else {
            return;
        };
        let _lifecycle = inner.lifecycle.lock().await;
        let crashed = {
            let mut shared = inner.shared();
            if shared.generation != generation {
                return; // intentional shutdown or switch
            }
            shared.instance.take()
        };
        if let Some(crashed) = crashed {
            crashed.connection.close();
            crashed.forwarder.abort();
        }
        loop {
            let delay = {
                let mut shared = inner.shared();
                match shared.backoff.on_crash(Instant::now()) {
                    Ok(delay) => {
                        shared.state = EngineState::Restarting;
                        delay
                    }
                    Err(_) => {
                        shared.state = EngineState::Dead;
                        drop(shared);
                        inner.announce("dead");
                        return;
                    }
                }
            };
            inner.announce("restarting");
            tokio::time::sleep(delay).await;
            if launch(&inner).await.is_ok() {
                inner.announce("running");
                return;
            }
        }
    }

    /// A launched engine before it is installed in `Shared`.
    struct Launched {
        connection_name: String,
        pid: u32,
        connection: Arc<PipeConnection>,
        child: Arc<ChildProcess>,
        job: Job,
        stdin: File,
        exit: watch::Receiver<Option<i32>>,
        forwarder: tokio::task::JoinHandle<()>,
    }

    impl Launched {
        fn into_instance(self) -> Instance {
            Instance {
                pid: self.pid,
                connection: self.connection,
                child: self.child,
                job: Some(self.job),
                stdin: Some(self.stdin),
                exit: self.exit,
                forwarder: self.forwarder,
            }
        }
    }

    async fn spawn_engine(
        config: &EngineConfig,
        stderr_ring: &Arc<StderrRing>,
    ) -> Result<Launched> {
        // The pipe exists before the engine does (D-1).
        let pipe_name = new_pipe_name();
        let server = PipeServer::create(&pipe_name)?;
        let secret = random_hex(32)?;
        let job = Job::kill_on_close()?;
        let mut child = spawn_in_job(
            &job,
            SpawnSpec {
                program: config.node.clone(),
                args: vec![
                    config.entry.to_string_lossy().into_owned(),
                    "studio-engine".to_owned(),
                    "--pipe".to_owned(),
                    pipe_name.clone(),
                ],
                cwd: Some(config.root.clone()),
                stdin: StdioMode::Piped,
                stdout: StdioMode::Null,
                stderr: StdioMode::Piped,
                ..SpawnSpec::default()
            },
        )?;
        let pid = child.pid();
        let mut stdin = child
            .take_stdin()
            .ok_or(StudioError::EngineExited { code: None })?;
        if let Some(stderr) = child.take_stderr() {
            pump_stderr(stderr, Arc::clone(stderr_ring));
        }
        let child = Arc::new(child);
        let mut exit = watch_exit(Arc::clone(&child));
        // The secret travels on stdin only, never in argv or the environment (EG-03).
        stdin
            .write_all(format!("{secret}\n").as_bytes())
            .and_then(|()| stdin.flush())
            .map_err(|e| StudioError::io("write engine stdin", &e))?;

        let accepted = tokio::select! {
            accepted = tokio::time::timeout(config.handshake_timeout, server.accept(pid, &secret)) => {
                accepted.unwrap_or(Err(StudioError::HandshakeFailed))
            }
            waited = exit.wait_for(Option::is_some) => {
                let code = waited.ok().and_then(|value| *value);
                Err(StudioError::EngineExited { code })
            }
        };
        let connection = match accepted {
            Ok(connection) => Arc::new(connection),
            Err(error) => {
                drop(job); // kills the engine
                return Err(error);
            }
        };
        Ok(Launched {
            connection_name: pipe_name,
            pid,
            connection,
            child,
            job,
            stdin,
            exit,
            forwarder: tokio::spawn(async {}),
        })
    }

    fn pump_stderr(mut stderr: File, ring: Arc<StderrRing>) {
        std::thread::spawn(move || {
            let mut buffer = vec![0u8; 16 * 1024];
            while let Ok(read) = stderr.read(&mut buffer) {
                if read == 0 {
                    break;
                }
                ring.push(&buffer[..read]);
            }
        });
    }

    /// A thread blocks on the process handle and publishes the exit code.
    fn watch_exit(child: Arc<ChildProcess>) -> watch::Receiver<Option<i32>> {
        let (sender, receiver) = watch::channel(None);
        std::thread::spawn(move || {
            let code = child
                .wait(Duration::MAX)
                .ok()
                .flatten()
                .map(u32::cast_signed);
            let _ = sender.send(Some(code.unwrap_or(-1)));
        });
        receiver
    }

    async fn stop(
        mut instance: Instance,
        grace: Duration,
        reason: impl Fn() -> StudioError,
    ) -> Result<EngineExit> {
        let started = Instant::now();
        instance.connection.abort_pending(&reason);
        instance.connection.close();
        instance.forwarder.abort();
        drop(instance.stdin.take());
        let mut exit = instance.exit.clone();
        if let Ok(Ok(value)) = tokio::time::timeout(grace, exit.wait_for(Option::is_some)).await {
            let code = *value;
            return Ok(EngineExit {
                code,
                killed_by_job: false,
                elapsed: started.elapsed(),
            });
        }
        drop(instance.job.take()); // KILL_ON_JOB_CLOSE
        let code = match tokio::time::timeout(
            Duration::from_secs(2),
            exit.wait_for(Option::is_some),
        )
        .await
        {
            Ok(Ok(value)) => *value,
            _ => {
                instance.child.kill()?;
                None
            }
        };
        Ok(EngineExit {
            code,
            killed_by_job: true,
            elapsed: started.elapsed(),
        })
    }
}

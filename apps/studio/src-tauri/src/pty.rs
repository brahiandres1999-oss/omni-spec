//! ConPTY terminal bridge (plan §1.7, §1.9, §10.4, decision D-12).
//!
//! The shell is created inside the terminals Job Object with `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`
//! and `PROC_THREAD_ATTRIBUTE_JOB_LIST` in the same attribute list. Output is read on its own
//! thread, which never stops draining (otherwise `ClosePseudoConsole` can block, §1.9), and
//! batched every ≤ 16 ms or ≤ 64 KiB into a bounded channel (backpressure on the shell).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::error::{Result, StudioError};

/// Longest time output waits before it is delivered.
pub const BATCH_MAX_DELAY: Duration = Duration::from_millis(16);
/// Largest output event.
pub const BATCH_MAX_BYTES: usize = 64 * 1024;

/// Shells tried in order when none is configured (D-12).
pub const DEFAULT_SHELLS: &[&str] = &["pwsh.exe", "powershell.exe", "cmd.exe"];

/// Resolves the terminal shell. A configured `preference` is used as is or fails; without one the
/// first of [`DEFAULT_SHELLS`] found by `lookup` wins.
///
/// # Errors
/// [`StudioError::ShellNotFound`] naming the configured shell (or the default chain).
pub fn resolve_shell(
    preference: Option<&str>,
    lookup: impl Fn(&str) -> Option<PathBuf>,
) -> Result<PathBuf> {
    if let Some(shell) = preference.map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(shell);
        if path.is_absolute() {
            return if path.is_file() {
                Ok(path)
            } else {
                Err(StudioError::ShellNotFound {
                    shell: shell.to_owned(),
                })
            };
        }
        return lookup(shell).ok_or_else(|| StudioError::ShellNotFound {
            shell: shell.to_owned(),
        });
    }
    DEFAULT_SHELLS
        .iter()
        .find_map(|shell| lookup(shell))
        .ok_or_else(|| StudioError::ShellNotFound {
            shell: DEFAULT_SHELLS.join(", "),
        })
}

/// Groups output bytes into events: a batch is flushed when it reaches `max_bytes`, or `max_delay`
/// after its first byte. Byte order is preserved.
#[derive(Debug)]
pub struct OutputBatcher {
    max_delay: Duration,
    max_bytes: usize,
    pending: Vec<u8>,
    first: Option<Instant>,
}

impl OutputBatcher {
    pub fn new(max_delay: Duration, max_bytes: usize) -> OutputBatcher {
        OutputBatcher {
            max_delay,
            max_bytes: max_bytes.max(1),
            pending: Vec::new(),
            first: None,
        }
    }

    /// Adds bytes received at `now`; returns the batches that became full.
    pub fn push(&mut self, bytes: &[u8], now: Instant) -> Vec<Vec<u8>> {
        if bytes.is_empty() {
            return Vec::new();
        }
        if self.pending.is_empty() {
            self.first = Some(now);
        }
        self.pending.extend_from_slice(bytes);
        let mut full = Vec::new();
        while self.pending.len() >= self.max_bytes {
            let rest = self.pending.split_off(self.max_bytes);
            full.push(std::mem::replace(&mut self.pending, rest));
            self.first = Some(now);
        }
        if self.pending.is_empty() {
            self.first = None;
        }
        full
    }

    /// When the pending batch is due.
    pub fn deadline(&self) -> Option<Instant> {
        self.first.map(|first| first + self.max_delay)
    }

    /// The pending batch, if it is due at `now`.
    pub fn poll(&mut self, now: Instant) -> Option<Vec<u8>> {
        if now < self.deadline()? {
            return None;
        }
        self.flush()
    }

    /// The pending batch, due or not.
    pub fn flush(&mut self) -> Option<Vec<u8>> {
        self.first = None;
        (!self.pending.is_empty()).then(|| std::mem::take(&mut self.pending))
    }
}

/// Terminal configuration.
#[derive(Debug, Clone)]
pub struct PtyConfig {
    pub shell: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
}

/// What a terminal reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyEvent {
    /// Raw VT output (≤ [`BATCH_MAX_BYTES`]).
    Output(Vec<u8>),
    /// The shell exited with this code.
    Exit(u32),
}

#[cfg(windows)]
pub use conpty::Pty;

#[cfg(windows)]
mod conpty {
    use std::fs::File;
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError};
    use std::sync::{Arc, Mutex, MutexGuard};
    use std::time::{Duration, Instant};

    use windows::Win32::System::Console::{
        COORD, ClosePseudoConsole, CreatePseudoConsole, HPCON, ResizePseudoConsole,
    };

    use super::{BATCH_MAX_BYTES, BATCH_MAX_DELAY, OutputBatcher, PtyConfig, PtyEvent};
    use crate::error::{Result, StudioError};
    use crate::win32::job::Job;
    use crate::win32::raw;
    use crate::win32::spawn::{ChildProcess, SpawnSpec, anonymous_pipe, spawn_in_job};

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    const READ_CHUNK: usize = 16 * 1024;
    const CHUNK_QUEUE: usize = 8;
    const EVENT_QUEUE: usize = 4;

    enum Chunk {
        Data(Vec<u8>),
        Exited(u32),
    }

    /// A shell attached to a pseudoconsole. Dropping it closes the terminal.
    #[derive(Debug)]
    pub struct Pty {
        id: u64,
        pid: u32,
        hpc: Mutex<Option<HPCON>>,
        input: Mutex<Option<File>>,
        events: Mutex<Receiver<PtyEvent>>,
        child: Arc<ChildProcess>,
        closing: Arc<AtomicBool>,
    }

    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn size(cols: u16, rows: u16) -> COORD {
        COORD {
            X: i16::try_from(cols.max(1)).unwrap_or(i16::MAX),
            Y: i16::try_from(rows.max(1)).unwrap_or(i16::MAX),
        }
    }

    impl Pty {
        /// Creates the pseudoconsole and starts the shell inside `job`.
        ///
        /// # Errors
        /// [`StudioError::Win32`] from `CreatePipe`, `CreatePseudoConsole` or `CreateProcessW`.
        pub fn open(config: PtyConfig, job: &Job) -> Result<Pty> {
            let (input_read, input_write) = anonymous_pipe()?;
            let (output_read, output_write) = anonymous_pipe()?;
            // SAFETY: valid pipe handles; ConPTY duplicates them.
            let hpc = unsafe {
                CreatePseudoConsole(
                    size(config.cols, config.rows),
                    raw(&input_read),
                    raw(&output_write),
                    0,
                )
            }
            .map_err(|e| StudioError::win32("CreatePseudoConsole", &e))?;
            // The pseudoconsole owns its copies; ours must close or the reader never sees EOF.
            drop(input_read);
            drop(output_write);
            let child = match spawn_in_job(
                job,
                SpawnSpec {
                    program: config.shell,
                    args: config.args,
                    cwd: Some(config.cwd),
                    pseudoconsole: Some(hpc),
                    ..SpawnSpec::default()
                },
            ) {
                Ok(child) => Arc::new(child),
                Err(error) => {
                    // SAFETY: created above, closed once.
                    unsafe { ClosePseudoConsole(hpc) };
                    return Err(error);
                }
            };
            let closing = Arc::new(AtomicBool::new(false));
            let (chunk_sender, chunk_receiver) = std::sync::mpsc::sync_channel(CHUNK_QUEUE);
            let (event_sender, event_receiver) = std::sync::mpsc::sync_channel(EVENT_QUEUE);
            read_output(File::from(output_read), chunk_sender.clone());
            wait_exit(Arc::clone(&child), chunk_sender);
            batch(chunk_receiver, event_sender, Arc::clone(&closing));
            Ok(Pty {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                pid: child.pid(),
                hpc: Mutex::new(Some(hpc)),
                input: Mutex::new(Some(File::from(input_write))),
                events: Mutex::new(event_receiver),
                child,
                closing,
            })
        }

        /// Terminal identifier, unique in the process.
        pub fn id(&self) -> u64 {
            self.id
        }

        /// PID of the shell.
        pub fn pid(&self) -> u32 {
            self.pid
        }

        /// Writes keyboard input.
        ///
        /// # Errors
        /// [`StudioError::TerminalClosed`] or a write failure.
        pub fn write(&self, bytes: &[u8]) -> Result<()> {
            let mut input = lock(&self.input);
            let pipe = input.as_mut().ok_or(StudioError::TerminalClosed)?;
            pipe.write_all(bytes)
                .and_then(|()| pipe.flush())
                .map_err(|e| StudioError::io("WriteFile", &e))
        }

        /// Resizes the pseudoconsole.
        ///
        /// # Errors
        /// [`StudioError::TerminalClosed`] or [`StudioError::Win32`] from `ResizePseudoConsole`.
        pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
            let hpc = lock(&self.hpc).ok_or(StudioError::TerminalClosed)?;
            // SAFETY: the pseudoconsole is open while it is stored in self.hpc.
            unsafe { ResizePseudoConsole(hpc, size(cols, rows)) }
                .map_err(|e| StudioError::win32("ResizePseudoConsole", &e))
        }

        /// The next output or exit event, waiting up to `timeout`.
        pub fn next_event(&self, timeout: Duration) -> Option<PtyEvent> {
            lock(&self.events).recv_timeout(timeout).ok()
        }

        /// Closes the pseudoconsole and makes sure the shell is gone. Idempotent.
        ///
        /// # Errors
        /// [`StudioError::Win32`] when the shell cannot be terminated.
        pub fn close(&self) -> Result<()> {
            if self.closing.swap(true, Ordering::SeqCst) {
                return Ok(());
            }
            drop(lock(&self.input).take());
            if let Some(hpc) = lock(&self.hpc).take() {
                // SAFETY: open pseudoconsole, closed exactly once. The reader thread keeps
                // draining the output pipe, so this cannot block on a full buffer (§1.9).
                unsafe { ClosePseudoConsole(hpc) };
            }
            if self.child.wait(Duration::from_millis(800))?.is_none() {
                self.child.kill()?;
                self.child.wait(Duration::from_secs(1))?;
            }
            Ok(())
        }
    }

    impl Drop for Pty {
        fn drop(&mut self) {
            let _ = self.close();
        }
    }

    /// Reads until EOF, forever draining (data is discarded once nobody listens).
    fn read_output(mut output: File, chunks: SyncSender<Chunk>) {
        std::thread::spawn(move || {
            let mut buffer = vec![0u8; READ_CHUNK];
            let mut listening = true;
            loop {
                match output.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if listening && chunks.send(Chunk::Data(buffer[..read].to_vec())).is_err() {
                            listening = false;
                        }
                    }
                }
            }
        });
    }

    fn wait_exit(child: Arc<ChildProcess>, chunks: SyncSender<Chunk>) {
        std::thread::spawn(move || {
            if let Ok(Some(code)) = child.wait(Duration::MAX) {
                let _ = chunks.send(Chunk::Exited(code));
            }
        });
    }

    /// Batches chunks into events. While the consumer is slow the bounded queues push back on the
    /// reader (and so on the shell); once the terminal is closing, events are dropped instead.
    fn batch(chunks: Receiver<Chunk>, events: SyncSender<PtyEvent>, closing: Arc<AtomicBool>) {
        std::thread::spawn(move || {
            let mut batcher = OutputBatcher::new(BATCH_MAX_DELAY, BATCH_MAX_BYTES);
            let mut open = true;
            let mut emit = |mut event: PtyEvent| {
                while open {
                    match events.try_send(event) {
                        Ok(()) => return,
                        Err(TrySendError::Disconnected(_)) => {
                            open = false;
                            return;
                        }
                        Err(TrySendError::Full(back)) => {
                            if closing.load(Ordering::SeqCst) {
                                return;
                            }
                            event = back;
                            std::thread::sleep(Duration::from_millis(2));
                        }
                    }
                }
            };
            loop {
                let received = match batcher.deadline() {
                    Some(deadline) => {
                        chunks.recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    }
                    None => chunks.recv().map_err(|_| RecvTimeoutError::Disconnected),
                };
                match received {
                    Ok(Chunk::Data(bytes)) => {
                        for full in batcher.push(&bytes, Instant::now()) {
                            emit(PtyEvent::Output(full));
                        }
                    }
                    Ok(Chunk::Exited(code)) => {
                        if let Some(rest) = batcher.flush() {
                            emit(PtyEvent::Output(rest));
                        }
                        emit(PtyEvent::Exit(code));
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if let Some(due) = batcher.poll(Instant::now()) {
                            emit(PtyEvent::Output(due));
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        if let Some(rest) = batcher.flush() {
                            emit(PtyEvent::Output(rest));
                        }
                        break;
                    }
                }
            }
        });
    }
}

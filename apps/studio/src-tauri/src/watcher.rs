//! Project file watcher (plan §1.10, §10.5): `notify` (ReadDirectoryChangesW) events, filtered,
//! normalised to POSIX relative paths and debounced (150 ms quiet, 1 s max wait) into batches for
//! the engine's `fs.changed`. Kernel overflows and backend errors surface as `fs.rescan`; losing
//! the root surfaces as an error state the UI offers to retry.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::error::{Result, StudioError};

/// Quiet period before a batch is emitted.
pub const QUIET_PERIOD: Duration = Duration::from_millis(150);
/// Longest a change may wait while new changes keep arriving.
pub const MAX_WAIT: Duration = Duration::from_secs(1);

/// What the watcher reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchEvent {
    /// Unique changed paths, POSIX and relative to the root (`fs.changed`).
    Batch(Vec<String>),
    /// Events were lost (kernel buffer overflow or backend error): refresh everything.
    Rescan,
    /// The root was deleted or renamed; the watcher stopped.
    RootLost,
}

/// Debouncer with an injected clock. A batch is emitted when it has not grown for `quiet`, or
/// `max_wait` after its first change, whichever comes first. Re-touching a path already in the
/// pending batch does not postpone it (the batch content does not change).
#[derive(Debug)]
pub struct Debouncer {
    quiet: Duration,
    max_wait: Duration,
    pending: BTreeSet<String>,
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Debouncer {
    pub fn new(quiet: Duration, max_wait: Duration) -> Debouncer {
        Debouncer {
            quiet,
            max_wait,
            pending: BTreeSet::new(),
            first: None,
            last: None,
        }
    }

    /// Records a change of `path` at `now`.
    pub fn push(&mut self, path: String, now: Instant) {
        if self.pending.insert(path) {
            self.first.get_or_insert(now);
            self.last = Some(now);
        }
    }

    /// When the pending batch is due, if there is one.
    pub fn deadline(&self) -> Option<Instant> {
        let (first, last) = (self.first?, self.last?);
        Some((last + self.quiet).min(first + self.max_wait))
    }

    /// The pending batch, if it is due at `now`.
    pub fn poll(&mut self, now: Instant) -> Option<Vec<String>> {
        if now < self.deadline()? {
            return None;
        }
        Some(self.take())
    }

    /// Drops the pending batch (a rescan supersedes it).
    pub fn clear(&mut self) {
        self.take();
    }

    fn take(&mut self) -> Vec<String> {
        self.first = None;
        self.last = None;
        std::mem::take(&mut self.pending).into_iter().collect()
    }
}

/// Path segments with `.` removed and `..` applied; case-folded on Windows.
fn segments(path: &Path) -> Vec<String> {
    let text = path.to_string_lossy();
    let text = if cfg!(windows) {
        let text = text.replace('/', "\\");
        match text.strip_prefix(r"\\?\UNC\") {
            Some(rest) => format!(r"\\{rest}"),
            None => text
                .strip_prefix(r"\\?\")
                .map_or(text.clone(), str::to_owned),
        }
    } else {
        text.into_owned()
    };
    let separator = if cfg!(windows) { '\\' } else { '/' };
    let mut out: Vec<String> = Vec::new();
    for part in text.split(separator) {
        match part {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            part => out.push(part.to_owned()),
        }
    }
    out
}

fn same_segment(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.to_lowercase() == b.to_lowercase()
    } else {
        a == b
    }
}

/// `path` relative to `root` with `/` separators, or `None` when it is outside the root (or is
/// the root itself). On Windows the root prefix matches case-insensitively.
pub fn normalize(root: &Path, path: &Path) -> Option<String> {
    let root = segments(root);
    let path = segments(path);
    if path.len() <= root.len() || !root.iter().zip(&path).all(|(a, b)| same_segment(a, b)) {
        return None;
    }
    Some(path[root.len()..].join("/"))
}

/// Which relative paths reach the engine: no engine state, dependencies, build output or Git
/// internals (except `.git/HEAD` and `.git/index`), and nothing `.gitignore` excludes.
#[derive(Debug)]
pub struct PathFilter {
    root: PathBuf,
    gitignore: ignore::gitignore::Gitignore,
}

impl PathFilter {
    /// Reads `<root>/.gitignore` and `<root>/.git/info/exclude`.
    ///
    /// # Errors
    /// [`StudioError::Io`] when an ignore file exists but cannot be parsed.
    pub fn new(root: &Path) -> Result<PathFilter> {
        let mut builder = ignore::gitignore::GitignoreBuilder::new(root);
        for file in [
            root.join(".gitignore"),
            root.join(".git").join("info").join("exclude"),
        ] {
            if file.is_file()
                && let Some(error) = builder.add(&file)
            {
                return Err(StudioError::Io {
                    op: "parse .gitignore",
                    message: error.to_string(),
                });
            }
        }
        let gitignore = builder.build().map_err(|error| StudioError::Io {
            op: "parse .gitignore",
            message: error.to_string(),
        })?;
        Ok(PathFilter {
            root: root.to_path_buf(),
            gitignore,
        })
    }

    /// True when a change of `relative` (POSIX, relative to the root) matters to the engine.
    pub fn accepts(&self, relative: &str) -> bool {
        if relative.is_empty() {
            return false;
        }
        if let Some(git) = relative.strip_prefix(".git/") {
            return matches!(git, "HEAD" | "index");
        }
        if relative == ".git"
            || relative.starts_with("specs/.omni/")
            || relative == "specs/.omni"
            || relative.starts_with("target/")
            || relative.split('/').any(|segment| segment == "node_modules")
        {
            return false;
        }
        let is_dir = self.root.join(relative).is_dir();
        !self
            .gitignore
            .matched_path_or_any_parents(relative, is_dir)
            .is_ignore()
    }
}

/// Turns raw `notify` results into [`WatchEvent`]s with an injected clock.
#[derive(Debug)]
pub struct ChangePump {
    root: PathBuf,
    filter: PathFilter,
    debouncer: Debouncer,
    rescan: bool,
}

impl ChangePump {
    /// # Errors
    /// See [`PathFilter::new`].
    pub fn new(root: &Path, debouncer: Debouncer) -> Result<ChangePump> {
        Ok(ChangePump {
            root: root.to_path_buf(),
            filter: PathFilter::new(root)?,
            debouncer,
            rescan: false,
        })
    }

    /// Feeds one backend result observed at `now`.
    pub fn ingest(&mut self, result: notify::Result<notify::Event>, now: Instant) {
        let event = match result {
            Ok(event) => event,
            Err(_) => {
                // Never swallow a backend error: something may have been missed.
                self.rescan = true;
                return;
            }
        };
        if event.need_rescan() {
            self.rescan = true;
        }
        if matches!(event.kind, notify::EventKind::Access(_)) {
            return;
        }
        for path in &event.paths {
            let Some(relative) = normalize(&self.root, path) else {
                continue;
            };
            if relative == ".gitignore"
                && let Ok(filter) = PathFilter::new(&self.root)
            {
                self.filter = filter;
            }
            if self.filter.accepts(&relative) {
                self.debouncer.push(relative, now);
            }
        }
    }

    /// The next event due at `now`. A pending rescan supersedes the pending batch.
    pub fn poll(&mut self, now: Instant) -> Option<WatchEvent> {
        if self.rescan {
            self.rescan = false;
            self.debouncer.clear();
            return Some(WatchEvent::Rescan);
        }
        self.debouncer.poll(now).map(WatchEvent::Batch)
    }

    /// When [`ChangePump::poll`] should run next.
    pub fn deadline(&self) -> Option<Instant> {
        if self.rescan {
            return Some(Instant::now());
        }
        self.debouncer.deadline()
    }
}

/// How often the pump checks that the root still exists.
const ROOT_CHECK: Duration = Duration::from_millis(100);

/// A running recursive watcher of one project root. Dropping it stops the watch.
pub struct ProjectWatcher {
    _watcher: notify::RecommendedWatcher,
    stop: Arc<AtomicBool>,
}

impl std::fmt::Debug for ProjectWatcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProjectWatcher").finish_non_exhaustive()
    }
}

impl ProjectWatcher {
    /// Starts watching `root` recursively. Events arrive on the returned channel.
    ///
    /// # Errors
    /// [`StudioError::Io`] when the backend cannot watch the folder.
    pub fn start(root: &Path) -> Result<(ProjectWatcher, tokio::sync::mpsc::Receiver<WatchEvent>)> {
        use notify::Watcher;
        let (raw_sender, raw_receiver) = std::sync::mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |result| {
            let _ = raw_sender.send((result, Instant::now()));
        })
        .map_err(|error| StudioError::Io {
            op: "notify watcher",
            message: error.to_string(),
        })?;
        watcher
            .watch(root, notify::RecursiveMode::Recursive)
            .map_err(|error| StudioError::Io {
                op: "ReadDirectoryChangesW",
                message: error.to_string(),
            })?;
        let mut pump = ChangePump::new(root, Debouncer::new(QUIET_PERIOD, MAX_WAIT))?;
        let (sender, receiver) = tokio::sync::mpsc::channel(64);
        let stop = Arc::new(AtomicBool::new(false));
        let root = root.to_path_buf();
        {
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || {
                let mut next_root_check = Instant::now() + ROOT_CHECK;
                while !stop.load(Ordering::SeqCst) {
                    let now = Instant::now();
                    let wake = pump
                        .deadline()
                        .map_or(next_root_check, |deadline| deadline.min(next_root_check));
                    match raw_receiver.recv_timeout(wake.saturating_duration_since(now)) {
                        Ok((result, at)) => pump.ingest(result, at),
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                    let now = Instant::now();
                    if now >= next_root_check {
                        next_root_check = now + ROOT_CHECK;
                        if !root.is_dir() {
                            let _ = sender.blocking_send(WatchEvent::RootLost);
                            break;
                        }
                    }
                    while let Some(event) = pump.poll(now) {
                        if sender.blocking_send(event).is_err() {
                            return;
                        }
                    }
                }
            });
        }
        Ok((
            ProjectWatcher {
                _watcher: watcher,
                stop,
            },
            receiver,
        ))
    }
}

impl Drop for ProjectWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

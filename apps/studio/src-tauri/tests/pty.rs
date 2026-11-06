//! CP — ConPTY terminal (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10.4, findings §1.7 and §1.9, D-12).
//!
//! Shell resolution and output batching are pure and tested without OS side effects. Everything
//! else drives a real pseudoconsole hosting `cmd.exe /d` (PowerShell 7 is not installed, §1.1).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::alloc::{GlobalAlloc, Layout, System};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use omni_studio::error::StudioError;
use omni_studio::pty::{BATCH_MAX_BYTES, BATCH_MAX_DELAY, OutputBatcher, resolve_shell};

// Live-heap counter for the CP-09 memory bound (+20 MB).
struct CountingAlloc;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

fn grow(size: usize) {
    let now = LIVE.fetch_add(size, Ordering::Relaxed) + size;
    PEAK.fetch_max(now, Ordering::Relaxed);
}

// SAFETY: delegates every operation to the system allocator; only counts bytes.
unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            grow(layout.size());
        }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let new = unsafe { System.realloc(ptr, layout, new_size) };
        if !new.is_null() {
            if new_size >= layout.size() {
                grow(new_size - layout.size());
            } else {
                LIVE.fetch_sub(layout.size() - new_size, Ordering::Relaxed);
            }
        }
        new
    }
}

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

#[cfg(windows)]
mod term {
    //! Helpers over a real `Pty`.
    use super::support::{cmd_exe, strip_vt};
    use omni_studio::pty::{Pty, PtyConfig, PtyEvent};
    use omni_studio::win32::job::Job;
    use std::path::Path;
    use std::time::{Duration, Instant};

    pub fn open_cmd(job: &Job, cwd: &Path, args: &[&str]) -> Pty {
        let mut all = vec!["/d".to_owned()];
        all.extend(args.iter().map(|a| (*a).to_owned()));
        Pty::open(
            PtyConfig {
                shell: cmd_exe(),
                args: all,
                cwd: cwd.to_path_buf(),
                cols: 120,
                rows: 30,
            },
            job,
        )
        .expect("Pty::open (CreatePseudoConsole + spawn in job)")
    }

    /// Collected raw output plus the exit code, if one was reported.
    #[derive(Default)]
    pub struct Transcript {
        pub raw: Vec<u8>,
        pub exit: Option<u32>,
    }

    impl Transcript {
        pub fn text(&self) -> String {
            strip_vt(&self.raw)
        }
    }

    /// Reads events until `done` holds on the transcript or `timeout` elapses (then panics).
    pub fn read_until(
        pty: &Pty,
        timeout: Duration,
        what: &str,
        done: impl Fn(&Transcript) -> bool,
    ) -> Transcript {
        let deadline = Instant::now() + timeout;
        let mut transcript = Transcript::default();
        while !done(&transcript) {
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(
                !left.is_zero(),
                "timed out waiting for {what}; output so far: {:?}",
                transcript.text()
            );
            match pty.next_event(left.min(Duration::from_millis(200))) {
                Some(PtyEvent::Output(bytes)) => transcript.raw.extend_from_slice(&bytes),
                Some(PtyEvent::Exit(code)) => transcript.exit = Some(code),
                None => {}
            }
        }
        transcript
    }
}

#[cfg(windows)]
#[test]
fn cp_01_conpty_runs_cmd_and_returns_output() {
    use omni_studio::win32::job::Job;
    let job = Job::kill_on_close().expect("terminals job");
    let dir = tempfile::tempdir().expect("tempdir");
    let pty = term::open_cmd(&job, dir.path(), &["/c", "echo OMNI"]);
    let transcript = term::read_until(&pty, Duration::from_secs(10), "OMNI", |t| {
        t.text().contains("OMNI")
    });
    assert!(transcript.text().contains("OMNI"));
    pty.close().expect("close");
}

#[test]
fn cp_02_shell_resolution_chain_and_explicit_override() {
    // A controlled PATH: a directory holding only the shells each case allows.
    let path_with = |shells: &[&str]| {
        let dir = tempfile::tempdir().expect("tempdir");
        for shell in shells {
            std::fs::write(dir.path().join(shell), b"").expect("fake shell file");
        }
        dir
    };
    let lookup_in = |dir: &Path| {
        let dir = dir.to_path_buf();
        move |name: &str| -> Option<PathBuf> {
            let candidate = dir.join(name);
            candidate.is_file().then_some(candidate)
        }
    };

    let all = path_with(&["pwsh.exe", "powershell.exe", "cmd.exe"]);
    assert_eq!(
        resolve_shell(None, lookup_in(all.path())).expect("pwsh first"),
        all.path().join("pwsh.exe")
    );
    let no_pwsh = path_with(&["powershell.exe", "cmd.exe"]);
    assert_eq!(
        resolve_shell(None, lookup_in(no_pwsh.path())).expect("then powershell"),
        no_pwsh.path().join("powershell.exe")
    );
    let only_cmd = path_with(&["cmd.exe"]);
    assert_eq!(
        resolve_shell(None, lookup_in(only_cmd.path())).expect("then cmd"),
        only_cmd.path().join("cmd.exe")
    );
    let empty = path_with(&[]);
    assert!(matches!(
        resolve_shell(None, lookup_in(empty.path())),
        Err(StudioError::ShellNotFound { .. })
    ));

    // A configured override is respected even when a "better" shell exists...
    assert_eq!(
        resolve_shell(Some("cmd.exe"), lookup_in(all.path())).expect("override"),
        all.path().join("cmd.exe")
    );
    // ...and a missing override is an explicit error, never a silent fallback.
    match resolve_shell(Some("nu.exe"), lookup_in(all.path())) {
        Err(error @ StudioError::ShellNotFound { .. }) => {
            assert_eq!(error.code(), "SHELL_NOT_FOUND");
            if let StudioError::ShellNotFound { shell } = error {
                assert_eq!(shell, "nu.exe");
            }
        }
        other => panic!("expected ShellNotFound for the configured shell, got {other:?}"),
    }
}

#[cfg(windows)]
#[test]
fn cp_03_input_round_trip_reports_project_root() {
    use omni_studio::win32::job::Job;
    let job = Job::kill_on_close().expect("job");
    let project = tempfile::tempdir().expect("project root");
    let root = project.path().to_string_lossy().to_lowercase();
    let pty = term::open_cmd(&job, project.path(), &[]);
    pty.write(b"cd\r").expect("write");
    let transcript = term::read_until(&pty, Duration::from_secs(10), "the cwd echo", |t| {
        // The prompt also shows the path; require the bare `cd` output line.
        t.text()
            .lines()
            .any(|line| line.trim().to_lowercase() == root)
    });
    assert!(transcript.exit.is_none(), "interactive shell keeps running");
    pty.close().expect("close");
}

#[cfg(windows)]
#[test]
fn cp_04_resize_is_seen_by_mode_con() {
    use omni_studio::win32::job::Job;
    let job = Job::kill_on_close().expect("job");
    let dir = tempfile::tempdir().expect("tempdir");
    let pty = term::open_cmd(&job, dir.path(), &[]);
    pty.resize(100, 40).expect("ResizePseudoConsole");
    pty.write(b"mode con\r").expect("write");
    // `mode con` is localised (Columns/Columnas, Lines/Líneas): match the numbers after a colon.
    let has_value = |text: &str, value: &str| {
        text.lines()
            .any(|line| line.split_once(':').is_some_and(|(_, v)| v.trim() == value))
    };
    term::read_until(&pty, Duration::from_secs(10), "mode con with 100x40", |t| {
        let text = t.text();
        has_value(&text, "100") && has_value(&text, "40")
    });
    pty.close().expect("close");
}

#[cfg(windows)]
#[test]
fn cp_05_truecolor_sequence_arrives_intact() {
    use omni_studio::win32::job::Job;
    let job = Job::kill_on_close().expect("job");
    let dir = tempfile::tempdir().expect("tempdir");
    let sgr = "\u{1b}[38;2;1;2;3m";
    let pty = term::open_cmd(
        &job,
        dir.path(),
        &["/c", &format!("echo {sgr}TRUECOLOR\u{1b}[0m")],
    );
    let transcript = term::read_until(&pty, Duration::from_secs(10), "TRUECOLOR", |t| {
        t.text().contains("TRUECOLOR")
    });
    let raw = String::from_utf8_lossy(&transcript.raw);
    assert!(
        raw.contains(sgr),
        "24-bit SGR must pass through untouched: {raw:?}"
    );
    pty.close().expect("close");
}

#[cfg(windows)]
#[test]
fn cp_06_utf8_round_trip() {
    use omni_studio::win32::job::Job;
    let job = Job::kill_on_close().expect("job");
    let dir = tempfile::tempdir().expect("tempdir");
    let pty = term::open_cmd(&job, dir.path(), &["/c", "chcp 65001 >nul & echo ñ✓"]);
    let needle = "ñ✓".as_bytes();
    let transcript = term::read_until(&pty, Duration::from_secs(10), "ñ✓", |t| {
        t.raw.windows(needle.len()).any(|w| w == needle)
    });
    assert!(transcript.raw.windows(needle.len()).any(|w| w == needle));
    pty.close().expect("close");
}

#[cfg(windows)]
#[test]
fn cp_07_shell_is_in_the_terminals_job() {
    use omni_studio::win32::job::Job;
    let terminals = Job::kill_on_close().expect("terminals job");
    let dir = tempfile::tempdir().expect("tempdir");
    let pty = term::open_cmd(&terminals, dir.path(), &[]);
    assert!(
        terminals.contains(pty.pid()).expect("IsProcessInJob"),
        "the shell must be created inside the terminals job (PROC_THREAD_ATTRIBUTE_JOB_LIST)"
    );
    pty.close().expect("close");
}

#[cfg(windows)]
#[test]
fn cp_08_close_with_undrained_output_returns_quickly() {
    use omni_studio::win32::job::Job;
    let job = Job::kill_on_close().expect("job");
    let dir = tempfile::tempdir().expect("tempdir");
    // Endless output that this test never consumes: the reader thread must keep draining (§1.9).
    let pty = term::open_cmd(
        &job,
        dir.path(),
        &["/c", "for /L %i in (1,1,10000000) do @echo %i"],
    );
    let shell = support::ProcessHandle::open(pty.pid());
    std::thread::sleep(Duration::from_millis(500));
    let started = Instant::now();
    pty.close().expect("ClosePseudoConsole");
    let elapsed = started.elapsed();
    assert!(
        elapsed < Duration::from_secs(2),
        "close blocked for {elapsed:?}"
    );
    assert!(
        shell.wait_exit(Duration::from_secs(2)),
        "the shell must terminate after the pseudoconsole is closed"
    );
}

#[test]
fn cp_09_output_flood_is_batched_with_bounded_memory() {
    // Pure batching rule: flush after <= 16 ms or <= 64 KiB, preserving byte order.
    assert_eq!(BATCH_MAX_DELAY, Duration::from_millis(16));
    assert_eq!(BATCH_MAX_BYTES, 64 * 1024);
    let t0 = Instant::now();
    let mut batcher = OutputBatcher::new(BATCH_MAX_DELAY, BATCH_MAX_BYTES);
    assert!(
        batcher.push(b"hello", t0).is_empty(),
        "small writes are held"
    );
    assert_eq!(batcher.deadline(), Some(t0 + BATCH_MAX_DELAY));
    assert_eq!(batcher.poll(t0 + Duration::from_millis(15)), None);
    batcher.push(b" world", t0 + Duration::from_millis(10));
    assert_eq!(
        batcher.poll(t0 + Duration::from_millis(16)),
        Some(b"hello world".to_vec()),
        "the deadline counts from the first byte of the batch"
    );
    assert_eq!(batcher.deadline(), None);
    let big: Vec<u8> = (0..150_000u32).map(|i| (i % 251) as u8).collect();
    let t1 = t0 + Duration::from_secs(1);
    let full = batcher.push(&big, t1);
    assert_eq!(full.len(), 2, "two full 64 KiB batches flush immediately");
    assert!(full.iter().all(|batch| batch.len() == BATCH_MAX_BYTES));
    let rest = batcher
        .poll(t1 + BATCH_MAX_DELAY)
        .expect("remainder flushes on time");
    assert_eq!([full.concat(), rest].concat(), big, "byte order preserved");
    assert!(batcher.push(b"", t1).is_empty() && batcher.deadline().is_none());

    // Real flood through ConPTY with a deliberately slow consumer (backpressure).
    #[cfg(windows)]
    {
        use omni_studio::pty::PtyEvent;
        use omni_studio::win32::job::Job;
        let job = Job::kill_on_close().expect("job");
        let dir = tempfile::tempdir().expect("tempdir");
        let baseline = LIVE.load(Ordering::Relaxed);
        PEAK.store(baseline, Ordering::Relaxed);
        let started = Instant::now();
        let pty = term::open_cmd(
            &job,
            dir.path(),
            &["/c", "for /L %i in (1,1,100000) do @echo %i"],
        );
        let mut events = 0usize;
        let mut total = 0usize;
        let mut tail: Vec<u8> = Vec::new();
        let mut exit = None;
        let mut saw_last_line = false;
        let deadline = started + Duration::from_secs(180);
        while exit.is_none() || !saw_last_line {
            assert!(
                Instant::now() < deadline,
                "flood did not finish (events {events}, bytes {total})"
            );
            match pty.next_event(Duration::from_millis(500)) {
                Some(PtyEvent::Output(bytes)) => {
                    assert!(
                        bytes.len() <= BATCH_MAX_BYTES,
                        "batch of {} bytes",
                        bytes.len()
                    );
                    events += 1;
                    total += bytes.len();
                    tail.extend_from_slice(&bytes);
                    let keep = tail.len().saturating_sub(4096);
                    tail.drain(..keep);
                    saw_last_line |= support::strip_vt(&tail).contains("100000");
                    if events <= 20 {
                        std::thread::sleep(Duration::from_millis(25)); // stalled consumer
                    }
                }
                Some(PtyEvent::Exit(code)) => exit = Some(code),
                None => {}
            }
        }
        let elapsed = started.elapsed();
        assert_eq!(exit, Some(0));
        let elapsed_ms = usize::try_from(elapsed.as_millis()).expect("ms fit");
        let bound = elapsed_ms / 16 + total / BATCH_MAX_BYTES + 4;
        assert!(
            events <= bound,
            "{events} events for {total} bytes in {elapsed:?}: output is not batched (bound {bound})"
        );
        let growth = PEAK.load(Ordering::Relaxed).saturating_sub(baseline);
        assert!(
            growth < 20 * 1024 * 1024,
            "host heap grew by {growth} bytes"
        );
        pty.close().expect("close");
    }
}

#[cfg(windows)]
#[test]
fn cp_10_terminals_are_independent() {
    use omni_studio::win32::job::Job;
    let job = Job::kill_on_close().expect("job");
    let dir = tempfile::tempdir().expect("tempdir");
    let first = term::open_cmd(&job, dir.path(), &[]);
    let second = term::open_cmd(&job, dir.path(), &[]);
    assert_ne!(first.id(), second.id(), "independent identifiers");
    assert_ne!(first.pid(), second.pid());
    let first_shell = support::ProcessHandle::open(first.pid());
    let second_shell = support::ProcessHandle::open(second.pid());
    first.close().expect("close first");
    assert!(first_shell.wait_exit(Duration::from_secs(2)));
    assert!(
        second_shell.is_running(),
        "closing one terminal must not affect the other"
    );
    second
        .write(b"echo SECOND-ALIVE\r")
        .expect("write to second");
    term::read_until(&second, Duration::from_secs(10), "SECOND-ALIVE", |t| {
        t.text().lines().any(|line| line.trim() == "SECOND-ALIVE")
    });
    second.close().expect("close second");
}

#[cfg(windows)]
#[test]
fn cp_11_shell_exit_code_is_reported() {
    use omni_studio::win32::job::Job;
    let job = Job::kill_on_close().expect("job");
    let dir = tempfile::tempdir().expect("tempdir");
    let pty = term::open_cmd(&job, dir.path(), &["/c", "exit 7"]);
    let transcript = term::read_until(&pty, Duration::from_secs(10), "the exit event", |t| {
        t.exit.is_some()
    });
    assert_eq!(transcript.exit, Some(7));
    pty.close().expect("close");
}

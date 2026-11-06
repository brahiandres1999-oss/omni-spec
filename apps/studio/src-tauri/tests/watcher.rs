//! FW — File watcher with debounce (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10.5, findings §1.10).
//!
//! Debounce timing runs on tokio's paused clock (`Instant` injected from `tokio::time::Instant`);
//! FW-06 and FW-08 use the real `ReadDirectoryChangesW` backend through `notify`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use omni_studio::watcher::{ChangePump, Debouncer, PathFilter, WatchEvent, normalize};
use tokio::time::{Instant, advance};

const QUIET: Duration = Duration::from_millis(150);
const MAX_WAIT: Duration = Duration::from_secs(1);

fn now() -> std::time::Instant {
    Instant::now().into_std()
}

#[tokio::test(start_paused = true)]
async fn fw_01_burst_yields_one_batch_150ms_after_the_last_write() {
    let mut debouncer = Debouncer::new(QUIET, MAX_WAIT);
    for i in 0..50 {
        debouncer.push(format!("src/file-{i}.ts"), now());
        assert_eq!(
            debouncer.poll(now()),
            None,
            "nothing is emitted during the burst"
        );
        advance(Duration::from_millis(2)).await; // 50 writes in 100 ms
    }
    let last = now() - Duration::from_millis(2);
    assert_eq!(debouncer.deadline(), Some(last + QUIET));
    assert_eq!(
        debouncer.poll(last + QUIET - Duration::from_millis(1)),
        None
    );
    let batch = debouncer
        .poll(last + QUIET)
        .expect("one batch at last + 150 ms");
    assert_eq!(batch.len(), 50);
    assert_eq!(debouncer.poll(last + QUIET * 10), None, "exactly one batch");
    assert_eq!(debouncer.deadline(), None);
}

#[tokio::test(start_paused = true)]
async fn fw_02_continuous_changes_flush_at_least_every_second() {
    let mut debouncer = Debouncer::new(QUIET, MAX_WAIT);
    let start = now();
    let mut emitted = Vec::new();
    for i in 0..500 {
        // A change every 10 ms for 5 s: the quiet period never elapses.
        debouncer.push(format!("src/hot-{}.ts", i % 7), now());
        if debouncer.poll(now()).is_some() {
            emitted.push(now());
        }
        advance(Duration::from_millis(10)).await;
    }
    assert!(
        emitted.len() >= 5,
        "no starvation: {} batches in 5 s",
        emitted.len()
    );
    let mut previous = start;
    for at in &emitted {
        assert!(
            *at - previous <= MAX_WAIT + Duration::from_millis(10),
            "gap of {:?} exceeds max_wait",
            *at - previous
        );
        previous = *at;
    }
}

#[test]
fn fw_03_batches_hold_unique_relative_posix_paths() {
    let root = if cfg!(windows) {
        PathBuf::from(r"C:\work\proj")
    } else {
        PathBuf::from("/work/proj")
    };
    let abs = |rel: &str| root.join(rel);
    assert_eq!(
        normalize(&root, &abs("src/a.ts")).as_deref(),
        Some("src/a.ts")
    );
    assert_eq!(
        normalize(&root, &root.join("src").join("nested").join("b.ts")).as_deref(),
        Some("src/nested/b.ts")
    );
    assert_eq!(
        normalize(&root, &root.join("src").join(".").join("a.ts")).as_deref(),
        Some("src/a.ts")
    );
    assert_eq!(
        normalize(&root, &root.with_file_name("other").join("a.ts")),
        None,
        "outside the root"
    );
    assert_eq!(
        normalize(&root, &root.with_file_name("proj2").join("a.ts")),
        None,
        "sibling with the same prefix"
    );
    #[cfg(windows)]
    {
        assert_eq!(
            normalize(&root, Path::new(r"C:\work\proj\src\a.ts")).as_deref(),
            Some("src/a.ts"),
            "backslashes become POSIX separators"
        );
        assert_eq!(
            normalize(&root, Path::new(r"c:\WORK\proj\src\a.ts")).as_deref(),
            Some("src/a.ts"),
            "the root prefix is matched case-insensitively on Windows"
        );
    }

    let t0 = std::time::Instant::now();
    let mut debouncer = Debouncer::new(QUIET, MAX_WAIT);
    for (i, path) in [
        "src/a.ts",
        "src/b.ts",
        "src/a.ts",
        "src/a.ts",
        "src/b.ts",
        "README.md",
    ]
    .iter()
    .enumerate()
    {
        let rel = normalize(&root, &abs(path)).expect("inside root");
        debouncer.push(rel, t0 + Duration::from_millis(i as u64));
    }
    let batch = debouncer.poll(t0 + Duration::from_secs(1)).expect("batch");
    let unique: BTreeSet<&str> = batch.iter().map(String::as_str).collect();
    assert_eq!(batch.len(), unique.len(), "duplicates in {batch:?}");
    assert_eq!(
        unique,
        BTreeSet::from(["README.md", "src/a.ts", "src/b.ts"])
    );
    assert!(
        batch
            .iter()
            .all(|p| !p.contains('\\') && !p.starts_with('/'))
    );
}

#[test]
fn fw_04_engine_and_vcs_noise_is_excluded() {
    let root = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(root.path().join(".git")).expect(".git");
    let filter = PathFilter::new(root.path()).expect("PathFilter");
    for excluded in [
        "specs/.omni/memory.db",
        "specs/.omni/memory.db-wal",
        "specs/.omni/memory.db-shm",
        "specs/.omni/cache/anything.json",
        "node_modules/react/index.js",
        "apps/studio/node_modules/vite/package.json",
        "target/debug/omni-studio.exe",
        ".git/objects/ab/cdef0123",
        ".git/refs/heads/main",
        ".git/index.lock",
        ".git/logs/HEAD",
    ] {
        assert!(
            !filter.accepts(excluded),
            "{excluded} must be ignored (anti-loop, §1.10)"
        );
    }
    for kept in [
        ".git/HEAD",
        ".git/index",
        "src/main.ts",
        "specs/feature/spec.md",
        "specs/manifest.json",
    ] {
        assert!(filter.accepts(kept), "{kept} must be watched");
    }
}

#[test]
fn fw_05_gitignore_is_respected() {
    let root = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(root.path().join(".git")).expect(".git");
    std::fs::write(root.path().join(".gitignore"), "dist/\n*.log\n!keep.log\n")
        .expect(".gitignore");
    let filter = PathFilter::new(root.path()).expect("PathFilter");
    assert!(!filter.accepts("dist/app.js"));
    assert!(!filter.accepts("dist/assets/chunk.css"));
    assert!(!filter.accepts("debug.log"));
    assert!(!filter.accepts("logs/server.log"));
    assert!(filter.accepts("keep.log"), "negated pattern");
    assert!(filter.accepts("src/app.ts"));
    assert!(
        filter.accepts("distribution/notes.md"),
        "dist/ matches the directory only"
    );
}

#[cfg(windows)]
async fn next_batch_containing(
    events: &mut tokio::sync::mpsc::Receiver<WatchEvent>,
    started: std::time::Instant,
    wanted: &[&str],
) -> Duration {
    let mut missing: BTreeSet<&str> = wanted.iter().copied().collect();
    while !missing.is_empty() {
        let left = Duration::from_secs(3).saturating_sub(started.elapsed());
        let event = tokio::time::timeout(left, events.recv())
            .await
            .unwrap_or_else(|_| panic!("no event for {missing:?} within 3 s"))
            .expect("watcher channel open");
        match event {
            WatchEvent::Batch(paths) => {
                for path in &paths {
                    missing.remove(path.as_str());
                }
            }
            other => panic!("unexpected {other:?} while waiting for {missing:?}"),
        }
    }
    started.elapsed()
}

#[cfg(windows)]
async fn drain(events: &mut tokio::sync::mpsc::Receiver<WatchEvent>) {
    while let Ok(Some(_)) = tokio::time::timeout(Duration::from_millis(400), events.recv()).await {}
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn fw_06_real_read_directory_changes_end_to_end() {
    use omni_studio::watcher::ProjectWatcher;
    let root = tempfile::tempdir().expect("tempdir");
    let (_watcher, mut events) = ProjectWatcher::start(root.path()).expect("start watcher");
    let budget = Duration::from_millis(450);

    let started = std::time::Instant::now();
    std::fs::write(root.path().join("a.txt"), b"one").expect("create");
    let took = next_batch_containing(&mut events, started, &["a.txt"]).await;
    assert!(took <= budget, "create detected in {took:?}");
    drain(&mut events).await;

    let started = std::time::Instant::now();
    std::fs::write(root.path().join("a.txt"), b"two").expect("modify");
    let took = next_batch_containing(&mut events, started, &["a.txt"]).await;
    assert!(took <= budget, "modify detected in {took:?}");
    drain(&mut events).await;

    let started = std::time::Instant::now();
    std::fs::rename(root.path().join("a.txt"), root.path().join("b.txt")).expect("rename");
    let took = next_batch_containing(&mut events, started, &["a.txt", "b.txt"]).await;
    assert!(took <= budget, "rename detected in {took:?}");
    drain(&mut events).await;

    let started = std::time::Instant::now();
    std::fs::remove_file(root.path().join("b.txt")).expect("delete");
    let took = next_batch_containing(&mut events, started, &["b.txt"]).await;
    assert!(took <= budget, "delete detected in {took:?}");
}

#[test]
fn fw_07_kernel_overflow_triggers_full_rescan() {
    use notify::event::{EventKind, Flag, ModifyKind};
    let root = tempfile::tempdir().expect("tempdir");
    let t0 = std::time::Instant::now();

    // A pending change followed by a Rescan notice (ReadDirectoryChangesW buffer overflow).
    let mut pump = ChangePump::new(root.path(), Debouncer::new(QUIET, MAX_WAIT)).expect("pump");
    pump.ingest(
        Ok(notify::Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(root.path().join("src").join("a.ts"))),
        t0,
    );
    pump.ingest(
        Ok(notify::Event::new(EventKind::Other).set_flag(Flag::Rescan)),
        t0 + Duration::from_millis(10),
    );
    let mut emitted = Vec::new();
    for step in 0..100u64 {
        if let Some(event) = pump.poll(t0 + Duration::from_millis(10 * step)) {
            emitted.push(event);
        }
    }
    assert!(
        emitted.contains(&WatchEvent::Rescan),
        "an overflow must surface as fs.rescan, got {emitted:?}"
    );

    // A backend error is never swallowed either: it also asks for a full refresh.
    let mut pump = ChangePump::new(root.path(), Debouncer::new(QUIET, MAX_WAIT)).expect("pump");
    pump.ingest(
        Err(notify::Error::generic("ReadDirectoryChangesW overflow")),
        t0,
    );
    let mut emitted = Vec::new();
    for step in 0..100u64 {
        if let Some(event) = pump.poll(t0 + Duration::from_millis(10 * step)) {
            emitted.push(event);
        }
    }
    assert!(emitted.contains(&WatchEvent::Rescan), "got {emitted:?}");
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn fw_08_losing_the_root_is_reported() {
    use omni_studio::watcher::ProjectWatcher;
    async fn expect_root_lost(events: &mut tokio::sync::mpsc::Receiver<WatchEvent>, what: &str) {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            let event = tokio::time::timeout(left, events.recv())
                .await
                .unwrap_or_else(|_| panic!("no RootLost within 3 s after the root was {what}"))
                .expect("watcher channel open until RootLost is delivered");
            if event == WatchEvent::RootLost {
                return;
            }
        }
    }

    let parent = tempfile::tempdir().expect("tempdir");
    let deleted = parent.path().join("deleted-root");
    std::fs::create_dir_all(deleted.join("src")).expect("root");
    std::fs::write(deleted.join("src").join("a.ts"), b"x").expect("file");
    let (_watcher, mut events) = ProjectWatcher::start(&deleted).expect("start");
    std::fs::remove_dir_all(&deleted).expect("delete the watched root");
    expect_root_lost(&mut events, "deleted").await;

    let renamed = parent.path().join("renamed-root");
    std::fs::create_dir_all(&renamed).expect("root");
    let (_watcher, mut events) = ProjectWatcher::start(&renamed).expect("start");
    std::fs::rename(&renamed, parent.path().join("renamed-root-moved"))
        .expect("rename the watched root");
    expect_root_lost(&mut events, "renamed").await;
}

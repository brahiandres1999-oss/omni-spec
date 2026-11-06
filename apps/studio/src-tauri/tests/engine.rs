//! EG — Engine supervisor (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10.3, decisions D-1, D-4, D-12).
//!
//! Pure logic (version parsing, Node resolution, backoff) is tested with injected collaborators.
//! Supervisor tests run a real `node.exe` with either the scriptable fake engine of
//! `tests/support` (lifecycle edge cases) or the real `bin/omni-spec.mjs studio-engine` (EG-07).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use omni_studio::engine::{Backoff, NodeVersion, engine_entry, resolve_node};
use omni_studio::error::StudioError;

fn v(major: u32, minor: u32, patch: u32) -> NodeVersion {
    NodeVersion {
        major,
        minor,
        patch,
    }
}

#[test]
fn eg_01_node_resolution_and_minimum_version() {
    // Parsing of `node --version` output.
    assert_eq!(NodeVersion::parse("v22.19.0").expect("parse"), v(22, 19, 0));
    assert_eq!(
        NodeVersion::parse("v24.22.1\r\n").expect("parse"),
        v(24, 22, 1)
    );
    assert_eq!(NodeVersion::parse("22.19.0").expect("parse"), v(22, 19, 0));
    for bad in ["", "v22", "v22.19", "node", "v22.x.0", "vv22.19.0"] {
        assert!(NodeVersion::parse(bad).is_err(), "{bad:?} must not parse");
    }
    assert_eq!(NodeVersion::MINIMUM, v(22, 19, 0));
    assert!(v(22, 18, 9) < NodeVersion::MINIMUM);
    assert!(v(22, 19, 0) >= NodeVersion::MINIMUM);
    assert!(
        v(100, 0, 0) > NodeVersion::MINIMUM,
        "numeric, not lexical, ordering"
    );

    let custom = PathBuf::from(r"C:\custom\node.exe");
    let on_path = PathBuf::from(r"C:\Program Files\nodejs\node.exe");
    let versions = |path: &Path| -> Result<String, StudioError> {
        if path == Path::new(r"C:\custom\node.exe") {
            Ok("v24.22.1\n".to_owned())
        } else if path == Path::new(r"C:\old\node.exe") {
            Ok("v20.11.0\n".to_owned())
        } else {
            Ok("v22.19.0\n".to_owned())
        }
    };
    let path_has_node = |name: &str| {
        (name.trim_end_matches(".exe") == "node")
            .then(|| PathBuf::from(r"C:\Program Files\nodejs\node.exe"))
    };
    let no_node_on_path = |_: &str| None;

    // 1. OMNI_STUDIO_NODE wins over PATH.
    let resolved = resolve_node(
        |key: &str| (key == "OMNI_STUDIO_NODE").then(|| r"C:\custom\node.exe".to_owned()),
        path_has_node,
        versions,
    )
    .expect("override resolves");
    assert_eq!(resolved.path, custom);
    assert_eq!(resolved.version, v(24, 22, 1));

    // 2. Without the override, node.exe from PATH.
    let resolved = resolve_node(|_: &str| None, path_has_node, versions).expect("PATH resolves");
    assert_eq!(resolved.path, on_path);
    assert_eq!(resolved.version, v(22, 19, 0));

    // 3. Too old -> NODE_UNSUPPORTED { found }, with no silent fallback to PATH.
    let error = resolve_node(
        |key: &str| (key == "OMNI_STUDIO_NODE").then(|| r"C:\old\node.exe".to_owned()),
        path_has_node,
        versions,
    )
    .expect_err("an unsupported override must not fall back to PATH");
    assert_eq!(error.code(), "NODE_UNSUPPORTED");
    match error {
        StudioError::NodeUnsupported { found } => assert!(found.contains("20.11.0"), "{found}"),
        other => panic!("expected NodeUnsupported, got {other:?}"),
    }

    // 4. Nothing anywhere -> NODE_NOT_FOUND.
    let error = resolve_node(|_: &str| None, no_node_on_path, versions).expect_err("no node");
    assert!(matches!(error, StudioError::NodeNotFound), "{error:?}");
}

#[test]
fn eg_02_engine_entry_is_the_bundled_cli_with_the_app_version() {
    let app_version = env!("CARGO_PKG_VERSION");
    // D-4: Studio ships exactly the omni-spec core it was built with.
    let package: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(support::repo_root().join("package.json"))
            .expect("root package.json"),
    )
    .expect("package.json is JSON");
    assert_eq!(
        package["version"], app_version,
        "omni-spec and Omni Studio versions diverge"
    );

    let resources = tempfile::tempdir().expect("tempdir");
    let core = resources.path().join("omni-spec");
    std::fs::create_dir_all(core.join("bin")).expect("bin dir");
    std::fs::write(core.join("bin").join("omni-spec.mjs"), "// bundled CLI\n").expect("entry");
    std::fs::write(
        core.join("package.json"),
        serde_json::json!({ "name": "omni-spec", "version": app_version }).to_string(),
    )
    .expect("bundled package.json");
    assert_eq!(
        engine_entry(resources.path()).expect("bundled entry"),
        core.join("bin").join("omni-spec.mjs")
    );

    // Version mismatch is refused and names both versions.
    std::fs::write(
        core.join("package.json"),
        serde_json::json!({ "name": "omni-spec", "version": "0.0.0" }).to_string(),
    )
    .expect("rewrite package.json");
    let message = engine_entry(resources.path())
        .expect_err("version mismatch")
        .to_string();
    assert!(
        message.contains("0.0.0") && message.contains(app_version),
        "{message}"
    );

    // Missing entry is an error, not a panic.
    let empty = tempfile::tempdir().expect("tempdir");
    assert!(engine_entry(empty.path()).is_err());
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn eg_03_secret_travels_on_stdin_which_stays_open() {
    use omni_studio::engine::{EngineConfig, Supervisor};
    let fake = support::FakeProject::new(serde_json::json!({}));
    let supervisor = Supervisor::start(EngineConfig::new(
        support::node_exe(),
        fake.entry.clone(),
        fake.root(),
    ))
    .await
    .expect("supervisor starts and completes the handshake");
    let pid = supervisor.engine_pid().expect("engine running");
    let launch = support::fake_launch(&fake.root(), pid);
    let secret = launch["secret"].as_str().expect("secret received on stdin");
    assert_eq!(secret.len(), 64, "256-bit secret as 64 hex chars");
    assert!(
        secret.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')),
        "{secret}"
    );
    assert_eq!(
        launch["secretInArgv"], false,
        "secret must never travel in argv"
    );
    assert_eq!(
        launch["secretInEnv"], false,
        "secret must never travel in the environment"
    );
    let argv: Vec<&str> = launch["argv"]
        .as_array()
        .expect("argv")
        .iter()
        .map(|a| a.as_str().expect("argv entry"))
        .collect();
    let pipe = supervisor.pipe_name();
    assert!(
        argv.ends_with(&["studio-engine", "--pipe", pipe.as_str()]),
        "{argv:?}"
    );

    // stdin stays open after the secret: its EOF is the "host died" signal (EN-09).
    tokio::time::sleep(Duration::from_millis(500)).await;
    let eof_marker = fake.root().join(".fake").join(format!("stdin-eof-{pid}"));
    assert!(
        !eof_marker.exists(),
        "the host must keep the engine's stdin open"
    );
    supervisor.shutdown().await.expect("shutdown");
}

#[test]
fn eg_04_backoff_then_engine_dead() {
    let t0 = Instant::now();
    let mut backoff = Backoff::new();
    assert_eq!(
        backoff.on_crash(t0).expect("1st restart"),
        Duration::from_millis(250)
    );
    assert_eq!(
        backoff
            .on_crash(t0 + Duration::from_secs(1))
            .expect("2nd restart"),
        Duration::from_millis(500)
    );
    assert_eq!(
        backoff
            .on_crash(t0 + Duration::from_secs(2))
            .expect("3rd restart"),
        Duration::from_millis(1000)
    );
    let error = backoff
        .on_crash(t0 + Duration::from_secs(3))
        .expect_err("a 4th crash inside 60 s is fatal");
    assert!(matches!(error, StudioError::EngineDead));
    assert_eq!(error.code(), "ENGINE_DEAD");
    assert!(
        backoff.on_crash(t0 + Duration::from_secs(120)).is_err(),
        "ENGINE_DEAD is terminal: no infinite restart loop"
    );

    // Crashes spread over more than 60 s never exhaust the budget and restart from the base delay.
    let mut spread = Backoff::new();
    for minute in 0..10u64 {
        assert_eq!(
            spread
                .on_crash(t0 + Duration::from_secs(61 * minute))
                .expect("isolated crash restarts"),
            Duration::from_millis(250)
        );
    }

    // End to end: an engine that crashes (exit 70) right after every handshake is restarted three
    // times and then the supervisor settles in ENGINE_DEAD.
    #[cfg(windows)]
    {
        use omni_studio::engine::{EngineConfig, EngineState, Supervisor};
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let fake =
                support::FakeProject::new(serde_json::json!({ "crashAfterHandshake": true }));
            let supervisor = Supervisor::start(EngineConfig::new(
                support::node_exe(),
                fake.entry.clone(),
                fake.root(),
            ))
            .await
            .expect("first start completes the handshake");
            let deadline = Instant::now() + Duration::from_secs(15);
            while supervisor.state() != EngineState::Dead {
                assert!(
                    Instant::now() < deadline,
                    "supervisor never reached ENGINE_DEAD"
                );
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let spawns = support::fake_log(&fake.root(), "spawns.log").len();
            assert_eq!(spawns, 4, "1 start + 3 restarts, then stop");
            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(
                support::fake_log(&fake.root(), "spawns.log").len(),
                4,
                "no restart after ENGINE_DEAD"
            );
            let error = supervisor
                .call("project.snapshot", serde_json::json!({}))
                .await
                .expect_err("a dead engine serves nothing");
            assert_eq!(error.code(), "ENGINE_DEAD");
        });
    }
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn eg_05_stderr_ring_buffer_keeps_the_last_256_kib() {
    use omni_studio::engine::{EngineConfig, STDERR_RING_BYTES, Supervisor};
    assert_eq!(STDERR_RING_BYTES, 256 * 1024);
    let fake = support::FakeProject::new(serde_json::json!({ "stderrBytes": 400 * 1024 }));
    let supervisor = Supervisor::start(EngineConfig::new(
        support::node_exe(),
        fake.entry.clone(),
        fake.root(),
    ))
    .await
    .expect("start");
    let deadline = Instant::now() + Duration::from_secs(10);
    let tail = loop {
        let tail = supervisor.stderr_tail();
        if tail.contains("TAIL-MARKER") {
            break tail;
        }
        assert!(
            Instant::now() < deadline,
            "stderr tail never reached the end marker"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    assert!(
        tail.len() <= STDERR_RING_BYTES,
        "ring overflowed: {} bytes",
        tail.len()
    );
    assert!(
        tail.len() >= STDERR_RING_BYTES - 4096,
        "ring should be (nearly) full: {} bytes",
        tail.len()
    );
    assert!(
        tail.trim_end().ends_with("TAIL-MARKER"),
        "newest output is kept"
    );
    assert!(!tail.contains("HEAD-MARKER"), "oldest output is evicted");
    supervisor.shutdown().await.expect("shutdown");
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn eg_06_orderly_shutdown_and_job_fallback() {
    use omni_studio::engine::{EngineConfig, Supervisor};

    // Cooperative engine: closing the pipe makes it exit 0 in under 1 s.
    let fake = support::FakeProject::new(serde_json::json!({}));
    let supervisor = Supervisor::start(EngineConfig::new(
        support::node_exe(),
        fake.entry.clone(),
        fake.root(),
    ))
    .await
    .expect("start");
    let process = support::ProcessHandle::open(supervisor.engine_pid().expect("pid"));
    let exit = supervisor.shutdown().await.expect("shutdown");
    assert_eq!(exit.code, Some(0));
    assert!(!exit.killed_by_job);
    assert!(exit.elapsed < Duration::from_secs(1), "{:?}", exit.elapsed);
    assert!(process.wait_exit(Duration::from_millis(200)));

    // Stubborn engine: ignores the pipe closing, so closing the job kills it (verified).
    let stubborn = support::FakeProject::new(serde_json::json!({ "ignoreClose": true }));
    let supervisor = Supervisor::start(EngineConfig::new(
        support::node_exe(),
        stubborn.entry.clone(),
        stubborn.root(),
    ))
    .await
    .expect("start");
    let process = support::ProcessHandle::open(supervisor.engine_pid().expect("pid"));
    let exit = supervisor.shutdown().await.expect("shutdown");
    assert!(
        exit.killed_by_job,
        "the job must kill an engine that does not exit"
    );
    assert!(exit.elapsed < Duration::from_secs(3), "{:?}", exit.elapsed);
    assert!(
        process.wait_exit(Duration::from_secs(2)),
        "the stubborn engine must be gone after the job closes"
    );
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn eg_07_spawn_to_handshake_under_floor() {
    use omni_studio::engine::{EngineConfig, Supervisor};
    let project = support::make_studio_project();
    let entry = support::repo_root().join("bin").join("omni-spec.mjs");
    let started = Instant::now();
    let supervisor = Supervisor::start(EngineConfig::new(
        support::node_exe(),
        entry,
        project.path().to_path_buf(),
    ))
    .await
    .expect("real engine completes the handshake");
    let elapsed = started.elapsed();
    assert!(
        elapsed < Duration::from_millis(1500),
        "spawn -> handshake took {elapsed:?} (suite floor 1500 ms; bench target 300 ms)"
    );
    let snapshot = supervisor
        .call("project.snapshot", serde_json::json!({}))
        .await
        .expect("project.snapshot");
    assert!(snapshot.is_object(), "{snapshot}");
    let exit = supervisor.shutdown().await.expect("shutdown");
    assert_eq!(
        exit.code,
        Some(0),
        "EN-08: the engine exits 0 when the host closes the pipe"
    );
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn eg_08_switching_project_restarts_engine_with_fresh_pipe_and_secret() {
    use omni_studio::engine::{EngineConfig, Supervisor};
    use std::sync::Arc;

    let fake = support::FakeProject::new(serde_json::json!({ "hang": ["diff.get"] }));
    let root_a = fake.root();
    let root_b = fake.extra_root("project-b", serde_json::json!({}));
    let supervisor = Arc::new(
        Supervisor::start(EngineConfig::new(
            support::node_exe(),
            fake.entry.clone(),
            root_a.clone(),
        ))
        .await
        .expect("start on A"),
    );
    let old_pid = supervisor.engine_pid().expect("pid A");
    let old_pipe = supervisor.pipe_name();
    let old_process = support::ProcessHandle::open(old_pid);

    let in_flight = {
        let supervisor = Arc::clone(&supervisor);
        tokio::spawn(async move { supervisor.call("diff.get", serde_json::json!({})).await })
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    while !support::fake_log(&root_a, "methods.log")
        .iter()
        .any(|m| m == "diff.get")
    {
        assert!(Instant::now() < deadline, "diff.get never reached engine A");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    supervisor
        .switch_project(&root_b)
        .await
        .expect("switch to B");

    let error = in_flight
        .await
        .expect("in-flight task")
        .expect_err("requests of the previous engine end when switching");
    assert!(matches!(error, StudioError::ProjectSwitched), "{error:?}");
    assert_eq!(error.code(), "PROJECT_SWITCHED");
    assert!(
        old_process.wait_exit(Duration::from_secs(2)),
        "the previous engine is shut down (EG-06)"
    );

    let new_pid = supervisor.engine_pid().expect("pid B");
    assert_ne!(new_pid, old_pid);
    assert_ne!(supervisor.pipe_name(), old_pipe, "a new pipe per engine");
    let secret_a = support::fake_launch(&root_a, old_pid)["secret"].clone();
    let secret_b = support::fake_launch(&root_b, new_pid)["secret"].clone();
    assert_ne!(secret_a, secret_b, "a new secret per engine");

    let snapshot = supervisor
        .call("project.snapshot", serde_json::json!({}))
        .await
        .expect("engine B serves");
    let served_root = PathBuf::from(snapshot["root"].as_str().expect("root"));
    assert_eq!(support::canon(&served_root), support::canon(&root_b));
    supervisor.shutdown().await.expect("shutdown");
}

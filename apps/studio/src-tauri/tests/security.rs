//! SEC — Capabilities, method allowlist, CSP, release hardening and launch arguments
//! (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10.8, blueprint §6).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use omni_studio::error::StudioError;
use omni_studio::security::{ALLOWED_ENGINE_METHODS, is_method_allowed, project_from_args};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_json(path: &Path) -> serde_json::Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{} is not JSON: {e}", path.display()))
}

/// The `tauri = ...` dependency line of Cargo.toml (no TOML crate in the dependency tree).
fn tauri_dependency_line() -> String {
    let cargo = std::fs::read_to_string(manifest_dir().join("Cargo.toml")).expect("Cargo.toml");
    cargo
        .lines()
        .find(|line| line.trim_start().starts_with("tauri ="))
        .expect("tauri dependency")
        .to_owned()
}

#[test]
fn sec_01_capabilities_grant_only_own_commands() {
    let dir = manifest_dir().join("capabilities");
    let mut own = Vec::new();
    let mut files = 0;
    for entry in std::fs::read_dir(&dir).expect("capabilities dir") {
        let path = entry.expect("dir entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        files += 1;
        let capability = read_json(&path);
        for permission in capability["permissions"].as_array().expect("permissions[]") {
            let identifier = permission
                .as_str()
                .or_else(|| permission["identifier"].as_str())
                .expect("permission identifier");
            let plugin = identifier.split_once(':').map(|(plugin, _)| plugin);
            assert!(
                !matches!(plugin, Some("fs" | "shell" | "http")),
                "{}: forbidden plugin permission {identifier}",
                path.display()
            );
            match plugin {
                None => own.push(identifier.to_owned()),
                Some("core" | "notification") => {}
                Some(other) => panic!("{}: unexpected plugin permission {other}:", path.display()),
            }
        }
    }
    assert!(files > 0, "no capability files found in {}", dir.display());
    assert!(
        !own.is_empty(),
        "the frontend must be granted Studio's own commands only"
    );
    let cargo = std::fs::read_to_string(manifest_dir().join("Cargo.toml")).expect("Cargo.toml");
    for plugin in ["tauri-plugin-fs", "tauri-plugin-shell", "tauri-plugin-http"] {
        assert!(!cargo.contains(plugin), "{plugin} must not be a dependency");
    }
}

#[test]
fn sec_02_unknown_methods_are_rejected_in_rust() {
    for method in [
        "project.snapshot",
        "board.get",
        "cartography.graph",
        "blastRadius.heat",
        "diff.get",
        "diff.getFile",
        "review.decideHunk",
        "review.stageApproved",
        "review.addRemark",
        "gate.approve",
        "finops.snapshot",
        "skills.list",
        "skills.toggle",
        "files.tree",
    ] {
        assert!(is_method_allowed(method), "{method} is a frontend method");
        assert!(ALLOWED_ENGINE_METHODS.contains(&method), "{method}");
    }
    for method in [
        "studio.challenge",
        "studio.hello",
        "fs.changed",
        "project.changed",
        "finops.tick",
        "project.delete",
        "Project.Snapshot",
        "project.snapshot ",
        "",
    ] {
        assert!(
            !is_method_allowed(method),
            "{method:?} must not be forwarded"
        );
    }

    // End to end: the supervisor refuses before anything reaches the engine.
    #[cfg(windows)]
    {
        use omni_studio::engine::{EngineConfig, Supervisor};
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let fake = support::FakeProject::new(serde_json::json!({}));
            let supervisor = Supervisor::start(EngineConfig::new(
                support::node_exe(),
                fake.entry.clone(),
                fake.root(),
            ))
            .await
            .expect("start");
            match supervisor
                .call("project.delete", serde_json::json!({}))
                .await
            {
                Err(error @ StudioError::MethodNotAllowed { .. }) => {
                    assert_eq!(error.code(), "METHOD_NOT_ALLOWED");
                }
                other => panic!("expected MethodNotAllowed, got {other:?}"),
            }
            supervisor
                .call("project.snapshot", serde_json::json!({}))
                .await
                .expect("allowed method reaches the engine");
            let methods = support::fake_log(&fake.root(), "methods.log");
            assert!(
                methods.iter().any(|m| m == "project.snapshot"),
                "{methods:?}"
            );
            assert!(
                !methods.iter().any(|m| m == "project.delete"),
                "{methods:?}"
            );
            supervisor.shutdown().await.expect("shutdown");
        });
    }
}

/// CSP as directive -> sources, accepting Tauri's string or object forms.
fn csp_directives(csp: &serde_json::Value) -> BTreeMap<String, Vec<String>> {
    match csp {
        serde_json::Value::String(text) => text
            .split(';')
            .filter_map(|directive| {
                let mut parts = directive.split_whitespace();
                let name = parts.next()?;
                Some((name.to_owned(), parts.map(str::to_owned).collect()))
            })
            .collect(),
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(name, sources)| {
                let sources = match sources {
                    serde_json::Value::String(text) => {
                        text.split_whitespace().map(str::to_owned).collect()
                    }
                    serde_json::Value::Array(items) => items
                        .iter()
                        .map(|s| s.as_str().expect("CSP source").to_owned())
                        .collect(),
                    other => panic!("unexpected CSP value {other}"),
                };
                (name.clone(), sources)
            })
            .collect(),
        other => panic!("app.security.csp must be set (got {other})"),
    }
}

#[test]
fn sec_03_csp_is_strict() {
    let config = read_json(&manifest_dir().join("tauri.conf.json"));
    let csp = csp_directives(&config["app"]["security"]["csp"]);
    assert_eq!(
        csp.get("default-src"),
        Some(&vec!["'self'".to_owned()]),
        "{csp:?}"
    );
    let scripts = csp
        .get("script-src")
        .or_else(|| csp.get("default-src"))
        .expect("script policy");
    for unsafe_source in ["'unsafe-eval'", "'unsafe-inline'"] {
        assert!(
            !scripts.iter().any(|s| s == unsafe_source),
            "script-src allows {unsafe_source}"
        );
    }
    let connect = csp.get("connect-src").expect("connect-src");
    let allowed = ["ipc:", "http://ipc.localhost"];
    assert!(
        connect.iter().all(|s| allowed.contains(&s.as_str())),
        "connect-src {connect:?}"
    );
    for required in allowed {
        assert!(
            connect.iter().any(|s| s == required),
            "connect-src lacks {required}"
        );
    }
    let cargo = std::fs::read_to_string(manifest_dir().join("Cargo.toml")).expect("Cargo.toml");
    assert!(
        !cargo.contains("tauri-plugin-localhost"),
        "no HTTP server in release (custom protocol only)"
    );
}

#[test]
fn sec_04_release_has_no_devtools_or_remote_debugging() {
    let tauri = tauri_dependency_line();
    assert!(
        !tauri.contains("devtools"),
        "the devtools feature would ship them in release: {tauri}"
    );
    let config = read_json(&manifest_dir().join("tauri.conf.json"));
    for window in config["app"]["windows"].as_array().expect("windows[]") {
        assert_ne!(
            window["devtools"], true,
            "window devtools must not be forced on"
        );
        let args = window["additionalBrowserArgs"].as_str().unwrap_or_default();
        assert!(
            !args.contains("remote-debugging"),
            "static remote debugging port: {args}"
        );
    }
    // The WebView2 remote-debugging argument (E2E over CDP, D-15) exists only in debug builds.
    let args = omni_studio::security::webview2_debug_args();
    if cfg!(debug_assertions) {
        assert!(
            args.is_some_and(|a| a.contains("--remote-debugging-port")),
            "debug builds expose CDP for Playwright"
        );
    } else {
        assert_eq!(args, None, "release builds must not open a debugging port");
    }
}

#[test]
fn sec_05_second_instance_forwards_the_project_folder() {
    let second_instance_cwd = tempfile::tempdir().expect("cwd of the second instance");
    let project = second_instance_cwd.path().join("my-project");
    std::fs::create_dir_all(&project).expect("project dir");
    let exe = "omni-studio.exe".to_owned();

    // Absolute folder argument.
    let opened = project_from_args(
        &[exe.clone(), project.to_string_lossy().into_owned()],
        Path::new("C:\\"),
    )
    .expect("valid folder")
    .expect("a project is requested");
    assert_eq!(support::canon(&opened), support::canon(&project));

    // Relative argument resolves against the SECOND instance's cwd (forwarded by the plugin).
    let opened = project_from_args(
        &[exe.clone(), "my-project".to_owned()],
        second_instance_cwd.path(),
    )
    .expect("valid relative folder")
    .expect("a project is requested");
    assert_eq!(support::canon(&opened), support::canon(&project));

    // No argument: just focus the existing instance.
    assert_eq!(
        project_from_args(std::slice::from_ref(&exe), second_instance_cwd.path()).expect("no args"),
        None
    );

    let cargo = std::fs::read_to_string(manifest_dir().join("Cargo.toml")).expect("Cargo.toml");
    assert!(cargo.contains("tauri-plugin-single-instance"));
}

#[test]
fn sec_06_invalid_project_argument_is_an_error_view_not_a_panic() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("not-a-folder.txt");
    std::fs::write(&file, b"x").expect("file");
    let exe = "omni-studio.exe".to_owned();
    for bad in [dir.path().join("does-not-exist"), file] {
        let result = std::panic::catch_unwind(|| {
            project_from_args(
                &[exe.clone(), bad.to_string_lossy().into_owned()],
                dir.path(),
            )
        })
        .expect("project_from_args must not panic");
        match result {
            Err(error @ StudioError::ProjectInvalid) => assert_eq!(error.code(), "PROJECT_INVALID"),
            other => panic!("{}: expected ProjectInvalid, got {other:?}", bad.display()),
        }
    }
}

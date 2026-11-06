//! Host-side security rules (plan §10.8, blueprint §6): the engine method allowlist, the launch
//! argument check and the debug-only WebView2 remote debugging switch.

use std::path::{Path, PathBuf};

use crate::error::{Result, StudioError};

/// Engine methods the frontend may call (`host->engine` requests of `STUDIO_METHODS`, without the
/// handshake). Notifications and anything else are refused in Rust (SEC-02).
pub const ALLOWED_ENGINE_METHODS: &[&str] = &[
    "agent.cancel",
    "agent.permission",
    "agent.prompt",
    "agent.reset",
    "agent.status",
    "blastRadius.heat",
    "board.get",
    "cartography.graph",
    "diff.get",
    "diff.getFile",
    "files.tree",
    "finops.snapshot",
    "gate.approve",
    "project.snapshot",
    "review.addRemark",
    "review.decideHunk",
    "review.stageApproved",
    "skills.list",
    "skills.toggle",
];

/// True when the frontend may forward `method` to the engine (exact, case-sensitive match).
pub fn is_method_allowed(method: &str) -> bool {
    ALLOWED_ENGINE_METHODS.contains(&method)
}

/// The project folder requested on the command line (first instance or forwarded by
/// `tauri-plugin-single-instance`). `args[0]` is the executable; options (`-x`, `--x`) are skipped.
/// Relative paths resolve against `cwd`, the working directory of the instance that received them.
///
/// # Errors
/// [`StudioError::ProjectInvalid`] when the argument is not an existing folder.
pub fn project_from_args(args: &[String], cwd: &Path) -> Result<Option<PathBuf>> {
    let Some(argument) = args.iter().skip(1).find(|arg| !arg.starts_with('-')) else {
        return Ok(None);
    };
    let path = cwd.join(argument);
    if !path.is_dir() {
        return Err(StudioError::ProjectInvalid);
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| StudioError::ProjectInvalid)?;
    Ok(Some(simplify(&canonical)))
}

/// Removes the `\\?\` verbatim prefix that `canonicalize` adds on Windows, when the path does not
/// need it.
pub fn simplify(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// WebView2 browser arguments that open the CDP port for Playwright (D-15). They exist only in
/// debug builds; the port comes from `OMNI_STUDIO_CDP_PORT` (default 9222).
pub fn webview2_debug_args() -> Option<String> {
    if cfg!(debug_assertions) {
        let port = std::env::var("OMNI_STUDIO_CDP_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(9222);
        Some(format!("--remote-debugging-port={port}"))
    } else {
        None
    }
}

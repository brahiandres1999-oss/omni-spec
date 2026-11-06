fn main() {
    // One `allow-<command>` permission per app command (keep in sync with commands::COMMANDS).
    // capabilities/default.json grants exactly these plus a few core/notification permissions
    // (SEC-01).
    let manifest = tauri_build::AppManifest::new().commands(&[
        "engine_call",
        "engine_stderr",
        "project_open",
        "recent_list",
        "pty_open",
        "pty_write",
        "pty_resize",
        "pty_close",
        "window_set_caption_layout",
        "fs_rescan",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .unwrap_or_else(|error| panic!("tauri build script failed: {error:#}"));
}

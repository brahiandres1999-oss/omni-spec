//! Omni Studio host (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10): the Tauri v2 shell around the
//! omni-spec engine. Library functions return `Result<_, StudioError>`; nothing outside the tests
//! unwraps (`clippy::unwrap_used`, `clippy::expect_used`).

#[cfg(windows)]
pub mod commands;
pub mod engine;
pub mod error;
pub mod pipe;
pub mod protocol;
pub mod pty;
pub mod recent;
pub mod security;
pub mod tray;
pub mod watcher;
#[cfg(windows)]
pub mod win32;
pub mod window;

/// Starts the Tauri application.
///
/// # Errors
/// Returns the Tauri error when the runtime cannot start (for example, no WebView2 runtime).
#[cfg(windows)]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), tauri::Error> {
    app::run()
}

#[cfg(windows)]
mod app {
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;

    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

    use crate::commands::{self, StudioState};
    use crate::tray::{AppControl, CloseAction, TrayState, WindowControl, close_action};
    use crate::window::{Backdrop, FALLBACK_BACKGROUND, backdrop_for, force_dark, os_build};

    /// WebView2 defaults kept by wry when no extra arguments are given.
    const WEBVIEW2_DEFAULT_ARGS: &str =
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

    struct Window(WebviewWindow);

    impl WindowControl for Window {
        fn show(&self) -> crate::error::Result<()> {
            self.0.show().map_err(tauri_error)
        }
        fn unminimize(&self) -> crate::error::Result<()> {
            self.0.unminimize().map_err(tauri_error)
        }
        fn set_focus(&self) -> crate::error::Result<()> {
            self.0.set_focus().map_err(tauri_error)
        }
    }

    struct App(AppHandle);

    impl AppControl for App {
        fn exit(&self, code: i32) {
            self.0.exit(code);
        }
    }

    fn tauri_error(error: tauri::Error) -> crate::error::StudioError {
        crate::error::StudioError::Io {
            op: "tauri window",
            message: error.to_string(),
        }
    }

    fn restore(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = crate::tray::on_toast_activated(&Window(window));
        }
    }

    fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
        let Some(config) = app.config().app.windows.iter().find(|w| w.label == "main") else {
            return Ok(());
        };
        let mut builder =
            tauri::WebviewWindowBuilder::from_config(app, config)?.on_new_window(|url, _| {
                if let Some(link) = crate::window::new_window_target(url.as_str()) {
                    crate::window::open_in_browser(link);
                }
                tauri::webview::NewWindowResponse::Deny
            });
        // CDP for the E2E suite exists only in debug builds and only on request (SEC-04, D-15).
        if std::env::var_os("OMNI_STUDIO_CDP_PORT").is_some()
            && std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none()
            && let Some(debug) = crate::security::webview2_debug_args()
        {
            builder = builder.additional_browser_args(&format!("{WEBVIEW2_DEFAULT_ARGS} {debug}"));
        }
        // E2E-01 measures hydration from process creation; the page reads it at startup.
        if let Some(started) = process_start_epoch_ms() {
            builder = builder.initialization_script(format!(
                "window.__OMNI_STUDIO_BOOT__ = Object.assign(window.__OMNI_STUDIO_BOOT__ || {{}}, {{ processStartEpochMs: {started} }});"
            ));
        }
        if let Some(dir) = crate::window::user_data_override() {
            builder = builder.data_directory(dir.join("webview"));
        }
        let window = builder.build()?;
        if let Ok(hwnd) = window.hwnd() {
            let _ = force_dark(hwnd);
        }
        match os_build().map(backdrop_for) {
            Ok(Backdrop::Mica) => {
                use tauri::utils::config::WindowEffectsConfig;
                use tauri::window::Effect;
                let _ = window.set_effects(WindowEffectsConfig {
                    effects: vec![Effect::Mica],
                    ..WindowEffectsConfig::default()
                });
            }
            _ => {
                let _ = FALLBACK_BACKGROUND; // the opaque canvas colour comes from the frontend
            }
        }
        Ok(())
    }

    /// Creation time of this process in Unix epoch milliseconds (`GetProcessTimes`).
    fn process_start_epoch_ms() -> Option<u64> {
        use windows::Win32::Foundation::FILETIME;
        use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
        let (mut creation, mut exit, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        // SAFETY: the pseudo-handle of the current process is always valid; the out-pointers
        // reference live locals.
        unsafe {
            GetProcessTimes(
                GetCurrentProcess(),
                &mut creation,
                &mut exit,
                &mut kernel,
                &mut user,
            )
        }
        .ok()?;
        let ticks = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
        // FILETIME counts 100 ns intervals since 1601-01-01; the Unix epoch is 11 644 473 600 s later.
        (ticks / 10_000).checked_sub(11_644_473_600_000)
    }

    fn create_tray(app: &AppHandle) -> tauri::Result<()> {
        let open = MenuItem::with_id(app, "open", "Abrir Omni Studio", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;
        let icon = Image::from_bytes(include_bytes!("../icons/tray-emerald.ico"))?;
        TrayIconBuilder::with_id("main")
            .icon(icon)
            .tooltip(format!("Omni Studio ({})", TrayState::Emerald.color_hex()))
            .menu(&menu)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "open" => restore(app),
                "quit" => {
                    let jobs = app.state::<StudioState>().shutdown();
                    crate::tray::quit(&App(app.clone()), jobs);
                }
                _ => {}
            })
            .build(app)?;
        Ok(())
    }

    pub fn run() -> tauri::Result<()> {
        let state = StudioState::new().map_err(|error| tauri::Error::Anyhow(error.into()))?;
        tauri::Builder::default()
            .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
                restore(app);
                commands::open_from_args(app, &argv, &PathBuf::from(cwd));
            }))
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_dialog::init())
            .manage(state)
            .setup(|app| {
                let handle = app.handle().clone();
                // Start the engine first: it boots while WebView2 loads the page.
                let args: Vec<String> = std::env::args().collect();
                let cwd = std::env::current_dir().unwrap_or_default();
                commands::open_initial(&handle, &args, &cwd);
                create_main_window(&handle)?;
                create_tray(&handle)?;
                Ok(())
            })
            .on_window_event(|window, event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let state = window.app_handle().state::<StudioState>();
                    if close_action(state.close_to_tray.load(Ordering::SeqCst))
                        == CloseAction::HideToTray
                    {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            })
            .invoke_handler(tauri::generate_handler![
                commands::engine_call,
                commands::engine_stderr,
                commands::project_open,
                commands::recent_list,
                commands::pty_open,
                commands::pty_write,
                commands::pty_resize,
                commands::pty_close,
                commands::window_set_caption_layout,
                commands::fs_rescan,
                commands::recent_remove,
                commands::project_pick,
            ])
            .build(tauri::generate_context!())?
            .run(|app, event| {
                if let tauri::RunEvent::Exit = event {
                    drop(app.state::<StudioState>().shutdown());
                }
            });
        Ok(())
    }
}

/// Starts the Tauri application (Omni Studio targets Windows; other platforms get a bare shell).
///
/// # Errors
/// Returns the Tauri error when the runtime cannot start.
#[cfg(not(windows))]
pub fn run() -> Result<(), tauri::Error> {
    tauri::Builder::default().run(tauri::generate_context!())
}

//! Tauri commands and application wiring (plan §2, §10.8). The frontend never touches the pipe: it
//! calls these commands, and only allowlisted engine methods are forwarded (SEC-02).
//!
//! Logical frontend names map to commands as follows (the Tauri transport of `src/ipc` does the
//! mapping): engine methods → `engine_call { method, params }`; `project.open` → `project_open`;
//! `recent.list` → `recent_list`; `recent.remove` → `recent_remove`; `project.pick` → `project_pick`; `pty.open|write|resize|close` → `pty_*`;
//! `window.set_caption_layout` → `window_set_caption_layout`; `fs.rescan` → `fs_rescan`.
//! Tauri event names cannot contain `.`, so events use `:` (`project:changed`, `finops:tick`,
//! `pty:output`, `pty:exit`, `engine:state`, `watcher:error`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::engine::{EngineConfig, Supervisor, engine_entry, path_lookup, resolve_system_node};
use crate::error::{Result, StudioError};
use crate::pty::{Pty, PtyConfig, PtyEvent, resolve_shell};
use crate::recent::RecentProjects;
use crate::security::{project_from_args, simplify};
use crate::watcher::{ProjectWatcher, WatchEvent};
use crate::win32::job::Job;
use crate::window::CaptionLayout;

/// Commands exposed to the frontend; `build.rs` generates one `allow-*` permission per command.
pub const COMMANDS: &[&str] = &[
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
    "recent_remove",
    "project_pick",
];

/// Shared host state.
pub struct StudioState {
    supervisors: tokio::sync::Mutex<HashMap<PathBuf, Arc<Supervisor>>>,
    active_root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<ProjectWatcher>>,
    terminals: Mutex<HashMap<String, Arc<Pty>>>,
    terminals_job: Mutex<Option<Job>>,
    next_terminal: AtomicU64,
    recent: Mutex<RecentProjects>,
    caption: Mutex<CaptionLayout>,
    /// "Cerrar a bandeja" setting (TR-05).
    pub close_to_tray: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl StudioState {
    /// # Errors
    /// [`StudioError::Win32`] when the terminals job cannot be created.
    pub fn new() -> Result<StudioState> {
        let recent = RecentProjects::default_path()
            .map(|path| RecentProjects::load(&path))
            .unwrap_or_else(|_| RecentProjects::load(Path::new("recent.json")));
        Ok(StudioState {
            supervisors: tokio::sync::Mutex::new(HashMap::new()),
            active_root: Mutex::new(None),
            watcher: Mutex::new(None),
            terminals: Mutex::new(HashMap::new()),
            terminals_job: Mutex::new(Some(Job::kill_on_close()?)),
            next_terminal: AtomicU64::new(1),
            recent: Mutex::new(recent),
            caption: Mutex::new(CaptionLayout::default()),
            close_to_tray: AtomicBool::new(false),
        })
    }

    /// The caption layout last reported by the frontend (for `WM_NCHITTEST`).
    pub fn caption_layout(&self) -> CaptionLayout {
        *lock(&self.caption)
    }

    /// Closes every terminal and the terminals job, and shuts every project engine down (tray "Salir").
    pub fn shutdown(&self) -> Vec<Job> {
        for (_, terminal) in lock(&self.terminals).drain() {
            let _ = terminal.close();
        }
        lock(&self.watcher).take();
        *lock(&self.active_root) = None;
        if let Ok(mut map) = self.supervisors.try_lock() {
            map.clear(); // dropping every supervisor closes its engine job
        }
        lock(&self.terminals_job).take().into_iter().collect()
    }

    async fn current(&self) -> Result<Arc<Supervisor>> {
        let root = lock(&self.active_root)
            .clone()
            .ok_or(StudioError::EngineDisconnected)?;
        self.supervisors
            .lock()
            .await
            .get(&root)
            .cloned()
            .ok_or(StudioError::EngineDisconnected)
    }
}

/// The omni-spec CLI the engine runs: the bundled resource (D-4), `OMNI_STUDIO_ENGINE_ENTRY`, or in
/// debug builds the repository checkout this crate lives in.
fn engine_entry_for(app: &AppHandle) -> Result<PathBuf> {
    if let Ok(entry) = std::env::var("OMNI_STUDIO_ENGINE_ENTRY") {
        return Ok(PathBuf::from(entry));
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|_| StudioError::EngineMissing {
            path: PathBuf::from("resources/omni-spec"),
        })
        .and_then(|resources| engine_entry(&resources));
    if cfg!(debug_assertions) && bundled.is_err() {
        let checkout = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../bin/omni-spec.mjs");
        if checkout.is_file() {
            return Ok(checkout);
        }
    }
    bundled
}

/// Starts (or reuses) the engine for `root`, switches the active project to it without stopping
/// background engines, starts the watcher for `root`, and records it as recent (Fase 3, vuelta 3).
async fn open_project(app: &AppHandle, root: &Path) -> Result<()> {
    let state = app.state::<StudioState>();
    lock(&state.recent).open(root)?;
    let root = simplify(
        &root
            .canonicalize()
            .map_err(|_| StudioError::ProjectInvalid)?,
    );
    let mut map = state.supervisors.lock().await;
    if !map.contains_key(&root) {
        let node = resolve_system_node()?;
        let entry = engine_entry_for(app)?;
        let supervisor = Arc::new(
            Supervisor::start(EngineConfig::new(node.path, entry, root.clone())).await?,
        );
        forward_engine_events(app.clone(), &supervisor);
        map.insert(root.clone(), supervisor);
    }
    *lock(&state.active_root) = Some(root.clone());
    drop(map);
    start_watcher(app, &root)
}

fn forward_engine_events(app: AppHandle, supervisor: &Supervisor) {
    let mut events = supervisor.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(message) => {
                    let name = message["method"]
                        .as_str()
                        .unwrap_or("engine")
                        .replace('.', ":");
                    let _ = app.emit(&name, message["params"].clone());
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

fn start_watcher(app: &AppHandle, root: &Path) -> Result<()> {
    let state = app.state::<StudioState>();
    let (watcher, mut events) = ProjectWatcher::start(root)?;
    *lock(&state.watcher) = Some(watcher);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let state = app.state::<StudioState>();
            let Ok(supervisor) = state.current().await else {
                continue;
            };
            let _ = match event {
                WatchEvent::Batch(paths) => {
                    supervisor
                        .notify("fs.changed", json!({ "paths": paths }))
                        .await
                }
                WatchEvent::Rescan => supervisor.notify("fs.rescan", json!({})).await,
                WatchEvent::RootLost => {
                    let _ = app.emit("watcher:error", json!({ "code": "ROOT_LOST" }));
                    Ok(())
                }
            };
        }
    });
    Ok(())
}

/// Opens `root` in the background and tells the frontend with `project:opened { snapshot }` (the
/// window may already be showing another project: single-instance relaunch, E2E-11).
fn open_in_background(app: &AppHandle, root: PathBuf) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let opened = async {
            open_project(&app, &root).await?;
            app.state::<StudioState>()
                .current()
                .await?
                .call("project.snapshot", json!({}))
                .await
        };
        match opened.await {
            Ok(snapshot) => {
                let _ = app.emit("project:opened", json!({ "snapshot": snapshot }));
            }
            Err(error) => {
                let _ = app.emit("engine:state", error.to_rpc_error());
            }
        }
    });
}

/// Opens the project requested on the command line, if any.
pub fn open_from_args(app: &AppHandle, args: &[String], cwd: &Path) {
    match project_from_args(args, cwd) {
        Ok(Some(root)) => open_in_background(app, root),
        Ok(None) => {}
        Err(error) => {
            let _ = app.emit("engine:state", error.to_rpc_error());
        }
    }
}

/// First launch: the folder on the command line, otherwise the most recent project that still
/// exists. Without either, the UI shows the engine-disconnected error with its retry.
pub fn open_initial(app: &AppHandle, args: &[String], cwd: &Path) {
    if !matches!(project_from_args(args, cwd), Ok(None)) {
        open_from_args(app, args, cwd);
        return;
    }
    let recent = {
        let state = app.state::<StudioState>();
        let entries = lock(&state.recent);
        entries
            .entries()
            .iter()
            .find(|entry| !entry.missing)
            .map(|entry| entry.path.clone())
    };
    if let Some(root) = recent {
        open_in_background(app, root);
    }
}

#[tauri::command]
pub async fn engine_call(
    state: State<'_, StudioState>,
    method: String,
    params: Option<Value>,
) -> Result<Value> {
    state
        .current()
        .await?
        .call(&method, params.unwrap_or_else(|| json!({})))
        .await
}

#[tauri::command]
pub async fn engine_stderr(state: State<'_, StudioState>) -> Result<String> {
    Ok(state.current().await?.stderr_tail())
}

#[tauri::command]
pub async fn project_open(app: AppHandle, path: String) -> Result<Value> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(StudioError::ProjectInvalid);
    }
    open_project(&app, &root).await?;
    let state = app.state::<StudioState>();
    state
        .current()
        .await?
        .call("project.snapshot", json!({}))
        .await
}

#[tauri::command]
pub fn recent_list(state: State<'_, StudioState>) -> Value {
    let recent = lock(&state.recent);
    json!({
        "entries": recent.entries(),
        "error": recent.load_error().map(StudioError::to_rpc_error),
    })
}

/// Drops a project from the rail's list (Fase 3, Q3: "ocultar"). Its files and its memory stay.
#[tauri::command]
pub fn recent_remove(state: State<'_, StudioState>, path: String) -> Result<Value> {
    let mut recent = lock(&state.recent);
    recent.remove(Path::new(&path))?;
    Ok(json!({ "entries": recent.entries() }))
}

/// The native folder picker behind the rail's "add project" button; `null` when cancelled.
#[tauri::command]
pub async fn project_pick(app: AppHandle) -> Result<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title("Agregar proyecto");
        // Owned by the main window, so it opens in front of Studio and blocks it like any modal.
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        dialog.blocking_pick_folder()
    })
    .await
    .map_err(|error| StudioError::Io {
        op: "pick folder",
        message: error.to_string(),
    })?;
    Ok(picked
        .and_then(|folder| folder.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, StudioState>,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
) -> Result<Value> {
    let shell = resolve_shell(shell.as_deref(), path_lookup)?;
    let cwd = match state.current().await {
        Ok(supervisor) => supervisor.root(),
        Err(_) => std::env::current_dir().map_err(|e| StudioError::io("current_dir", &e))?,
    };
    let pty = {
        let job = lock(&state.terminals_job);
        let job = job.as_ref().ok_or(StudioError::TerminalClosed)?;
        Arc::new(Pty::open(
            PtyConfig {
                shell,
                args: Vec::new(),
                cwd,
                cols: cols.unwrap_or(120),
                rows: rows.unwrap_or(30),
            },
            job,
        )?)
    };
    let id = format!(
        "pty-{}",
        state.next_terminal.fetch_add(1, Ordering::Relaxed)
    );
    lock(&state.terminals).insert(id.clone(), Arc::clone(&pty));
    pump_terminal(app, id.clone(), pty);
    Ok(json!({ "id": id }))
}

/// Forwards terminal output as `pty:output { id, data }` (UTF-8 kept whole across batches) and the
/// exit as `pty:exit { id, code }`.
fn pump_terminal(app: AppHandle, id: String, pty: Arc<Pty>) {
    std::thread::spawn(move || {
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match pty.next_event(Duration::from_millis(200)) {
                Some(PtyEvent::Output(bytes)) => {
                    carry.extend_from_slice(&bytes);
                    let valid = match std::str::from_utf8(&carry) {
                        Ok(_) => carry.len(),
                        Err(error) if error.error_len().is_none() => error.valid_up_to(),
                        Err(_) => carry.len(),
                    };
                    let rest = carry.split_off(valid);
                    let data = String::from_utf8_lossy(&carry).into_owned();
                    carry = rest;
                    let _ = app.emit("pty:output", json!({ "id": id, "data": data }));
                }
                Some(PtyEvent::Exit(code)) => {
                    let _ = app.emit("pty:exit", json!({ "id": id, "code": code }));
                }
                None => {
                    let state = app.state::<StudioState>();
                    if !lock(&state.terminals).contains_key(&id) {
                        break;
                    }
                }
            }
        }
    });
}

fn terminal(state: &StudioState, id: &str) -> Result<Arc<Pty>> {
    lock(&state.terminals)
        .get(id)
        .cloned()
        .ok_or(StudioError::TerminalClosed)
}

#[tauri::command]
pub fn pty_write(state: State<'_, StudioState>, id: String, data: String) -> Result<()> {
    terminal(&state, &id)?.write(data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, StudioState>, id: String, cols: u16, rows: u16) -> Result<()> {
    terminal(&state, &id)?.resize(cols, rows)
}

#[tauri::command]
pub fn pty_close(state: State<'_, StudioState>, id: String) -> Result<()> {
    let removed = lock(&state.terminals).remove(&id);
    match removed {
        Some(pty) => pty.close(),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn window_set_caption_layout(state: State<'_, StudioState>, layout: CaptionLayout) {
    *lock(&state.caption) = layout;
}

#[tauri::command]
pub async fn fs_rescan(app: AppHandle) -> Result<()> {
    let state = app.state::<StudioState>();
    let supervisor = state.current().await?;
    start_watcher(&app, &supervisor.root())?;
    supervisor.notify("fs.rescan", json!({})).await
}

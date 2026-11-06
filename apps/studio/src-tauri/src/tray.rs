//! System tray state, icons, toasts and close-to-tray (plan §10.7, reconciliation §1.17.9).
//! Everything here is pure or works through the [`WindowControl`] / [`AppControl`] seams, so the
//! Tauri wiring stays thin.

use std::collections::HashSet;
use std::time::Duration;

use crate::error::Result;

/// Signals the tray colour is derived from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TrayInputs {
    /// A circuit breaker is `OPEN`.
    pub breaker_open: bool,
    /// An architecture contract is violated.
    pub contract_violated: bool,
    /// A human gate waits for approval.
    pub gate_pending: bool,
    /// The engine is working.
    pub engine_busy: bool,
}

/// Tray colour, by priority Crimson > Amber > Cyan > Emerald.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TrayState {
    Emerald,
    Cyan,
    Amber,
    Crimson,
}

/// Icon frames of the cyan "busy" pulse, in `icons/`.
pub const PULSE_FRAMES: &[&str] = &[
    "tray-cyan-pulse-1.ico",
    "tray-cyan-pulse-2.ico",
    "tray-cyan-pulse-3.ico",
];

impl TrayState {
    /// Colour from the canonical palette (`STUDIO-DESIGN-SYSTEM.md` §2.1).
    pub fn color_hex(self) -> &'static str {
        match self {
            TrayState::Emerald => "#10b981",
            TrayState::Cyan => "#06b6d4",
            TrayState::Amber => "#f59e0b",
            TrayState::Crimson => "#f43f5e",
        }
    }

    /// True when the icon animates ([`PULSE_FRAMES`]).
    pub fn pulses(self) -> bool {
        self == TrayState::Cyan
    }

    /// Static icon file in `icons/` (16, 20, 24, 32 and 48 px).
    pub fn icon_file(self) -> &'static str {
        match self {
            TrayState::Emerald => "tray-emerald.ico",
            TrayState::Cyan => "tray-cyan.ico",
            TrayState::Amber => "tray-amber.ico",
            TrayState::Crimson => "tray-crimson.ico",
        }
    }
}

/// The tray state for `inputs` (TR-01).
pub fn tray_state(inputs: &TrayInputs) -> TrayState {
    if inputs.breaker_open || inputs.contract_violated {
        TrayState::Crimson
    } else if inputs.gate_pending {
        TrayState::Amber
    } else if inputs.engine_busy {
        TrayState::Cyan
    } else {
        TrayState::Emerald
    }
}

/// A notification the host should show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Toast {
    /// The tray entered Amber or Crimson.
    StateChanged(TrayState),
    /// A long task finished.
    TaskFinished { task: String, elapsed: Duration },
}

/// Decides when to toast: on entering Amber or Crimson, and once per task longer than 30 s.
#[derive(Debug, Default)]
pub struct ToastPolicy {
    last: Option<TrayState>,
    notified_tasks: HashSet<String>,
}

impl ToastPolicy {
    /// Tasks must run longer than this to toast on completion.
    pub const LONG_TASK: Duration = Duration::from_secs(30);

    pub fn new() -> ToastPolicy {
        ToastPolicy::default()
    }

    /// Called on every state tick; toasts only on a transition into Amber or Crimson.
    pub fn on_state(&mut self, state: TrayState) -> Option<Toast> {
        let previous = self.last.replace(state);
        (previous != Some(state) && matches!(state, TrayState::Amber | TrayState::Crimson))
            .then_some(Toast::StateChanged(state))
    }

    /// Called when a task ends; toasts once per task that ran longer than [`Self::LONG_TASK`].
    pub fn on_task_finished(&mut self, task: &str, elapsed: Duration) -> Option<Toast> {
        if elapsed <= Self::LONG_TASK || !self.notified_tasks.insert(task.to_owned()) {
            return None;
        }
        Some(Toast::TaskFinished {
            task: task.to_owned(),
            elapsed,
        })
    }
}

/// The main window, as far as the tray needs it.
pub trait WindowControl {
    fn show(&self) -> Result<()>;
    fn unminimize(&self) -> Result<()>;
    fn set_focus(&self) -> Result<()>;
}

/// The application, as far as the tray needs it.
pub trait AppControl {
    fn exit(&self, code: i32);
}

/// Clicking a toast restores and focuses the window (focus last).
///
/// # Errors
/// The first window operation that fails.
pub fn on_toast_activated(window: &impl WindowControl) -> Result<()> {
    window.show()?;
    window.unminimize()?;
    window.set_focus()
}

/// What closing the main window does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    HideToTray,
    Exit,
}

/// Close-to-tray when the setting is on, exit otherwise (TR-05).
pub fn close_action(close_to_tray: bool) -> CloseAction {
    if close_to_tray {
        CloseAction::HideToTray
    } else {
        CloseAction::Exit
    }
}

/// "Salir" from the tray: closes every job (their processes die) and exits with 0.
#[cfg(windows)]
pub fn quit(app: &impl AppControl, jobs: Vec<crate::win32::job::Job>) {
    drop(jobs);
    app.exit(0);
}

/// "Salir" from the tray on platforms without Job Objects.
#[cfg(not(windows))]
pub fn quit(app: &impl AppControl, jobs: Vec<()>) {
    drop(jobs);
    app.exit(0);
}

//! TR — System tray state, icons, toasts and close-to-tray (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10.7,
//! reconciliation §1.17.9).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::time::Duration;

use omni_studio::error::StudioError;
use omni_studio::tray::{
    AppControl, CloseAction, PULSE_FRAMES, Toast, ToastPolicy, TrayInputs, TrayState,
    WindowControl, close_action, on_toast_activated, tray_state,
};

#[test]
fn tr_01_tray_state_priority_table() {
    for bits in 0u8..16 {
        let inputs = TrayInputs {
            breaker_open: bits & 1 != 0,
            contract_violated: bits & 2 != 0,
            gate_pending: bits & 4 != 0,
            engine_busy: bits & 8 != 0,
        };
        let expected = if inputs.breaker_open || inputs.contract_violated {
            TrayState::Crimson
        } else if inputs.gate_pending {
            TrayState::Amber
        } else if inputs.engine_busy {
            TrayState::Cyan
        } else {
            TrayState::Emerald
        };
        assert_eq!(tray_state(&inputs), expected, "{inputs:?}");
    }
    assert_eq!(TrayState::Crimson.color_hex(), "#f43f5e");
    assert_eq!(TrayState::Amber.color_hex(), "#f59e0b");
    assert_eq!(TrayState::Cyan.color_hex(), "#06b6d4");
    assert_eq!(TrayState::Emerald.color_hex(), "#10b981");
    assert!(TrayState::Cyan.pulses(), "busy engine pulses");
    assert!(
        !TrayState::Crimson.pulses() && !TrayState::Amber.pulses() && !TrayState::Emerald.pulses()
    );
}

/// Sizes (px) declared in an .ico directory (ICONDIR + ICONDIRENTRY, 0 means 256).
fn ico_sizes(bytes: &[u8]) -> BTreeSet<u32> {
    assert!(bytes.len() >= 6, "truncated ICO");
    assert_eq!(
        &bytes[0..4],
        &[0, 0, 1, 0],
        "ICONDIR reserved=0, type=1 (icon)"
    );
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    (0..count)
        .map(|index| {
            let entry = &bytes[6 + index * 16..6 + (index + 1) * 16];
            let width = if entry[0] == 0 {
                256
            } else {
                u32::from(entry[0])
            };
            let height = if entry[1] == 0 {
                256
            } else {
                u32::from(entry[1])
            };
            assert_eq!(width, height, "square icon entries");
            width
        })
        .collect()
}

#[test]
fn tr_02_icons_exist_for_every_state_and_pulse_frame() {
    let icons = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons");
    let mut files: Vec<&str> = [
        TrayState::Emerald,
        TrayState::Cyan,
        TrayState::Amber,
        TrayState::Crimson,
    ]
    .iter()
    .map(|state| state.icon_file())
    .collect();
    assert!(
        PULSE_FRAMES.len() >= 2,
        "the cyan pulse needs at least two frames"
    );
    files.extend(PULSE_FRAMES.iter().copied());
    let unique: BTreeSet<&str> = files.iter().copied().collect();
    assert_eq!(
        unique.len(),
        files.len(),
        "each state/frame has its own icon: {files:?}"
    );
    for file in files {
        let path = icons.join(file);
        let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let sizes = ico_sizes(&bytes);
        for size in [16, 20, 24, 32, 48] {
            assert!(
                sizes.contains(&size),
                "{} lacks {size}px (has {sizes:?})",
                path.display()
            );
        }
    }
}

#[test]
fn tr_03_toasts_on_amber_crimson_and_long_tasks_without_duplicates() {
    let mut policy = ToastPolicy::new();
    assert_eq!(policy.on_state(TrayState::Emerald), None);
    assert_eq!(
        policy.on_state(TrayState::Cyan),
        None,
        "busy is not toast-worthy"
    );
    assert_eq!(
        policy.on_state(TrayState::Amber),
        Some(Toast::StateChanged(TrayState::Amber))
    );
    assert_eq!(policy.on_state(TrayState::Amber), None, "no toast per tick");
    assert_eq!(policy.on_state(TrayState::Amber), None, "no toast per tick");
    assert_eq!(
        policy.on_state(TrayState::Crimson),
        Some(Toast::StateChanged(TrayState::Crimson))
    );
    assert_eq!(policy.on_state(TrayState::Crimson), None);
    assert_eq!(policy.on_state(TrayState::Emerald), None);
    assert_eq!(
        policy.on_state(TrayState::Amber),
        Some(Toast::StateChanged(TrayState::Amber)),
        "re-entering amber notifies again"
    );

    assert_eq!(policy.on_task_finished("T1", Duration::from_secs(29)), None);
    assert_eq!(
        policy.on_task_finished("T2", Duration::from_secs(30)),
        None,
        "more than 30 s"
    );
    assert_eq!(
        policy.on_task_finished("T3", Duration::from_secs(31)),
        Some(Toast::TaskFinished {
            task: "T3".to_owned(),
            elapsed: Duration::from_secs(31)
        })
    );
    assert_eq!(
        policy.on_task_finished("T3", Duration::from_secs(32)),
        None,
        "one toast per task"
    );
}

#[derive(Default)]
struct FakeWindow {
    calls: RefCell<Vec<&'static str>>,
}

impl WindowControl for FakeWindow {
    fn show(&self) -> Result<(), StudioError> {
        self.calls.borrow_mut().push("show");
        Ok(())
    }
    fn unminimize(&self) -> Result<(), StudioError> {
        self.calls.borrow_mut().push("unminimize");
        Ok(())
    }
    fn set_focus(&self) -> Result<(), StudioError> {
        self.calls.borrow_mut().push("set_focus");
        Ok(())
    }
}

#[test]
fn tr_04_clicking_a_toast_restores_and_focuses() {
    let window = FakeWindow::default();
    on_toast_activated(&window).expect("activation");
    let calls = window.calls.borrow();
    assert!(calls.contains(&"show"), "{calls:?}");
    assert!(calls.contains(&"unminimize"), "{calls:?}");
    assert_eq!(
        calls.last(),
        Some(&"set_focus"),
        "focus comes last: {calls:?}"
    );
}

#[derive(Default)]
struct FakeApp {
    exits: RefCell<Vec<i32>>,
}

impl AppControl for FakeApp {
    fn exit(&self, code: i32) {
        self.exits.borrow_mut().push(code);
    }
}

#[test]
fn tr_05_close_to_tray_and_quit() {
    assert_eq!(close_action(true), CloseAction::HideToTray);
    assert_eq!(close_action(false), CloseAction::Exit);

    // "Salir" from the tray exits the app and closes the job (its processes die).
    let app = FakeApp::default();
    #[cfg(windows)]
    {
        use omni_studio::win32::job::Job;
        use omni_studio::win32::spawn::{SpawnSpec, spawn_in_job};
        let job = Job::kill_on_close().expect("job");
        let comspec = std::env::var_os("ComSpec").expect("ComSpec");
        let child = spawn_in_job(
            &job,
            SpawnSpec {
                program: comspec.into(),
                args: vec!["/d".into(), "/c".into(), "ping -n 30 127.0.0.1 >nul".into()],
                ..SpawnSpec::default()
            },
        )
        .expect("spawn");
        omni_studio::tray::quit(&app, vec![job]);
        assert!(
            child.wait(Duration::from_secs(2)).expect("wait").is_some(),
            "quitting from the tray must close the job and kill its processes"
        );
    }
    #[cfg(not(windows))]
    omni_studio::tray::quit(&app, Vec::new());
    assert_eq!(
        *app.exits.borrow(),
        vec![0],
        "the app exits once with code 0"
    );
}

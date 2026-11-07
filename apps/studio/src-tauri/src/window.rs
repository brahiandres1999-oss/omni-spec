//! Window chrome on Windows 11 (plan §1.16, §1.17.1, §1.17.5, §10.6): the custom title bar's
//! `WM_NCHITTEST` mapping (pure), the Mica decision by OS build, and DWM dark mode.

/// A point in physical pixels relative to the window's top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// A rectangle in logical (DIP) pixels; `right` and `bottom` are exclusive.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    fn contains(&self, x: i64, y: i64) -> bool {
        x >= i64::from(self.left)
            && x < i64::from(self.right)
            && y >= i64::from(self.top)
            && y < i64::from(self.bottom)
    }
}

/// Title bar geometry in logical pixels, as the frontend reports it (SH-06).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionLayout {
    pub window_width: i32,
    pub window_height: i32,
    pub caption_height: i32,
    /// Resize band thickness; 0 while maximised.
    pub resize_border: i32,
    pub minimize: Rect,
    pub maximize: Rect,
    pub close: Rect,
}

/// Result of the hit test, convertible to the `HT*` code Windows expects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HitRegion {
    Client,
    Caption,
    MinButton,
    MaxButton,
    Close,
    Left,
    Right,
    Top,
    TopLeft,
    TopRight,
    Bottom,
    BottomLeft,
    BottomRight,
}

impl HitRegion {
    /// The `WM_NCHITTEST` return value (`HTCLIENT`, `HTMAXBUTTON`...). Snap Layouts needs
    /// `HTMAXBUTTON` over the maximise button.
    pub fn code(self) -> u32 {
        match self {
            HitRegion::Client => 1,
            HitRegion::Caption => 2,
            HitRegion::MinButton => 8,
            HitRegion::MaxButton => 9,
            HitRegion::Left => 10,
            HitRegion::Right => 11,
            HitRegion::Top => 12,
            HitRegion::TopLeft => 13,
            HitRegion::TopRight => 14,
            HitRegion::Bottom => 15,
            HitRegion::BottomLeft => 16,
            HitRegion::BottomRight => 17,
            HitRegion::Close => 20,
        }
    }
}

/// Maps a physical point to a region: resize bands first, then the caption buttons, then the
/// caption, then the client area. `dpi` is the window's DPI (96 = 100 %).
pub fn hit_test(point: Point, layout: &CaptionLayout, dpi: u32) -> HitRegion {
    let dpi = i64::from(dpi.max(1));
    let x = i64::from(point.x) * 96 / dpi;
    let y = i64::from(point.y) * 96 / dpi;
    let border = i64::from(layout.resize_border);
    let left = x < border;
    let right = x >= i64::from(layout.window_width) - border;
    let top = y < border;
    let bottom = y >= i64::from(layout.window_height) - border;
    match (top, bottom, left, right) {
        (true, _, true, _) => return HitRegion::TopLeft,
        (true, _, _, true) => return HitRegion::TopRight,
        (_, true, true, _) => return HitRegion::BottomLeft,
        (_, true, _, true) => return HitRegion::BottomRight,
        (true, _, _, _) => return HitRegion::Top,
        (_, true, _, _) => return HitRegion::Bottom,
        (_, _, true, _) => return HitRegion::Left,
        (_, _, _, true) => return HitRegion::Right,
        _ => {}
    }
    if layout.minimize.contains(x, y) {
        HitRegion::MinButton
    } else if layout.maximize.contains(x, y) {
        HitRegion::MaxButton
    } else if layout.close.contains(x, y) {
        HitRegion::Close
    } else if y < i64::from(layout.caption_height) {
        HitRegion::Caption
    } else {
        HitRegion::Client
    }
}

/// Opaque canvas colour used when Mica is unavailable.
pub const FALLBACK_BACKGROUND: &str = "#121213";

/// First Windows build with Mica (Windows 11 21H2).
pub const MICA_MIN_BUILD: u32 = 22000;

/// Window backdrop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backdrop {
    Mica,
    Solid { color: &'static str },
}

/// True on Windows builds that support Mica.
pub fn mica_supported(build: u32) -> bool {
    build >= MICA_MIN_BUILD
}

/// The backdrop for an OS build, decided by explicit version, not by trying and failing.
pub fn backdrop_for(build: u32) -> Backdrop {
    if mica_supported(build) {
        Backdrop::Mica
    } else {
        Backdrop::Solid {
            color: FALLBACK_BACKGROUND,
        }
    }
}

/// The OS build number (`CurrentBuildNumber` under `HKLM\...\Windows NT\CurrentVersion`, which,
/// unlike `GetVersionExW`, is not subject to manifest-based version lying).
///
/// # Errors
/// [`crate::error::StudioError::Win32`] when the value cannot be read or parsed.
#[cfg(windows)]
pub fn os_build() -> crate::error::Result<u32> {
    use windows::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW};
    use windows::core::w;

    let mut buffer = [0u16; 32];
    let mut size = size_of_val(&buffer) as u32;
    // SAFETY: the out buffer and its size describe `buffer`.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"),
            w!("CurrentBuildNumber"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return Err(crate::error::StudioError::Win32 {
            op: "RegGetValueW",
            code: status.0,
        });
    }
    let chars = (size as usize / 2).min(buffer.len());
    String::from_utf16_lossy(&buffer[..chars])
        .trim_end_matches('\0')
        .trim()
        .parse()
        .map_err(|_| crate::error::StudioError::Win32 {
            op: "RegGetValueW",
            code: 13, // ERROR_INVALID_DATA
        })
}

/// Forces the dark DWM theme (`DWMWA_USE_IMMERSIVE_DARK_MODE = 1`) so Mica's tint matches the
/// single Obsidian theme, whatever `AppsUseLightTheme` says (§1.17.5).
///
/// # Errors
/// [`crate::error::StudioError::Win32`] from `DwmSetWindowAttribute`.
#[cfg(windows)]
pub fn force_dark(hwnd: windows::Win32::Foundation::HWND) -> crate::error::Result<()> {
    use windows::Win32::Graphics::Dwm::{DWMWA_USE_IMMERSIVE_DARK_MODE, DwmSetWindowAttribute};
    let enabled: i32 = 1;
    // SAFETY: valid window handle; 4-byte BOOL attribute.
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            (&raw const enabled).cast(),
            size_of::<i32>() as u32,
        )
    }
    .map_err(|e| crate::error::StudioError::win32("DwmSetWindowAttribute", &e))
}

/// What a request for a new webview window becomes. Studio has one window: WebView2's own Ctrl+N (and any
/// `window.open`) must not clone it. Only web links leave, to the default browser.
pub fn new_window_target(url: &str) -> Option<&str> {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://")).then_some(url)
}

/// Opens a web link in the default browser (links in the chat use `target="_blank"`).
#[cfg(windows)]
pub fn open_in_browser(url: &str) {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HSTRING, w};
    let target = HSTRING::from(url);
    // SAFETY: null-terminated wide strings that outlive the call; no parent window is needed.
    unsafe {
        ShellExecuteW(None, w!("open"), &target, None, None, SW_SHOWNORMAL);
    }
}

/// `OMNI_STUDIO_USER_DATA`: a folder that replaces every per-user location (recent projects and the
/// WebView2 profile, hence `localStorage`). The E2E suite gives each run its own folder so runs never
/// see each other's layout or recent list.
pub fn user_data_override() -> Option<std::path::PathBuf> {
    std::env::var_os("OMNI_STUDIO_USER_DATA")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
}

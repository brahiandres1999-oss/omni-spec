//! WN — Window chrome: WM_NCHITTEST, Mica and DWM dark mode (docs/NEXTGEN-PHASE4-TEST-PLAN.md
//! §10.6, findings §1.16 and §1.17.1/§1.17.5).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use omni_studio::window::{
    Backdrop, CaptionLayout, FALLBACK_BACKGROUND, HitRegion, Point, Rect, backdrop_for, hit_test,
    mica_supported,
};

/// Layout in logical (DIP) pixels, as the frontend reports it (SH-06): 1200x800 window,
/// 40 px caption, 6 px resize border, three 46 px caption buttons at the right edge.
fn layout() -> CaptionLayout {
    CaptionLayout {
        window_width: 1200,
        window_height: 800,
        caption_height: 40,
        resize_border: 6,
        minimize: Rect {
            left: 1062,
            top: 0,
            right: 1108,
            bottom: 40,
        },
        maximize: Rect {
            left: 1108,
            top: 0,
            right: 1154,
            bottom: 40,
        },
        close: Rect {
            left: 1154,
            top: 0,
            right: 1200,
            bottom: 40,
        },
    }
}

#[test]
fn wn_01_hit_test_maps_regions_at_100_150_and_200_percent() {
    let cases: [((i32, i32), HitRegion); 12] = [
        ((1085, 20), HitRegion::MinButton),
        ((1131, 20), HitRegion::MaxButton),
        ((1177, 20), HitRegion::Close),
        ((600, 20), HitRegion::Caption),
        ((600, 400), HitRegion::Client),
        ((600, 2), HitRegion::Top),
        ((600, 797), HitRegion::Bottom),
        ((2, 400), HitRegion::Left),
        ((1197, 400), HitRegion::Right),
        ((2, 2), HitRegion::TopLeft),
        ((2, 797), HitRegion::BottomLeft),
        ((1197, 797), HitRegion::BottomRight),
    ];
    for dpi in [96u32, 144, 192] {
        let layout = layout();
        for ((x, y), expected) in cases {
            // WM_NCHITTEST works in physical pixels: scale the logical probe by dpi / 96.
            let point = Point {
                x: x * dpi as i32 / 96,
                y: y * dpi as i32 / 96,
            };
            assert_eq!(
                hit_test(point, &layout, dpi),
                expected,
                "logical ({x},{y}) at {dpi} dpi"
            );
        }
        // An unscaled point is NOT the maximize button at 200 %: DPI really is applied.
        if dpi == 192 {
            assert_eq!(
                hit_test(Point { x: 1131, y: 20 }, &layout, dpi),
                HitRegion::Caption
            );
        }
    }

    // HT* codes returned to Windows (Snap Layouts needs HTMAXBUTTON, §1.16).
    assert_eq!(HitRegion::Client.code(), 1);
    assert_eq!(HitRegion::Caption.code(), 2);
    assert_eq!(HitRegion::MinButton.code(), 8);
    assert_eq!(HitRegion::MaxButton.code(), 9);
    assert_eq!(HitRegion::Left.code(), 10);
    assert_eq!(HitRegion::Right.code(), 11);
    assert_eq!(HitRegion::Top.code(), 12);
    assert_eq!(HitRegion::TopLeft.code(), 13);
    assert_eq!(HitRegion::TopRight.code(), 14);
    assert_eq!(HitRegion::Bottom.code(), 15);
    assert_eq!(HitRegion::BottomLeft.code(), 16);
    assert_eq!(HitRegion::BottomRight.code(), 17);
    assert_eq!(HitRegion::Close.code(), 20);
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            HTCAPTION, HTCLOSE, HTMAXBUTTON, HTMINBUTTON, HTTOP,
        };
        assert_eq!(HitRegion::Caption.code(), HTCAPTION);
        assert_eq!(HitRegion::MinButton.code(), HTMINBUTTON);
        assert_eq!(HitRegion::MaxButton.code(), HTMAXBUTTON);
        assert_eq!(HitRegion::Close.code(), HTCLOSE);
        assert_eq!(HitRegion::Top.code(), HTTOP);
    }
}

#[test]
fn wn_02_mica_only_on_build_22000_or_later() {
    assert!(!mica_supported(19045), "Windows 10 22H2");
    assert!(!mica_supported(21999));
    assert!(mica_supported(22000), "Windows 11 21H2");
    assert!(mica_supported(26300));
    assert_eq!(FALLBACK_BACKGROUND, "#121213");
    assert_eq!(backdrop_for(22631), Backdrop::Mica);
    assert_eq!(
        backdrop_for(19045),
        Backdrop::Solid {
            color: FALLBACK_BACKGROUND
        }
    );

    // The decision uses an explicit OS build query, cross-checked against `ver`.
    #[cfg(windows)]
    {
        let build = omni_studio::window::os_build().expect("os build query");
        let ver = std::process::Command::new(std::env::var_os("ComSpec").expect("ComSpec"))
            .args(["/d", "/c", "ver"])
            .output()
            .expect("ver");
        let text = String::from_utf8_lossy(&ver.stdout);
        // "Microsoft Windows [Version 10.0.26300.1234]" (localised word, stable numbers).
        let numbers = text
            .split(|c: char| !(c.is_ascii_digit() || c == '.'))
            .find(|token| token.matches('.').count() >= 2)
            .expect("version numbers in `ver` output");
        let expected: u32 = numbers
            .split('.')
            .nth(2)
            .expect("build")
            .parse()
            .expect("numeric build");
        assert_eq!(build, expected, "os_build() vs `ver`: {text}");
    }
}

#[cfg(windows)]
#[test]
fn wn_03_window_forces_immersive_dark_mode() {
    use omni_studio::window::force_dark;
    use windows::Win32::Graphics::Dwm::{DWMWA_USE_IMMERSIVE_DARK_MODE, DwmGetWindowAttribute};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WS_OVERLAPPEDWINDOW,
    };
    use windows::core::w;

    let read_dark = |hwnd| {
        let mut value: i32 = -1;
        // SAFETY: valid HWND, 4-byte out buffer for a BOOL attribute.
        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                (&raw mut value).cast(),
                std::mem::size_of::<i32>() as u32,
            )
        }
        .expect("DwmGetWindowAttribute(DWMWA_USE_IMMERSIVE_DARK_MODE)");
        value
    };

    // Hidden top-level test window (no WS_VISIBLE).
    // SAFETY: predefined STATIC class, no parent, destroyed below.
    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("STATIC"),
            w!("omni-studio-wn03"),
            WS_OVERLAPPEDWINDOW,
            0,
            0,
            320,
            240,
            None,
            None,
            None,
            None,
        )
    }
    .expect("CreateWindowExW");
    // New windows are light until they opt in, whatever AppsUseLightTheme says.
    assert_eq!(read_dark(hwnd), 0, "precondition: DWM default is light");
    force_dark(hwnd).expect("force_dark");
    assert_eq!(
        read_dark(hwnd),
        1,
        "DWMWA_USE_IMMERSIVE_DARK_MODE must be 1 (§1.17.5)"
    );
    // SAFETY: the window was created above on this thread.
    unsafe { DestroyWindow(hwnd) }.expect("DestroyWindow");
}

#[test]
#[ignore = "manual evidence: docs/evidence/phase4/"]
fn wn_04_snap_layouts_flyout_manual_evidence() {
    // WN-04 [manual] — Snap Layouts flyout over the custom maximize button (§1.16).
    // Checklist, recorded with screenshots in docs/evidence/phase4/WN-04-snap-layouts.md:
    //  1. Debug build of Omni Studio on Windows 11 (build >= 22000), 100 % scaling.
    //  2. Hover the maximize button of the custom title bar for ~1 s: the Snap Layouts flyout opens
    //     anchored to the button (Windows returned HTMAXBUTTON from WM_NCHITTEST).
    //  3. Pick a layout zone: the window snaps; the button shows the restore glyph.
    //  4. Repeat at 150 % and 200 % scaling (Settings > Display) and on a second monitor with a
    //     different DPI: the flyout still anchors to the button.
    //  5. Win+Z opens the same flyout; minimize/close keep working; the caption still drags.
    //  6. Attach the screenshots and the build number (`winver`) to the evidence file.
    panic!("WN-04 is verified manually; see the checklist above and docs/evidence/phase4/");
}

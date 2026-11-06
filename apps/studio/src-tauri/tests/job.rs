//! JB — Job Objects and atomic spawn (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10.1, findings §1.7).
//!
//! Real Win32 behaviour only: every process here is a real `cmd.exe`/`powershell.exe`/`PING.EXE`.
//! Helper scripts print descendant PIDs to files so the tests can open handles to them.
#![cfg(windows)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use omni_studio::error::StudioError;
use omni_studio::win32::job::Job;
use omni_studio::win32::spawn::{SpawnSpec, spawn_in_job};
use support::{ProcessHandle, cmd_exe, powershell_exe, powershell_file_args, wait_for_file};
use windows::Win32::System::JobObjects::{
    JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
};

/// Starts PING.EXE with CreateProcess (UseShellExecute = false) and writes its PID atomically.
const GRANDCHILD_PS1: &str = r#"param([string]$Out)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = Join-Path $env:SystemRoot 'System32\PING.EXE'
$psi.Arguments = '-n 120 127.0.0.1'
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)
[System.IO.File]::WriteAllText($Out + '.tmp', [string]$p.Id)
Move-Item -LiteralPath ($Out + '.tmp') -Destination $Out
Start-Sleep -Seconds 120
"#;

/// Calls CreateProcessW with CREATE_BREAKAWAY_FROM_JOB and writes GetLastError (0 on success).
const BREAKAWAY_PS1: &str = r#"param([string]$Out)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Breakaway {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit,
    uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  public static int Try() {
    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(si);
    PROCESS_INFORMATION pi;
    const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    const uint CREATE_NO_WINDOW = 0x08000000;
    bool ok = CreateProcessW(null, new StringBuilder("cmd.exe /d /c exit 0"), IntPtr.Zero, IntPtr.Zero, false,
      CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW, IntPtr.Zero, null, ref si, out pi);
    return ok ? 0 : Marshal.GetLastWin32Error();
  }
}
'@
$code = [Breakaway]::Try()
[System.IO.File]::WriteAllText($Out + '.tmp', [string]$code)
Move-Item -LiteralPath ($Out + '.tmp') -Destination $Out
"#;

fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, body).expect("write helper script");
    path
}

fn powershell_spec(script: &Path, out: &Path) -> SpawnSpec {
    SpawnSpec {
        program: powershell_exe(),
        args: powershell_file_args(script, &["-Out", &out.to_string_lossy()]),
        ..SpawnSpec::default()
    }
}

fn long_running_cmd() -> SpawnSpec {
    SpawnSpec {
        program: cmd_exe(),
        args: vec!["/d".into(), "/c".into(), "ping -n 30 127.0.0.1 >nul".into()],
        ..SpawnSpec::default()
    }
}

#[test]
fn jb_01_job_has_kill_on_close_and_no_breakaway() {
    let job = Job::kill_on_close().expect("CreateJobObjectW + SetInformationJobObject");
    // limit_flags() reads JOBOBJECT_EXTENDED_LIMIT_INFORMATION via QueryInformationJobObject.
    let flags = job
        .limit_flags()
        .expect("QueryInformationJobObject must succeed");
    assert_ne!(
        flags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.0,
        0,
        "KILL_ON_JOB_CLOSE must be set (flags = {flags:#x})"
    );
    assert_eq!(
        flags & JOB_OBJECT_LIMIT_BREAKAWAY_OK.0,
        0,
        "BREAKAWAY_OK must not be set (flags = {flags:#x})"
    );
    assert_eq!(
        flags & JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK.0,
        0,
        "SILENT_BREAKAWAY_OK must not be set (flags = {flags:#x})"
    );
}

#[test]
fn jb_02_spawn_in_job_assigns_at_creation() {
    let job = Job::kill_on_close().expect("job");
    let other = Job::kill_on_close().expect("control job");
    let child = spawn_in_job(&job, long_running_cmd()).expect("spawn_in_job");
    // Checked immediately after CreateProcessW returned: PROC_THREAD_ATTRIBUTE_JOB_LIST puts the
    // process in the job at creation, so there is no window where it runs outside it (§1.7).
    assert!(
        job.contains(child.pid()).expect("IsProcessInJob"),
        "child must be in the job as soon as spawn_in_job returns"
    );
    assert!(
        !other
            .contains(child.pid())
            .expect("IsProcessInJob (control)"),
        "child must not be reported in an unrelated job"
    );
    assert_eq!(
        child.wait(Duration::from_millis(200)).expect("wait"),
        None,
        "the child is still running (not left suspended-and-exited)"
    );
    child.kill().expect("TerminateProcess");
    assert!(
        child.wait(Duration::from_secs(2)).expect("wait").is_some(),
        "killed child must report an exit code"
    );
}

#[test]
fn jb_03_grandchild_is_in_the_job() {
    let dir = tempfile::tempdir().expect("tempdir");
    let script = write_script(dir.path(), "grandchild.ps1", GRANDCHILD_PS1);
    let out = dir.path().join("grandchild.pid");
    let job = Job::kill_on_close().expect("job");
    let child = spawn_in_job(&job, powershell_spec(&script, &out)).expect("spawn helper");
    let grandchild: u32 = wait_for_file(&out, Duration::from_secs(30))
        .parse()
        .expect("helper prints the grandchild PID");
    assert_ne!(grandchild, child.pid());
    assert!(
        job.contains(child.pid()).expect("IsProcessInJob(child)"),
        "child must be in the job"
    );
    assert!(
        job.contains(grandchild)
            .expect("IsProcessInJob(grandchild)"),
        "grandchild {grandchild} must inherit the job"
    );
}

#[test]
fn jb_04_closing_the_job_kills_child_and_grandchild() {
    let dir = tempfile::tempdir().expect("tempdir");
    let script = write_script(dir.path(), "grandchild.ps1", GRANDCHILD_PS1);
    let out = dir.path().join("grandchild.pid");
    let job = Job::kill_on_close().expect("job");
    let child = spawn_in_job(&job, powershell_spec(&script, &out)).expect("spawn helper");
    let grandchild: u32 = wait_for_file(&out, Duration::from_secs(30))
        .parse()
        .expect("grandchild PID");
    let child_handle = ProcessHandle::open(child.pid());
    let grandchild_handle = ProcessHandle::open(grandchild);
    assert!(child_handle.is_running() && grandchild_handle.is_running());

    let started = Instant::now();
    drop(job); // closes the last job handle -> JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    assert!(
        child_handle.wait_exit(Duration::from_secs(2)),
        "child must die within 2 s of closing the job"
    );
    assert!(
        grandchild_handle.wait_exit(Duration::from_secs(2).saturating_sub(started.elapsed())),
        "grandchild must die within 2 s of closing the job"
    );
}

const JB05_HELPER_ENV: &str = "OMNI_STUDIO_JB05_HELPER_DIR";
const JB05_TEST_NAME: &str = "jb_05_abrupt_host_death_kills_all_descendants";

#[test]
fn jb_05_abrupt_host_death_kills_all_descendants() {
    // Helper mode: this same test binary, re-executed, plays the Studio host. It owns the job,
    // spawns the engine-like tree and then waits to be killed with TerminateProcess.
    if let Some(dir) = std::env::var_os(JB05_HELPER_ENV) {
        let dir = PathBuf::from(dir);
        let script = write_script(&dir, "grandchild.ps1", GRANDCHILD_PS1);
        let job = Job::kill_on_close().expect("helper job");
        let child = spawn_in_job(&job, powershell_spec(&script, &dir.join("grandchild.pid")))
            .expect("helper spawn");
        std::fs::write(dir.join("child.pid.tmp"), child.pid().to_string()).expect("write pid");
        std::fs::rename(dir.join("child.pid.tmp"), dir.join("child.pid")).expect("publish pid");
        std::thread::sleep(Duration::from_secs(120));
        panic!("JB-05 helper was not terminated by the orchestrator");
    }

    let dir = tempfile::tempdir().expect("tempdir");
    let mut host = Command::new(std::env::current_exe().expect("current test binary"))
        .args([JB05_TEST_NAME, "--exact", "--nocapture", "--test-threads=1"])
        .env(JB05_HELPER_ENV, dir.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn host helper");
    let child: u32 = wait_for_file(&dir.path().join("child.pid"), Duration::from_secs(30))
        .parse()
        .expect("child PID");
    let grandchild: u32 =
        wait_for_file(&dir.path().join("grandchild.pid"), Duration::from_secs(30))
            .parse()
            .expect("grandchild PID");
    let child_handle = ProcessHandle::open(child);
    let grandchild_handle = ProcessHandle::open(grandchild);
    assert!(child_handle.is_running() && grandchild_handle.is_running());

    host.kill().expect("TerminateProcess on the host helper");
    host.wait().expect("reap host helper");
    assert!(
        child_handle.wait_exit(Duration::from_secs(2)),
        "child must die when the host dies abruptly (orphan scenario of blueprint §6)"
    );
    assert!(
        grandchild_handle.wait_exit(Duration::from_secs(2)),
        "grandchild must die when the host dies abruptly"
    );
}

#[test]
fn jb_06_breakaway_from_job_is_denied() {
    let dir = tempfile::tempdir().expect("tempdir");
    let script = write_script(dir.path(), "breakaway.ps1", BREAKAWAY_PS1);
    let out = dir.path().join("breakaway.code");
    let job = Job::kill_on_close().expect("job");
    let child = spawn_in_job(&job, powershell_spec(&script, &out)).expect("spawn helper");
    let code = wait_for_file(&out, Duration::from_secs(60));
    assert_eq!(
        code, "5",
        "CreateProcessW(CREATE_BREAKAWAY_FROM_JOB) inside the job must fail with ERROR_ACCESS_DENIED"
    );
    assert!(
        child.wait(Duration::from_secs(10)).expect("wait").is_some(),
        "helper exits after reporting"
    );
}

#[test]
fn jb_07_missing_executable_is_a_typed_win32_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let job = Job::kill_on_close().expect("job");
    let result = spawn_in_job(
        &job,
        SpawnSpec {
            program: dir.path().join("definitely-missing.exe"),
            ..SpawnSpec::default()
        },
    );
    match result {
        Err(StudioError::Win32 { op, code }) => {
            assert_eq!(op, "CreateProcessW");
            assert_eq!(code, 2, "ERROR_FILE_NOT_FOUND");
        }
        Err(other) => panic!("expected StudioError::Win32, got {other:?}"),
        Ok(child) => panic!(
            "spawn of a missing executable succeeded (pid {})",
            child.pid()
        ),
    }
}

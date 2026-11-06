//! Shared helpers for the Omni Studio host integration tests (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10).
//!
//! Only test scaffolding lives here: real processes, real files and real Win32 handles. Nothing in
//! this module re-implements production logic of `omni_studio`; the fake engine below is a
//! scriptable stand-in for `omni-spec studio-engine` that speaks the same wire protocol (§4, §5).
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// Repository root (`omni-spec/`), three levels above this crate.
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .canonicalize()
        .expect("repository root must exist")
}

/// `%SystemRoot%\System32\cmd.exe`.
pub fn cmd_exe() -> PathBuf {
    system32().join("cmd.exe")
}

/// Windows PowerShell 5.1 (PowerShell 7 is not installed on the dev machine, §1.1).
pub fn powershell_exe() -> PathBuf {
    system32()
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe")
}

fn system32() -> PathBuf {
    let root = std::env::var_os("SystemRoot").expect("SystemRoot must be set on Windows");
    PathBuf::from(root).join("System32")
}

/// Arguments that run a PowerShell 5.1 script file without loading profiles.
pub fn powershell_file_args(script: &Path, extra: &[&str]) -> Vec<String> {
    let mut args: Vec<String> = [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    args.push(script.to_string_lossy().into_owned());
    args.extend(extra.iter().map(|s| (*s).to_owned()));
    args
}

/// Absolute path of the system `node.exe` (first hit of `where.exe node`). Fails the test if absent.
pub fn node_exe() -> PathBuf {
    let output = Command::new("where.exe")
        .arg("node")
        .output()
        .expect("where.exe must run");
    assert!(
        output.status.success(),
        "node.exe must be on PATH for the engine tests"
    );
    let text = String::from_utf8(output.stdout).expect("where.exe prints UTF-8/ASCII paths");
    let first = text
        .lines()
        .next()
        .expect("where.exe printed at least one path");
    PathBuf::from(first.trim())
}

/// Polls `condition` every 20 ms until it holds or `timeout` elapses.
pub fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if condition() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Waits for a file written atomically by a helper process and returns its trimmed content.
pub fn wait_for_file(path: &Path, timeout: Duration) -> String {
    assert!(
        wait_until(timeout, || path.is_file()),
        "helper did not write {} within {:?}",
        path.display(),
        timeout
    );
    std::fs::read_to_string(path)
        .expect("helper file must be readable")
        .trim()
        .to_owned()
}

/// Removes ANSI/VT control sequences (CSI, OSC, single-char escapes) so ConPTY output can be searched.
/// Cursor positioning (CUP, `CSI row;col H` / `f`) becomes a line break: conhost moves to the next
/// line with CUP instead of `\r\n` when it skips blank rows, which would otherwise glue the end of
/// one output line to the next prompt.
pub fn strip_vt(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('[') => {
                // CSI: parameters/intermediates until a final byte in 0x40..=0x7E.
                for next in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&next) {
                        if matches!(next, 'H' | 'f') && !out.is_empty() && !out.ends_with('\n') {
                            out.push('\n');
                        }
                        break;
                    }
                }
            }
            Some(']') => {
                // OSC: terminated by BEL or ESC \.
                while let Some(next) = chars.next() {
                    if next == '\u{7}' {
                        break;
                    }
                    if next == '\u{1b}' {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Lower-cased, separator-normalised path text without the `\\?\` verbatim prefix.
pub fn norm_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
    text.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// Canonical form of an existing path, normalised with [`norm_path`].
pub fn canon(path: &Path) -> String {
    norm_path(
        &path
            .canonicalize()
            .expect("path must exist to canonicalize"),
    )
}

/// Runs a command and asserts it succeeded.
pub fn run_ok(command: &mut Command) {
    let output = command.output().expect("command must start");
    assert!(
        output.status.success(),
        "{:?} failed: {}\n{}",
        command,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Real OmniSpec project built with the CLI itself (git init + `omni-spec init --yes` + commit),
/// mirroring `test-support/studio-fixtures.mjs#makeStudioProject`.
pub fn make_studio_project() -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("omni-studio-")
        .tempdir()
        .expect("tempdir");
    let root = dir.path();
    let git = |args: &[&str]| run_ok(Command::new("git").args(args).current_dir(root));
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.email", "studio-test@example.com"]);
    git(&["config", "user.name", "Studio Test"]);
    git(&["config", "commit.gpgsign", "false"]);
    git(&["config", "core.autocrlf", "false"]);
    run_ok(
        Command::new(node_exe())
            .arg(repo_root().join("bin").join("omni-spec.mjs"))
            .args(["init", "--yes"])
            .current_dir(root),
    );
    git(&["add", "-A"]);
    git(&["commit", "-q", "--allow-empty", "-m", "init"]);
    dir
}

// ---------------------------------------------------------------------------------------------
// Fake engine: a scriptable Node client of the host pipe (same CLI shape and wire protocol as
// `omni-spec studio-engine --pipe <name>`, secret on the first stdin line, cwd = project root).
// Behaviour comes from `<root>/fake-engine.json`; observations are written under `<root>/.fake/`.
// ---------------------------------------------------------------------------------------------

pub const FAKE_ENGINE_JS: &str = r##"
import { createHmac, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, '.fake');
mkdirSync(out, { recursive: true });
const behaviourFile = join(root, 'fake-engine.json');
const behaviour = existsSync(behaviourFile) ? JSON.parse(readFileSync(behaviourFile, 'utf8')) : {};
appendFileSync(join(out, 'spawns.log'), `${process.pid}\n`);

const pipeIndex = process.argv.indexOf('--pipe');
if (process.argv[pipeIndex - 1] !== 'studio-engine' || pipeIndex === -1) {
  process.stderr.write(`fake engine: unexpected argv ${JSON.stringify(process.argv)}\n`);
  process.exit(2);
}
const pipePath = process.argv[pipeIndex + 1];
const proof = (secret, role, nonce) =>
  createHmac('sha256', Buffer.from(secret, 'hex')).update(`omnispec-studio-v1:${role}:${nonce}`, 'utf8').digest('hex');
const encode = message => {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
};
const writeAtomic = (name, text) => {
  writeFileSync(join(out, `${name}.tmp`), text);
  renameSync(join(out, `${name}.tmp`), join(out, name));
};

let stdinText = '';
let secret = null;
let resolveSecret;
const secretReady = new Promise(resolve => (resolveSecret = resolve));
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (secret !== null) return;
  stdinText += chunk;
  const newline = stdinText.indexOf('\n');
  if (newline !== -1) {
    secret = stdinText.slice(0, newline).trim();
    resolveSecret(secret);
  }
});
process.stdin.on('end', () => writeFileSync(join(out, `stdin-eof-${process.pid}`), ''));

const secretValue = await secretReady;
writeAtomic(
  `launch-${process.pid}.json`,
  JSON.stringify({
    pid: process.pid,
    argv: process.argv,
    cwd: root,
    secret: secretValue,
    secretInArgv: process.argv.some(arg => arg.includes(secretValue)),
    secretInEnv: Object.values(process.env).some(value => typeof value === 'string' && value.includes(secretValue)),
  }),
);

const engineNonce = randomBytes(32).toString('hex');
let authenticated = false;
let buffer = Buffer.alloc(0);
const socket = connect(pipePath);
const send = message => socket.write(encode(message));

function handle(message) {
  appendFileSync(join(out, 'methods.log'), `${message.method}\n`);
  if (message.method === 'studio.challenge') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: 1,
        proof: proof(secretValue, 'engine', message.params.nonce),
        nonce: engineNonce,
        pid: process.pid,
        versions: { engine: 'fake', node: process.versions.node },
      },
    });
    return;
  }
  if (message.method === 'studio.hello') {
    if (message.params?.proof !== proof(secretValue, 'host', engineNonce)) {
      process.stderr.write('fake engine: bad host proof\n');
      process.exit(3);
    }
    authenticated = true;
    if (behaviour.stderrBytes) {
      const lines = ['HEAD-MARKER\n'];
      let size = lines[0].length;
      for (let index = 0; size < behaviour.stderrBytes; index++) {
        const line = `stderr filler line ${index} ${'x'.repeat(64)}\n`;
        lines.push(line);
        size += line.length;
      }
      lines.push('TAIL-MARKER\n');
      process.stderr.write(lines.join(''));
    }
    if (behaviour.crashAfterHandshake) {
      process.stderr.write('fake engine: simulated crash\n');
      process.exit(70);
    }
    return;
  }
  if (!authenticated) {
    process.stderr.write('fake engine: request before handshake\n');
    process.exit(3);
  }
  if ((behaviour.hang ?? []).includes(message.method)) return;
  if (message.id === undefined) return;
  send({ jsonrpc: '2.0', id: message.id, result: { method: message.method, root, pid: process.pid, params: message.params ?? null } });
}

socket.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const message = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
    buffer = buffer.subarray(4 + length);
    handle(message);
  }
});
socket.on('error', error => process.stderr.write(`fake engine: socket error ${error.code}\n`));
socket.on('close', () => {
  if (behaviour.ignoreClose) {
    setInterval(() => {}, 1000);
    return;
  }
  process.exit(0);
});
"##;

/// A project root for the fake engine plus the script itself.
pub struct FakeProject {
    pub dir: tempfile::TempDir,
    pub entry: PathBuf,
}

impl FakeProject {
    /// Creates `<tmp>/fake-engine.mjs` and an empty project root with the given behaviour JSON.
    pub fn new(behaviour: serde_json::Value) -> FakeProject {
        let dir = tempfile::Builder::new()
            .prefix("omni-fake-engine-")
            .tempdir()
            .expect("tempdir");
        let entry = dir.path().join("fake-engine.mjs");
        std::fs::write(&entry, FAKE_ENGINE_JS).expect("write fake engine");
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).expect("project root");
        write_behaviour(&root, &behaviour);
        FakeProject { dir, entry }
    }

    pub fn root(&self) -> PathBuf {
        self.dir.path().join("project")
    }

    /// An extra project root next to the default one (for project switching).
    pub fn extra_root(&self, name: &str, behaviour: serde_json::Value) -> PathBuf {
        let root = self.dir.path().join(name);
        std::fs::create_dir_all(&root).expect("extra project root");
        write_behaviour(&root, &behaviour);
        root
    }
}

pub fn write_behaviour(root: &Path, behaviour: &serde_json::Value) {
    std::fs::write(
        root.join("fake-engine.json"),
        serde_json::to_vec(behaviour).expect("behaviour json"),
    )
    .expect("write behaviour");
}

/// Lines of `<root>/.fake/<name>` (empty when the file does not exist yet).
pub fn fake_log(root: &Path, name: &str) -> Vec<String> {
    match std::fs::read_to_string(root.join(".fake").join(name)) {
        Ok(text) => text.lines().map(str::to_owned).collect(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => panic!("cannot read fake engine log {name}: {error}"),
    }
}

/// The launch record the fake engine wrote for `pid` (argv, cwd, received secret, leak checks).
pub fn fake_launch(root: &Path, pid: u32) -> serde_json::Value {
    let path = root.join(".fake").join(format!("launch-{pid}.json"));
    let text = wait_for_file(&path, Duration::from_secs(10));
    serde_json::from_str(&text).expect("launch record is JSON")
}

// ---------------------------------------------------------------------------------------------
// Win32 process handles: opened BEFORE the event under test so PID reuse cannot fool the checks.
// ---------------------------------------------------------------------------------------------

#[cfg(windows)]
pub struct ProcessHandle(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl ProcessHandle {
    pub fn open(pid: u32) -> ProcessHandle {
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        };
        // SAFETY: plain Win32 call; the returned handle is owned by ProcessHandle and closed on drop.
        let handle = unsafe {
            OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                pid,
            )
        }
        .unwrap_or_else(|error| panic!("OpenProcess({pid}) failed: {error}"));
        ProcessHandle(handle)
    }

    /// True when the process has exited within `timeout` (`WaitForSingleObject`).
    pub fn wait_exit(&self, timeout: Duration) -> bool {
        use windows::Win32::Foundation::WAIT_OBJECT_0;
        use windows::Win32::System::Threading::WaitForSingleObject;
        let millis = u32::try_from(timeout.as_millis()).expect("timeout fits in u32 ms");
        // SAFETY: the handle is valid for the lifetime of self.
        unsafe { WaitForSingleObject(self.0, millis) == WAIT_OBJECT_0 }
    }

    pub fn is_running(&self) -> bool {
        !self.wait_exit(Duration::ZERO)
    }
}

#[cfg(windows)]
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        use windows::Win32::Foundation::CloseHandle;
        // SAFETY: the handle was opened by ProcessHandle::open and is closed exactly once.
        let closed = unsafe { CloseHandle(self.0) };
        if let Err(error) = closed
            && !std::thread::panicking()
        {
            panic!("CloseHandle failed: {error}");
        }
    }
}

/// String SID of the current user, read with `whoami /user` (independent of the code under test).
#[cfg(windows)]
pub fn current_user_sid() -> String {
    let output = Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .expect("whoami must run");
    assert!(output.status.success(), "whoami /user failed");
    let text = String::from_utf8_lossy(&output.stdout);
    let sid = text
        .trim()
        .rsplit(',')
        .next()
        .expect("whoami csv has a SID column")
        .trim_matches('"')
        .to_owned();
    assert!(sid.starts_with("S-1-"), "unexpected whoami output: {text}");
    sid
}

//! PP — Named Pipe server, framing and handshake (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10.2, §4, §5,
//! findings §1.8 and decision D-1/D-2).
//!
//! The "engine" side in these tests is the test itself acting as a pipe client with a hand-rolled
//! codec (4-byte little-endian length + UTF-8 JSON), so the host is checked against the wire format,
//! not against its own encoder.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use hmac::{Hmac, Mac};
use omni_studio::error::StudioError;
use omni_studio::protocol::{FrameDecoder, MAX_FRAME_BYTES, encode_frame, handshake_proof};

// ---------------------------------------------------------------------------------------------
// Per-thread allocation probe for PP-08 ("reject before reserving memory").
// ---------------------------------------------------------------------------------------------

struct ProbeAlloc;

thread_local! {
    static PROBING: Cell<bool> = const { Cell::new(false) };
    static LARGEST: Cell<usize> = const { Cell::new(0) };
}

fn record(size: usize) {
    let probing = PROBING.try_with(Cell::get).unwrap_or(false);
    if probing {
        let _ = LARGEST.try_with(|largest| largest.set(largest.get().max(size)));
    }
}

// SAFETY: delegates every operation to the system allocator; only observes requested sizes.
unsafe impl GlobalAlloc for ProbeAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record(layout.size());
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        record(layout.size());
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        record(new_size);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: ProbeAlloc = ProbeAlloc;

/// Runs `f` and returns its result plus the largest single allocation it requested on this thread.
fn largest_allocation<T>(f: impl FnOnce() -> T) -> (T, usize) {
    LARGEST.with(|largest| largest.set(0));
    PROBING.with(|probing| probing.set(true));
    let value = f();
    PROBING.with(|probing| probing.set(false));
    (value, LARGEST.with(Cell::get))
}

// ---------------------------------------------------------------------------------------------
// Independent reference implementations (wire format and HMAC proof).
// ---------------------------------------------------------------------------------------------

fn reference_proof(secret_hex: &str, role: &str, nonce_hex: &str) -> String {
    let key = hex::decode(secret_hex).expect("secret is hex");
    let mut mac = Hmac::<sha2::Sha256>::new_from_slice(&key).expect("HMAC accepts any key size");
    mac.update(format!("omnispec-studio-v1:{role}:{nonce_hex}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn reference_frame(json: &str) -> Vec<u8> {
    let length = u32::try_from(json.len()).expect("test frames fit in u32");
    let mut frame = length.to_le_bytes().to_vec();
    frame.extend_from_slice(json.as_bytes());
    frame
}

const SECRET: &str = "4f6d6e6953706563537475646f2d746573742d7365637265742d3235362d6269";

#[cfg(windows)]
mod wire {
    //! Engine-side client helpers over a real `NamedPipeClient`.
    use super::{SECRET, reference_frame, reference_proof};
    use serde_json::{Value, json};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};

    pub const ENGINE_NONCE: &str =
        "e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff00";

    pub fn open(name: &str) -> NamedPipeClient {
        ClientOptions::new()
            .open(name)
            .unwrap_or_else(|error| panic!("client open of {name} failed: {error}"))
    }

    pub async fn read_frame(client: &mut NamedPipeClient) -> Value {
        let mut header = [0u8; 4];
        client
            .read_exact(&mut header)
            .await
            .expect("frame header from host");
        let length = u32::from_le_bytes(header) as usize;
        let mut body = vec![0u8; length];
        client
            .read_exact(&mut body)
            .await
            .expect("frame body from host");
        serde_json::from_slice(&body).expect("host frames carry JSON")
    }

    pub async fn write_frame(client: &mut NamedPipeClient, message: &Value) {
        let json = serde_json::to_string(message).expect("serialize");
        client
            .write_all(&reference_frame(&json))
            .await
            .expect("write frame to host");
    }

    /// Asserts the host sends nothing more and the connection ends (EOF or broken pipe).
    pub async fn assert_closed_without_frames(client: &mut NamedPipeClient) {
        let mut byte = [0u8; 1];
        let read = tokio::time::timeout(Duration::from_secs(2), client.read(&mut byte))
            .await
            .expect("host must close the connection within 2 s");
        match read {
            Ok(0) => {}
            Ok(n) => panic!("host sent {n} byte(s) after rejecting the peer"),
            Err(error) => assert!(
                matches!(error.raw_os_error(), Some(109 | 232 | 233)),
                "unexpected read error: {error}"
            ),
        }
    }

    /// Engine side of the §5 handshake. Returns the host's `studio.hello` proof.
    pub async fn engine_handshake(
        client: &mut NamedPipeClient,
        engine_proof: Option<String>,
    ) -> Value {
        let challenge = read_frame(client).await;
        assert_eq!(challenge["jsonrpc"], "2.0");
        assert_eq!(challenge["method"], "studio.challenge");
        assert_eq!(challenge["params"]["protocolVersion"], 1);
        let nonce = challenge["params"]["nonce"]
            .as_str()
            .expect("challenge nonce is a string")
            .to_owned();
        assert!(
            nonce.len() >= 32
                && nonce
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "nonce must be >= 128-bit lowercase hex, got {nonce:?}"
        );
        let proof = engine_proof.unwrap_or_else(|| reference_proof(SECRET, "engine", &nonce));
        write_frame(
            client,
            &json!({
                "jsonrpc": "2.0",
                "id": challenge["id"].clone(),
                "result": {
                    "protocolVersion": 1,
                    "proof": proof,
                    "nonce": ENGINE_NONCE,
                    "pid": std::process::id(),
                    "versions": { "engine": "test", "node": "none" }
                }
            }),
        )
        .await;
        challenge
    }
}

#[cfg(windows)]
#[test]
fn pp_01_pipe_names_are_unique_uuid_v4() {
    use omni_studio::pipe::{is_valid_pipe_name, new_pipe_name};
    let prefix = r"\\.\pipe\omnispec-";
    let mut seen = std::collections::HashSet::new();
    for _ in 0..1000 {
        let name = new_pipe_name();
        let uuid = name
            .strip_prefix(prefix)
            .unwrap_or_else(|| panic!("{name} lacks the {prefix} prefix"));
        // Pattern of EN-07: ^\\\\\.\\pipe\\omnispec-[0-9a-f-]{36}$, and a real UUID v4 layout.
        assert_eq!(uuid.len(), 36, "{name}");
        assert!(
            uuid.chars()
                .all(|c| matches!(c, '0'..='9' | 'a'..='f' | '-')),
            "{name}"
        );
        let groups: Vec<&str> = uuid.split('-').collect();
        assert_eq!(
            groups.iter().map(|g| g.len()).collect::<Vec<_>>(),
            [8, 4, 4, 4, 12],
            "{name}"
        );
        assert!(
            groups[2].starts_with('4'),
            "UUID version nibble must be 4: {name}"
        );
        assert!(
            matches!(groups[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b'),
            "UUID variant must be RFC 4122: {name}"
        );
        assert!(is_valid_pipe_name(&name), "{name} must validate");
        assert!(seen.insert(name), "pipe names must be unique");
    }
    let valid = format!("{prefix}0f8fad5b-d9cb-469f-a165-70867728950e");
    assert!(is_valid_pipe_name(&valid));
    for invalid in [
        r"\\.\pipe\omnispec-0F8FAD5B-D9CB-469F-A165-70867728950E",
        r"\\server\pipe\omnispec-0f8fad5b-d9cb-469f-a165-70867728950e",
        r"\\.\pipe\other-0f8fad5b-d9cb-469f-a165-70867728950e",
        r"\\.\pipe\omnispec-0f8fad5b-d9cb-469f-a165-70867728950e-x",
        r"\\.\pipe\omnispec-0f8fad5b",
        "",
    ] {
        assert!(!is_valid_pipe_name(invalid), "{invalid:?} must be rejected");
    }
}

#[cfg(windows)]
#[tokio::test]
async fn pp_02_squatted_pipe_name_fails_without_retry() {
    use omni_studio::pipe::{PipeServer, new_pipe_name};
    use tokio::net::windows::named_pipe::ServerOptions;
    let name = new_pipe_name();
    // Same-user attacker creates the pipe first.
    let _squatter = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&name)
        .expect("squatter pipe");
    match PipeServer::create(&name) {
        Err(error @ StudioError::PipeSquatted) => assert_eq!(error.code(), "PIPE_SQUATTED"),
        Err(other) => panic!("expected PipeSquatted, got {other:?}"),
        Ok(_) => panic!(
            "PipeServer::create must fail on a pre-existing pipe (FILE_FLAG_FIRST_PIPE_INSTANCE)"
        ),
    }
    // The host's own instance must not mask the attack either: a second create of the same name fails too.
    let own = new_pipe_name();
    let _first = PipeServer::create(&own).expect("first create");
    assert!(
        matches!(PipeServer::create(&own), Err(StudioError::PipeSquatted)),
        "a second instance of the same name must be refused"
    );
}

#[cfg(windows)]
#[tokio::test]
async fn pp_03_server_options_are_hardened() {
    use omni_studio::pipe::{PipeServer, new_pipe_name};
    let server = PipeServer::create(&new_pipe_name()).expect("create");
    let options = server.options();
    assert!(options.first_pipe_instance, "FILE_FLAG_FIRST_PIPE_INSTANCE");
    assert!(options.reject_remote_clients, "PIPE_REJECT_REMOTE_CLIENTS");
    assert_eq!(options.max_instances, 1);
}

#[cfg(windows)]
#[tokio::test]
async fn pp_04_dacl_grants_only_the_current_user() {
    use omni_studio::pipe::{PipeServer, new_pipe_name};
    let server = PipeServer::create(&new_pipe_name()).expect("create");
    // dacl_sids() reads the DACL back with GetSecurityInfo and lists the SID of every access ACE.
    let sids = server.dacl_sids().expect("GetSecurityInfo");
    assert_eq!(
        sids,
        vec![support_sid()],
        "the DACL must hold a single ACE for the current user"
    );
}

#[cfg(windows)]
fn support_sid() -> String {
    let output = std::process::Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .expect("whoami");
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim()
        .rsplit(',')
        .next()
        .expect("SID column")
        .trim_matches('"')
        .to_owned()
}

#[cfg(windows)]
#[tokio::test]
async fn pp_05_peer_with_unexpected_pid_is_rejected() {
    use omni_studio::pipe::{PipeServer, new_pipe_name};
    let name = new_pipe_name();
    let server = PipeServer::create(&name).expect("create");
    // The launched engine would be another process; this test process is the impostor.
    let expected_pid = std::process::id() + 4;
    let accept = tokio::spawn(async move { server.accept(expected_pid, SECRET).await });
    let mut client = wire::open(&name);
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), accept)
        .await
        .expect("accept must finish")
        .expect("accept task");
    match result {
        Err(error @ StudioError::PeerRejected { .. }) => {
            assert_eq!(error.code(), "PEER_REJECTED");
            if let StudioError::PeerRejected { pid } = error {
                assert_eq!(
                    pid,
                    std::process::id(),
                    "GetNamedPipeClientProcessId of the impostor"
                );
            }
        }
        Err(other) => panic!("expected PeerRejected, got {other:?}"),
        Ok(_) => panic!("a client with the wrong PID must not be accepted"),
    }
    wire::assert_closed_without_frames(&mut client).await;
}

#[cfg(windows)]
#[tokio::test]
async fn pp_06_wrong_hmac_proof_disconnects() {
    use omni_studio::pipe::{PipeServer, new_pipe_name};
    // The Rust proof matches the reference HMAC-SHA256 over "omnispec-studio-v1:<role>:<nonce>".
    assert_eq!(
        handshake_proof(SECRET, "engine", wire::ENGINE_NONCE).expect("proof"),
        reference_proof(SECRET, "engine", wire::ENGINE_NONCE)
    );
    assert!(handshake_proof("not-hex", "host", wire::ENGINE_NONCE).is_err());

    // Wrong proof: the host disconnects, never sends studio.hello, and reports HANDSHAKE_FAILED.
    let name = new_pipe_name();
    let server = PipeServer::create(&name).expect("create");
    let accept = tokio::spawn(async move { server.accept(std::process::id(), SECRET).await });
    let mut client = wire::open(&name);
    let wrong = reference_proof(&"00".repeat(32), "engine", "ignored");
    wire::engine_handshake(&mut client, Some(wrong)).await;
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), accept)
        .await
        .expect("accept must finish")
        .expect("accept task");
    assert!(
        matches!(result, Err(StudioError::HandshakeFailed)),
        "expected HandshakeFailed, got {:?}",
        result.as_ref().err()
    );
    wire::assert_closed_without_frames(&mut client).await;

    // Control: the correct proof is accepted and the host answers with its own proof.
    let name = new_pipe_name();
    let server = PipeServer::create(&name).expect("create");
    let accept = tokio::spawn(async move { server.accept(std::process::id(), SECRET).await });
    let mut client = wire::open(&name);
    wire::engine_handshake(&mut client, None).await;
    let hello = wire::read_frame(&mut client).await;
    assert_eq!(hello["method"], "studio.hello");
    assert!(hello.get("id").is_none(), "studio.hello is a notification");
    assert_eq!(
        hello["params"]["proof"],
        reference_proof(SECRET, "host", wire::ENGINE_NONCE)
    );
    tokio::time::timeout(std::time::Duration::from_secs(5), accept)
        .await
        .expect("accept must finish")
        .expect("accept task")
        .expect("handshake with the right proof succeeds");
}

#[test]
fn pp_07_cross_language_conformance_with_protocol_vectors() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("protocol-vectors.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "{} is generated by the Node encoder (src/studio/protocol.mjs encodeFrame) and must exist: {error}",
            path.display()
        )
    });
    let vectors: serde_json::Value =
        serde_json::from_str(&text).expect("protocol-vectors.json is JSON");
    assert_eq!(vectors["protocolVersion"], 1);
    assert_eq!(
        vectors["maxFrameBytes"].as_u64(),
        Some(MAX_FRAME_BYTES as u64)
    );
    assert_eq!(MAX_FRAME_BYTES, 8 * 1024 * 1024);

    let frames = vectors["frames"].as_array().expect("frames[]");
    assert!(frames.len() >= 3, "at least three golden frames");
    let mut stream = Vec::new();
    let mut expected_texts = Vec::new();
    let mut saw_multibyte = false;
    for vector in frames {
        let name = vector["name"].as_str().expect("frame name");
        let json = vector["json"]
            .as_str()
            .expect("exact JSON text produced by Node");
        let bytes =
            hex::decode(vector["frameHex"].as_str().expect("frameHex")).expect("frameHex is hex");
        serde_json::from_str::<serde_json::Value>(json).expect("vector json parses");
        saw_multibyte |= json.len() != json.chars().count();
        // Encoder: Rust produces exactly the bytes Node produced.
        assert_eq!(
            encode_frame(json).expect("encode"),
            bytes,
            "encode mismatch for {name}"
        );
        // Decoder: whole frame, and one byte at a time.
        let mut decoder = FrameDecoder::new(MAX_FRAME_BYTES);
        assert_eq!(
            decoder.push(&bytes).expect("decode"),
            vec![json.to_owned()],
            "{name}"
        );
        let mut decoder = FrameDecoder::new(MAX_FRAME_BYTES);
        let mut out = Vec::new();
        for byte in &bytes {
            out.extend(
                decoder
                    .push(std::slice::from_ref(byte))
                    .expect("decode byte-wise"),
            );
        }
        assert_eq!(out, vec![json.to_owned()], "byte-wise decode of {name}");
        stream.extend_from_slice(&bytes);
        expected_texts.push(json.to_owned());
    }
    assert!(
        saw_multibyte,
        "vectors must include non-ASCII text (header counts bytes)"
    );
    let mut decoder = FrameDecoder::new(MAX_FRAME_BYTES);
    assert_eq!(
        decoder.push(&stream).expect("decode stream"),
        expected_texts
    );

    // Rejections must carry the same protocol error codes as the Node decoder.
    for vector in vectors["rejects"].as_array().expect("rejects[]") {
        let name = vector["name"].as_str().expect("reject name");
        let code = vector["code"].as_str().expect("reject code");
        let bytes = hex::decode(vector["chunkHex"].as_str().expect("chunkHex")).expect("hex");
        let error = FrameDecoder::new(
            vector["maxFrameBytes"]
                .as_u64()
                .map_or(MAX_FRAME_BYTES, |m| m as usize),
        )
        .push(&bytes)
        .expect_err(name);
        assert_eq!(error.code(), code, "{name}");
    }

    for vector in vectors["handshake"].as_array().expect("handshake[]") {
        let secret = vector["secret"].as_str().expect("secret");
        let role = vector["role"].as_str().expect("role");
        let nonce = vector["nonce"].as_str().expect("nonce");
        let proof = vector["proof"].as_str().expect("proof");
        assert_eq!(
            handshake_proof(secret, role, nonce).expect("proof"),
            proof,
            "{role}/{nonce}"
        );
    }
}

#[test]
fn pp_08_oversized_header_is_rejected_before_allocating() {
    let oversized = u32::try_from(MAX_FRAME_BYTES + 1)
        .expect("fits")
        .to_le_bytes();
    let mut decoder = FrameDecoder::new(MAX_FRAME_BYTES);
    let (result, largest) = largest_allocation(|| decoder.push(&oversized));
    match result {
        Err(StudioError::FrameTooLarge { len, max }) => {
            assert_eq!(len, MAX_FRAME_BYTES + 1);
            assert_eq!(max, MAX_FRAME_BYTES);
        }
        other => panic!("expected FrameTooLarge, got {other:?}"),
    }
    assert!(
        largest < 1024 * 1024,
        "the payload must not be reserved before rejecting (largest allocation {largest} bytes)"
    );
    // The decoder is poisoned: it never tries to resynchronise on the same stream.
    assert!(
        decoder
            .push(&reference_frame(r#"{"jsonrpc":"2.0","id":1,"result":1}"#))
            .is_err(),
        "a failed decoder must stay failed"
    );

    let mut decoder = FrameDecoder::new(MAX_FRAME_BYTES);
    let (result, largest) = largest_allocation(|| decoder.push(&0xffff_fff0u32.to_le_bytes()));
    assert!(matches!(result, Err(StudioError::FrameTooLarge { .. })));
    assert!(largest < 1024 * 1024, "largest allocation {largest} bytes");

    // Boundary: exactly MAX_FRAME_BYTES is legal, one more byte is not (encoder side too).
    let at_limit = format!("\"{}\"", "x".repeat(MAX_FRAME_BYTES - 2));
    let frame = encode_frame(&at_limit).expect("frame at the limit");
    assert_eq!(
        &frame[..4],
        &u32::try_from(MAX_FRAME_BYTES).expect("fits").to_le_bytes()
    );
    assert_eq!(
        FrameDecoder::new(MAX_FRAME_BYTES)
            .push(&frame)
            .expect("decode at limit"),
        vec![at_limit]
    );
    let over_limit = format!("\"{}\"", "x".repeat(MAX_FRAME_BYTES - 1));
    assert!(matches!(
        encode_frame(&over_limit),
        Err(StudioError::FrameTooLarge { .. })
    ));
}

#[cfg(windows)]
#[tokio::test]
async fn pp_09_second_client_is_rejected() {
    use omni_studio::pipe::{PipeServer, new_pipe_name};
    use tokio::net::windows::named_pipe::ClientOptions;
    let name = new_pipe_name();
    let server = PipeServer::create(&name).expect("create");
    let accept = tokio::spawn(async move { server.accept(std::process::id(), SECRET).await });
    let mut first = wire::open(&name);
    wire::engine_handshake(&mut first, None).await;
    let _hello = wire::read_frame(&mut first).await;
    let _connection = accept
        .await
        .expect("accept task")
        .expect("first client accepted");

    match ClientOptions::new().open(&name) {
        Err(error) => assert_eq!(
            error.raw_os_error(),
            Some(231),
            "second client must get ERROR_PIPE_BUSY (max_instances = 1), got {error}"
        ),
        Ok(_) => panic!("a second client must not be able to connect"),
    }
}

#[cfg(windows)]
#[tokio::test]
async fn pp_10_method_timeout_reports_engine_timeout_without_killing() {
    use omni_studio::pipe::{DEFAULT_CALL_TIMEOUT, PipeServer, new_pipe_name};
    use serde_json::json;
    use std::time::{Duration, Instant};
    assert_eq!(DEFAULT_CALL_TIMEOUT, Duration::from_secs(10));

    let name = new_pipe_name();
    let server = PipeServer::create(&name).expect("create");
    let accept = tokio::spawn(async move { server.accept(std::process::id(), SECRET).await });
    let mut client = wire::open(&name);
    wire::engine_handshake(&mut client, None).await;
    let _hello = wire::read_frame(&mut client).await;
    let connection = accept.await.expect("accept task").expect("accepted");

    // The engine never answers diff.get within the (configured) 200 ms timeout.
    let started = Instant::now();
    let (timed_out, slow_request) = tokio::join!(
        connection.call_with_timeout("diff.get", json!({}), Duration::from_millis(200)),
        wire::read_frame(&mut client)
    );
    match timed_out {
        Err(error @ StudioError::EngineTimeout { .. }) => {
            assert_eq!(error.code(), "ENGINE_TIMEOUT");
            if let StudioError::EngineTimeout { method } = error {
                assert_eq!(method, "diff.get");
            }
        }
        other => panic!("expected EngineTimeout, got {other:?}"),
    }
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "timeout honoured"
    );
    assert_eq!(slow_request["method"], "diff.get");

    // The connection (and the engine) stays alive: a late reply is ignored, the next call works.
    let next = async {
        let request = wire::read_frame(&mut client).await;
        assert_eq!(request["method"], "project.snapshot");
        wire::write_frame(
            &mut client,
            &json!({ "jsonrpc": "2.0", "id": slow_request["id"].clone(), "result": { "late": true } }),
        )
        .await;
        wire::write_frame(
            &mut client,
            &json!({ "jsonrpc": "2.0", "id": request["id"].clone(), "result": { "ok": true } }),
        )
        .await;
    };
    let (result, ()) = tokio::join!(
        connection.call_with_timeout("project.snapshot", json!({}), Duration::from_secs(5)),
        next
    );
    assert_eq!(
        result.expect("engine still serving after a timeout"),
        json!({ "ok": true })
    );
}

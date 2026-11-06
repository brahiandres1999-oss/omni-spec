//! Wire format of the Studio IPC (plan §4, decision D-2): JSON-RPC 2.0 messages in frames made of a
//! 4-byte little-endian byte length followed by UTF-8 JSON, at most [`MAX_FRAME_BYTES`]. The same
//! rules as `src/studio/protocol.mjs`; `apps/studio/protocol-vectors.json` pins both (PP-07).

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::error::{Result, StudioError};

/// Protocol version exchanged in `studio.challenge`.
pub const PROTOCOL_VERSION: u64 = 1;
/// Largest frame body accepted or produced (8 MiB).
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

const HEADER_BYTES: usize = 4;
const HANDSHAKE_DOMAIN: &str = "omnispec-studio-v1";
/// Initial buffer reservation; larger bodies grow with the bytes actually received.
const INITIAL_RESERVE: usize = 64 * 1024;

/// Encodes one JSON text as a frame (header + body).
///
/// # Errors
/// [`StudioError::FrameTooLarge`] when the body exceeds [`MAX_FRAME_BYTES`].
pub fn encode_frame(json: &str) -> Result<Vec<u8>> {
    let len = json.len();
    if len > MAX_FRAME_BYTES {
        return Err(StudioError::FrameTooLarge {
            len,
            max: MAX_FRAME_BYTES,
        });
    }
    let header = u32::try_from(len)
        .map_err(|_| StudioError::FrameTooLarge {
            len,
            max: MAX_FRAME_BYTES,
        })?
        .to_le_bytes();
    let mut frame = Vec::with_capacity(HEADER_BYTES + len);
    frame.extend_from_slice(&header);
    frame.extend_from_slice(json.as_bytes());
    Ok(frame)
}

/// Incremental frame decoder. The declared length is validated before any payload is buffered,
/// and after the first error every later `push` fails: a byte stream cannot be resynchronised.
#[derive(Debug)]
pub struct FrameDecoder {
    max: usize,
    header: [u8; HEADER_BYTES],
    header_len: usize,
    expected: Option<usize>,
    body: Vec<u8>,
    failed: bool,
}

impl FrameDecoder {
    /// A decoder that rejects frames larger than `max` bytes.
    pub fn new(max: usize) -> FrameDecoder {
        FrameDecoder {
            max,
            header: [0; HEADER_BYTES],
            header_len: 0,
            expected: None,
            body: Vec::new(),
            failed: false,
        }
    }

    /// Feeds bytes and returns the complete frame bodies they finish, in order.
    ///
    /// # Errors
    /// `FrameTooLarge`, `EmptyFrame` or `InvalidUtf8` for a bad frame; `DecoderFailed` afterwards.
    pub fn push(&mut self, mut chunk: &[u8]) -> Result<Vec<String>> {
        if self.failed {
            return Err(StudioError::DecoderFailed);
        }
        let mut out = Vec::new();
        while !chunk.is_empty() {
            let Some(expected) = self.expected else {
                let take = (HEADER_BYTES - self.header_len).min(chunk.len());
                self.header[self.header_len..self.header_len + take]
                    .copy_from_slice(&chunk[..take]);
                self.header_len += take;
                chunk = &chunk[take..];
                if self.header_len == HEADER_BYTES {
                    self.header_len = 0;
                    let len = u32::from_le_bytes(self.header) as usize;
                    if len == 0 {
                        return Err(self.fail(StudioError::EmptyFrame));
                    }
                    if len > self.max {
                        return Err(self.fail(StudioError::FrameTooLarge { len, max: self.max }));
                    }
                    self.expected = Some(len);
                    self.body = Vec::with_capacity(len.min(INITIAL_RESERVE));
                }
                continue;
            };
            let take = (expected - self.body.len()).min(chunk.len());
            self.body.extend_from_slice(&chunk[..take]);
            chunk = &chunk[take..];
            if self.body.len() == expected {
                self.expected = None;
                let body = std::mem::take(&mut self.body);
                match String::from_utf8(body) {
                    Ok(text) => out.push(text),
                    Err(_) => return Err(self.fail(StudioError::InvalidUtf8)),
                }
            }
        }
        Ok(out)
    }

    fn fail(&mut self, error: StudioError) -> StudioError {
        self.failed = true;
        self.body = Vec::new();
        self.expected = None;
        error
    }
}

fn handshake_mac(secret_hex: &str, role: &str, nonce_hex: &str) -> Result<Hmac<Sha256>> {
    let key = hex::decode(secret_hex).map_err(|_| StudioError::HandshakeFailed)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).map_err(|_| StudioError::HandshakeFailed)?;
    mac.update(format!("{HANDSHAKE_DOMAIN}:{role}:{nonce_hex}").as_bytes());
    Ok(mac)
}

/// HMAC-SHA256 proof of the handshake (plan §5): lowercase hex of
/// `HMAC(secret, "omnispec-studio-v1:<role>:<nonce>")`.
///
/// # Errors
/// [`StudioError::HandshakeFailed`] when the secret is not hex.
pub fn handshake_proof(secret_hex: &str, role: &str, nonce_hex: &str) -> Result<String> {
    Ok(hex::encode(
        handshake_mac(secret_hex, role, nonce_hex)?
            .finalize()
            .into_bytes(),
    ))
}

/// Verifies a peer proof in constant time (same guarantee as `signaturesMatch` in Node).
pub fn verify_proof(secret_hex: &str, role: &str, nonce_hex: &str, proof_hex: &str) -> bool {
    let Ok(proof) = hex::decode(proof_hex) else {
        return false;
    };
    handshake_mac(secret_hex, role, nonce_hex).is_ok_and(|mac| mac.verify_slice(&proof).is_ok())
}

/// True for exactly 64 lowercase hexadecimal characters (256-bit value).
pub fn is_hex64(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `bytes` random bytes from the OS CSPRNG, as lowercase hex.
///
/// # Errors
/// [`StudioError::Io`] when the OS generator is unavailable.
pub fn random_hex(bytes: usize) -> Result<String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|error| StudioError::Io {
        op: "getrandom",
        message: error.to_string(),
    })?;
    Ok(hex::encode(buffer))
}

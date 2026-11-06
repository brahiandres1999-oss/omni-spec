//! Typed errors of the Studio host (docs/NEXTGEN-PHASE4-TEST-PLAN.md §10).
//!
//! Every variant maps to a stable SCREAMING_CASE code ([`StudioError::code`]) that the frontend
//! turns into one of its four view states. Win32 failures keep the `GetLastError` value.

use std::path::PathBuf;

/// Errors returned by every fallible function of the `omni_studio` crate.
#[derive(Debug, thiserror::Error)]
pub enum StudioError {
    /// A Win32 call failed; `code` is the `GetLastError` value.
    #[error("{op} failed with Win32 error {code}")]
    Win32 { op: &'static str, code: u32 },
    /// The pipe name already exists (another process created it first).
    #[error("the named pipe already exists: possible pipe squatting")]
    PipeSquatted,
    /// The pipe client is not the engine process the host launched.
    #[error("pipe client {pid} is not the launched engine")]
    PeerRejected { pid: u32 },
    /// The mutual HMAC handshake failed.
    #[error("the engine handshake failed")]
    HandshakeFailed,
    /// A frame header announced more bytes than allowed.
    #[error("frame of {len} bytes exceeds {max}")]
    FrameTooLarge { len: usize, max: usize },
    /// A frame header announced zero bytes.
    #[error("zero-length frame")]
    EmptyFrame,
    /// A frame body is not valid UTF-8.
    #[error("frame body is not valid UTF-8")]
    InvalidUtf8,
    /// The decoder already failed; the stream cannot be resynchronised.
    #[error("the frame decoder already failed; close the connection")]
    DecoderFailed,
    /// A frame body is not a JSON-RPC 2.0 message.
    #[error("invalid JSON-RPC message: {reason}")]
    InvalidMessage { reason: String },
    /// Node.js is older than [`crate::engine::NodeVersion::MINIMUM`] (or its version is unreadable).
    #[error("Node.js {found} is not supported (>= 22.19.0 required)")]
    NodeUnsupported { found: String },
    /// Neither `OMNI_STUDIO_NODE` nor `PATH` provides `node.exe`.
    #[error("node.exe was not found (set OMNI_STUDIO_NODE or add Node.js >= 22.19.0 to PATH)")]
    NodeNotFound,
    /// The bundled omni-spec core is missing.
    #[error("the bundled omni-spec engine is missing: {path}")]
    EngineMissing { path: PathBuf },
    /// The bundled omni-spec core does not match the app version (D-4).
    #[error("bundled omni-spec {bundled} does not match Omni Studio {app}")]
    EngineMismatch { bundled: String, app: String },
    /// The engine crashed too often; the supervisor stopped restarting it.
    #[error("the engine crashed repeatedly and was not restarted")]
    EngineDead,
    /// The engine exited before the handshake completed.
    #[error("the engine exited before the handshake (exit code {code:?})")]
    EngineExited { code: Option<i32> },
    /// The engine is being restarted after a crash.
    #[error("the engine is restarting")]
    EngineRestarting,
    /// The pipe to the engine closed while a request was in flight.
    #[error("the connection to the engine was closed")]
    EngineDisconnected,
    /// The engine did not answer `method` within the call timeout.
    #[error("the engine did not answer {method} in time")]
    EngineTimeout { method: String },
    /// The engine answered with a JSON-RPC error; `code` is its domain code.
    #[error("{code}: {message}")]
    Engine {
        code: String,
        message: String,
        /// The JSON-RPC error object, forwarded to the frontend as is.
        error: serde_json::Value,
    },
    /// The configured or default shell does not exist.
    #[error("shell {shell} was not found")]
    ShellNotFound { shell: String },
    /// The frontend asked for a method outside the allowlist (SEC-02).
    #[error("method {method} is not allowed")]
    MethodNotAllowed { method: String },
    /// `recent.json` exists but cannot be parsed.
    #[error("the recent projects list is unreadable")]
    RecentUnreadable,
    /// The project argument is not an existing folder.
    #[error("the project path is not an existing folder")]
    ProjectInvalid,
    /// The request belonged to an engine that was replaced by a project switch (EG-08).
    #[error("the project was switched while the request was in flight")]
    ProjectSwitched,
    /// The terminal was already closed.
    #[error("the terminal is closed")]
    TerminalClosed,
    /// An I/O operation failed.
    #[error("{op}: {message}")]
    Io { op: &'static str, message: String },
}

impl StudioError {
    /// Stable machine-readable code (`ENGINE_TIMEOUT`, `PIPE_SQUATTED`, ...). For engine domain
    /// errors it is the code the engine sent.
    pub fn code(&self) -> &str {
        match self {
            StudioError::Win32 { .. } => "WIN32_ERROR",
            StudioError::PipeSquatted => "PIPE_SQUATTED",
            StudioError::PeerRejected { .. } => "PEER_REJECTED",
            StudioError::HandshakeFailed => "HANDSHAKE_FAILED",
            StudioError::FrameTooLarge { .. } => "FRAME_TOO_LARGE",
            StudioError::EmptyFrame => "EMPTY_FRAME",
            StudioError::InvalidUtf8 => "INVALID_UTF8",
            StudioError::DecoderFailed => "DECODER_FAILED",
            StudioError::InvalidMessage { .. } => "INVALID_MESSAGE",
            StudioError::NodeUnsupported { .. } => "NODE_UNSUPPORTED",
            StudioError::NodeNotFound => "NODE_NOT_FOUND",
            StudioError::EngineMissing { .. } => "ENGINE_MISSING",
            StudioError::EngineMismatch { .. } => "ENGINE_MISMATCH",
            StudioError::EngineDead => "ENGINE_DEAD",
            StudioError::EngineExited { .. } => "ENGINE_EXITED",
            StudioError::EngineRestarting => "ENGINE_RESTARTING",
            StudioError::EngineDisconnected => "ENGINE_DISCONNECTED",
            StudioError::EngineTimeout { .. } => "ENGINE_TIMEOUT",
            StudioError::Engine { code, .. } => code,
            StudioError::ShellNotFound { .. } => "SHELL_NOT_FOUND",
            StudioError::MethodNotAllowed { .. } => "METHOD_NOT_ALLOWED",
            StudioError::RecentUnreadable => "RECENT_UNREADABLE",
            StudioError::ProjectInvalid => "PROJECT_INVALID",
            StudioError::ProjectSwitched => "PROJECT_SWITCHED",
            StudioError::TerminalClosed => "TERMINAL_CLOSED",
            StudioError::Io { .. } => "IO_ERROR",
        }
    }

    /// True when retrying the same request later can succeed.
    pub fn retryable(&self) -> bool {
        matches!(
            self,
            StudioError::EngineTimeout { .. }
                | StudioError::EngineRestarting
                | StudioError::EngineDisconnected
                | StudioError::ProjectSwitched
        )
    }

    pub(crate) fn io(op: &'static str, error: &std::io::Error) -> StudioError {
        match error
            .raw_os_error()
            .and_then(|code| u32::try_from(code).ok())
        {
            Some(code) => StudioError::Win32 { op, code },
            None => StudioError::Io {
                op,
                message: error.to_string(),
            },
        }
    }

    /// Converts a `windows` crate error (an HRESULT) back to the Win32 code it wraps.
    #[cfg(windows)]
    pub(crate) fn win32(op: &'static str, error: &windows::core::Error) -> StudioError {
        // HRESULT_FROM_WIN32 sets facility 7 and the severity bit: 0x8007_xxxx.
        let hresult = error.code().0.cast_unsigned();
        let code = if hresult & 0xFFFF_0000 == 0x8007_0000 {
            hresult & 0xFFFF
        } else {
            hresult
        };
        StudioError::Win32 { op, code }
    }

    /// The error object sent to the frontend: `{ code, message, data: { code, detail, retryable } }`.
    pub fn to_rpc_error(&self) -> serde_json::Value {
        if let StudioError::Engine { error, .. } = self {
            return error.clone();
        }
        serde_json::json!({
            "code": -32000,
            "message": self.to_string(),
            "data": { "code": self.code(), "detail": self.to_string(), "retryable": self.retryable() },
        })
    }
}

impl serde::Serialize for StudioError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        self.to_rpc_error().serialize(serializer)
    }
}

/// Crate-wide result alias.
pub type Result<T> = std::result::Result<T, StudioError>;

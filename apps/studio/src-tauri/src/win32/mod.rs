//! Direct Win32 building blocks (decision D-3): Job Objects and process creation with attributes.

pub mod job;
pub mod spawn;

use std::os::windows::io::{AsRawHandle, OwnedHandle};

use windows::Win32::Foundation::HANDLE;

/// Borrows an owned handle as the `windows` crate type.
pub(crate) fn raw(handle: &OwnedHandle) -> HANDLE {
    HANDLE(handle.as_raw_handle())
}

/// Takes ownership of a handle returned by a Win32 call.
///
/// # Safety
/// `handle` must be a valid, open handle that nothing else closes.
pub(crate) unsafe fn own(handle: HANDLE) -> OwnedHandle {
    use std::os::windows::io::FromRawHandle;
    // SAFETY: guaranteed by the caller.
    unsafe { OwnedHandle::from_raw_handle(handle.0) }
}

/// Null-terminated UTF-16 copy of an OS string.
pub(crate) fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    text.encode_wide().chain(std::iter::once(0)).collect()
}

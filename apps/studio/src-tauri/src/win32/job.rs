//! Job Objects with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (plan §10.1): closing the last handle,
//! including when the host dies abruptly, terminates every process in the job.

use std::os::windows::io::OwnedHandle;

use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::JobObjects::{
    CreateJobObjectW, IsProcessInJob, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    QueryInformationJobObject, SetInformationJobObject,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::core::{BOOL, PCWSTR};

use super::{own, raw};
use crate::error::{Result, StudioError};

/// An anonymous Job Object. Dropping it closes the handle and kills every process in it.
#[derive(Debug)]
pub struct Job {
    handle: OwnedHandle,
}

impl Job {
    /// Creates a job whose processes die when the job handle closes. Breakaway is not allowed.
    ///
    /// # Errors
    /// [`StudioError::Win32`] from `CreateJobObjectW` or `SetInformationJobObject`.
    pub fn kill_on_close() -> Result<Job> {
        // SAFETY: anonymous job with default security; the handle is owned right away.
        let handle = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
            .map_err(|e| StudioError::win32("CreateJobObjectW", &e))?;
        // SAFETY: valid handle returned above, closed exactly once by OwnedHandle.
        let job = Job {
            handle: unsafe { own(handle) },
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: the pointer and size describe `info`, which outlives the call.
        unsafe {
            SetInformationJobObject(
                raw(&job.handle),
                JobObjectExtendedLimitInformation,
                (&raw const info).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|e| StudioError::win32("SetInformationJobObject", &e))?;
        Ok(job)
    }

    /// The job's `LimitFlags`, read back with `QueryInformationJobObject`.
    ///
    /// # Errors
    /// [`StudioError::Win32`] from `QueryInformationJobObject`.
    pub fn limit_flags(&self) -> Result<u32> {
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // SAFETY: the pointer and size describe `info`.
        unsafe {
            QueryInformationJobObject(
                Some(raw(&self.handle)),
                JobObjectExtendedLimitInformation,
                (&raw mut info).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                None,
            )
        }
        .map_err(|e| StudioError::win32("QueryInformationJobObject", &e))?;
        Ok(info.BasicLimitInformation.LimitFlags.0)
    }

    /// True when process `pid` belongs to this job (`IsProcessInJob`).
    ///
    /// # Errors
    /// [`StudioError::Win32`] when the process cannot be opened or queried.
    pub fn contains(&self, pid: u32) -> Result<bool> {
        // SAFETY: plain Win32 call; the handle is closed below.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
            .map_err(|e| StudioError::win32("OpenProcess", &e))?;
        let mut inside = BOOL(0);
        // SAFETY: both handles are valid; `inside` is a valid out pointer.
        let result = unsafe { IsProcessInJob(process, Some(raw(&self.handle)), &mut inside) };
        // SAFETY: `process` was opened above and is closed exactly once.
        let _ = unsafe { CloseHandle(process) };
        result.map_err(|e| StudioError::win32("IsProcessInJob", &e))?;
        Ok(inside.as_bool())
    }

    pub(crate) fn handle(&self) -> &OwnedHandle {
        &self.handle
    }
}

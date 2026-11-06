//! Recent projects in `%APPDATA%\OmniStudio\recent.json` (plan §10.9, reconciliation §1.17.10):
//! MRU order, canonical paths compared case-insensitively on Windows, at most 10 entries, atomic
//! writes. Loading never rewrites the file, so a corrupt list survives until the user opens a project.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::security::simplify;

/// Maximum number of remembered projects.
pub const MAX_RECENT: usize = 10;

/// One remembered project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    /// Canonical folder path.
    pub path: PathBuf,
    /// Folder name, for the rail.
    pub name: String,
    /// The folder no longer exists (shown, never dropped silently).
    pub missing: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct RecentFile {
    version: u32,
    entries: Vec<StoredEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredEntry {
    path: PathBuf,
}

/// The recent projects list bound to its file.
#[derive(Debug)]
pub struct RecentProjects {
    file: PathBuf,
    entries: Vec<RecentEntry>,
    load_error: Option<StudioError>,
}

fn key(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

fn entry(path: PathBuf) -> RecentEntry {
    RecentEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        missing: !path.is_dir(),
        path,
    }
}

impl RecentProjects {
    /// `%APPDATA%\OmniStudio\recent.json`.
    ///
    /// # Errors
    /// [`StudioError::RecentUnreadable`] when `APPDATA` is not set.
    pub fn default_path() -> Result<PathBuf> {
        // E2E isolation: OMNI_STUDIO_USER_DATA replaces every per-user location.
        if let Some(dir) = crate::window::user_data_override() {
            return Ok(dir.join("recent.json"));
        }
        let appdata = std::env::var_os("APPDATA").ok_or(StudioError::RecentUnreadable)?;
        Ok(PathBuf::from(appdata)
            .join("OmniStudio")
            .join("recent.json"))
    }

    /// Reads the list. A missing file is an empty list; an unreadable one is an empty list plus
    /// [`RecentProjects::load_error`].
    pub fn load(file: &Path) -> RecentProjects {
        let mut recent = RecentProjects {
            file: file.to_path_buf(),
            entries: Vec::new(),
            load_error: None,
        };
        match std::fs::read(file) {
            Ok(bytes) => match serde_json::from_slice::<RecentFile>(&bytes) {
                Ok(stored) => {
                    recent.entries = stored
                        .entries
                        .into_iter()
                        .take(MAX_RECENT)
                        .map(|stored| entry(stored.path))
                        .collect();
                }
                Err(_) => recent.load_error = Some(StudioError::RecentUnreadable),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => recent.load_error = Some(StudioError::RecentUnreadable),
        }
        recent
    }

    /// Entries, most recent first.
    pub fn entries(&self) -> &[RecentEntry] {
        &self.entries
    }

    /// Why the file could not be read, if it could not.
    pub fn load_error(&self) -> Option<&StudioError> {
        self.load_error.as_ref()
    }

    /// Moves `project` to the front (adding it if new) and saves the list atomically.
    ///
    /// # Errors
    /// [`StudioError::ProjectInvalid`] when `project` is not a folder; I/O errors when saving.
    pub fn open(&mut self, project: &Path) -> Result<()> {
        if !project.is_dir() {
            return Err(StudioError::ProjectInvalid);
        }
        let canonical = simplify(
            &project
                .canonicalize()
                .map_err(|_| StudioError::ProjectInvalid)?,
        );
        let wanted = key(&canonical);
        self.entries
            .retain(|existing| key(&existing.path) != wanted);
        self.entries.insert(0, entry(canonical));
        self.entries.truncate(MAX_RECENT);
        self.save()?;
        self.load_error = None;
        Ok(())
    }

    fn save(&self) -> Result<()> {
        let stored = RecentFile {
            version: 1,
            entries: self
                .entries
                .iter()
                .map(|entry| StoredEntry {
                    path: entry.path.clone(),
                })
                .collect(),
        };
        let text = serde_json::to_vec_pretty(&stored).map_err(|e| StudioError::Io {
            op: "serialize recent.json",
            message: e.to_string(),
        })?;
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| StudioError::io("create_dir_all", &e))?;
        }
        let mut temporary = self.file.clone().into_os_string();
        temporary.push(format!(".{}.tmp", std::process::id()));
        let temporary = PathBuf::from(temporary);
        std::fs::write(&temporary, text).map_err(|e| StudioError::io("write recent.json", &e))?;
        std::fs::rename(&temporary, &self.file).map_err(|error| {
            let _ = std::fs::remove_file(&temporary);
            StudioError::io("rename recent.json", &error)
        })
    }
}

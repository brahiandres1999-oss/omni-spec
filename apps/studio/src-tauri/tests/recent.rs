//! RP — Recent projects in `%APPDATA%\OmniStudio\recent.json` (docs/NEXTGEN-PHASE4-TEST-PLAN.md
//! §10.9, reconciliation §1.17.10).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::{Path, PathBuf};

use omni_studio::error::StudioError;
use omni_studio::recent::{MAX_RECENT, RecentProjects};
use support::{canon, norm_path};

fn entry_paths(recent: &RecentProjects) -> Vec<String> {
    recent
        .entries()
        .iter()
        .map(|entry| norm_path(&entry.path))
        .collect()
}

fn make_projects(parent: &Path, count: usize) -> Vec<PathBuf> {
    (0..count)
        .map(|i| {
            let dir = parent.join(format!("project-{i:02}"));
            std::fs::create_dir_all(&dir).expect("project dir");
            dir
        })
        .collect()
}

#[test]
fn rp_01_mru_without_duplicates_capped_written_atomically() {
    #[cfg(windows)]
    {
        let appdata = PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA"));
        assert_eq!(
            norm_path(&RecentProjects::default_path().expect("default path")),
            norm_path(&appdata.join("OmniStudio").join("recent.json"))
        );
    }

    let workspace = tempfile::tempdir().expect("projects");
    let store = tempfile::tempdir().expect("store dir");
    let file = store.path().join("recent.json");
    let projects = make_projects(workspace.path(), MAX_RECENT + 2);

    let mut recent = RecentProjects::load(&file);
    assert!(
        recent.load_error().is_none(),
        "a missing file is just an empty list"
    );
    assert!(recent.entries().is_empty());
    for project in &projects[..3] {
        recent.open(project).expect("open");
    }
    recent
        .open(&projects[0])
        .expect("re-open keeps its place");
    assert_eq!(
        recent.last_opened().map(|entry| norm_path(&entry.path)),
        Some(canon(&projects[0])),
        "the last one opened is remembered for the next launch"
    );
    #[cfg(windows)]
    {
        // Same folder, different case: one entry (canonical, case-insensitive on Windows).
        let shouted = PathBuf::from(projects[1].to_string_lossy().to_uppercase());
        recent.open(&shouted).expect("open with different case");
    }
    let expected = vec![
        canon(&projects[2]),
        canon(&projects[1]),
        canon(&projects[0]),
    ];
    assert_eq!(
        entry_paths(&recent),
        expected,
        "opening a listed project never reorders the rail, and adds no duplicate"
    );

    for project in &projects {
        recent.open(project).expect("open");
    }
    let paths = entry_paths(&recent);
    assert_eq!(paths.len(), MAX_RECENT, "capped");
    let newest_first: Vec<String> = projects
        .iter()
        .rev()
        .take(MAX_RECENT)
        .map(|p| canon(p))
        .collect();
    assert_eq!(paths, newest_first);

    // Persisted: a fresh load sees the same list; only recent.json is left behind (temp + rename).
    let reloaded = RecentProjects::load(&file);
    assert!(reloaded.load_error().is_none());
    assert_eq!(entry_paths(&reloaded), newest_first);
    let leftovers: Vec<String> = std::fs::read_dir(store.path())
        .expect("store dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        leftovers,
        vec!["recent.json".to_owned()],
        "no temporary files left behind"
    );
    serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&file).expect("read"))
        .expect("recent.json is valid JSON");
}

#[test]
fn rp_02_missing_project_is_flagged_not_dropped() {
    let workspace = tempfile::tempdir().expect("projects");
    let store = tempfile::tempdir().expect("store dir");
    let file = store.path().join("recent.json");
    let projects = make_projects(workspace.path(), 2);
    let gone = canon(&projects[0]);
    let alive = canon(&projects[1]);
    let mut recent = RecentProjects::load(&file);
    recent.open(&projects[0]).expect("open");
    recent.open(&projects[1]).expect("open");
    std::fs::remove_dir_all(&projects[0]).expect("delete project 0");

    let reloaded = RecentProjects::load(&file);
    assert!(reloaded.load_error().is_none());
    let entries: Vec<(String, bool)> = reloaded
        .entries()
        .iter()
        .map(|entry| (norm_path(&entry.path), entry.missing))
        .collect();
    assert_eq!(entries, vec![(alive, false), (gone.clone(), true)]);
    // Loading never rewrites the file: the missing entry is still persisted.
    let again = RecentProjects::load(&file);
    assert!(
        again
            .entries()
            .iter()
            .any(|entry| norm_path(&entry.path) == gone && entry.missing)
    );
}

#[test]
fn rp_03_corrupt_file_is_typed_and_preserved_until_next_open() {
    let workspace = tempfile::tempdir().expect("projects");
    let store = tempfile::tempdir().expect("store dir");
    let file = store.path().join("recent.json");
    let corrupt = b"{ \"entries\": [ this is not json";
    std::fs::write(&file, corrupt).expect("corrupt file");

    let mut recent = RecentProjects::load(&file);
    match recent.load_error() {
        Some(error @ StudioError::RecentUnreadable) => {
            assert_eq!(error.code(), "RECENT_UNREADABLE")
        }
        other => panic!("expected RecentUnreadable, got {other:?}"),
    }
    assert!(recent.entries().is_empty());
    assert_eq!(
        std::fs::read(&file).expect("read"),
        corrupt,
        "loading must not overwrite the file"
    );

    let project = make_projects(workspace.path(), 1).remove(0);
    recent
        .open(&project)
        .expect("opening a project replaces the unreadable list");
    assert!(recent.load_error().is_none());
    let reloaded = RecentProjects::load(&file);
    assert!(reloaded.load_error().is_none());
    assert_eq!(entry_paths(&reloaded), vec![canon(&project)]);
}

#[test]
fn rp_04_removing_a_project_drops_it_from_the_list_only() {
    let workspace = tempfile::tempdir().expect("projects");
    let store = tempfile::tempdir().expect("store dir");
    let file = store.path().join("recent.json");
    let projects = make_projects(workspace.path(), 3);
    let mut recent = RecentProjects::load(&file);
    for project in &projects {
        recent.open(project).expect("open");
    }

    recent.remove(&projects[1]).expect("remove");
    assert_eq!(
        entry_paths(&recent),
        vec![canon(&projects[2]), canon(&projects[0])]
    );
    assert!(projects[1].is_dir(), "the folder itself is untouched");
    assert_eq!(
        entry_paths(&RecentProjects::load(&file)),
        vec![canon(&projects[2]), canon(&projects[0])],
        "saved"
    );

    // A folder that no longer exists can still be removed, and an unknown one changes nothing.
    std::fs::remove_dir_all(&projects[0]).expect("delete folder");
    let gone = RecentProjects::load(&file).entries()[1].path.clone();
    recent.remove(&gone).expect("remove missing");
    recent
        .remove(Path::new("C:/no/such/folder"))
        .expect("remove unknown");
    assert_eq!(entry_paths(&recent), vec![canon(&projects[2])]);
}

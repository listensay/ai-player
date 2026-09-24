use crate::{db, AppState};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    collections::HashSet,
    io::Write,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub kind: String,
    pub relative: String,
    pub size: u64,
    pub modified: u64,
    pub path: String,
}

pub fn saved_roots(db: &Connection) -> db::Result<HashSet<PathBuf>> {
    db.prepare("SELECT path FROM course_locations")
        .map_err(|e| e.to_string())?
        .query_map([], |r| Ok(PathBuf::from(r.get::<_, String>(0)?)))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())
}
/// Resolve canonical paths inside a user-selected root, including symlinks and not-yet-created children.
fn resolve(
    roots: &HashSet<PathBuf>,
    root: &str,
    relative: &str,
    create: bool,
) -> db::Result<PathBuf> {
    let root = PathBuf::from(root);
    if !roots.contains(&root) {
        return Err("未授权访问此课程目录".into());
    }
    let relative = Path::new(relative);
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
        && !relative.as_os_str().is_empty()
    {
        return Err("无效的课程文件路径".into());
    }
    let base = root
        .canonicalize()
        .map_err(|_| "课程目录不存在，请重新关联文件夹".to_string())?;
    let path = base.join(relative);
    let canonical = if create && !path.exists() {
        let parent = path
            .parent()
            .ok_or("无效的文件路径")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        parent.join(path.file_name().ok_or("无效的文件名")?)
    } else {
        path.canonicalize().map_err(|e| e.to_string())?
    };
    if !canonical.starts_with(&base) {
        return Err("文件位于授权的课程目录之外".into());
    }
    Ok(canonical)
}
fn entry(path: &Path, relative: String) -> db::Result<Entry> {
    let stat = path.metadata().map_err(|e| e.to_string())?;
    Ok(Entry {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        kind: if stat.is_dir() { "directory" } else { "file" }.into(),
        relative,
        size: stat.len(),
        modified: stat
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        path: path.to_string_lossy().into_owned(),
    })
}
pub(crate) fn authorized(
    state: &AppState,
    root: &str,
    relative: &str,
    create: bool,
) -> db::Result<PathBuf> {
    resolve(
        &*state.roots.lock().map_err(|e| e.to_string())?,
        root,
        relative,
        create,
    )
}
#[tauri::command]
pub async fn choose_course_folder(app: tauri::AppHandle) -> db::Result<Option<Entry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("选择课程文件夹")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = path
            .into_path()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        app.asset_protocol_scope()
            .allow_directory(&path, true)
            .map_err(|e| e.to_string())?;
        app.state::<AppState>()
            .roots
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.clone());
        entry(&path, String::new()).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn course_locations(
    state: State<AppState>,
) -> db::Result<std::collections::HashMap<String, String>> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let result = conn
        .prepare("SELECT course_id,path FROM course_locations")
        .map_err(|e| e.to_string())?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    result
}
#[tauri::command]
pub fn save_course_location(
    state: State<AppState>,
    id: String,
    root: Option<String>,
) -> db::Result<()> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(root) = root {
        let path = authorized(&state, &root, "", false)?;
        conn.execute("INSERT INTO course_locations(course_id,path) VALUES (?,?) ON CONFLICT(course_id) DO UPDATE SET path=excluded.path",params![id,path.to_string_lossy()]).map_err(|e|e.to_string())?;
    } else {
        conn.execute("DELETE FROM course_locations WHERE course_id=?", [id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn fs_stat(state: State<AppState>, root: String, relative: String) -> db::Result<Entry> {
    entry(&authorized(&state, &root, &relative, false)?, relative)
}
#[tauri::command]
pub fn fs_entries(
    state: State<AppState>,
    root: String,
    relative: String,
) -> db::Result<Vec<Entry>> {
    let path = authorized(&state, &root, &relative, false)?;
    let mut entries = vec![];
    for file in path.read_dir().map_err(|e| e.to_string())? {
        let file = file.map_err(|e| e.to_string())?;
        if file.file_type().map_err(|e| e.to_string())?.is_symlink() {
            continue;
        }
        let child = if relative.is_empty() {
            file.file_name().to_string_lossy().into_owned()
        } else {
            format!("{relative}/{}", file.file_name().to_string_lossy())
        };
        // External symlinks and unreadable children are not part of the selected course.
        if let Ok(path) = authorized(&state, &root, &child, false) {
            if let Ok(item) = entry(&path, child) {
                entries.push(item);
            }
        }
    }
    Ok(entries)
}
#[tauri::command]
pub fn fs_child(
    state: State<AppState>,
    root: String,
    relative: String,
    directory: bool,
    create: bool,
) -> db::Result<Entry> {
    let path = authorized(&state, &root, &relative, create)?;
    if create && !path.exists() {
        if directory {
            std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        } else {
            check_write(&path)?;
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| e.to_string())?;
        }
    }
    let item = entry(&path, relative)?;
    if (item.kind == "directory") != directory {
        return Err("文件类型不匹配".into());
    }
    Ok(item)
}
fn check_write(path: &Path) -> db::Result<()> {
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if !["md", "srt", "vtt", "png", "jpg", "jpeg", "webp", "gif"].contains(&ext.as_str()) {
        return Err("仅支持写入笔记、字幕和图片文件".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn fs_read(
    app: tauri::AppHandle,
    root: String,
    relative: String,
) -> db::Result<tauri::ipc::Response> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = authorized(&app.state::<AppState>(), &root, &relative, false)?;
        std::fs::read(path)
            .map(tauri::ipc::Response::new)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn fs_write(
    app: tauri::AppHandle,
    root: String,
    relative: String,
    bytes: Vec<u8>,
) -> db::Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = authorized(&app.state::<AppState>(), &root, &relative, true)?;
        check_write(&path)?;
        let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("无效的文件路径")?)
            .map_err(|e| e.to_string())?;
        temp.write_all(&bytes).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(&path).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_access_to_selected_courses() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        std::fs::write(root.join("lesson.mp4"), b"video").unwrap();
        let roots = HashSet::from([root.clone()]);
        let path = root.to_str().unwrap();
        assert!(resolve(&roots, path, "lesson.mp4", false).is_ok());
        assert!(resolve(&roots, path, "lesson.md", true).is_ok());
        assert!(resolve(&roots, path, "../private.txt", false).is_err());
        assert!(resolve(&roots, path, "/etc/passwd", false).is_err());
        assert!(resolve(&HashSet::new(), path, "lesson.mp4", false).is_err());
        assert!(check_write(&root.join("lesson.mp4")).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn blocks_symlinks_outside_course() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
        let roots = HashSet::from([root.path().canonicalize().unwrap()]);
        assert!(resolve(
            &roots,
            root.path().to_str().unwrap(),
            "escape/notes.md",
            true
        )
        .is_err());
    }
}

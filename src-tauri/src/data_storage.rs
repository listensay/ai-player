use crate::{db, notes_storage::NotesStorage};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, Webview};
use tauri_plugin_dialog::DialogExt;

const FOLDER: &str = "Study Helper Data";
const MARKER: &str = ".study-helper-data";
pub(crate) const NOTES_PENDING: &str = ".notes-import-pending";
const DATABASE: &str = "ai-player.db";
const NOTES: &str = "notes.sqlite";

#[derive(Clone, Default, Deserialize, Serialize)]
struct Config {
    active: Option<PathBuf>,
    pending: Option<Pending>,
}
#[derive(Clone, Deserialize, Serialize)]
struct Pending {
    path: PathBuf,
    // Only a directory created by this migration may receive copied data.
    migration: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct Manifest {
    version: u32,
    id: String,
    ready: bool,
}
pub struct DataStorage {
    local: PathBuf,
    pub directory: PathBuf,
    pub portable: bool,
    config: Mutex<Config>,
    _local_lock: Mutex<Connection>,
    _data_lock: Option<Mutex<Connection>>,
}
fn config_path(local: &Path) -> PathBuf {
    local.join("data-storage.json")
}
fn load_config(local: &Path) -> db::Result<Config> {
    match fs::read(config_path(local)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "数据位置配置读取失败".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn write_json(path: &Path, value: &impl Serialize) -> db::Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("数据目录无效")?)
        .map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn regular(path: &Path) -> db::Result<()> {
    if !fs::symlink_metadata(path)
        .map_err(|_| "数据文件缺失，请检查存储设备或同步是否完成")?
        .is_file()
    {
        return Err("数据文件无效".into());
    }
    Ok(())
}
fn lock(directory: &Path) -> db::Result<Connection> {
    if !directory.is_dir() {
        return Err("数据文件夹无法访问，请连接存储设备".into());
    }
    let path = directory.join(".study-helper-lock");
    if fs::symlink_metadata(&path).is_ok() {
        regular(&path)?;
    }
    let connection = Connection::open(path).map_err(|e| e.to_string())?;
    connection
        .busy_timeout(std::time::Duration::ZERO)
        .map_err(|e| e.to_string())?;
    connection
        .execute_batch("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;")
        .map_err(|_| "数据正在使用，请先关闭另一份应用".to_owned())?;
    Ok(connection)
}
fn manifest(directory: &Path) -> db::Result<Manifest> {
    if !fs::symlink_metadata(directory)
        .map_err(|_| "数据文件夹无法访问，请连接存储设备")?
        .is_dir()
    {
        return Err("数据文件夹无效".into());
    }
    regular(&directory.join(MARKER))?;
    let value: Manifest =
        serde_json::from_slice(&fs::read(directory.join(MARKER)).map_err(|e| e.to_string())?)
            .map_err(|_| "请选择 Study Helper 数据文件夹")?;
    if value.version != 1 {
        return Err("该数据需要更新版本的 Study Helper".into());
    }
    Ok(value)
}
fn validate_database(path: &Path, table: &str) -> db::Result<()> {
    regular(path)?;
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let result: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
            [table],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if result != "ok" || count != 1 {
        return Err("数据校验失败，请检查同步是否完成".into());
    }
    Ok(())
}
fn validate(directory: &Path, allow_import: bool) -> db::Result<()> {
    if !manifest(directory)?.ready {
        return Err("数据迁移尚未完成".into());
    }
    validate_database(&directory.join(DATABASE), "app_settings")?;
    if directory.join(NOTES_PENDING).exists() {
        if !allow_import {
            return Err("请先在原电脑打开笔记，完成数据迁移".into());
        }
    } else {
        validate_database(&directory.join(NOTES), "snapshots")?;
    }
    Ok(())
}
pub(crate) fn backup(source: &Path, target: &Path) -> db::Result<()> {
    regular(source)?;
    let source = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let temporary = tempfile::NamedTempFile::new_in(target.parent().ok_or("数据目录无效")?)
        .map_err(|e| e.to_string())?;
    let mut next = Connection::open(temporary.path()).map_err(|e| e.to_string())?;
    rusqlite::backup::Backup::new(&source, &mut next)
        .map_err(|e| e.to_string())?
        .run_to_completion(128, std::time::Duration::from_millis(5), None)
        .map_err(|e| e.to_string())?;
    let result: String = next
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if result != "ok" {
        return Err("数据迁移校验失败".into());
    }
    next.close().map_err(|(_, e)| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(target).map_err(|e| e.to_string())?;
    Ok(())
}
impl DataStorage {
    pub fn open(local: &Path) -> db::Result<Self> {
        let local = local.canonicalize().map_err(|e| e.to_string())?;
        let local_lock = lock(&local)?;
        let mut config = load_config(&local)?;
        let source = config.active.clone().unwrap_or_else(|| local.clone());
        let mut data_lock = None;
        if let Some(pending) = config.pending.as_ref() {
            data_lock = Some(lock(&pending.path)?);
            if let Some(id) = pending.migration.as_ref() {
                let mut marker = manifest(&pending.path)?;
                if &marker.id != id {
                    return Err("数据迁移目标已变化，请重新选择".into());
                }
                if !marker.ready {
                    let _source_lock = if config.active.is_some() {
                        Some(lock(&source)?)
                    } else {
                        None
                    };
                    if config.active.is_some() {
                        validate(&source, false)?;
                    }
                    backup(&source.join(DATABASE), &pending.path.join(DATABASE))?;
                    let notes = if config.active.is_some() {
                        Some(source.join(NOTES))
                    } else {
                        NotesStorage::legacy_database(&local)?
                    };
                    if let Some(notes) = notes {
                        backup(&notes, &pending.path.join(NOTES))?;
                    } else {
                        fs::write(pending.path.join(NOTES_PENDING), b"pending\n")
                            .map_err(|e| e.to_string())?;
                    }
                    marker.ready = true;
                    write_json(&pending.path.join(MARKER), &marker)?;
                }
                validate(&pending.path, true)?;
            } else {
                validate(&pending.path, false)?;
            }
            config.active = Some(pending.path.clone());
            config.pending = None;
            write_json(&config_path(&local), &config)?;
        }
        let directory = config.active.clone().unwrap_or_else(|| local.clone());
        if config.active.is_some() {
            if data_lock.is_none() {
                data_lock = Some(lock(&directory)?);
            }
            validate(&directory, true)?;
        }
        Ok(Self {
            local,
            directory,
            portable: config.active.is_some(),
            config: Mutex::new(config),
            _local_lock: Mutex::new(local_lock),
            _data_lock: data_lock.map(Mutex::new),
        })
    }
    pub(crate) fn info(&self) -> db::Result<Value> {
        let config = self.config.lock().map_err(|e| e.to_string())?;
        Ok(
            json!({"path":self.directory,"pendingPath":config.pending.as_ref().map(|p|&p.path),"pendingAction":config.pending.as_ref().map(|p|if p.migration.is_some(){"move"}else{"open"})}),
        )
    }
    pub(crate) fn choose(&self, parent: &Path, existing: bool) -> db::Result<Value> {
        let mut saved = self.config.lock().map_err(|e| e.to_string())?;
        let mut config = saved.clone();
        let parent = parent.canonicalize().map_err(|_| "所选文件夹无法访问")?;
        let target = if existing || parent.file_name().is_some_and(|n| n == FOLDER) {
            parent
        } else {
            parent.join(FOLDER)
        };
        if target == self.directory {
            config.pending = None;
        } else if config.pending.as_ref().is_some_and(|p| p.path == target) {
            return Err("该位置已等待切换".into());
        } else if existing {
            let _lock = lock(&target)?;
            validate(&target, false)?;
            config.pending = Some(Pending {
                path: target,
                migration: None,
            });
        } else {
            if self.portable && self.directory.join(NOTES_PENDING).exists() {
                return Err("请先打开笔记，完成数据迁移".into());
            }
            if target.starts_with(&self.directory) || self.directory.starts_with(&target) {
                return Err("请选择当前数据文件夹之外的位置".into());
            }
            if target.exists() {
                return Err("该位置已有数据文件夹，请使用“打开已有数据”或选择其他位置".into());
            }
            fs::create_dir(&target).map_err(|e| format!("无法创建数据文件夹：{e}"))?;
            let id = uuid::Uuid::new_v4().to_string();
            write_json(
                &target.join(MARKER),
                &Manifest {
                    version: 1,
                    id: id.clone(),
                    ready: false,
                },
            )?;
            config.pending = Some(Pending {
                path: target,
                migration: Some(id),
            });
        }
        write_json(&config_path(&self.local), &config)?;
        *saved = config;
        drop(saved);
        self.info()
    }
    fn cancel(&self) -> db::Result<Value> {
        let mut config = self.config.lock().map_err(|e| e.to_string())?;
        let next = Config {
            active: config.active.clone(),
            pending: None,
        };
        write_json(&config_path(&self.local), &next)?;
        *config = next;
        drop(config);
        self.info()
    }
    // Used only after an explicit native folder selection during startup recovery.
    pub fn recover(local: &Path, target: &Path) -> db::Result<()> {
        let _local_lock = lock(local)?;
        let target = target.canonicalize().map_err(|e| e.to_string())?;
        let current = load_config(local)?;
        let is_local = target == local.canonicalize().map_err(|e| e.to_string())?;
        let _target_lock = if is_local { None } else { Some(lock(&target)?) };
        if is_local {
            validate_database(&target.join(DATABASE), "app_settings")?;
        } else {
            validate(&target, current.active.as_ref() == Some(&target))?;
        }
        write_json(
            &config_path(local),
            &Config {
                active: if is_local { None } else { Some(target) },
                pending: None,
            },
        )
    }
}
fn main_only(view: &Webview) -> db::Result<()> {
    if view.label() == "main" {
        Ok(())
    } else {
        Err("设置请求来源无效".into())
    }
}
#[tauri::command]
pub fn data_storage_info(app: tauri::AppHandle, webview: Webview) -> db::Result<Value> {
    main_only(&webview)?;
    app.state::<DataStorage>().info()
}
#[tauri::command]
pub async fn choose_data_directory(
    app: tauri::AppHandle,
    webview: Webview,
    existing: bool,
) -> db::Result<Value> {
    main_only(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title(if existing {
                "打开 Study Helper 数据文件夹"
            } else {
                "选择数据存储位置"
            })
            .blocking_pick_folder()
        else {
            return app.state::<DataStorage>().info();
        };
        app.state::<DataStorage>()
            .choose(&path.into_path().map_err(|e| e.to_string())?, existing)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_data_directory(app: tauri::AppHandle, webview: Webview) -> db::Result<Value> {
    main_only(&webview)?;
    app.state::<DataStorage>().cancel()
}
#[tauri::command]
pub async fn data_storage_flush(app: tauri::AppHandle, webview: Webview) -> db::Result<()> {
    main_only(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<crate::AppState>();
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        checkpoint(&conn)?;
        app.state::<NotesStorage>().checkpoint()
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(crate) fn checkpoint(conn: &Connection) -> db::Result<()> {
    let busy: i64 = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if busy != 0 {
        return Err("数据仍在写入，请稍后重试".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn local() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        let mut conn = db::open(&root.path().join(DATABASE)).unwrap();
        for (endpoint, body) in [
            (
                "recent-courses",
                json!({"id":"course","name":"同步课程","videoCount":2}),
            ),
            (
                "progress",
                json!({"courseId":"course","path":"lesson.mp4","time":42,"duration":100}),
            ),
            (
                "settings",
                json!({"key":"ai_settings","value":{"model":"example","apiKey":"test-only"}}),
            ),
            (
                "practice",
                json!({"courseId":"course","videoPath":"lesson.mp4","records":[{"draft":"answer"}]}),
            ),
        ] {
            db::request(&mut conn, endpoint, "POST", json!({}), body).unwrap();
        }
        root
    }
    fn finish_notes(root: &Path) {
        let conn = Connection::open(root.join(NOTES)).unwrap();
        conn.execute_batch("CREATE TABLE snapshots(space TEXT,id TEXT,bin BLOB,at INTEGER,PRIMARY KEY(space,id)); INSERT INTO snapshots VALUES ('workspace','doc',X'010203',1);").unwrap();
        fs::remove_file(root.join(NOTES_PENDING)).unwrap();
    }
    fn migrated(local: &Path, parent: &Path) -> DataStorage {
        let storage = DataStorage::open(local).unwrap();
        storage.choose(parent, false).unwrap();
        drop(storage);
        let storage = DataStorage::open(local).unwrap();
        finish_notes(&storage.directory);
        storage
    }
    #[test]
    fn migration_includes_all_learning_data_and_late_writes_without_changing_source() {
        let root = local();
        let parent = tempfile::tempdir().unwrap();
        let storage = DataStorage::open(root.path()).unwrap();
        let selection = storage.choose(parent.path(), false).unwrap();
        assert_eq!(
            selection["path"],
            json!(root.path().canonicalize().unwrap())
        );
        assert_eq!(selection["pendingAction"], "move");
        let conn = db::open(&root.path().join(DATABASE)).unwrap();
        conn.execute("INSERT INTO app_settings VALUES ('late','42',1)", [])
            .unwrap();
        drop(storage);
        // The source WAL is still open: the backup must include committed pages in it.
        let storage = DataStorage::open(root.path()).unwrap();
        let target = db::open(&storage.directory.join(DATABASE)).unwrap();
        for endpoint in ["recent-courses", "progress", "settings", "practice"] {
            let query = if endpoint == "settings" {
                json!({"key":"ai_settings"})
            } else {
                json!({"courseId":"course"})
            };
            let mut source = db::open(&root.path().join(DATABASE)).unwrap();
            let mut target = db::open(&storage.directory.join(DATABASE)).unwrap();
            assert_eq!(
                db::request(&mut source, endpoint, "GET", query.clone(), Value::Null).unwrap(),
                db::request(&mut target, endpoint, "GET", query, Value::Null).unwrap()
            );
        }
        assert_eq!(
            target
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key='late'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "42"
        );
        assert!(storage.directory.join(NOTES_PENDING).exists());
        assert!(root.path().join(DATABASE).exists());
        assert!(storage.info().unwrap()["pendingPath"].is_null());
    }
    #[test]
    fn second_computer_opens_existing_data_without_importing_or_overwriting_its_own() {
        let first = local();
        let second = local();
        let disk = tempfile::tempdir().unwrap();
        let storage = migrated(first.path(), disk.path());
        let shared = storage.directory.clone();
        let conn = db::open(&shared.join(DATABASE)).unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES ('origin','\"first-computer\"',1)",
            [],
        )
        .unwrap();
        drop(conn);
        drop(storage);
        let second_storage = DataStorage::open(second.path()).unwrap();
        second_storage.choose(&shared, true).unwrap();
        drop(second_storage);
        let second_storage = DataStorage::open(second.path()).unwrap();
        assert_eq!(second_storage.directory, shared);
        let restored = db::open(&second_storage.directory.join(DATABASE)).unwrap();
        assert_eq!(
            restored
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key='origin'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "\"first-computer\""
        );
        let own = db::open(&second.path().join(DATABASE)).unwrap();
        assert_eq!(
            own.query_row(
                "SELECT COUNT(*) FROM app_settings WHERE key='origin'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert!(!shared.join(NOTES_PENDING).exists());
    }
    #[test]
    fn portable_relocation_preserves_notes_and_releases_lock_on_exit() {
        let root = local();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let storage = migrated(root.path(), first.path());
        let original = storage.directory.clone();
        assert!(lock(&original).is_err());
        assert!(DataStorage::open(root.path()).is_err());
        storage.choose(second.path(), false).unwrap();
        drop(storage);
        let moved = DataStorage::open(root.path()).unwrap();
        let notes = Connection::open(moved.directory.join(NOTES)).unwrap();
        assert_eq!(
            notes
                .query_row("SELECT bin FROM snapshots WHERE id='doc'", [], |r| r
                    .get::<_, Vec<u8>>(0))
                .unwrap(),
            vec![1, 2, 3]
        );
        assert!(!moved.directory.join(NOTES_PENDING).exists());
        assert!(lock(&original).is_ok());
        assert!(original.join(NOTES).is_file());
    }
    #[test]
    fn missing_device_does_not_create_empty_data_and_recovery_uses_existing_folder() {
        let root = local();
        let disk = tempfile::tempdir().unwrap();
        let storage = migrated(root.path(), disk.path());
        let source = storage.directory.clone();
        drop(storage);
        let renamed = disk.path().join("different-mount");
        fs::rename(&source, &renamed).unwrap();
        assert!(DataStorage::open(root.path()).is_err());
        assert!(!source.exists());
        DataStorage::recover(root.path(), &renamed).unwrap();
        assert_eq!(
            DataStorage::open(root.path()).unwrap().directory,
            renamed.canonicalize().unwrap()
        );
    }
    #[test]
    fn refuses_incomplete_corrupt_busy_and_unrelated_folders() {
        let root = local();
        let disk = tempfile::tempdir().unwrap();
        let other = local();
        let storage = DataStorage::open(root.path()).unwrap();
        fs::create_dir(disk.path().join(FOLDER)).unwrap();
        fs::write(disk.path().join(FOLDER).join("keep"), b"original").unwrap();
        assert!(storage.choose(disk.path(), false).is_err());
        assert!(storage.choose(disk.path(), true).is_err());
        assert_eq!(
            fs::read(disk.path().join(FOLDER).join("keep")).unwrap(),
            b"original"
        );
        let target = tempfile::tempdir().unwrap();
        let owner = migrated(other.path(), target.path());
        assert!(storage.choose(&owner.directory, true).is_err());
        let folder = owner.directory.clone();
        drop(owner);
        fs::write(folder.join(NOTES_PENDING), "pending").unwrap();
        assert!(storage.choose(&folder, true).is_err());
        fs::remove_file(folder.join(NOTES_PENDING)).unwrap();
        fs::write(folder.join(DATABASE), b"corrupt").unwrap();
        assert!(storage.choose(&folder, true).is_err());
        assert!(storage.info().unwrap()["pendingPath"].is_null());
    }
    #[test]
    fn cancel_keeps_current_data_and_failed_migration_can_retry() {
        let root = local();
        let disk = tempfile::tempdir().unwrap();
        let storage = DataStorage::open(root.path()).unwrap();
        let info = storage.choose(disk.path(), false).unwrap();
        storage.cancel().unwrap();
        assert!(load_config(root.path()).unwrap().pending.is_none());
        assert_eq!(storage.directory, root.path().canonicalize().unwrap());
        let second = tempfile::tempdir().unwrap();
        storage.choose(second.path(), false).unwrap();
        drop(storage);
        fs::rename(root.path().join(DATABASE), root.path().join("saved.db")).unwrap();
        assert!(DataStorage::open(root.path()).is_err());
        assert!(load_config(root.path()).unwrap().active.is_none());
        fs::rename(root.path().join("saved.db"), root.path().join(DATABASE)).unwrap();
        assert!(DataStorage::open(root.path()).unwrap().portable);
        assert!(Path::new(info["pendingPath"].as_str().unwrap()).exists());
    }
    #[test]
    fn upgrades_legacy_notes_folder_without_changing_it() {
        let root = local();
        let old = tempfile::tempdir().unwrap();
        fs::write(
            old.path().join(".study-helper-notes"),
            "Study Helper notes v1\n",
        )
        .unwrap();
        let db = Connection::open(old.path().join(NOTES)).unwrap();
        db.execute_batch("CREATE TABLE snapshots(id TEXT, bin BLOB); INSERT INTO snapshots VALUES ('old', X'0102');").unwrap();
        fs::write(
            root.path().join("notes-storage.json"),
            json!({"active":old.path(),"pending":null}).to_string(),
        )
        .unwrap();
        let destination = tempfile::tempdir().unwrap();
        let storage = DataStorage::open(root.path()).unwrap();
        storage.choose(destination.path(), false).unwrap();
        drop(storage);
        let moved = DataStorage::open(root.path()).unwrap();
        assert!(!moved.directory.join(NOTES_PENDING).exists());
        let db = Connection::open(moved.directory.join(NOTES)).unwrap();
        assert_eq!(
            db.query_row("SELECT bin FROM snapshots", [], |r| r.get::<_, Vec<u8>>(0))
                .unwrap(),
            vec![1, 2]
        );
        assert!(old.path().join(NOTES).exists());
    }
}

pub struct StorageStartup {
    pub directory: PathBuf,
    pub gate: Mutex<()>,
}
#[tauri::command]
pub async fn initialize_data_storage(app: tauri::AppHandle, webview: Webview) -> db::Result<()> {
    main_only(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let startup = app.state::<StorageStartup>();
        let _gate = startup.gate.lock().map_err(|e| e.to_string())?;
        if app.try_state::<DataStorage>().is_some() {
            return Ok(());
        }
        let directory = startup.directory.clone();
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let storage = match DataStorage::open(&directory) {
            Ok(storage) => storage,
            Err(error) => {
                if !app
                    .dialog()
                    .message(&error)
                    .title("数据无法打开")
                    .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                        "重新选择数据文件夹".into(),
                        "退出".into(),
                    ))
                    .blocking_show()
                {
                    app.exit(0);
                    return Err(error);
                }
                let path = app
                    .dialog()
                    .file()
                    .set_title("选择已有数据文件夹")
                    .blocking_pick_folder()
                    .ok_or("未选择数据文件夹")?;
                DataStorage::recover(&directory, &path.into_path().map_err(|e| e.to_string())?)?;
                DataStorage::open(&directory)?
            }
        };
        let mut conn = db::open(&storage.directory.join("ai-player.db"))?;
        crate::legacy_data::clear(&directory, &mut conn)?;
        let roots = crate::files::saved_roots(&conn)?;
        let roots = roots
            .into_iter()
            .filter(|path| path.is_absolute() && path.is_dir())
            .collect::<std::collections::HashSet<_>>();
        for root in &roots {
            app.asset_protocol_scope()
                .allow_directory(root, true)
                .map_err(|e| e.to_string())?;
        }
        let notes = if storage.portable {
            NotesStorage::project(&storage.directory)
        } else {
            NotesStorage::new(&directory)
        }?;
        app.manage(notes);
        app.manage(storage);
        app.manage(crate::AppState {
            db: Mutex::new(conn),
            roots: Mutex::new(roots),
            frontend_ready: std::sync::atomic::AtomicBool::new(false),
        });

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

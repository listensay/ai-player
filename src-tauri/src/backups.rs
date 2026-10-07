use crate::{db, AppState};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Mutex},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const FORMAT: u32 = 1;
const APPLICATION_ID: i64 = 0x41495042;
const DAY: i64 = 86_400_000;
const META_SQL: &str =
    "CREATE TABLE IF NOT EXISTS ai_player_backup_metadata (metadata TEXT NOT NULL)";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String,
    format: u32,
    created_at: i64,
    kind: String,
    app_version: String,
    courses: i64,
    notes: i64,
    exercises: i64,
    #[serde(default)]
    bytes: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Config {
    enabled: bool,
    last_version: String,
    last_at: i64,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: true,
            last_version: String::new(),
            last_at: 0,
        }
    }
}
pub struct BackupState {
    directory: PathBuf,
    // All backup, import, restore and preference operations share this lock.
    operation: Mutex<()>,
    error: Mutex<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    entries: Vec<Entry>,
    error: String,
    restore_pending: bool,
}

fn private_directory(directory: &Path) -> db::Result<PathBuf> {
    let path = directory.join("backups");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(path)
}
fn config(directory: &Path) -> db::Result<Config> {
    match fs::read(directory.join("backup-settings.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "备份设置无法读取".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn save_config(directory: &Path, value: &Config) -> db::Result<()> {
    use std::io::Write;
    let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(directory.join("backup-settings.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn entry_path(directory: &Path, id: &str) -> db::Result<PathBuf> {
    let uuid = uuid::Uuid::parse_str(id).map_err(|_| "备份编号无效")?;
    if uuid.to_string() != id {
        return Err("备份编号无效".into());
    }
    Ok(directory.join("backups").join(format!("{id}.sqlite")))
}
fn read_only(path: &Path) -> db::Result<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA trusted_schema=OFF;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}
fn metadata(conn: &Connection) -> db::Result<Entry> {
    let raw: String = conn
        .query_row("SELECT metadata FROM ai_player_backup_metadata", [], |r| {
            r.get(0)
        })
        .map_err(|_| "请选择 AI Player 备份文件")?;
    let entry: Entry = serde_json::from_str(&raw).map_err(|_| "备份信息无效")?;
    if entry.format != FORMAT || uuid::Uuid::parse_str(&entry.id).is_err() {
        return Err("不支持此备份版本".into());
    }
    Ok(entry)
}
fn schema(conn: &Connection) -> db::Result<Vec<(String, String, String)>> {
    let mut statement = conn.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").map_err(|e| e.to_string())?;
    let result = statement
        .query_map([], |r| {
            let sql: String = r.get(2)?;
            Ok((
                r.get(0)?,
                r.get(1)?,
                sql.split_whitespace().collect::<Vec<_>>().join(" "),
            ))
        })
        .map_err(|e| e.to_string())?;
    result
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
fn inspect(path: &Path, require_compatible: bool) -> db::Result<Entry> {
    let conn = read_only(path)?;
    let magic: i64 = conn
        .query_row("PRAGMA application_id", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if magic != APPLICATION_ID {
        return Err("请选择 AI Player 备份文件".into());
    }
    let mut entry = metadata(&conn)?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        return Err("备份文件已损坏".into());
    }
    let expected = Connection::open_in_memory().map_err(|e| e.to_string())?;
    expected
        .execute_batch(include_str!("schema.sql"))
        .map_err(|e| e.to_string())?;
    expected
        .execute_batch(META_SQL)
        .map_err(|e| e.to_string())?;
    if require_compatible && schema(&conn)? != schema(&expected)? {
        return Err("备份的数据结构与当前版本不兼容".into());
    }
    // Do not let a structurally valid SQLite file replace the library with broken JSON.
    for (table, fields) in [
        ("app_settings", vec!["value_json"]),
        ("lesson_practices", vec!["records_json"]),
        (
            "learning_guides",
            vec![
                "plan_json",
                "metadata_json",
                "mastery_json",
                "questions_json",
                "today_json",
            ],
        ),
        ("daily_plan_snapshots", vec!["snapshot_json"]),
    ] {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
                [table],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists && !require_compatible {
            continue;
        }
        for field in fields {
            let count: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE {field} IS NOT NULL AND NOT json_valid({field})"), [], |r| r.get(0)).map_err(|e| e.to_string())?;
            if count != 0 {
                return Err("备份包含无法读取的学习记录".into());
            }
        }
    }
    entry.courses = conn
        .query_row("SELECT COUNT(*) FROM course_library", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    entry.notes = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    entry.exercises = conn
        .query_row("SELECT COUNT(*) FROM lesson_practices", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    entry.bytes = fs::metadata(path).map_err(|e| e.to_string())?.len();
    Ok(entry)
}
fn validate(path: &Path) -> db::Result<Entry> {
    inspect(path, true)
}
fn copy_database(source: &Connection, destination: &mut Connection) -> db::Result<()> {
    Backup::new(source, destination)
        .map_err(|e| e.to_string())?
        .run_to_completion(256, Duration::from_millis(5), None)
        .map_err(|e| e.to_string())
}
fn create(conn: &Connection, directory: &Path, kind: &str, version: &str) -> db::Result<Entry> {
    let root = private_directory(directory)?;
    let temp = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    let mut target = Connection::open(temp.path()).map_err(|e| e.to_string())?;
    let snapshot = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    snapshot
        .query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|e| e.to_string())?;
    copy_database(&snapshot, &mut target)?;
    let count = |table: &str| {
        target
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(|e| e.to_string())
    };
    let entry = Entry {
        id: uuid::Uuid::new_v4().to_string(),
        format: FORMAT,
        created_at: db::now(),
        kind: kind.into(),
        app_version: version.into(),
        courses: count("course_library")?,
        notes: count("notes")?,
        exercises: count("lesson_practices")?,
        bytes: 0,
    };
    target.execute_batch(META_SQL).map_err(|e| e.to_string())?;
    target
        .execute("DELETE FROM ai_player_backup_metadata", [])
        .map_err(|e| e.to_string())?;
    target
        .execute(
            "INSERT INTO ai_player_backup_metadata VALUES (?)",
            [serde_json::to_string(&entry).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
    target
        .pragma_update(None, "application_id", APPLICATION_ID)
        .map_err(|e| e.to_string())?;
    target
        .execute_batch("PRAGMA journal_mode=DELETE;")
        .map_err(|e| e.to_string())?;
    drop(target);
    let verified = inspect(temp.path(), false)?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist_noclobber(entry_path(directory, &entry.id)?)
        .map_err(|e| e.to_string())?;
    Ok(verified)
}
fn scan(directory: &Path) -> db::Result<(Vec<Entry>, usize)> {
    let root = private_directory(directory)?;
    let mut entries = Vec::new();
    let mut unreadable = 0;
    for item in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = item.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("sqlite") {
            continue;
        }
        let result = (|| -> db::Result<Entry> {
            let conn = read_only(&path)?;
            let mut entry = metadata(&conn)?;
            if entry_path(directory, &entry.id)? != path {
                return Err("备份索引与文件不匹配".into());
            }
            entry.bytes = fs::metadata(&path).map_err(|e| e.to_string())?.len();
            Ok(entry)
        })();
        match result {
            Ok(entry) => entries.push(entry),
            Err(_) => unreadable += 1,
        }
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_at));
    Ok((entries, unreadable))
}
fn list(directory: &Path) -> db::Result<Vec<Entry>> {
    Ok(scan(directory)?.0)
}
fn automatic(conn: &Connection, directory: &Path, version: &str) -> db::Result<()> {
    let mut settings = config(directory)?;
    let upgrade = !settings.last_version.is_empty() && settings.last_version != version;
    if upgrade || (settings.enabled && db::now().saturating_sub(settings.last_at) >= DAY) {
        create(
            conn,
            directory,
            if upgrade { "upgrade" } else { "automatic" },
            if upgrade {
                &settings.last_version
            } else {
                version
            },
        )?;
        settings.last_at = db::now();
        for (kind, keep) in [("automatic", 7), ("upgrade", 3), ("before-restore", 3)] {
            for entry in list(directory)?
                .iter()
                .filter(|e| e.kind == kind)
                .skip(keep)
            {
                fs::remove_file(entry_path(directory, &entry.id)?).map_err(|e| e.to_string())?;
            }
        }
    }
    if settings.last_version != version || settings.enabled {
        settings.last_version = version.into();
        save_config(directory, &settings)?;
    }
    Ok(())
}
fn apply_pending(directory: &Path) -> db::Result<()> {
    let path = directory.join("restore-pending.sqlite");
    if !path.exists() {
        return Ok(());
    }
    validate(&path)?;
    let source = read_only(&path)?;
    let mut target = Connection::open(directory.join("ai-player.db")).map_err(|e| e.to_string())?;
    copy_database(&source, &mut target)?;
    drop(source);
    drop(target);
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn initialize(directory: &Path, version: &str) -> db::Result<BackupState> {
    let restore_error = if let Err(error) = apply_pending(directory) {
        // Keep a rejected staged file for diagnosis without preventing use of the current library.
        let rejected = directory.join(format!("restore-rejected-{}.sqlite", uuid::Uuid::new_v4()));
        fs::rename(directory.join("restore-pending.sqlite"), rejected)
            .map_err(|e| e.to_string())?;
        format!("恢复未完成，当前数据库已保留：{error}")
    } else {
        String::new()
    };
    let path = directory.join("ai-player.db");
    // Take the upgrade copy before opening the database with the new schema.
    let error = if path.exists() {
        read_only(&path)
            .and_then(|conn| automatic(&conn, directory, version))
            .err()
            .unwrap_or_default()
    } else {
        String::new()
    };
    Ok(BackupState {
        directory: directory.into(),
        operation: Mutex::new(()),
        error: Mutex::new(if restore_error.is_empty() {
            error
        } else {
            restore_error
        }),
    })
}
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        {
            let backups = app.state::<BackupState>();
            let Ok(_operation) = backups.operation.lock() else {
                return;
            };
            let state = app.state::<AppState>();
            if state.restore_pending.load(Ordering::SeqCst) {
                return;
            }
            let result = read_only(&backups.directory.join("ai-player.db")).and_then(|conn| {
                automatic(
                    &conn,
                    &backups.directory,
                    &app.package_info().version.to_string(),
                )
            });
            if let Ok(mut error) = backups.error.lock() {
                if let Err(reason) = result {
                    *error = reason;
                }
            };
        }
        std::thread::sleep(Duration::from_secs(3600));
    });
}
#[tauri::command]
pub async fn backup_status(app: tauri::AppHandle) -> db::Result<Status> {
    tauri::async_runtime::spawn_blocking(move || {
        let backups = app.state::<BackupState>();
        let _operation = backups.operation.lock().map_err(|e| e.to_string())?;
        let (entries, unreadable) = scan(&backups.directory)?;
        let mut error = backups.error.lock().map_err(|e| e.to_string())?.clone();
        if unreadable > 0 {
            error = format!("{unreadable} 份备份无法读取，其余备份仍可使用。{error}");
        }
        Ok(Status {
            enabled: config(&backups.directory)?.enabled,
            entries,
            error,
            restore_pending: app
                .state::<AppState>()
                .restore_pending
                .load(Ordering::SeqCst),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn set_backup_enabled(app: tauri::AppHandle, enabled: bool) -> db::Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let backups = app.state::<BackupState>();
        let _operation = backups.operation.lock().map_err(|e| e.to_string())?;
        let mut value = config(&backups.directory)?;
        value.enabled = enabled;
        save_config(&backups.directory, &value)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn create_backup(app: tauri::AppHandle) -> db::Result<Entry> {
    tauri::async_runtime::spawn_blocking(move || {
        let backups = app.state::<BackupState>();
        let _operation = backups.operation.lock().map_err(|e| e.to_string())?;
        let state = app.state::<AppState>();
        let conn = read_only(&backups.directory.join("ai-player.db"))?;
        if state.restore_pending.load(Ordering::SeqCst) {
            return Err("请先重新启动完成恢复".into());
        }
        create(
            &conn,
            &backups.directory,
            "manual",
            &app.package_info().version.to_string(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn import_backup(app: tauri::AppHandle) -> db::Result<Option<Entry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("选择学习备份")
            .add_filter("AI Player", &["sqlite"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let backups = app.state::<BackupState>();
        let _operation = backups.operation.lock().map_err(|e| e.to_string())?;
        let path = file.into_path().map_err(|e| e.to_string())?;
        validate(&path)?;
        let source = read_only(&path)?;
        // Re-snapshot the validated source, including any committed WAL contents.
        let original = metadata(&source)?;
        let mut entry = create(
            &source,
            &backups.directory,
            "imported",
            &original.app_version,
        )?;
        entry.created_at = original.created_at;
        let imported = Connection::open(entry_path(&backups.directory, &entry.id)?)
            .map_err(|e| e.to_string())?;
        imported
            .execute(
                "UPDATE ai_player_backup_metadata SET metadata=?",
                [serde_json::to_string(&entry).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        Ok(Some(entry))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn export_backup(app: tauri::AppHandle, id: String) -> db::Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let backups = app.state::<BackupState>();
        let path = entry_path(&backups.directory, &id)?;
        validate(&path)?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("导出学习备份")
            .set_file_name(format!("AI-Player-{id}.sqlite"))
            .add_filter("AI Player", &["sqlite"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let _operation = backups.operation.lock().map_err(|e| e.to_string())?;
        let selected = file.into_path().map_err(|e| e.to_string())?;
        let destination = selected
            .parent()
            .ok_or("保存位置无效")?
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(selected.file_name().ok_or("文件名无效")?);
        if destination == path {
            return Ok(true);
        }
        if destination.starts_with(
            backups
                .directory
                .canonicalize()
                .map_err(|e| e.to_string())?,
        ) {
            return Err("请选择应用数据目录以外的位置".into());
        }
        let temp = tempfile::NamedTempFile::new_in(destination.parent().ok_or("保存位置无效")?)
            .map_err(|e| e.to_string())?;
        fs::copy(path, temp.path()).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(destination).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn restore_backup(app: tauri::AppHandle, id: String) -> db::Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let backups = app.state::<BackupState>();
        let _operation = backups.operation.lock().map_err(|e| e.to_string())?;
        let path = entry_path(&backups.directory, &id)?;
        validate(&path)?;
        let state = app.state::<AppState>();
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if state.restore_pending.load(Ordering::SeqCst) {
            return Err("恢复已经准备完成，请重新启动".into());
        }
        create(
            &conn,
            &backups.directory,
            "before-restore",
            &app.package_info().version.to_string(),
        )?;
        let temp =
            tempfile::NamedTempFile::new_in(&backups.directory).map_err(|e| e.to_string())?;
        fs::copy(path, temp.path()).map_err(|e| e.to_string())?;
        validate(temp.path())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(backups.directory.join("restore-pending.sqlite"))
            .map_err(|e| e.to_string())?;
        state.restore_pending.store(true, Ordering::SeqCst);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn restart_after_restore(app: tauri::AppHandle) -> db::Result<()> {
    if !app
        .state::<AppState>()
        .restore_pending
        .load(Ordering::SeqCst)
    {
        return Err("尚未选择恢复的备份".into());
    }
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Connection) {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::open(&directory.path().join("ai-player.db")).unwrap();
        conn.execute(
            "INSERT INTO notes VALUES ('course','one.mp4','original',1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES ('example','{\"value\":1}',1)",
            [],
        )
        .unwrap();
        (directory, conn)
    }
    #[test]
    fn live_wal_backup_contains_committed_notes_images_and_settings() {
        let (directory, conn) = fixture();
        conn.execute(
            "INSERT INTO note_images VALUES ('image','course','one.mp4','one.png','YWJj',1)",
            [],
        )
        .unwrap();
        let entry = create(&conn, directory.path(), "manual", "0.1.0").unwrap();
        conn.execute("UPDATE notes SET content='newer'", [])
            .unwrap();
        let path = entry_path(directory.path(), &entry.id).unwrap();
        let backup = read_only(&path).unwrap();
        assert_eq!(
            backup
                .query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "original"
        );
        assert_eq!(
            backup
                .query_row("SELECT data_base64 FROM note_images", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "YWJj"
        );
        assert_eq!(validate(&path).unwrap().notes, 1);
        assert_eq!(list(directory.path()).unwrap().len(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn daily_and_upgrade_backups_are_deduplicated_and_manual_copies_retained() {
        let (directory, conn) = fixture();
        automatic(&conn, directory.path(), "0.1.0").unwrap();
        automatic(&conn, directory.path(), "0.1.0").unwrap();
        assert_eq!(list(directory.path()).unwrap().len(), 1);
        let mut settings = config(directory.path()).unwrap();
        settings.enabled = false;
        save_config(directory.path(), &settings).unwrap();
        automatic(&conn, directory.path(), "0.2.0").unwrap();
        let entries = list(directory.path()).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries
            .iter()
            .any(|e| e.kind == "upgrade" && e.app_version == "0.1.0"));
        let manual = create(&conn, directory.path(), "manual", "0.2.0").unwrap();
        for _ in 0..8 {
            create(&conn, directory.path(), "automatic", "0.2.0").unwrap();
        }
        let mut settings = config(directory.path()).unwrap();
        settings.enabled = true;
        settings.last_at = 0;
        save_config(directory.path(), &settings).unwrap();
        automatic(&conn, directory.path(), "0.2.0").unwrap();
        assert_eq!(
            list(directory.path())
                .unwrap()
                .iter()
                .filter(|e| e.kind == "automatic")
                .count(),
            7
        );
        assert!(entry_path(directory.path(), &manual.id).unwrap().exists());
    }
    #[test]
    fn staged_restore_is_applied_at_startup_and_consumed_once() {
        let (directory, conn) = fixture();
        let original = create(&conn, directory.path(), "manual", "0.1.0").unwrap();
        conn.execute("UPDATE notes SET content='current'", [])
            .unwrap();
        let safety = create(&conn, directory.path(), "before-restore", "0.1.0").unwrap();
        fs::copy(
            entry_path(directory.path(), &original.id).unwrap(),
            directory.path().join("restore-pending.sqlite"),
        )
        .unwrap();
        drop(conn);
        apply_pending(directory.path()).unwrap();
        let conn = db::open(&directory.path().join("ai-player.db")).unwrap();
        assert_eq!(
            conn.query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "original"
        );
        conn.execute("UPDATE notes SET content='after restart'", [])
            .unwrap();
        drop(conn);
        apply_pending(directory.path()).unwrap();
        let conn = read_only(&directory.path().join("ai-player.db")).unwrap();
        assert_eq!(
            conn.query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "after restart"
        );
        let safety = read_only(&entry_path(directory.path(), &safety.id).unwrap()).unwrap();
        assert_eq!(
            safety
                .query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "current"
        );
    }
    #[test]
    fn damaged_pending_restore_does_not_prevent_opening_the_current_library() {
        let (directory, conn) = fixture();
        let good = create(&conn, directory.path(), "manual", "0.1.0").unwrap();
        fs::write(directory.path().join("restore-pending.sqlite"), b"broken").unwrap();
        fs::write(directory.path().join("backups/broken.sqlite"), b"broken").unwrap();
        let state = initialize(directory.path(), "0.1.0").unwrap();
        assert!(state.error.lock().unwrap().contains("恢复未完成"));
        assert!(!directory.path().join("restore-pending.sqlite").exists());
        let (entries, unreadable) = scan(directory.path()).unwrap();
        assert!(entries.iter().any(|entry| entry.id == good.id));
        assert_eq!(unreadable, 1);
        assert_eq!(
            conn.query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "original"
        );
    }
    #[test]
    fn pre_upgrade_copy_preserves_the_old_schema_before_initialization() {
        let (directory, conn) = fixture();
        conn.execute("DROP TABLE daily_plan_snapshots", []).unwrap();
        let entry = create(&conn, directory.path(), "upgrade", "0.0.9").unwrap();
        let path = entry_path(directory.path(), &entry.id).unwrap();
        assert!(path.exists());
        assert!(validate(&path).unwrap_err().contains("不兼容"));
        assert_eq!(inspect(&path, false).unwrap().app_version, "0.0.9");
    }
    #[test]
    fn rejects_invalid_json_unknown_schema_and_path_traversal_without_replacing_current_data() {
        let (directory, conn) = fixture();
        assert!(entry_path(directory.path(), "../../ai-player.db").is_err());
        let entry = create(&conn, directory.path(), "manual", "0.1.0").unwrap();
        let path = entry_path(directory.path(), &entry.id).unwrap();
        let broken = Connection::open(&path).unwrap();
        broken
            .execute("UPDATE app_settings SET value_json='broken'", [])
            .unwrap();
        assert!(validate(&path).unwrap_err().contains("无法读取"));
        broken
            .execute("UPDATE app_settings SET value_json='null'", [])
            .unwrap();
        broken.execute_batch("CREATE TRIGGER unexpected AFTER UPDATE ON notes BEGIN DELETE FROM app_settings; END;").unwrap();
        assert!(validate(&path).unwrap_err().contains("不兼容"));
        fs::copy(path, directory.path().join("restore-pending.sqlite")).unwrap();
        assert!(apply_pending(directory.path()).is_err());
        assert_eq!(
            conn.query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "original"
        );
    }
}

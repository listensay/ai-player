use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, Webview};
use tauri_plugin_dialog::DialogExt;

type Result<T> = std::result::Result<T, String>;
const DATABASE: &str = "notes.sqlite";
const MARKER: &str = ".study-helper-notes";
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS snapshots(space TEXT, id TEXT, bin BLOB NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(space,id));
CREATE TABLE IF NOT EXISTS updates(space TEXT, id TEXT, bin BLOB NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(space,id,at));
CREATE TABLE IF NOT EXISTS clocks(space TEXT, id TEXT, at INTEGER NOT NULL, PRIMARY KEY(space,id));
CREATE TABLE IF NOT EXISTS blobs(space TEXT, id TEXT, bin BLOB NOT NULL, mime TEXT NOT NULL, at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(space,id));
CREATE TABLE IF NOT EXISTS metadata(scope TEXT, key TEXT, value TEXT NOT NULL, PRIMARY KEY(scope,key));";

#[derive(Clone, Default, Deserialize, Serialize)]
struct Config {
    active: Option<PathBuf>,
    pending: Option<PathBuf>,
}
struct Session {
    config: Config,
    db: Option<Connection>,
    importing: bool,
}
pub struct NotesStorage {
    project: Option<PathBuf>,
    config_file: PathBuf,
    session: Mutex<Session>,
    flushes: Mutex<std::collections::HashMap<u64, std::sync::mpsc::Sender<Result<()>>>>,
}
fn load_config(path: &Path) -> Result<Config> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "笔记位置配置读取失败".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn save_config(path: &Path, config: &Config) -> Result<()> {
    use std::io::Write;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("笔记设置目录无效")?)
        .map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn open_database(path: &Path) -> Result<Connection> {
    if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err("笔记数据库不能是符号链接".into());
    }
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
        .map_err(|e| e.to_string())?;
    db.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(db)
}
fn verify_folder(path: &Path) -> Result<()> {
    if !path.is_dir()
        || fs::symlink_metadata(path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("笔记文件夹无法访问".into());
    }
    if fs::read_to_string(path.join(MARKER)).map_err(|_| "笔记文件夹标记缺失")?
        != "Study Helper notes v1\n"
    {
        return Err("笔记文件夹标记无效".into());
    }
    Ok(())
}
impl NotesStorage {
    pub fn project(directory: &Path) -> Result<Self> {
        Ok(Self {
            project: Some(directory.to_path_buf()),
            config_file: directory.join("notes-storage.json"),
            flushes: Mutex::new(Default::default()),
            session: Mutex::new(Session {
                config: Config::default(),
                db: None,
                importing: false,
            }),
        })
    }
    pub(crate) fn legacy_database(directory: &Path) -> Result<Option<PathBuf>> {
        let config = load_config(&directory.join("notes-storage.json"))?;
        if let Some(path) = config.active {
            verify_folder(&path)?;
            let file = path.join(DATABASE);
            if !file.is_file() {
                return Err("原笔记数据库无法访问，请连接存储设备".into());
            }
            Ok(Some(file))
        } else {
            Ok(None)
        }
    }
    pub(crate) fn checkpoint(&self) -> Result<()> {
        let state = self.session.lock().map_err(|e| e.to_string())?;
        if state.importing {
            return Err("笔记正在迁移，请稍后重试".into());
        }
        if let Some(db) = &state.db {
            crate::data_storage::checkpoint(db)?;
        }
        Ok(())
    }

    pub fn new(directory: &Path) -> Result<Self> {
        let config_file = directory.join("notes-storage.json");
        let config = load_config(&config_file)?;
        Ok(Self {
            project: None,
            config_file,
            flushes: Mutex::new(Default::default()),
            session: Mutex::new(Session {
                config,
                db: None,
                importing: false,
            }),
        })
    }
    fn info(&self) -> Result<Value> {
        let config = load_config(&self.config_file)?;
        Ok(json!({"path":config.active,"pendingPath":config.pending}))
    }
    pub(crate) fn choose(&self, parent: &Path) -> Result<Value> {
        let mut session = self.session.lock().map_err(|e| e.to_string())?;
        if session.importing {
            return Err("笔记正在迁移，请稍后重试".into());
        }
        let parent = parent.canonicalize().map_err(|_| "所选文件夹无法访问")?;
        let mut config = load_config(&self.config_file)?;
        let target = if parent
            .file_name()
            .is_some_and(|name| name == "Study Helper Notes")
        {
            parent
        } else {
            parent.join("Study Helper Notes")
        };
        if config.active.as_ref() == Some(&target) {
            config.pending = None;
        } else if config.pending.as_ref() != Some(&target) {
            if target.exists() {
                return Err("该位置已有 Study Helper Notes 文件夹，请选择其他位置".into());
            }
            fs::create_dir(&target).map_err(|e| format!("无法创建笔记文件夹：{e}"))?;
            if let Err(error) = fs::write(target.join(MARKER), "Study Helper notes v1\n") {
                let _ = fs::remove_dir(&target);
                return Err(error.to_string());
            }
            config.pending = Some(target);
        }
        save_config(&self.config_file, &config)?;
        if session.db.is_none() {
            session.config.pending = None;
        }
        drop(session);
        self.info()
    }
    fn boot(&self) -> Result<Value> {
        let mut state = self.session.lock().map_err(|e| e.to_string())?;
        if let Some(directory) = &self.project {
            if state.db.is_none() {
                let pending = directory.join(crate::data_storage::NOTES_PENDING).is_file();
                if !pending && !directory.join(DATABASE).is_file() {
                    return Err("笔记数据库无法访问，请检查存储设备".into());
                }
                let db = open_database(&directory.join(DATABASE))?;
                if pending {
                    db.execute_batch("DELETE FROM snapshots; DELETE FROM updates; DELETE FROM clocks; DELETE FROM blobs; DELETE FROM metadata;").map_err(|e|e.to_string())?;
                }
                state.importing = pending;
                state.db = Some(db);
            }
            return Ok(json!({"enabled":true,"importing":state.importing}));
        }
        if state.db.is_none() {
            if let Some(target) = state.config.pending.clone() {
                verify_folder(&target)?;
                let mut next = open_database(&target.join(DATABASE))?;
                if let Some(source) = state.config.active.as_ref() {
                    verify_folder(source)?;
                    if !source.join(DATABASE).is_file() {
                        return Err("原笔记数据库无法访问".into());
                    }
                    let source = open_database(&source.join(DATABASE))?;
                    rusqlite::backup::Backup::new(&source, &mut next)
                        .map_err(|e| e.to_string())?
                        .run_to_completion(128, std::time::Duration::from_millis(5), None)
                        .map_err(|e| e.to_string())?;
                    let integrity: String = next
                        .query_row("PRAGMA quick_check", [], |r| r.get(0))
                        .map_err(|e| e.to_string())?;
                    if integrity != "ok" {
                        return Err("笔记迁移校验失败".into());
                    }
                    let config = Config {
                        active: Some(target),
                        pending: None,
                    };
                    save_config(&self.config_file, &config)?;
                    state.config = config;
                } else {
                    // A failed import is retried from the unchanged legacy database.
                    next.execute_batch("DELETE FROM snapshots; DELETE FROM updates; DELETE FROM clocks; DELETE FROM blobs; DELETE FROM metadata;").map_err(|e| e.to_string())?;
                    state.importing = true;
                }
                state.db = Some(next);
            } else if let Some(path) = state.config.active.as_ref() {
                verify_folder(path)?;
                if !path.join(DATABASE).is_file() {
                    return Err("笔记数据库无法访问，请连接存储设备后重试".into());
                }
                state.db = Some(open_database(&path.join(DATABASE))?);
            }
        }
        Ok(json!({"enabled":state.db.is_some(),"importing":state.importing}))
    }
    fn commit(&self) -> Result<()> {
        let mut state = self.session.lock().map_err(|e| e.to_string())?;
        if !state.importing {
            return Err("当前没有待完成的笔记迁移".into());
        }
        state
            .db
            .as_ref()
            .ok_or("笔记存储尚未打开")?
            .execute_batch("PRAGMA wal_checkpoint(FULL)")
            .map_err(|e| e.to_string())?;
        if let Some(directory) = &self.project {
            crate::data_storage::checkpoint(state.db.as_ref().ok_or("笔记存储尚未打开")?)?;
            fs::remove_file(directory.join(crate::data_storage::NOTES_PENDING))
                .map_err(|e| e.to_string())?;
            state.importing = false;
            return Ok(());
        }
        let config = Config {
            active: state.config.pending.clone(),
            pending: None,
        };
        save_config(&self.config_file, &config)?;
        state.config = config;
        state.importing = false;
        Ok(())
    }
    fn request(&self, request: &Value) -> Result<Value> {
        let state = self.session.lock().map_err(|e| e.to_string())?;
        let db = state.db.as_ref().ok_or("笔记存储尚未打开")?;
        let result = db.unchecked_transaction().map_err(|e| e.to_string())?;
        let value = operate(&result, request)?;
        result.commit().map_err(|e| e.to_string())?;
        Ok(value)
    }
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .filter(|s| s.len() <= 8192)
        .ok_or_else(|| format!("笔记参数无效：{key}"))
}
fn bin(value: &Value, key: &str) -> Result<Vec<u8>> {
    let bytes: Vec<u8> =
        serde_json::from_value(value[key].clone()).map_err(|_| "笔记内容格式无效")?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err("单条笔记内容过大".into());
    }
    Ok(bytes)
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn operate(db: &Connection, q: &Value) -> Result<Value> {
    let operation = text(q, "op")?;
    let space = text(q, "space")?;
    let id = q["id"].as_str().unwrap_or("");
    let execute =
        |sql: &str, args: &[&dyn rusqlite::ToSql]| db.execute(sql, args).map_err(|e| e.to_string());
    match operation {
        "push" | "import" => {
            let bytes = bin(q,"bin")?;
            let old: i64 = db.query_row("SELECT at FROM clocks WHERE space=? AND id=?", params![space,id], |r| r.get(0)).optional().map_err(|e| e.to_string())?.unwrap_or(0);
            let at = if operation == "import" { q["at"].as_i64().ok_or("笔记时间无效")?.max(old + 1) } else { now().max(old + 1) };
            execute("INSERT OR IGNORE INTO updates VALUES (?,?,?,?)", &[&space,&id,&bytes,&at])?;
            execute("INSERT INTO clocks VALUES (?,?,?) ON CONFLICT(space,id) DO UPDATE SET at=MAX(at,excluded.at)", &[&space,&id,&at])?;
            Ok(json!(at))
        }
        "snapshot" => Ok(db.query_row("SELECT bin,at FROM snapshots WHERE space=? AND id=?", params![space,id], |r| Ok(json!({"docId":id,"bin":r.get::<_,Vec<u8>>(0)?,"at":r.get::<_,i64>(1)?}))).optional().map_err(|e| e.to_string())?.unwrap_or(Value::Null)),
        "setSnapshot" => {
            let bytes = bin(q,"bin")?;
            let at = q["at"].as_i64().ok_or("笔记时间无效")?;
            execute("INSERT INTO snapshots VALUES (?,?,?,?) ON CONFLICT(space,id) DO UPDATE SET bin=excluded.bin,at=excluded.at WHERE excluded.at > at", &[&space,&id,&bytes,&at])?;
            Ok(json!(true))
        }
        "updates" => {
            let mut stmt = db.prepare("SELECT bin,at FROM updates WHERE space=? AND id=? ORDER BY at").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![space,id], |r| Ok(json!({"docId":id,"bin":r.get::<_,Vec<u8>>(0)?,"at":r.get::<_,i64>(1)?}))).map_err(|e| e.to_string())?.collect::<std::result::Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
            Ok(json!(rows))
        }
        "merge" => {
            let mut count = 0;
            for at in q["times"].as_array().ok_or("笔记时间无效")? {
                count += execute("DELETE FROM updates WHERE space=? AND id=? AND at=?", &[&space,&id,&at.as_i64().ok_or("笔记时间无效")?])?;
            }
            Ok(json!(count))
        }
        "clocks" => {
            let mut stmt = db.prepare("SELECT id,at FROM clocks WHERE space=? AND at>?").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![space,q["after"].as_i64().unwrap_or(0)], |r| Ok(json!({"id":r.get::<_,String>(0)?,"at":r.get::<_,i64>(1)?}))).map_err(|e| e.to_string())?.collect::<std::result::Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
            Ok(json!(rows))
        }
        "clock" => Ok(db.query_row("SELECT at FROM clocks WHERE space=? AND id=?", params![space,id], |r| r.get::<_,i64>(0)).optional().map_err(|e| e.to_string())?.map_or(Value::Null, |at| json!(at))),
        "deleteDoc" => {
            for table in ["snapshots","updates","clocks"] { execute(&format!("DELETE FROM {table} WHERE space=? AND id=?"), &[&space,&id])?; }
            Ok(Value::Null)
        }
        "blobGet" => Ok(db.query_row("SELECT bin,mime,at FROM blobs WHERE space=? AND id=? AND deleted=0", params![space,id], |r| Ok(json!({"key":id,"data":r.get::<_,Vec<u8>>(0)?,"mime":r.get::<_,String>(1)?,"at":r.get::<_,i64>(2)?}))).optional().map_err(|e| e.to_string())?.unwrap_or(Value::Null)),
        "blobSet" => {
            let bytes = bin(q,"data")?;
            execute("INSERT INTO blobs VALUES (?,?,?,?,?,0) ON CONFLICT(space,id) DO UPDATE SET bin=excluded.bin,mime=excluded.mime,deleted=0", &[&space,&id,&bytes,&text(q,"mime")?,&q["at"].as_i64().unwrap_or_else(now)])?;
            Ok(Value::Null)
        }
        "blobDelete" => {
            execute(if q["permanently"] == true {"DELETE FROM blobs WHERE space=? AND id=?"} else {"UPDATE blobs SET deleted=1 WHERE space=? AND id=?"}, &[&space,&id])?;
            Ok(Value::Null)
        }
        "blobRelease" => { execute("DELETE FROM blobs WHERE space=? AND deleted=1", &[&space])?; Ok(Value::Null) }
        "blobList" => {
            let mut stmt = db.prepare("SELECT id,mime,length(bin),at FROM blobs WHERE space=? AND deleted=0").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([space], |r| Ok(json!({"key":r.get::<_,String>(0)?,"mime":r.get::<_,String>(1)?,"size":r.get::<_,i64>(2)?,"at":r.get::<_,i64>(3)?}))).map_err(|e| e.to_string())?.collect::<std::result::Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
            Ok(json!(rows))
        }
        "kvGet" => Ok(db.query_row("SELECT value FROM metadata WHERE scope=? AND key=?", params![space,id], |r| r.get::<_,String>(0)).optional().map_err(|e| e.to_string())?.map_or(Value::Null, Value::String)),
        "kvSet" => {
            let value = q["value"].as_str().filter(|v| v.len() <= 128 * 1024 * 1024).ok_or("笔记设置无效")?;
            execute("INSERT INTO metadata VALUES (?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value", &[&space,&id,&value])?;
            Ok(Value::Null)
        }
        "kvDelete" => { execute("DELETE FROM metadata WHERE scope=? AND key=?", &[&space,&id])?; Ok(Value::Null) }
        "kvList" => {
            let mut stmt = db.prepare("SELECT key,value FROM metadata WHERE scope=?").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([space], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e| e.to_string())?.collect::<std::result::Result<std::collections::BTreeMap<_,_>,_>>().map_err(|e| e.to_string())?;
            Ok(json!(rows))
        }
        _ => Err("未知笔记存储操作".into()),
    }
}
fn main_only(view: &Webview) -> Result<()> {
    if view.label() == "main" {
        Ok(())
    } else {
        Err("设置请求来源无效".into())
    }
}
#[tauri::command]
pub fn notes_storage_info(app: tauri::AppHandle, webview: Webview) -> Result<Value> {
    main_only(&webview)?;
    app.state::<NotesStorage>().info()
}
#[tauri::command]
pub async fn choose_notes_directory(app: tauri::AppHandle, webview: Webview) -> Result<Value> {
    main_only(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("选择笔记存储位置")
            .blocking_pick_folder()
        else {
            return app.state::<NotesStorage>().info();
        };
        app.state::<NotesStorage>()
            .choose(&path.into_path().map_err(|e| e.to_string())?)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn notes_storage_boot(app: tauri::AppHandle, webview: Webview) -> Result<Value> {
    crate::affine::require_notes(&webview)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<NotesStorage>().boot())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn notes_storage_commit(app: tauri::AppHandle, webview: Webview) -> Result<()> {
    crate::affine::require_notes(&webview)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<NotesStorage>().commit())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn notes_store_request(
    app: tauri::AppHandle,
    webview: Webview,
    request: Value,
) -> Result<Value> {
    crate::affine::require_notes(&webview)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<NotesStorage>().request(&request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn notes_storage_flush(app: tauri::AppHandle, webview: Webview) -> Result<()> {
    main_only(&webview)?;
    let Some(view) = app.get_webview(crate::affine::LABEL) else {
        return Ok(());
    };
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.state::<NotesStorage>()
        .flushes
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, sender);
    let script = format!(
        r#"(async () => {{
      let error = null;
      try {{
        if (!window.__AI_PLAYER_NOTES_FLUSH__) throw Error('笔记尚未就绪，请稍后重试');
        await window.__AI_PLAYER_NOTES_FLUSH__();
      }} catch (e) {{ error = String(e.message || e); }}
      await window.__TAURI__.core.invoke('notes_storage_flush_result', {{id: {id}, error}});
    }})()"#
    );
    let result = match view.eval(script) {
        Ok(()) => tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(std::time::Duration::from_secs(25))
                .map_err(|_| "笔记保存超时，请重试".to_owned())
                .and_then(|result| result)
        })
        .await
        .map_err(|e| e.to_string())?,
        Err(e) => Err(e.to_string()),
    };
    app.state::<NotesStorage>()
        .flushes
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    result
}
#[tauri::command]
pub fn notes_storage_flush_result(
    app: tauri::AppHandle,
    webview: Webview,
    id: u64,
    error: Option<String>,
) -> Result<()> {
    crate::affine::require_notes(&webview)?;
    if let Some(sender) = app
        .state::<NotesStorage>()
        .flushes
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        let _ = sender.send(error.map_or(Ok(()), Err));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn start(root: &Path) -> NotesStorage {
        let storage = NotesStorage::new(root).unwrap();
        storage.boot().unwrap();
        storage
    }
    fn imported(root: &Path, parent: &Path) -> NotesStorage {
        let storage = start(root);
        storage.choose(parent).unwrap();
        assert_eq!(
            storage.boot().unwrap()["enabled"],
            false,
            "selection applies on restart"
        );
        let storage = start(root);
        assert_eq!(storage.boot().unwrap()["importing"], true);
        storage
            .request(&json!({"op":"import","space":"workspace","id":"doc","bin":[1,2,3],"at":100}))
            .unwrap();
        storage.request(&json!({"op":"blobSet","space":"workspace","id":"image","data":[9,8,7],"mime":"image/png"})).unwrap();
        storage
            .request(
                &json!({"op":"kvSet","space":"localStorage","id":"lesson","value":"linked-doc"}),
            )
            .unwrap();
        storage.commit().unwrap();
        storage
    }
    #[test]
    fn selection_is_pending_and_import_is_committed_only_after_success() {
        let root = tempfile::tempdir().unwrap();
        let parent = tempfile::tempdir().unwrap();
        let storage = start(root.path());
        storage.choose(parent.path()).unwrap();
        assert!(storage.info().unwrap()["path"].is_null());
        let failed = start(root.path());
        failed
            .request(&json!({"op":"push","space":"workspace","id":"partial","bin":[1]}))
            .unwrap();
        assert!(failed.info().unwrap()["path"].is_null());
        drop(failed);
        let retry = start(root.path());
        assert!(retry
            .request(&json!({"op":"clock","space":"workspace","id":"partial"}))
            .unwrap()
            .is_null());
        retry.commit().unwrap();
        assert!(retry.info().unwrap()["pendingPath"].is_null());
        assert_eq!(start(root.path()).boot().unwrap()["importing"], false);
    }
    #[test]
    fn relocating_preserves_notes_blobs_metadata_and_original_database() {
        let root = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let next = tempfile::tempdir().unwrap();
        let storage = imported(root.path(), first.path());
        storage.choose(next.path()).unwrap();
        // Edits made after choosing a folder are included on next start.
        storage
            .request(&json!({"op":"push","space":"workspace","id":"doc","bin":[4]}))
            .unwrap();
        drop(storage);
        let moved = start(root.path());
        assert_eq!(
            moved
                .request(&json!({"op":"updates","space":"workspace","id":"doc"}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            moved
                .request(&json!({"op":"blobGet","space":"workspace","id":"image"}))
                .unwrap()["data"],
            json!([9, 8, 7])
        );
        assert_eq!(
            moved
                .request(&json!({"op":"kvGet","space":"localStorage","id":"lesson"}))
                .unwrap(),
            "linked-doc"
        );
        assert!(first
            .path()
            .join("Study Helper Notes/notes.sqlite")
            .is_file());
        assert_eq!(
            moved.info().unwrap()["path"],
            json!(next
                .path()
                .canonicalize()
                .unwrap()
                .join("Study Helper Notes"))
        );
    }
    #[test]
    fn unavailable_target_does_not_switch_active_location_or_create_empty_notes() {
        let root = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let next = tempfile::tempdir().unwrap();
        let storage = imported(root.path(), first.path());
        storage.choose(next.path()).unwrap();
        let target = next.path().join("Study Helper Notes");
        fs::rename(&target, next.path().join("disconnected")).unwrap();
        let restart = NotesStorage::new(root.path()).unwrap();
        assert!(restart.boot().is_err());
        assert_eq!(
            restart.info().unwrap()["path"],
            json!(first
                .path()
                .canonicalize()
                .unwrap()
                .join("Study Helper Notes"))
        );
        assert!(!target.exists());
    }
    #[test]
    fn snapshots_reject_stale_writes_and_compaction_retains_new_updates() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SCHEMA).unwrap();
        for bytes in [vec![1], vec![2]] {
            operate(
                &db,
                &json!({"op":"import","space":"s","id":"d","bin":bytes,"at":100}),
            )
            .unwrap();
        }
        let rows = operate(&db, &json!({"op":"updates","space":"s","id":"d"})).unwrap();
        assert_eq!(rows[1]["at"], 101);
        operate(
            &db,
            &json!({"op":"setSnapshot","space":"s","id":"d","bin":[1,2],"at":101}),
        )
        .unwrap();
        operate(
            &db,
            &json!({"op":"setSnapshot","space":"s","id":"d","bin":[0],"at":99}),
        )
        .unwrap();
        operate(&db, &json!({"op":"push","space":"s","id":"d","bin":[3]})).unwrap();
        operate(
            &db,
            &json!({"op":"merge","space":"s","id":"d","times":[100,101]}),
        )
        .unwrap();
        assert_eq!(
            operate(&db, &json!({"op":"snapshot","space":"s","id":"d"})).unwrap()["bin"],
            json!([1, 2])
        );
        assert_eq!(
            operate(&db, &json!({"op":"updates","space":"s","id":"d"}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn existing_folders_and_symlinks_are_not_overwritten() {
        let root = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let folder = target.path().join("Study Helper Notes");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("important"), "keep").unwrap();
        assert!(start(root.path()).choose(target.path()).is_err());
        assert_eq!(
            fs::read_to_string(folder.join("important")).unwrap(),
            "keep"
        );
        #[cfg(unix)]
        {
            let link = root.path().join("notes.sqlite");
            std::os::unix::fs::symlink(folder.join("important"), &link).unwrap();
            assert!(open_database(&link).is_err());
        }
    }
}

#[tauri::command]
pub fn notes_storage_abort(app: tauri::AppHandle, webview: Webview) -> Result<()> {
    crate::affine::require_notes(&webview)?;
    let storage = app.state::<NotesStorage>();
    let mut state = storage.session.lock().map_err(|e| e.to_string())?;
    if state.importing {
        state.db = None;
        state.importing = false;
    }
    Ok(())
}

#[cfg(test)]
mod project_tests {
    use super::*;
    #[test]
    fn interrupted_project_import_retries_and_completed_import_survives_restart() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join(crate::data_storage::NOTES_PENDING),
            "pending",
        )
        .unwrap();
        let storage = NotesStorage::project(root.path()).unwrap();
        assert_eq!(storage.boot().unwrap()["importing"], true);
        storage
            .request(&json!({"op":"push","space":"s","id":"partial","bin":[1]}))
            .unwrap();
        assert!(storage.checkpoint().is_err());
        drop(storage);
        let storage = NotesStorage::project(root.path()).unwrap();
        assert_eq!(storage.boot().unwrap()["importing"], true);
        assert!(storage
            .request(&json!({"op":"clock","space":"s","id":"partial"}))
            .unwrap()
            .is_null());
        storage
            .request(&json!({"op":"import","space":"s","id":"doc","bin":[9,8],"at":100}))
            .unwrap();
        storage
            .request(
                &json!({"op":"blobSet","space":"s","id":"image","data":[1,2],"mime":"image/png"}),
            )
            .unwrap();
        storage.commit().unwrap();
        storage.checkpoint().unwrap();
        assert!(!root
            .path()
            .join(crate::data_storage::NOTES_PENDING)
            .exists());
        drop(storage);
        let storage = NotesStorage::project(root.path()).unwrap();
        assert_eq!(storage.boot().unwrap()["importing"], false);
        assert_eq!(
            storage
                .request(&json!({"op":"updates","space":"s","id":"doc"}))
                .unwrap()[0]["bin"],
            json!([9, 8])
        );
        assert_eq!(
            storage
                .request(&json!({"op":"blobGet","space":"s","id":"image"}))
                .unwrap()["data"],
            json!([1, 2])
        );
    }
    #[test]
    fn missing_project_notes_are_an_error_instead_of_an_empty_workspace() {
        let root = tempfile::tempdir().unwrap();
        let storage = NotesStorage::project(root.path()).unwrap();
        assert!(storage.boot().is_err());
        assert!(!root.path().join(DATABASE).exists());
    }
}

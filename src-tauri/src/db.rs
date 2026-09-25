use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;")
        .map_err(|e| e.to_string())?;
    db.execute_batch(include_str!("schema.sql"))
        .map_err(|e| e.to_string())?;
    Ok(db)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("缺少参数：{key}"))
}
fn sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or_default())),
        Value::String(s) => SqlValue::Text(s.clone()),
        _ => SqlValue::Text(value.to_string()),
    }
}
fn rows(db: &Connection, query: &str, args: Vec<SqlValue>) -> Result<Vec<Value>> {
    let mut stmt = db.prepare(query).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let result = stmt
        .query_map(params_from_iter(args), |row| {
            let mut object = Map::new();
            for (i, name) in columns.iter().enumerate() {
                let val = match row.get::<_, SqlValue>(i)? {
                    SqlValue::Null => Value::Null,
                    SqlValue::Integer(n) => json!(n),
                    SqlValue::Real(n) => json!(n),
                    SqlValue::Text(s) => json!(s),
                    SqlValue::Blob(_) => Value::Null,
                };
                object.insert(name.clone(), val);
            }
            Ok(Value::Object(object))
        })
        .map_err(|e| e.to_string())?;
    result
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
fn decoded(row: &Value, key: &str, fallback: Value) -> Value {
    row[key]
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(fallback)
}
fn upsert(
    db: &Connection,
    table: &str,
    columns: &str,
    conflict: &str,
    values: Vec<Value>,
) -> Result<()> {
    let names: Vec<&str> = columns.split(',').collect();
    let keys: Vec<&str> = conflict.split(',').collect();
    let update = names
        .iter()
        .filter(|n| !keys.contains(n) && **n != "created_at")
        .map(|n| format!("{n}=excluded.{n}"))
        .collect::<Vec<_>>()
        .join(",");
    let placeholders = vec!["?"; names.len()].join(",");
    db.execute(&format!("INSERT INTO {table} ({columns}) VALUES ({placeholders}) ON CONFLICT({conflict}) DO UPDATE SET {update}"), params_from_iter(values.iter().map(sql))).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn canonical(db: &Connection, id: &str) -> Result<String> {
    Ok(db
        .query_row(
            "SELECT course_id FROM course_aliases WHERE alias_id=?",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| id.to_string()))
}
pub fn request(
    db: &mut Connection,
    endpoint: &str,
    method: &str,
    query: Value,
    body: Value,
) -> Result<Value> {
    if method == "GET" {
        return read(db, endpoint, &query);
    }
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let result = write(&tx, endpoint, method, &query, &body)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}
fn read(db: &Connection, endpoint: &str, q: &Value) -> Result<Value> {
    let course =
        || -> Result<SqlValue> { Ok(SqlValue::Text(canonical(db, text(q, "courseId")?)?)) };
    match endpoint {
        "recent-courses" => {
            let (query, args) = if let Some(id) = q["id"].as_str() {
                (
                    "SELECT * FROM recent_courses WHERE id=?",
                    vec![SqlValue::Text(canonical(db, id)?)],
                )
            } else {
                (
                    "SELECT * FROM recent_courses ORDER BY last_opened_at DESC LIMIT 20",
                    vec![],
                )
            };
            let list: Vec<Value> = rows(db, query, args)?.iter().map(|r| json!({"id":r["id"],"name":r["name"],"videoCount":r["video_count"],"lastOpenedAt":r["last_opened_at"],"lastVideoPath":r["last_video_path"]})).collect();
            Ok(if q["id"].is_string() {
                list.into_iter().next().unwrap_or(Value::Null)
            } else {
                json!(list)
            })
        }
        "progress" => {
            let (query, args) = if q["courseId"].is_string() {
                (
                    "SELECT * FROM video_progress WHERE course_id=?",
                    vec![course()?],
                )
            } else {
                ("SELECT * FROM video_progress", vec![])
            };
            let mut result = json!({});
            for r in rows(db, query, args)? {
                let item = json!({"time":r["time"],"duration":r["duration"],"ratio":r["ratio"],"done":r["done"]==1,"updatedAt":r["updated_at"]});
                let path = r["video_path"].as_str().unwrap_or_default();
                if q["courseId"].is_string() {
                    result[path] = item;
                } else {
                    let id = r["course_id"].as_str().unwrap_or_default();
                    if result[id].is_null() {
                        result[id] = json!({});
                    }
                    result[id][path] = item;
                }
            }
            Ok(result)
        }
        "check-in" => {
            let mut result = json!({});
            for r in rows(
                db,
                "SELECT * FROM check_ins WHERE course_id=?",
                vec![course()?],
            )? {
                result[r["date"].as_str().unwrap_or_default()] = json!({"date":r["date"],"seconds":r["seconds"],"targetSeconds":r["target_seconds"],"checkedAt":r["checked_at"]});
            }
            Ok(result)
        }
        "notes" => {
            let list = rows(
                db,
                "SELECT content,updated_at FROM notes WHERE course_id=? AND video_path=?",
                vec![course()?, sql(&json!(text(q, "videoPath")?))],
            )?;
            Ok(list
                .first()
                .map(|r| json!({"content":r["content"],"updatedAt":r["updated_at"]}))
                .unwrap_or(json!({"content":"","updatedAt":null})))
        }
        "note-images" => {
            if let Some(id) = q["id"].as_str() {
                return Ok(rows(
                    db,
                    "SELECT id,name,data_base64 FROM note_images WHERE id=?",
                    vec![sql(&json!(id))],
                )?
                .into_iter()
                .next()
                .unwrap_or(Value::Null));
            }
            Ok(json!(rows(db,"SELECT id,name,data_base64,created_at FROM note_images WHERE course_id=? AND video_path=? ORDER BY created_at",vec![course()?,sql(&json!(text(q,"videoPath")?))])?))
        }
        "guide" => {
            let list = rows(
                db,
                "SELECT * FROM learning_guides WHERE course_id=?",
                vec![course()?],
            )?;
            Ok(list.first().map(|r| json!({"plan":decoded(r,"plan_json",Value::Null),"metadata":decoded(r,"metadata_json",json!({})),"view":r["view"],"includeOptional":r["include_optional"]==1,"mastery":decoded(r,"mastery_json",json!({})),"questions":decoded(r,"questions_json",json!([])),"today":decoded(r,"today_json",Value::Null),"updatedAt":r["updated_at"]})).unwrap_or(Value::Null))
        }
        "practice" => {
            let mut result = json!({});
            for r in rows(
                db,
                "SELECT video_path,records_json FROM lesson_practices WHERE course_id=?",
                vec![course()?],
            )? {
                result[r["video_path"].as_str().unwrap_or_default()] =
                    decoded(&r, "records_json", json!([]));
            }
            Ok(result)
        }
        "settings" => {
            if let Some(key) = q["key"].as_str() {
                return Ok(rows(
                    db,
                    "SELECT value_json FROM app_settings WHERE key=?",
                    vec![sql(&json!(key))],
                )?
                .first()
                .map(|r| decoded(r, "value_json", Value::Null))
                .unwrap_or(Value::Null));
            }
            let mut result = json!({});
            for r in rows(db, "SELECT key,value_json FROM app_settings", vec![])? {
                result[r["key"].as_str().unwrap_or_default()] =
                    decoded(&r, "value_json", Value::Null);
            }
            Ok(result)
        }
        _ => Err("不支持的数据操作".into()),
    }
}
fn write(db: &Connection, endpoint: &str, method: &str, q: &Value, b: &Value) -> Result<Value> {
    if method == "DELETE" && endpoint == "recent-courses" {
        db.execute(
            "DELETE FROM recent_courses WHERE id=?",
            [canonical(db, text(q, "id")?)?],
        )
        .map_err(|e| e.to_string())?;
        return Ok(json!({"success":true}));
    }
    if method != "POST" {
        return Err("不支持的数据操作".into());
    }
    let time = json!(now());
    let course = || -> Result<Value> { Ok(json!(canonical(db, text(b, "courseId")?)?)) };
    let default = |key: &str, fallback: Value| {
        if b[key].is_null() {
            fallback
        } else {
            b[key].clone()
        }
    };
    match endpoint {
        "recent-courses" => upsert(db,"recent_courses","id,name,video_count,last_opened_at,last_video_path,created_at,updated_at","id",vec![json!(canonical(db,text(b,"id")?)?),json!(text(b,"name")?),default("videoCount",json!(0)),default("lastOpenedAt",time.clone()),b["lastVideoPath"].clone(),time.clone(),time.clone()])?,
        "progress" => upsert(db,"video_progress","course_id,video_path,time,duration,ratio,done,updated_at","course_id,video_path",vec![course()?,json!(text(b,"path")?),default("time",json!(0)),default("duration",json!(0)),default("ratio",json!(0)),json!(b["done"]==true),time.clone()])?,
        "notes" => {
            let content = b["content"].as_str().ok_or("笔记内容无效")?;
            upsert(db,"notes","course_id,video_path,content,updated_at","course_id,video_path",vec![course()?,json!(text(b,"videoPath")?),json!(content),time.clone()])?;
        }
        "note-images" => {
            let id = b["id"].as_str().map(String::from).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            db.execute("INSERT INTO note_images (id,course_id,video_path,name,data_base64,created_at) VALUES (?,?,?,?,?,?)",params![id,canonical(db,text(b,"courseId")?)?,text(b,"videoPath")?,text(b,"name")?,text(b,"dataBase64")?,now()]).map_err(|e| e.to_string())?;
            return Ok(json!({"success":true,"id":id,"dataBase64":b["dataBase64"]}));
        }
        "check-in" => {
            for day in b["days"].as_array().ok_or("打卡数据无效")? {
                upsert(db,"check_ins","course_id,date,seconds,target_seconds,checked_at,created_at,updated_at","course_id,date",vec![course()?,json!(text(day,"date")?),day["seconds"].clone(),day["targetSeconds"].clone(),day["checkedAt"].clone(),time.clone(),time.clone()])?;
            }
        }
        "guide" => upsert(db,"learning_guides","course_id,plan_json,metadata_json,view,include_optional,mastery_json,questions_json,today_json,updated_at","course_id",vec![course()?,b["plan"].clone(),b["metadata"].clone(),default("view",json!("all")),json!(b["includeOptional"]==true),b["mastery"].clone(),b["questions"].clone(),b["today"].clone(),time.clone()])?,
        "practice" => {
            if !b["records"].is_array() { return Err("练习记录无效".into()); }
            upsert(db,"lesson_practices","course_id,video_path,records_json,updated_at","course_id,video_path",vec![course()?,json!(text(b,"videoPath")?),b["records"].clone(),time.clone()])?;
        }
        "settings" => upsert(db,"app_settings","key,value_json,updated_at","key",vec![json!(text(b,"key")?),json!(b["value"].to_string()),time.clone()])?,
        _ => return Err("不支持的数据操作".into()),
    }
    Ok(json!({"success":true,"updatedAt":time}))
}


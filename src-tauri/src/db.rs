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
        "learning-sources" => {
            let id = q["courseId"]
                .as_str()
                .map(|id| canonical(db, id))
                .transpose()?;
            let args = || {
                id.as_ref()
                    .map(|id| vec![SqlValue::Text(id.clone())])
                    .unwrap_or_default()
            };
            let mut practices = Vec::new();
            for r in rows(
                db,
                if id.is_some() {
                    "SELECT course_id,records_json FROM lesson_practices WHERE course_id=?"
                } else {
                    "SELECT course_id,records_json FROM lesson_practices"
                },
                args(),
            )? {
                let records: Value = serde_json::from_str(r["records_json"].as_str().unwrap_or(""))
                    .map_err(|_| "练习记录格式异常".to_string())?;
                practices.push(json!({"courseId":r["course_id"],"records":records}));
            }
            let notes: Vec<Value> = rows(db, if id.is_some() { "SELECT course_id,video_path,content,updated_at FROM notes WHERE course_id=?" } else { "SELECT course_id,video_path,content,updated_at FROM notes" }, args())?
                .iter().map(|r| json!({"courseId":r["course_id"],"path":r["video_path"],"content":r["content"],"updatedAt":r["updated_at"]})).collect();
            let mut summaries = Vec::new();
            // Deliberately scoped: never return AI credentials or unrelated settings.
            let settings = if let Some(id) = &id {
                let prefix = format!("lesson-knowledge:[{},", json!(id));
                rows(
                    db,
                    "SELECT key,value_json FROM app_settings WHERE key=? OR (key>=? AND key<?)",
                    vec![
                        SqlValue::Text(format!("daily-practice:{id}")),
                        SqlValue::Text(prefix.clone()),
                        SqlValue::Text(format!("{prefix}\u{10ffff}")),
                    ],
                )?
            } else {
                rows(db, "SELECT key,value_json FROM app_settings WHERE key LIKE 'daily-practice:%' OR key LIKE 'lesson-knowledge:%'", vec![])?
            };
            for r in settings {
                let key = r["key"].as_str().unwrap_or("");
                let value: Value = serde_json::from_str(r["value_json"].as_str().unwrap_or(""))
                    .map_err(|_| "学习材料格式异常".to_string())?;
                if let Some(id) = key.strip_prefix("daily-practice:") {
                    let records: Vec<Value> = value
                        .as_object()
                        .ok_or("每日练习记录格式异常")?
                        .values()
                        .map(|v| v.as_array().ok_or("每日练习记录格式异常"))
                        .collect::<std::result::Result<Vec<_>, _>>()?
                        .into_iter()
                        .flatten()
                        .cloned()
                        .collect();
                    practices.push(json!({"courseId":id,"records":records}));
                } else if let Some(identity) = key.strip_prefix("lesson-knowledge:") {
                    let identity: Value =
                        serde_json::from_str(identity).map_err(|_| "知识点索引无效".to_string())?;
                    // Full-lesson summaries own the index; partial summaries duplicate their points.
                    if identity[2].is_null() && !value.is_null() && value["version"] == 2 {
                        summaries.push(json!({"courseId":identity[0],"path":identity[1],"createdAt":value["createdAt"],"overview":value["overview"],"points":value["points"]}));
                    }
                }
            }
            let mut result = json!({"practices":practices,"notes":notes,"summaries":summaries});
            if let Some(id) = id {
                result["courseId"] = json!(id);
            }
            Ok(result)
        }
        "library" => {
            let (query, args) = if let Some(id) = q["id"].as_str() {
                (
                    "SELECT * FROM course_library WHERE id=?",
                    vec![SqlValue::Text(canonical(db, id)?)],
                )
            } else {
                (
                    "SELECT * FROM course_library ORDER BY pinned DESC,last_opened_at DESC",
                    vec![],
                )
            };
            let list: Vec<Value> = rows(db, query, args)?.iter().map(|r| json!({"id":r["id"],"name":r["name"],"videoCount":r["video_count"],"lastOpenedAt":r["last_opened_at"],"lastVideoPath":r["last_video_path"],"status":r["status"],"pinned":r["pinned"]==1})).collect();
            Ok(if q["id"].is_string() {
                list.into_iter().next().unwrap_or(Value::Null)
            } else {
                json!(list)
            })
        }
        "practice-scopes" => {
            let id = canonical(db, text(q, "courseId")?)?;
            let value = read(
                db,
                "settings",
                &json!({"key":format!("daily-practice:{id}")}),
            )?;
            Ok(json!(value
                .as_object()
                .map(|records| records
                    .keys()
                    .filter(|key| key.starts_with("daily:"))
                    .cloned()
                    .collect::<Vec<_>>())
                .unwrap_or_default()))
        }
        "day-snapshots" => {
            let mut result = json!({});
            for row in rows(db, "SELECT date,snapshot_json FROM daily_plan_snapshots WHERE course_id=? ORDER BY date DESC LIMIT 366", vec![course()?])? {
                let snapshot: Value = serde_json::from_str(row["snapshot_json"].as_str().unwrap_or("")).map_err(|_| "每日计划记录格式异常".to_string())?;
                result[row["date"].as_str().unwrap_or_default()] = snapshot;
            }
            Ok(result)
        }
        "study-evidence" => {
            // Only aggregates and timestamps cross the boundary; never note text or answers.
            let notes: Vec<Value> = rows(db,
                "SELECT course_id,length(content) AS characters,updated_at FROM notes", vec![])?
                .iter().map(|r| json!({"courseId":r["course_id"],"characters":r["characters"],"updatedAt":r["updated_at"]})).collect();
            let mut practices = Vec::new();
            for r in rows(
                db,
                "SELECT course_id,video_path,records_json FROM lesson_practices",
                vec![],
            )? {
                let records: Value =
                    serde_json::from_str(r["records_json"].as_str().ok_or("练习记录格式异常")?)
                        .map_err(|_| "练习记录格式异常")?;
                for record in records.as_array().ok_or("练习记录格式异常")? {
                    let solid_at = record["attempts"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|a| a["feedback"]["result"] == "solid")
                        .filter_map(|a| a["at"].as_i64())
                        .min();
                    practices.push(json!({"courseId":r["course_id"],
                        "id":format!("{}:{}",r["video_path"],record["id"].as_str().ok_or("练习编号无效")?),"solidAt":solid_at}));
                }
            }
            Ok(json!({"notes":notes,"practices":practices}))
        }
        "dashboard" => {
            let library = if let Some(id) = q["courseId"].as_str() {
                let entry = read(db, "library", &json!({"id":id}))?;
                if entry.is_null() {
                    json!([])
                } else {
                    json!([entry])
                }
            } else {
                read(db, "library", &json!({}))?
            };
            let mut result = Vec::new();
            for entry in library.as_array().ok_or("课程库格式异常")? {
                let id = entry["id"].as_str().ok_or("课程编号无效")?;
                let data = (|| -> Result<Value> {
                    let query = json!({"courseId":id});
                    Ok(
                        json!({"guide":read(db,"guide",&query)?,"progress":read(db,"progress",&query)?,
                        "days":read(db,"check-in",&query)?,"snapshots":read(db,"day-snapshots",&query)?,"practiceScopes":read(db,"practice-scopes",&query)?,
                        "records":read(db,"settings",&json!({"key":format!("study-records:{id}")}))?}),
                    )
                })();
                result.push(match data {
                    Ok(data) => json!({"course":entry,"data":data}),
                    Err(error) => json!({"course":entry,"error":error}),
                });
            }
            Ok(json!(result))
        }
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
            if let Some(name) = q["name"].as_str() {
                return Ok(json!(rows(db,
                    "SELECT id,name,data_base64 FROM note_images WHERE course_id=? AND video_path=? AND name=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
                    vec![course()?, sql(&json!(text(q, "videoPath")?)), sql(&json!(name))])?));
            }
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
            // 损坏的数据与“没有记录”必须区分，避免前端用空值覆盖可恢复内容。
            if let Some(row) = list.first() {
                for key in [
                    "plan_json",
                    "metadata_json",
                    "mastery_json",
                    "questions_json",
                    "today_json",
                ] {
                    if let Some(value) = row[key].as_str() {
                        serde_json::from_str::<Value>(value)
                            .map_err(|_| "导学记录格式异常，原始数据已保留".to_string())?;
                    }
                }
            }
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
                let values = rows(
                    db,
                    "SELECT value_json FROM app_settings WHERE key=?",
                    vec![sql(&json!(key))],
                )?;
                return match values.first() {
                    Some(row) => serde_json::from_str(row["value_json"].as_str().unwrap_or("null"))
                        .map_err(|_| "设置记录格式异常，原始数据已保留".to_string()),
                    None => Ok(Value::Null),
                };
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
    if endpoint == "ai-batch-cache" {
        if method == "POST" {
            let key = text(b, "key")?;
            if !key.starts_with("ai-batches:v1:") {
                return Err("无效的 AI 批次键".into());
            }
            let raw: Option<String> = db
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key=?",
                    [key],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(raw) = raw {
                let mut value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                if value["version"] != 1 || !value["values"].is_array() {
                    return Err("无效的 AI 批次记录".into());
                }
                value["completedAt"] = json!(now());
                db.execute(
                    "UPDATE app_settings SET value_json=? WHERE key=?",
                    params![value.to_string(), key],
                )
                .map_err(|e| e.to_string())?;
            }
        } else if method != "DELETE" {
            return Err("不支持的数据操作".into());
        }
        // Incomplete and legacy checkpoints have no completedAt and are never removed.
        let cutoff = now() - 30 * 24 * 60 * 60 * 1000;
        let removed = db.execute("DELETE FROM app_settings WHERE key LIKE 'ai-batches:v1:%' AND CASE WHEN json_valid(value_json) THEN json_type(value_json,'$.completedAt')='integer' AND json_extract(value_json,'$.completedAt') < ? ELSE 0 END", [cutoff]).map_err(|e| e.to_string())?;
        return Ok(json!({"success":true,"removed":removed}));
    }
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
        "library" => {
            let id = canonical(db, text(b, "id")?)?;
            if let Some(status) = b["status"].as_str() {
                if !["active","paused","archived"].contains(&status) { return Err("课程状态无效".into()); }
                db.execute("UPDATE course_library SET status=? WHERE id=?", params![status,id]).map_err(|e| e.to_string())?;
            }
            if let Some(pinned) = b["pinned"].as_bool() {
                db.execute("UPDATE course_library SET pinned=? WHERE id=?", params![pinned,id]).map_err(|e| e.to_string())?;
            }
        }
        "day-snapshots" => {
            let snapshot = &b["snapshot"];
            let date = text(snapshot,"date")?;
            let valid_date = date.len() == 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-'
                && date.bytes().enumerate().all(|(i,c)| i == 4 || i == 7 || c.is_ascii_digit());
            if !valid_date || !snapshot["tasks"].is_array() || !snapshot["capturedAt"].is_u64()
                || !snapshot["plannedMinutes"].as_u64().is_some_and(|n| n <= 1440) { return Err("每日计划快照无效".into()); }
            let previous = rows(db,"SELECT snapshot_json FROM daily_plan_snapshots WHERE course_id=? AND date=?",vec![sql(&course()?),sql(&json!(date))])?;
            let mut next = snapshot.clone();
            if let Some(row) = previous.first() {
                let old: Value = serde_json::from_str(row["snapshot_json"].as_str().unwrap_or("")).map_err(|_| "原每日计划记录损坏，已暂停保存".to_string())?;
                if old["capturedAt"].as_u64() > snapshot["capturedAt"].as_u64() { return Ok(json!({"success":true})); }
                next["initialMinutes"] = old["initialMinutes"].clone();
            } else { next["initialMinutes"] = snapshot["plannedMinutes"].clone(); }
            upsert(db,"daily_plan_snapshots","course_id,date,snapshot_json","course_id,date",vec![course()?,json!(date),next])?;
        }
        "recent-courses" => upsert(db,"recent_courses","id,name,video_count,last_opened_at,last_video_path,created_at,updated_at","id",vec![json!(canonical(db,text(b,"id")?)?),json!(text(b,"name")?),default("videoCount",json!(0)),default("lastOpenedAt",time.clone()),b["lastVideoPath"].clone(),time.clone(),time.clone()])?,
        "progress" => upsert(db,"video_progress","course_id,video_path,time,duration,ratio,done,updated_at","course_id,video_path",vec![course()?,json!(text(b,"path")?),default("time",json!(0)),default("duration",json!(0)),default("ratio",json!(0)),json!(b["done"]==true),time.clone()])?,
        "notes" => {
            let content = b["content"].as_str().ok_or("笔记内容无效")?;
            if b.get("expectedContent").is_some() {
                let previous = read(db,"notes",&json!({"courseId":course()?,"videoPath":text(b,"videoPath")?}))?;
                if previous["content"] != b["expectedContent"] { return Err("笔记已修改，请重新同步。".into()); }
            }
            upsert(db,"notes","course_id,video_path,content,updated_at","course_id,video_path",vec![course()?,json!(text(b,"videoPath")?),json!(content),time.clone()])?;
        }
        "note-images" => {
            let id = b["id"].as_str().map(String::from).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            db.execute("INSERT INTO note_images (id,course_id,video_path,name,data_base64,created_at) VALUES (?,?,?,?,?,?)",params![id,canonical(db,text(b,"courseId")?)?,text(b,"videoPath")?,text(b,"name")?,text(b,"dataBase64")?,now()]).map_err(|e| e.to_string())?;
            return Ok(json!({"success":true,"id":id,"dataBase64":b["dataBase64"]}));
        }
        "check-in" => {
            for day in b["days"].as_array().ok_or("打卡数据无效")? {
                // 学习时长只累计；另一窗口较旧的快照不能倒退时长或撤销打卡。
                db.execute("INSERT INTO check_ins (course_id,date,seconds,target_seconds,checked_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(course_id,date) DO UPDATE SET seconds=MAX(check_ins.seconds,excluded.seconds),target_seconds=excluded.target_seconds,checked_at=COALESCE(check_ins.checked_at,excluded.checked_at),updated_at=excluded.updated_at",
                    params_from_iter([course()?,json!(text(day,"date")?),day["seconds"].clone(),day["targetSeconds"].clone(),day["checkedAt"].clone(),time.clone(),time.clone()].iter().map(sql))).map_err(|e| e.to_string())?;
            }
        }
        "guide" => upsert(db,"learning_guides","course_id,plan_json,metadata_json,view,include_optional,mastery_json,questions_json,today_json,updated_at","course_id",vec![course()?,b["plan"].clone(),b["metadata"].clone(),default("view",json!("all")),json!(b["includeOptional"]==true),b["mastery"].clone(),b["questions"].clone(),b["today"].clone(),time.clone()])?,
        "learning-plan" => {
            let id = canonical(db,text(b,"courseId")?)?;
            let guide = read(db,"guide",&json!({"courseId":id}))?;
            if guide["plan"] != b["expectedPlan"] { return Err("计划已修改，请重新预览。".into()); }
            let plan = &b["plan"];
            if !plan.is_object() || !plan["program"].is_object() || !plan["lessons"].is_array() { return Err("学习计划无效".into()); }
            let key = format!("study-records:{id}");
            let mut records = read(db,"settings",&json!({"key":key}))?;
            if records.is_null() { records = json!({"entries":[],"checks":{},"activeModuleId":"","undo":null}); }
            if !records.is_object() { return Err("阶段记录无效".into()); }
            if b["undo"] == true {
                if records["undo"]["plan"] != *plan || records["undo"]["label"] != "自适应减负" { return Err("撤销记录已变化，请重新读取。".into()); }
                records["undo"] = Value::Null;
            } else { records["undo"] = json!({"plan":guide["plan"],"includeOptional":guide["includeOptional"],"view":guide["view"],"label":"自适应减负","at":now(),"scheduleOnly":true}); }
            // A schedule preview may normalize display fields. Preserve the original route and conversation.
            let mut scheduled = guide["plan"].clone();
            scheduled["program"] = plan["program"].clone();
            scheduled["dailyMinutes"] = plan["dailyMinutes"].clone();
            if let Some(modules) = scheduled["modules"].as_array_mut() {
                for module in modules {
                    if let Some(next) = plan["modules"].as_array().and_then(|ms|ms.iter().find(|m|m["id"] == module["id"])) {
                        if module["practice"].is_object() && next["practice"].is_object() {
                            module["practice"]["startDay"] = next["practice"]["startDay"].clone();
                            module["practice"]["endDay"] = next["practice"]["endDay"].clone();
                        }
                    }
                }
            }
            upsert(db,"app_settings","key,value_json,updated_at","key",vec![json!(key),json!(records.to_string()),time.clone()])?;
            db.execute("UPDATE learning_guides SET plan_json=?,updated_at=? WHERE course_id=?", params![scheduled.to_string(),now(),id]).map_err(|e|e.to_string())?;
        }
        "practice" => {
            if !b["records"].is_array() { return Err("练习记录无效".into()); }
            upsert(db,"lesson_practices","course_id,video_path,records_json,updated_at","course_id,video_path",vec![course()?,json!(text(b,"videoPath")?),b["records"].clone(),time.clone()])?;
        }
        "settings" => upsert(db,"app_settings","key,value_json,updated_at","key",vec![json!(text(b,"key")?),json!(b["value"].to_string()),time.clone()])?,
        _ => return Err("不支持的数据操作".into()),
    }
    Ok(json!({"success":true,"updatedAt":time}))
}

#[cfg(test)]
mod persistence_tests {
    use super::*;

    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA trusted_schema=OFF;").unwrap();
        db.execute_batch(include_str!("schema.sql")).unwrap();
        db
    }
    #[test]
    fn learning_sources_migrate_old_records_without_exposing_other_settings() {
        let mut db = database();
        let before = read(&db, "learning-sources", &json!({})).unwrap();
        assert_eq!(before, json!({"notes":[],"summaries":[],"practices":[]}));
        for (key, value) in [
            ("ai_settings", json!({"apiKey":"SECRET"})),
            ("learning-notion", json!({"token":"SECRET"})),
            (
                "daily-practice:one",
                json!({"daily:day":[{"id":"practice"}]}),
            ),
            (
                "lesson-knowledge:[\"one\",\"1.mp4\",null]",
                json!({"version":2,"createdAt":1,"overview":"overview","points":[]}),
            ),
        ] {
            request(
                &mut db,
                "settings",
                "POST",
                json!({}),
                json!({"key":key,"value":value}),
            )
            .unwrap();
        }
        request(
            &mut db,
            "notes",
            "POST",
            json!({}),
            json!({"courseId":"one","videoPath":"1.mp4","content":"note"}),
        )
        .unwrap();
        let value = read(&db, "learning-sources", &json!({})).unwrap();
        assert_eq!(value["notes"][0]["content"], "note");
        assert_eq!(value["summaries"][0]["courseId"], "one");
        assert_eq!(value["practices"][0]["records"][0]["id"], "practice");
        assert!(!value.to_string().contains("SECRET"));
    }
    #[test]
    fn incoming_note_edit_must_match_current_content() {
        let mut db = database();
        request(
            &mut db,
            "notes",
            "POST",
            json!({}),
            json!({"courseId":"one","videoPath":"1.mp4","content":"new draft"}),
        )
        .unwrap();
        assert!(request(&mut db,"notes","POST",json!({}),json!({"courseId":"one","videoPath":"1.mp4","content":"remote","expectedContent":"old draft"})).is_err());
        assert_eq!(
            read(&db, "notes", &json!({"courseId":"one","videoPath":"1.mp4"})).unwrap()["content"],
            "new draft"
        );
    }
    #[test]
    fn adaptive_schedule_preserves_conversation_and_supports_guarded_undo() {
        let mut db = database();
        let original = json!({"version":1,"createdAt":1,"dailyMinutes":30,"modules":[],"lessons":[],"messages":[{"role":"user","content":"保留学情"}],"program":{"days":14}});
        request(&mut db,"guide","POST",json!({}),json!({"courseId":"one","plan":original,"metadata":{},"mastery":{},"questions":[],"today":null})).unwrap();
        let mut next = original.clone();
        next["dailyMinutes"] = json!(15);
        next["program"]["days"] = json!(28);
        next["messages"] = json!([]);
        request(
            &mut db,
            "learning-plan",
            "POST",
            json!({}),
            json!({"courseId":"one","expectedPlan":original,"plan":next}),
        )
        .unwrap();
        let current = read(&db, "guide", &json!({"courseId":"one"})).unwrap()["plan"].clone();
        assert_eq!(current["messages"], original["messages"]);
        assert_eq!(current["program"]["days"], 28);
        assert!(request(
            &mut db,
            "learning-plan",
            "POST",
            json!({}),
            json!({"courseId":"one","expectedPlan":original,"plan":next})
        )
        .is_err());
        request(
            &mut db,
            "learning-plan",
            "POST",
            json!({}),
            json!({"courseId":"one","expectedPlan":current,"plan":original,"undo":true}),
        )
        .unwrap();
        assert_eq!(
            read(&db, "guide", &json!({"courseId":"one"})).unwrap()["plan"],
            original
        );
        assert!(
            read(&db, "settings", &json!({"key":"study-records:one"})).unwrap()["undo"].is_null()
        );
    }
    #[test]
    fn history_scope_read_excludes_answers_and_other_settings() {
        let mut db = database();
        request(
            &mut db,
            "settings",
            "POST",
            json!({}),
            json!({"key":"daily-practice:one", "value":{
                "daily:2026-09-30:[[\"a.mp4\",0,300]]":[{"draft":"private answer"}], "other":[]
            }}),
        )
        .unwrap();
        let value = read(&db, "practice-scopes", &json!({"courseId":"one"})).unwrap();
        assert_eq!(value, json!(["daily:2026-09-30:[[\"a.mp4\",0,300]]"]));
        assert!(!value.to_string().contains("private answer"));
    }

    fn save_guide(db: &mut Connection, plan: Value) -> Result<Value> {
        request(
            db,
            "guide",
            "POST",
            json!({}),
            json!({"courseId":"one", "plan":plan,
            "metadata":{}, "view":"route", "includeOptional":false, "mastery":{}, "questions":[], "today":null}),
        )
    }

    #[test]
    fn completed_ai_cache_expires_without_touching_unfinished_or_other_settings() {
        let mut db = database();
        let old = super::now() - 31 * 24 * 60 * 60 * 1000;
        for (key, value) in [
            (
                "ai-batches:v1:old",
                json!({"version":1,"values":[1],"completedAt":old}),
            ),
            ("ai-batches:v1:pending", json!({"version":1,"values":[1]})),
            (
                "ai-batches:v1:recent",
                json!({"version":1,"values":[1],"completedAt":super::now()}),
            ),
            ("user-setting", json!({"completedAt":old})),
        ] {
            request(
                &mut db,
                "settings",
                "POST",
                json!({}),
                json!({"key":key,"value":value}),
            )
            .unwrap();
        }
        let result = request(&mut db, "ai-batch-cache", "DELETE", json!({}), json!({})).unwrap();
        assert_eq!(result["removed"], 1);
        for key in [
            "ai-batches:v1:pending",
            "ai-batches:v1:recent",
            "user-setting",
        ] {
            assert_ne!(
                super::read(&db, "settings", &json!({"key":key})).unwrap(),
                Value::Null
            );
        }
        request(
            &mut db,
            "ai-batch-cache",
            "POST",
            json!({}),
            json!({"key":"ai-batches:v1:pending"}),
        )
        .unwrap();
        assert!(
            super::read(&db, "settings", &json!({"key":"ai-batches:v1:pending"})).unwrap()
                ["completedAt"]
                .is_i64()
        );
        assert!(request(
            &mut db,
            "ai-batch-cache",
            "POST",
            json!({}),
            json!({"key":"user-setting"})
        )
        .is_err());
    }

    #[test]
    fn image_lookup_by_name_is_scoped_and_returns_only_requested_image() {
        let mut db = database();
        for (course, name, content) in [
            ("one", "a.png", "old"),
            ("two", "a.png", "other-course"),
            ("one", "b.png", "other-image"),
            ("one", "a.png", "new"),
        ] {
            request(&mut db, "note-images", "POST", json!({}), json!({"courseId":course,"videoPath":"lesson.mp4","name":name,"dataBase64":content})).unwrap();
        }
        let result = super::read(
            &db,
            "note-images",
            &json!({"courseId":"one","videoPath":"lesson.mp4","name":"a.png"}),
        )
        .unwrap();
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["data_base64"], "new");
    }

    #[test]
    fn library_survives_recent_removal_and_metadata_refresh() {
        let mut db = database();
        for index in 0..24 {
            request(
                &mut db,
                "recent-courses",
                "POST",
                json!({}),
                json!({"id":format!("course-{index}"),"name":"课程","videoCount":3}),
            )
            .unwrap();
        }
        request(
            &mut db,
            "library",
            "POST",
            json!({}),
            json!({"id":"course-0","status":"archived","pinned":true}),
        )
        .unwrap();
        request(
            &mut db,
            "recent-courses",
            "DELETE",
            json!({"id":"course-0"}),
            Value::Null,
        )
        .unwrap();
        assert_eq!(
            request(&mut db, "library", "GET", json!({}), Value::Null)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            24
        );
        assert_eq!(
            request(&mut db, "recent-courses", "GET", json!({}), Value::Null)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            20
        );
        request(
            &mut db,
            "recent-courses",
            "POST",
            json!({}),
            json!({"id":"course-0","name":"新名称","videoCount":4}),
        )
        .unwrap();
        let entry = request(
            &mut db,
            "library",
            "GET",
            json!({"id":"course-0"}),
            Value::Null,
        )
        .unwrap();
        assert_eq!(entry["status"], "archived");
        assert_eq!(entry["pinned"], true);
        assert_eq!(entry["videoCount"], 4);
        assert!(request(
            &mut db,
            "library",
            "POST",
            json!({}),
            json!({"id":"course-0","status":"invalid"})
        )
        .is_err());
    }

    #[test]
    fn snapshots_preserve_initial_budget_and_reject_older_writes() {
        let mut db = database();
        for (time, minutes) in [(10, 60), (20, 30), (15, 90)] {
            request(&mut db,"day-snapshots","POST",json!({}),json!({"courseId":"one","snapshot":{"date":"2026-09-26","plannedMinutes":minutes,"capturedAt":time,"tasks":[]}})).unwrap();
        }
        let data = request(
            &mut db,
            "day-snapshots",
            "GET",
            json!({"courseId":"one"}),
            Value::Null,
        )
        .unwrap();
        assert_eq!(data["2026-09-26"]["plannedMinutes"], 30);
        assert_eq!(data["2026-09-26"]["initialMinutes"], 60);
        assert!(request(&mut db,"day-snapshots","POST",json!({}),json!({"courseId":"one","snapshot":{"date":"bad","plannedMinutes":30,"capturedAt":30,"tasks":[]}})).is_err());
    }

    #[test]
    fn incremental_sources_and_dashboard_only_return_the_requested_canonical_course() {
        let mut db = database();
        for id in ["one", "two"] {
            request(
                &mut db,
                "recent-courses",
                "POST",
                json!({}),
                json!({"id":id,"name":id}),
            )
            .unwrap();
            request(
                &mut db,
                "notes",
                "POST",
                json!({}),
                json!({"courseId":id,"videoPath":"one.mp4","content":id}),
            )
            .unwrap();
            db.execute(
                "INSERT INTO lesson_practices VALUES (?, 'one.mp4', '[]', 1)",
                [id],
            )
            .unwrap();
            request(
                &mut db,
                "settings",
                "POST",
                json!({}),
                json!({"key":format!("daily-practice:{id}"),"value":{"day":[]}}),
            )
            .unwrap();
            request(&mut db, "settings", "POST", json!({}), json!({"key":format!("lesson-knowledge:{}",json!([id,"one.mp4",null])),"value":{"version":2,"createdAt":1,"overview":id,"points":[]}})).unwrap();
        }
        db.execute("INSERT INTO course_aliases VALUES ('old-one','one')", [])
            .unwrap();
        let data = request(
            &mut db,
            "learning-sources",
            "GET",
            json!({"courseId":"old-one"}),
            Value::Null,
        )
        .unwrap();
        assert_eq!(data["courseId"], "one");
        for key in ["notes", "practices", "summaries"] {
            assert!(!data[key].as_array().unwrap().is_empty());
            assert!(data[key]
                .as_array()
                .unwrap()
                .iter()
                .all(|row| row["courseId"] == "one"));
        }
        let dashboard = request(
            &mut db,
            "dashboard",
            "GET",
            json!({"courseId":"old-one"}),
            Value::Null,
        )
        .unwrap();
        assert_eq!(dashboard.as_array().unwrap().len(), 1);
        assert_eq!(dashboard[0]["course"]["id"], "one");
        assert_eq!(
            request(
                &mut db,
                "dashboard",
                "GET",
                json!({"courseId":"missing"}),
                Value::Null
            )
            .unwrap(),
            json!([])
        );
    }

    #[test]
    fn dashboard_isolates_corrupt_course_and_omits_credentials() {
        let mut db = database();
        for id in ["one", "two"] {
            request(
                &mut db,
                "recent-courses",
                "POST",
                json!({}),
                json!({"id":id,"name":id}),
            )
            .unwrap();
        }
        db.execute("INSERT INTO learning_guides(course_id,plan_json,updated_at) VALUES ('one','{broken',1)", []).unwrap();
        request(
            &mut db,
            "settings",
            "POST",
            json!({}),
            json!({"key":"ai-settings","value":{"apiKey":"private-test-key"}}),
        )
        .unwrap();
        let data = request(&mut db, "dashboard", "GET", json!({}), Value::Null).unwrap();
        let entries = data.as_array().unwrap();
        assert!(entries.iter().find(|e| e["course"]["id"] == "one").unwrap()["error"].is_string());
        assert!(entries.iter().find(|e| e["course"]["id"] == "two").unwrap()["data"].is_object());
        assert!(!data.to_string().contains("private-test-key"));
    }

    #[test]
    fn study_evidence_omits_private_text_and_uses_first_success() {
        let mut db = database();
        request(
            &mut db,
            "notes",
            "POST",
            json!({}),
            json!({"courseId":"one","videoPath":"1.mp4","content":"私密笔记"}),
        )
        .unwrap();
        db.execute("INSERT INTO lesson_practices(course_id,video_path,records_json,updated_at) VALUES ('one','1.mp4',?,1)",
            [json!([{"id":"q1","question":{"prompt":"private-question"},"attempts":[
                {"answer":"private-answer","feedback":{"result":"solid"},"at":200},
                {"feedback":{"result":"solid"},"at":100}]}]).to_string()]).unwrap();
        let data = request(&mut db, "study-evidence", "GET", json!({}), Value::Null).unwrap();
        assert_eq!(data["notes"][0]["characters"], 4);
        assert_eq!(data["practices"][0]["solidAt"], 100);
        assert!(!data.to_string().contains("私密笔记"));
        assert!(!data.to_string().contains("private-"));
    }

    #[test]
    fn empty_state_cannot_overwrite_existing_guide() {
        let mut db = database();
        save_guide(&mut db, Value::Null).unwrap();
        save_guide(&mut db, json!({"summary":"保留的学习路线"})).unwrap();
        assert!(save_guide(&mut db, Value::Null).is_err());
        let restored = request(
            &mut db,
            "guide",
            "GET",
            json!({"courseId":"one"}),
            Value::Null,
        )
        .unwrap();
        assert_eq!(restored["plan"]["summary"], "保留的学习路线");
    }

    #[test]
    fn guide_history_keeps_twenty_versions_without_metadata_churn() {
        let mut db = database();
        for revision in 0..25 {
            save_guide(&mut db, json!({"revision":revision})).unwrap();
        }
        let before: i64 = db
            .query_row("SELECT COUNT(*) FROM learning_guide_history", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(before, 20);
        db.execute(
            "UPDATE learning_guides SET metadata_json='{}', today_json='{}'",
            [],
        )
        .unwrap();
        let after: i64 = db
            .query_row("SELECT COUNT(*) FROM learning_guide_history", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(after, before);
        let newest: String = db
            .query_row(
                "SELECT plan_json FROM learning_guide_history ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&newest).unwrap()["revision"],
            23
        );
    }

    #[test]
    fn corrupt_guide_is_a_read_error_not_an_empty_plan() {
        let mut db = database();
        db.execute("INSERT INTO learning_guides(course_id,plan_json,updated_at) VALUES ('one','{broken',1)", []).unwrap();
        assert!(request(
            &mut db,
            "guide",
            "GET",
            json!({"courseId":"one"}),
            Value::Null
        )
        .is_err());
        let original: String = db
            .query_row("SELECT plan_json FROM learning_guides", [], |r| r.get(0))
            .unwrap();
        assert_eq!(original, "{broken");
    }

    #[test]
    fn stale_window_cannot_reduce_study_time_or_remove_check_in() {
        let mut db = database();
        for (seconds, checked) in [(3600, json!(123)), (0, Value::Null)] {
            request(
                &mut db,
                "check-in",
                "POST",
                json!({}),
                json!({"courseId":"one","days":[{
                "date":"2026-09-25","seconds":seconds,"targetSeconds":3600,"checkedAt":checked}]}),
            )
            .unwrap();
        }
        let saved = request(
            &mut db,
            "check-in",
            "GET",
            json!({"courseId":"one"}),
            Value::Null,
        )
        .unwrap();
        assert_eq!(saved["2026-09-25"]["seconds"], 3600.0);
        assert_eq!(saved["2026-09-25"]["checkedAt"], 123);
    }
}

use crate::{db, AppState};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Emitter, Manager, Url};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    token: String,
    reminder_id: String,
}

#[derive(Default)]
pub struct ReminderLinks(Mutex<Option<OpenRequest>>);

fn reminder_id(url: &Url) -> Option<String> {
    if url.scheme() != "aiplayer-study"
        || url.host_str() != Some("reminder")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let id = url.path().strip_prefix('/')?;
    if id.len() != 36 {
        return None;
    }
    let parsed = uuid::Uuid::parse_str(id).ok()?.hyphenated().to_string();
    (parsed == id.to_ascii_lowercase()).then_some(parsed)
}

impl ReminderLinks {
    fn receive(&self, urls: &[Url]) -> db::Result<bool> {
        let Some(id) = urls.iter().rev().find_map(reminder_id) else {
            return Ok(false);
        };
        *self.0.lock().map_err(|e| e.to_string())? = Some(OpenRequest {
            token: uuid::Uuid::new_v4().to_string(),
            reminder_id: id,
        });
        Ok(true)
    }
    fn pending(&self) -> db::Result<Option<OpenRequest>> {
        Ok(self.0.lock().map_err(|e| e.to_string())?.clone())
    }
    fn acknowledge(&self, token: &str) -> db::Result<()> {
        let mut pending = self.0.lock().map_err(|e| e.to_string())?;
        if pending.as_ref().is_some_and(|p| p.token == token) {
            *pending = None;
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub fn opened(app: &tauri::AppHandle, urls: &[Url]) {
    if !app.state::<ReminderLinks>().receive(urls).unwrap_or(false) {
        return;
    }
    // Keep a pending request as well as emitting: macOS can open URLs before the webview has mounted.
    let _ = app.emit("study-reminder-open", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn pending_reminder_link(
    state: tauri::State<ReminderLinks>,
) -> db::Result<Option<OpenRequest>> {
    state.pending()
}

#[tauri::command]
pub fn acknowledge_reminder_link(
    state: tauri::State<ReminderLinks>,
    token: String,
) -> db::Result<()> {
    state.acknowledge(&token)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    course_id: Option<String>,
    lesson: Option<String>,
    notice: String,
}

fn study_page(notice: &str) -> Destination {
    Destination {
        course_id: None,
        lesson: None,
        notice: notice.into(),
    }
}

fn resolve(conn: &mut rusqlite::Connection, id: &str) -> db::Result<Destination> {
    let id = uuid::Uuid::parse_str(id)
        .map_err(|_| "学习提醒链接无效。")?
        .hyphenated()
        .to_string();
    let data = db::request(
        conn,
        "settings",
        "GET",
        json!({"key":"study-tools"}),
        Value::Null,
    )?;
    if data.is_null() {
        return Ok(study_page("这条学习提醒已不存在，请在学习管理中查看。"));
    }
    let reminders = data["reminders"]
        .as_array()
        .ok_or("学习提醒读取失败，请重试。")?;
    let Some(reminder) = reminders.iter().find(|r| r["id"].as_str() == Some(&id)) else {
        return Ok(study_page("这条学习提醒已在软件中删除。"));
    };
    let course_id = reminder["courseId"]
        .as_str()
        .ok_or("关联课程读取失败，请重试。")?;
    if course_id.is_empty() {
        return Ok(study_page(""));
    }
    let course = db::request(conn, "library", "GET", json!({"id":course_id}), Value::Null)?;
    let Some(id) = course["id"].as_str() else {
        return Ok(study_page("关联课程已不存在，请重新选择课程。"));
    };
    // Only local records decide the destination. The external URL never supplies a path or playback time.
    Ok(Destination {
        course_id: Some(id.into()),
        lesson: course["lastVideoPath"]
            .as_str()
            .filter(|p| !p.is_empty())
            .map(str::to_owned),
        notice: String::new(),
    })
}

#[tauri::command]
pub async fn resolve_reminder_link(
    app: tauri::AppHandle,
    reminder_id: String,
) -> db::Result<Destination> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        resolve(&mut conn, &reminder_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "4c46e3b1-5a5c-42de-b95a-457053e0b375";
    fn url() -> Url {
        Url::parse(&format!("aiplayer-study://reminder/{ID}")).unwrap()
    }

    #[test]
    fn accepts_only_the_existing_reminder_url_shape() {
        assert_eq!(reminder_id(&url()).as_deref(), Some(ID));
        for raw in [
            format!("https://reminder/{ID}"),
            format!("aiplayer-study://course/{ID}"),
            format!("aiplayer-study://reminder/{ID}?course=/private"),
            format!("aiplayer-study://reminder/{ID}#x"),
            format!("aiplayer-study://user@reminder/{ID}"),
            format!("aiplayer-study://reminder:80/{ID}"),
            format!("aiplayer-study://reminder/{ID}/extra"),
            "aiplayer-study://reminder/not-an-id".into(),
        ] {
            assert!(reminder_id(&Url::parse(&raw).unwrap()).is_none(), "{raw}");
        }
    }

    #[test]
    fn startup_retains_a_request_and_old_acknowledgement_cannot_drop_a_new_click() {
        let links = ReminderLinks::default();
        links.receive(&[url()]).unwrap();
        let first = links.pending().unwrap().unwrap();
        assert_eq!(links.pending().unwrap().unwrap(), first);
        links.receive(&[url()]).unwrap();
        let second = links.pending().unwrap().unwrap();
        assert_ne!(first.token, second.token);
        links.acknowledge(&first.token).unwrap();
        assert_eq!(links.pending().unwrap().unwrap(), second);
        links.acknowledge(&second.token).unwrap();
        assert!(links.pending().unwrap().is_none());
    }

    #[test]
    fn resolves_latest_course_association_and_location_without_changing_course_state() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("schema.sql")).unwrap();
        conn.execute("INSERT INTO course_library (id,name,last_opened_at,last_video_path,status) VALUES ('course','课程',1,'第二节.mp4','paused')", []).unwrap();
        conn.execute(
            "INSERT INTO course_aliases VALUES ('old-course','course')",
            [],
        )
        .unwrap();
        let save = |conn: &mut rusqlite::Connection, course: &str| {
            db::request(
                conn,
                "settings",
                "POST",
                json!({}),
                json!({"key":"study-tools","value":{"reminders":[{"id":ID,"courseId":course}]}}),
            )
            .unwrap();
        };
        save(&mut conn, "old-course");
        let target = resolve(&mut conn, ID).unwrap();
        assert_eq!(target.course_id.as_deref(), Some("course"));
        assert_eq!(target.lesson.as_deref(), Some("第二节.mp4"));
        assert_eq!(
            db::request(
                &mut conn,
                "library",
                "GET",
                json!({"id":"course"}),
                Value::Null
            )
            .unwrap()["status"],
            "paused"
        );
        save(&mut conn, "");
        assert!(resolve(&mut conn, ID).unwrap().course_id.is_none());
        save(&mut conn, "missing");
        assert!(!resolve(&mut conn, ID).unwrap().notice.is_empty());
        db::request(
            &mut conn,
            "settings",
            "POST",
            json!({}),
            json!({"key":"study-tools","value":{"reminders":[]}}),
        )
        .unwrap();
        assert!(!resolve(&mut conn, ID).unwrap().notice.is_empty());
        db::request(
            &mut conn,
            "settings",
            "POST",
            json!({}),
            json!({"key":"study-tools","value":{"reminders":null}}),
        )
        .unwrap();
        assert!(resolve(&mut conn, ID).is_err());
    }
}

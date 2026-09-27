use crate::{db, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::Manager;

const LINKS_KEY: &str = "mac-reminders-links";
static EXPORT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderLink {
    identifier: String,
    calendar: String,
    exported_at: i64,
    #[serde(default)]
    snapshot: Option<ReminderSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ReminderSnapshot {
    title: String,
    time: String,
    weekdays: Vec<u8>,
    course_id: String,
    enabled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder() -> SavedReminder {
        SavedReminder {
            id: "4c46e3b1-5a5c-42de-b95a-457053e0b375".into(),
            title: "复习课程".into(),
            time: "20:00".into(),
            weekdays: vec![1, 3, 7],
            course_id: String::new(),
            enabled: true,
        }
    }

    #[test]
    fn validate_before_requesting_permission() {
        assert_eq!(reminder().schedule().unwrap(), (20, 0));
        for time in ["24:00", "20:60", "8:00", "no:00", "20:00:00"] {
            let mut r = reminder();
            r.time = time.into();
            assert!(r.schedule().is_err());
        }
        for days in [vec![], vec![0], vec![8], vec![1, 1]] {
            let mut r = reminder();
            r.weekdays = days;
            assert!(r.schedule().is_err());
        }
        let mut r = reminder();
        r.id = "invalid".into();
        assert!(r.schedule().is_err());
    }

    #[test]
    fn corrupt_links_cannot_silently_create_duplicate_exports() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("schema.sql")).unwrap();
        assert!(read_links(&mut db).unwrap().is_empty());
        db::request(
            &mut db,
            "settings",
            "POST",
            json!({}),
            json!({"key":LINKS_KEY, "value":{"invalid":42}}),
        )
        .unwrap();
        assert!(read_links(&mut db).is_err());
    }

    #[test]
    fn sync_snapshot_roundtrips_and_old_links_require_an_update() {
        let old: ReminderLink = serde_json::from_value(
            json!({"identifier":"system-id", "calendar":"AI Player", "exportedAt":123}),
        )
        .unwrap();
        assert!(old.snapshot.is_none());
        let mut r = reminder();
        r.weekdays = vec![7, 1, 3];
        r.enabled = false;
        r.course_id = "course".into();
        let snapshot = r.snapshot();
        assert_eq!(snapshot.weekdays, vec![1, 3, 7]);
        let link = ReminderLink {
            snapshot: Some(snapshot.clone()),
            ..old
        };
        let restored: ReminderLink =
            serde_json::from_value(serde_json::to_value(&link).unwrap()).unwrap();
        assert_eq!(restored.snapshot.unwrap(), snapshot);
    }

    #[cfg(target_os = "macos")]
    mod native_dates {
        use super::*;
        use objc2::rc::{autoreleasepool, Retained};
        use objc2_event_kit::EKRecurrenceFrequency;
        use objc2_foundation::{
            NSCalendar, NSCalendarIdentifierGregorian, NSCalendarUnit, NSDate, NSDateComponents,
            NSString, NSTimeZone,
        };

        fn calendar(zone: &str) -> Retained<NSCalendar> {
            let calendar =
                NSCalendar::calendarWithIdentifier(unsafe { NSCalendarIdentifierGregorian })
                    .unwrap();
            calendar.setTimeZone(&NSTimeZone::timeZoneWithName(&NSString::from_str(zone)).unwrap());
            calendar
        }
        fn date(
            calendar: &NSCalendar,
            year: isize,
            month: isize,
            day: isize,
            hour: isize,
            minute: isize,
        ) -> Retained<NSDate> {
            let c = NSDateComponents::new();
            c.setYear(year);
            c.setMonth(month);
            c.setDay(day);
            c.setHour(hour);
            c.setMinute(minute);
            c.setSecond(0);
            calendar.dateFromComponents(&c).unwrap()
        }
        #[test]
        fn next_due_uses_local_time_and_skips_past_occurrences() {
            autoreleasepool(|_| {
                let calendar = calendar("Asia/Shanghai");
                let now = date(&calendar, 2026, 9, 26, 21, 0);
                let next = macos::next_due(&reminder(), &calendar, &now).unwrap();
                assert_eq!(
                    next.timeIntervalSince1970(),
                    date(&calendar, 2026, 9, 27, 20, 0).timeIntervalSince1970()
                );
                let mut r = reminder();
                r.weekdays = vec![6];
                assert_eq!(
                    macos::next_due(&r, &calendar, &now)
                        .unwrap()
                        .timeIntervalSince1970(),
                    date(&calendar, 2026, 10, 3, 20, 0).timeIntervalSince1970()
                );
                r.time = "23:00".into();
                assert_eq!(
                    macos::next_due(&r, &calendar, &now)
                        .unwrap()
                        .timeIntervalSince1970(),
                    date(&calendar, 2026, 9, 26, 23, 0).timeIntervalSince1970()
                );
            });
        }
        #[test]
        fn nonexistent_dst_time_moves_to_the_next_valid_time() {
            autoreleasepool(|_| {
                let calendar = calendar("America/Los_Angeles");
                let mut r = reminder();
                r.weekdays = vec![7];
                r.time = "02:30".into();
                let next =
                    macos::next_due(&r, &calendar, &date(&calendar, 2026, 3, 8, 0, 0)).unwrap();
                let c =
                    calendar.components_fromDate(NSCalendarUnit::Day | NSCalendarUnit::Hour, &next);
                assert_eq!((c.day(), c.hour()), (8, 3));
            });
        }
        #[test]
        fn weekly_recurrence_maps_monday_and_sunday_correctly() {
            autoreleasepool(|_| unsafe {
                let rule = macos::recurrence(&reminder());
                assert_eq!(rule.frequency(), EKRecurrenceFrequency::Weekly);
                assert_eq!(rule.interval(), 1);
                let mut days: Vec<_> = rule
                    .daysOfTheWeek()
                    .unwrap()
                    .iter()
                    .map(|d| d.dayOfTheWeek().0)
                    .collect();
                days.sort();
                assert_eq!(days, vec![1, 2, 4]);
                assert!(rule.recurrenceEnd().is_none());
            });
        }

        #[test]
        fn pause_removes_all_triggers_and_resume_restores_the_new_schedule_without_saving() {
            use objc2::AnyThread;
            use objc2_event_kit::{EKEventStore, EKReminder};
            autoreleasepool(|_| unsafe {
                let store = EKEventStore::init(EKEventStore::alloc());
                let item = EKReminder::reminderWithEventStore(&store);
                let mut r = reminder();
                let now = NSDate::now();
                macos::configure(&item, &r, &now).unwrap();
                assert!(item.dueDateComponents().is_some());
                assert!(item.alarms().is_some_and(|items| items.len() == 1));
                assert!(item.recurrenceRules().is_some_and(|items| items.len() == 1));
                r.enabled = false;
                macos::configure(&item, &r, &now).unwrap();
                assert!(item.dueDateComponents().is_none());
                assert!(item.startDateComponents().is_none());
                assert!(item.alarms().is_none_or(|items| items.is_empty()));
                assert!(item.recurrenceRules().is_none_or(|items| items.is_empty()));
                assert!(!item.isCompleted());
                r.enabled = true;
                r.title = "更新后".into();
                r.time = "21:30".into();
                macos::configure(&item, &r, &now).unwrap();
                assert_eq!(item.title().to_string(), "更新后");
                assert_eq!(item.dueDateComponents().unwrap().hour(), 21);
                assert_eq!(item.dueDateComponents().unwrap().minute(), 30);
                assert!(item.alarms().is_some_and(|items| items.len() == 1));
                assert!(item.recurrenceRules().is_some_and(|items| items.len() == 1));
            });
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedReminder {
    id: String,
    title: String,
    time: String,
    weekdays: Vec<u8>,
    #[serde(default)]
    course_id: String,
    enabled: bool,
}

impl SavedReminder {
    fn snapshot(&self) -> ReminderSnapshot {
        let mut weekdays = self.weekdays.clone();
        weekdays.sort();
        ReminderSnapshot {
            title: self.title.clone(),
            time: self.time.clone(),
            weekdays,
            course_id: self.course_id.clone(),
            enabled: self.enabled,
        }
    }
    fn schedule(&self) -> db::Result<(u8, u8)> {
        let pieces: Vec<_> = self.time.split(':').collect();
        let hour = pieces.first().and_then(|v| v.parse::<u8>().ok());
        let minute = pieces.get(1).and_then(|v| v.parse::<u8>().ok());
        if pieces.len() != 2
            || self.time.len() != 5
            || !self.time.bytes().enumerate().all(|(i, c)| {
                if i == 2 {
                    c == b':'
                } else {
                    c.is_ascii_digit()
                }
            })
            || hour.is_none_or(|h| h > 23)
            || minute.is_none_or(|m| m > 59)
            || self.weekdays.is_empty()
            || self.weekdays.len() > 7
            || self.weekdays.iter().any(|d| !(1..=7).contains(d))
            || self
                .weekdays
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.weekdays.len()
            || self.title.trim().is_empty()
            || self.title.chars().count() > 80
            || uuid::Uuid::parse_str(&self.id).is_err()
        {
            return Err("提醒内容、时间或重复日无效，请先编辑并保存。".into());
        }
        Ok((hour.unwrap(), minute.unwrap()))
    }
}

fn read_links(conn: &mut rusqlite::Connection) -> db::Result<BTreeMap<String, ReminderLink>> {
    let raw = db::request(
        conn,
        "settings",
        "GET",
        json!({"key": LINKS_KEY}),
        Value::Null,
    )?;
    if raw.is_null() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_value(raw)
        .map_err(|_| "Mac 提醒事项关联记录损坏，已暂停添加以避免重复。".into())
}

#[tauri::command]
pub async fn mac_reminders_status(app: tauri::AppHandle) -> db::Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        Ok(json!({"available":cfg!(target_os = "macos"), "links":read_links(&mut conn)?}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mac_reminders_export(
    app: tauri::AppHandle,
    reminder_id: String,
) -> db::Result<ReminderLink> {
    tauri::async_runtime::spawn_blocking(move || {
        let _export = EXPORT_LOCK.lock().map_err(|e| e.to_string())?;
        let state = app.state::<AppState>();
        // Do not hold the application database lock while macOS asks for permission.
        let (reminder, mut links) = {
            let mut conn = state.db.lock().map_err(|e| e.to_string())?;
            let data = db::request(
                &mut conn,
                "settings",
                "GET",
                json!({"key":"study-tools"}),
                Value::Null,
            )?;
            let raw = data["reminders"]
                .as_array()
                .and_then(|items| {
                    items
                        .iter()
                        .find(|r| r["id"].as_str() == Some(&reminder_id))
                })
                .ok_or("学习提醒不存在，请先保存提醒。")?;
            let mut reminder: SavedReminder =
                serde_json::from_value(raw.clone()).map_err(|_| "学习提醒格式无效。")?;
            reminder.schedule()?;
            if !reminder.course_id.is_empty() {
                let course = db::request(
                    &mut conn,
                    "library",
                    "GET",
                    json!({"id":reminder.course_id}),
                    Value::Null,
                )?;
                reminder.enabled &= course["status"].as_str() == Some("active");
            }
            (reminder, read_links(&mut conn)?)
        };
        let link = platform_export(&reminder, links.get(&reminder_id))?;
        links.insert(reminder_id, link.clone());
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        db::request(
            &mut conn,
            "settings",
            "POST",
            json!({}),
            json!({"key":LINKS_KEY,"value":links}),
        )
        .map_err(|_| {
            "已写入 Mac 提醒事项，但本地关联保存失败。可以重试，系统会查找同一条提醒。".to_string()
        })?;
        Ok(link)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mac_reminders_remove(app: tauri::AppHandle, reminder_id: String) -> db::Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let _export = EXPORT_LOCK.lock().map_err(|e| e.to_string())?;
        if uuid::Uuid::parse_str(&reminder_id).is_err() {
            return Err("提醒编号无效。".into());
        }
        let state = app.state::<AppState>();
        let mut links = {
            let mut conn = state.db.lock().map_err(|e| e.to_string())?;
            read_links(&mut conn)?
        };
        let Some(link) = links.get(&reminder_id) else {
            return Ok(());
        };
        platform_remove(&reminder_id, link)?;
        links.remove(&reminder_id);
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        db::request(
            &mut conn,
            "settings",
            "POST",
            json!({}),
            json!({"key":LINKS_KEY,"value":links}),
        )
        .map_err(|_| "Mac 提醒已删除，但关联记录保存失败，请重试以完成清理。".to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
fn platform_remove(_: &str, _: &ReminderLink) -> db::Result<()> {
    Err("同步提醒事项仅支持 macOS。".into())
}

#[cfg(target_os = "macos")]
fn platform_remove(id: &str, link: &ReminderLink) -> db::Result<()> {
    objc2::rc::autoreleasepool(|_| macos::remove(id, link))
}

#[cfg(not(target_os = "macos"))]
fn platform_export(_: &SavedReminder, _: Option<&ReminderLink>) -> db::Result<ReminderLink> {
    Err("添加到提醒事项仅支持 macOS。".into())
}

#[cfg(target_os = "macos")]
fn platform_export(
    reminder: &SavedReminder,
    previous: Option<&ReminderLink>,
) -> db::Result<ReminderLink> {
    objc2::rc::autoreleasepool(|_| macos::export(reminder, previous))
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use block2::RcBlock;
    use objc2::{
        rc::Retained,
        runtime::{Bool, NSObjectProtocol},
        sel, AnyThread,
    };
    use objc2_event_kit::*;
    use objc2_foundation::{
        NSArray, NSBundle, NSCalendar, NSCalendarIdentifierGregorian, NSCalendarOptions,
        NSCalendarUnit, NSDate, NSDateComponents, NSError, NSString, NSTimeZone, NSURL,
    };
    use std::{sync::mpsc, time::Duration};

    fn permission(store: &EKEventStore) -> db::Result<()> {
        // SAFETY: EventKit calls stay on this worker; callback values are copied before crossing threads.
        unsafe {
            match EKEventStore::authorizationStatusForEntityType(EKEntityType::Reminder) {
                EKAuthorizationStatus::FullAccess => return Ok(()),
                EKAuthorizationStatus::Denied | EKAuthorizationStatus::Restricted => {
                    return Err(
                        "请在系统设置 → 隐私与安全性 → 提醒事项中允许 AI Player 访问。".into(),
                    )
                }
                _ => {}
            }
            let modern =
                store.respondsToSelector(sel!(requestFullAccessToRemindersWithCompletion:));
            let key = if modern {
                "NSRemindersFullAccessUsageDescription"
            } else {
                "NSRemindersUsageDescription"
            };
            if NSBundle::mainBundle()
                .objectForInfoDictionaryKey(&NSString::from_str(key))
                .is_none()
            {
                return Err(
                    "当前启动方式缺少提醒事项权限说明，请打开打包后的 AI Player 客户端再试。"
                        .into(),
                );
            }
            let (tx, rx) = mpsc::channel();
            let callback = RcBlock::new(move |allowed: Bool, error: *mut NSError| {
                let result = if allowed.as_bool() {
                    Ok(())
                } else if let Some(error) = error.as_ref() {
                    Err(error.localizedDescription().to_string())
                } else {
                    Err("未获提醒事项访问权限。请在系统设置中允许访问后重试。".to_string())
                };
                let _ = tx.send(result);
            });
            if modern {
                store.requestFullAccessToRemindersWithCompletion(RcBlock::as_ptr(&callback));
            } else {
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(
                    EKEntityType::Reminder,
                    RcBlock::as_ptr(&callback),
                );
            }
            rx.recv_timeout(Duration::from_secs(120))
                .map_err(|_| "等待授权超时，请完成系统授权后重试。".to_string())?
        }
    }

    fn calendar(store: &EKEventStore) -> db::Result<Retained<EKCalendar>> {
        unsafe {
            for calendar in store.calendarsForEntityType(EKEntityType::Reminder) {
                if calendar.title().to_string() == "AI Player"
                    && calendar.allowsContentModifications()
                {
                    return Ok(calendar);
                }
            }
            let default = store
                .defaultCalendarForNewReminders()
                .ok_or("请先打开 Mac 提醒事项并创建一个可写的提醒列表。")?;
            let source = default
                .source()
                .ok_or("默认提醒列表没有可用账户，请在提醒事项中检查账户设置。")?;
            let calendar =
                EKCalendar::calendarForEntityType_eventStore(EKEntityType::Reminder, store);
            calendar.setTitle(&NSString::from_str("AI Player"));
            calendar.setSource(Some(&source));
            store
                .saveCalendar_commit_error(&calendar, true)
                .map_err(|e| {
                    format!("创建 AI Player 提醒列表失败：{}", e.localizedDescription())
                })?;
            Ok(calendar)
        }
    }

    fn has_marker(reminder: &EKReminder, marker: &str) -> bool {
        unsafe {
            reminder
                .URL()
                .and_then(|u| u.absoluteString())
                .is_some_and(|u| u.to_string() == marker)
        }
    }

    fn existing(
        store: &EKEventStore,
        calendar: &EKCalendar,
        previous: Option<&ReminderLink>,
        marker: &str,
    ) -> db::Result<Option<Retained<EKReminder>>> {
        unsafe {
            if let Some(item) = previous
                .and_then(|p| store.calendarItemWithIdentifier(&NSString::from_str(&p.identifier)))
            {
                if let Ok(reminder) = item.downcast::<EKReminder>() {
                    if has_marker(&reminder, marker) && !reminder.isCompleted() {
                        return Ok(Some(reminder));
                    }
                }
            }
            // A stable marker recovers links after an interrupted save or an iCloud identifier change.
            // Search only the app's list, never the user's entire reminder library.
            let calendars = NSArray::from_slice(&[calendar]);
            let predicate = store.predicateForRemindersInCalendars(Some(&calendars));
            let (tx, rx) = mpsc::channel();
            let marker = marker.to_owned();
            let callback = RcBlock::new(move |items: *mut NSArray<EKReminder>| {
                let found = items.as_ref().map(|items| {
                    items
                        .iter()
                        .find(|r| !r.isCompleted() && has_marker(r, &marker))
                        .map(|r| r.calendarItemIdentifier().to_string())
                });
                let _ = tx.send(found);
            });
            let token = store.fetchRemindersMatchingPredicate_completion(&predicate, &callback);
            let result = rx.recv_timeout(Duration::from_secs(30));
            if result.is_err() {
                store.cancelFetchRequest(&token);
            }
            let id = result
                .map_err(|_| "读取已添加的提醒超时，请重试。")?
                .ok_or("无法读取提醒列表，已停止添加以避免重复。")?;
            Ok(id
                .and_then(|id| store.calendarItemWithIdentifier(&NSString::from_str(&id)))
                .and_then(|item| item.downcast::<EKReminder>().ok()))
        }
    }

    pub(super) fn next_due(
        reminder: &SavedReminder,
        calendar: &NSCalendar,
        now: &NSDate,
    ) -> db::Result<Retained<NSDate>> {
        let (hour, minute) = reminder.schedule()?;
        reminder
            .weekdays
            .iter()
            .filter_map(|day| {
                let components = NSDateComponents::new();
                components.setWeekday(isize::from(day % 7 + 1));
                components.setHour(isize::from(hour));
                components.setMinute(isize::from(minute));
                components.setSecond(0);
                calendar.nextDateAfterDate_matchingComponents_options(
                    now,
                    &components,
                    NSCalendarOptions::MatchNextTime | NSCalendarOptions::MatchFirst,
                )
            })
            .min_by(|a, b| {
                a.timeIntervalSince1970()
                    .total_cmp(&b.timeIntervalSince1970())
            })
            .ok_or("无法计算下一次提醒时间，请调整重复日后重试。".into())
    }

    pub(super) fn recurrence(reminder: &SavedReminder) -> Retained<EKRecurrenceRule> {
        unsafe {
            let days: Vec<_> = reminder
                .weekdays
                .iter()
                .map(|day| EKRecurrenceDayOfWeek::dayOfWeek(EKWeekday(isize::from(day % 7 + 1))))
                .collect();
            let days = NSArray::from_retained_slice(&days);
            EKRecurrenceRule::initRecurrenceWithFrequency_interval_daysOfTheWeek_daysOfTheMonth_monthsOfTheYear_weeksOfTheYear_daysOfTheYear_setPositions_end(
                EKRecurrenceRule::alloc(), EKRecurrenceFrequency::Weekly, 1, Some(&days), None, None, None, None, None, None)
        }
    }

    pub(super) fn configure(
        item: &EKReminder,
        reminder: &SavedReminder,
        now: &NSDate,
    ) -> db::Result<()> {
        unsafe {
            item.setTitle(Some(&NSString::from_str(&reminder.title)));
            if !reminder.enabled {
                // Keep the item and stable marker without leaving any notification trigger.
                item.setRecurrenceRules(None);
                item.setAlarms(None);
                item.setDueDateComponents(None);
                item.setStartDateComponents(None);
                return Ok(());
            }
            // EKReminder throws an exception for date components using a non-Gregorian calendar.
            let calendar = NSCalendar::calendarWithIdentifier(NSCalendarIdentifierGregorian)
                .ok_or("无法创建提醒日历。")?;
            calendar.setTimeZone(&NSTimeZone::localTimeZone());
            let due = next_due(reminder, &calendar, now)?;
            let components = calendar.components_fromDate(
                NSCalendarUnit::Year
                    | NSCalendarUnit::Month
                    | NSCalendarUnit::Day
                    | NSCalendarUnit::Hour
                    | NSCalendarUnit::Minute
                    | NSCalendarUnit::Second,
                &due,
            );
            components.setTimeZone(Some(&calendar.timeZone()));
            components.setCalendar(Some(&calendar));
            item.setTitle(Some(&NSString::from_str(&reminder.title)));
            item.setDueDateComponents(Some(&components));
            item.setStartDateComponents(Some(&components));
            item.setAlarms(Some(&NSArray::from_retained_slice(&[
                EKAlarm::alarmWithAbsoluteDate(&due),
            ])));
            item.setRecurrenceRules(Some(&NSArray::from_retained_slice(&[recurrence(reminder)])));
            Ok(())
        }
    }

    pub(super) fn export(
        reminder: &SavedReminder,
        previous: Option<&ReminderLink>,
    ) -> db::Result<ReminderLink> {
        unsafe {
            if !reminder.enabled && previous.is_none() {
                return Err("请先启用提醒和关联课程，再添加到 Mac 提醒事项。".into());
            }
            let store = EKEventStore::init(EKEventStore::alloc());
            permission(&store)?;
            let marker = format!("aiplayer-study://reminder/{}", reminder.id);
            let target = if reminder.enabled {
                calendar(&store)?
            } else {
                let target = previous
                    .and_then(|p| {
                        store.calendarItemWithIdentifier(&NSString::from_str(&p.identifier))
                    })
                    .and_then(|item| item.downcast::<EKReminder>().ok())
                    .filter(|r| has_marker(r, &marker))
                    .and_then(|r| r.calendar())
                    .or_else(|| {
                        store
                            .calendarsForEntityType(EKEntityType::Reminder)
                            .into_iter()
                            .find(|c| c.title().to_string() == "AI Player")
                    });
                let Some(target) = target else {
                    let mut link = previous.unwrap().clone();
                    link.snapshot = Some(reminder.snapshot());
                    link.exported_at = db::now();
                    return Ok(link);
                };
                target
            };
            let existing = existing(&store, &target, previous, &marker)?;
            if !reminder.enabled && existing.is_none() {
                let mut link = previous.unwrap().clone();
                link.snapshot = Some(reminder.snapshot());
                link.exported_at = db::now();
                return Ok(link);
            }
            // Preserve a user's chosen destination if they moved an earlier export to another list.
            let target = existing
                .as_ref()
                .and_then(|item| item.calendar())
                .unwrap_or(target);
            let item = existing.unwrap_or_else(|| EKReminder::reminderWithEventStore(&store));
            if !target.allowsContentModifications() {
                return Err("这条提醒所在的列表不可写，请在 Mac 提醒事项中调整后重试。".into());
            }
            item.setCalendar(Some(&target));
            item.setURL(NSURL::URLWithString(&NSString::from_str(&marker)).as_deref());
            configure(&item, reminder, &NSDate::now())?;
            store
                .saveReminder_commit_error(&item, true)
                .map_err(|e| format!("同步 Mac 提醒事项失败：{}", e.localizedDescription()))?;
            Ok(ReminderLink {
                identifier: item.calendarItemIdentifier().to_string(),
                calendar: target.title().to_string(),
                exported_at: db::now(),
                snapshot: Some(reminder.snapshot()),
            })
        }
    }

    pub(super) fn remove(id: &str, previous: &ReminderLink) -> db::Result<()> {
        unsafe {
            let store = EKEventStore::init(EKEventStore::alloc());
            permission(&store)?;
            let marker = format!("aiplayer-study://reminder/{id}");
            let linked = store
                .calendarItemWithIdentifier(&NSString::from_str(&previous.identifier))
                .and_then(|item| item.downcast::<EKReminder>().ok())
                .filter(|r| has_marker(r, &marker));
            let target = linked.as_ref().and_then(|r| r.calendar()).or_else(|| {
                store
                    .calendarsForEntityType(EKEntityType::Reminder)
                    .into_iter()
                    .find(|c| c.title().to_string() == "AI Player")
            });
            let Some(target) = target else {
                return Ok(());
            };
            if !target.allowsContentModifications() {
                return Err("这条提醒所在的列表不可写，请在 Mac 提醒事项中调整后重试。".into());
            }
            // Find the live occurrence; completed history stays in Reminders.
            if let Some(item) = existing(&store, &target, Some(previous), &marker)? {
                store
                    .removeReminder_commit_error(&item, true)
                    .map_err(|e| format!("删除 Mac 提醒失败：{}", e.localizedDescription()))?;
            }
            Ok(())
        }
    }
}

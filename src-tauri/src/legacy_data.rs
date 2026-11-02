use crate::db;
use rusqlite::Connection;
use std::{fs, path::Path};

/// Remove retired feature data without copying it or touching Notion/session data.
pub fn clear(directory: &Path, connection: &mut Connection) -> db::Result<()> {
    connection
        .execute_batch("PRAGMA secure_delete=ON;")
        .map_err(|e| e.to_string())?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute_batch(
            "DELETE FROM note_images;
             DELETE FROM notes;
             DELETE FROM app_settings WHERE key = 'milestones:v1' OR key GLOB 'pomodoro:*'
               OR key GLOB 'home-tasks:*' OR key = 'desktop-auto-open-companion';
             UPDATE app_settings SET value_json = json_remove(value_json,
               '$.contracts', '$.works', '$.cards', '$.flows', '$.protections', '$.preferences.flowPrompt')
             WHERE key = 'learning-management:v1' AND CASE WHEN json_valid(value_json)
               THEN json_type(value_json, '$.contracts') IS NOT NULL
                 OR json_type(value_json, '$.works') IS NOT NULL
                 OR json_type(value_json, '$.cards') IS NOT NULL
                 OR json_type(value_json, '$.flows') IS NOT NULL
                 OR json_type(value_json, '$.protections') IS NOT NULL
                 OR json_type(value_json, '$.preferences.flowPrompt') IS NOT NULL ELSE 0 END;
             UPDATE app_settings SET value_json = json_remove(value_json, '$.rewardDays')
             WHERE key = 'learning-management:v1' AND CASE WHEN json_valid(value_json)
               THEN json_type(value_json, '$.rewardDays') IS NOT NULL ELSE 0 END;
             UPDATE app_settings
             SET value_json = json_remove(value_json, '$.preferences.quietFocus', '$.preferences.shortcut')
             WHERE key = 'learning-management:v1' AND CASE WHEN json_valid(value_json)
               THEN json_type(value_json, '$.preferences') = 'object'
                 AND (json_type(value_json, '$.preferences.quietFocus') IS NOT NULL
                   OR json_type(value_json, '$.preferences.shortcut') IS NOT NULL)
               ELSE 0 END;",
        )
        .map_err(|e| e.to_string())?;
    let practices = {
        let mut statement = transaction
            .prepare("SELECT course_id, video_path, records_json FROM lesson_practices")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    for (course, path, raw) in practices {
        let Ok(mut records) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) else {
            continue;
        };
        let count = records.len();
        records.retain(|record| {
            !record["sources"]
                .as_array()
                .is_some_and(|sources| sources.iter().any(|source| source["id"] == "weak1"))
        });
        if records.len() != count {
            transaction.execute(
                "UPDATE lesson_practices SET records_json=?1 WHERE course_id=?2 AND video_path=?3",
                rusqlite::params![serde_json::to_string(&records).map_err(|e| e.to_string())?, course, path],
            ).map_err(|e| e.to_string())?;
        }
    }
    transaction.commit().map_err(|e| e.to_string())?;
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let retired = matches!(
            name.as_ref(),
            "backups"
                | "backup-settings.json"
                | "restore-pending.sqlite"
                | "ai-player.db.bak"
                | "ai-player.db-wal.bak"
                | "ai-player.db-shm.bak"
        ) || (name.starts_with("restore-rejected-") && name.ends_with(".sqlite"));
        if !retired {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        // file_type does not follow symlinks: never traverse a linked directory.
        let result = if kind.is_dir() {
            fs::remove_dir_all(entry.path())
        } else {
            fs::remove_file(entry.path())
        };
        result.map_err(|e| format!("旧功能数据清理失败（{name}）：{e}"))?;
    }
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_companion_settings_and_rewards_preserving_other_learning_records() {
        let directory = tempfile::tempdir().unwrap();
        let mut connection = db::open(&directory.path().join("ai-player.db")).unwrap();
        let original = serde_json::json!({
            "version": 1,
            "rewardDays": ["2026-10-16"],
            "cards": [{"id": "review", "reviewedAt": 123}],
            "flows": [{"id": "flow"}],
            "preferences": {"flowPrompt": true}
        });
        connection
            .execute(
                "INSERT INTO app_settings VALUES ('learning-management:v1', ?1, 123)",
                [original.to_string()],
            )
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO app_settings VALUES ('desktop-auto-open-companion','true',1);
             INSERT INTO app_settings VALUES ('ai_settings','{}',1);
             INSERT INTO app_settings VALUES ('notion-page:lesson','{}',1);
             INSERT INTO video_progress VALUES ('course','lesson',90,100,0.9,1,1);",
            )
            .unwrap();
        let mut expected = original;
        for key in ["rewardDays", "cards", "flows", "protections"] {
            expected.as_object_mut().unwrap().remove(key);
        }
        expected["preferences"]
            .as_object_mut()
            .unwrap()
            .remove("flowPrompt");
        for _ in 0..2 {
            clear(directory.path(), &mut connection).unwrap();
            let stored: String = connection
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key='learning-management:v1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&stored).unwrap(),
                expected
            );
            assert_eq!(
                connection
                    .query_row("SELECT count(*) FROM app_settings", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                3
            );
            assert_eq!(
                connection
                    .query_row("SELECT time FROM video_progress", [], |row| row
                        .get::<_, f64>(0))
                    .unwrap(),
                90.0
            );
        }
        connection
            .execute(
                "UPDATE app_settings SET value_json='invalid' WHERE key='learning-management:v1'",
                [],
            )
            .unwrap();
        clear(directory.path(), &mut connection).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key='learning-management:v1'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "invalid"
        );
        assert!(!directory.path().join("backups").exists());
    }

    #[test]
    fn removes_retired_timer_settings_and_history_preserving_learning_data() {
        let directory = tempfile::tempdir().unwrap();
        let mut connection = db::open(&directory.path().join("ai-player.db")).unwrap();
        let original = serde_json::json!({
            "version": 1,
            "flows": [{"id": "lesson-feedback", "mood": "steady"}],
            "contracts": [{"id": "course-goal"}],
            "preferences": {
                "flowPrompt": true, "quietFocus": true, "shortcut": "Study",
                "calendarTime": "20:00", "calendarDays": 30, "calendarEnabled": true
            }
        });
        connection
            .execute(
                "INSERT INTO app_settings VALUES ('learning-management:v1', ?1, 123)",
                [original.to_string()],
            )
            .unwrap();
        connection.execute_batch(
            "INSERT INTO app_settings VALUES ('pomodoro:v1','{\"settings\":{},\"timer\":{},\"focusHistory\":[{}]}',1);
             INSERT INTO app_settings VALUES ('pomodoro:v0','{}',1);
             INSERT INTO app_settings VALUES ('study-tools:v1','{\"reminders\":[{}]}',1);
             INSERT INTO check_ins (course_id,date,seconds,target_seconds,checked_at,created_at,updated_at) VALUES ('course','2026-10-15',900,900,1,1,1);
             INSERT INTO video_progress VALUES ('course','lesson',90,100,0.9,1,1);"
        ).unwrap();
        let mut expected = original;
        for key in ["contracts", "cards", "flows", "protections"] {
            expected.as_object_mut().unwrap().remove(key);
        }
        expected["preferences"]
            .as_object_mut()
            .unwrap()
            .remove("flowPrompt");
        expected["preferences"]
            .as_object_mut()
            .unwrap()
            .remove("quietFocus");
        expected["preferences"]
            .as_object_mut()
            .unwrap()
            .remove("shortcut");
        for _ in 0..2 {
            clear(directory.path(), &mut connection).unwrap();
            let (value, updated_at): (String, i64) = connection.query_row(
                "SELECT value_json, updated_at FROM app_settings WHERE key='learning-management:v1'",
                [], |row| Ok((row.get(0)?, row.get(1)?)),
            ).unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&value).unwrap(),
                expected
            );
            assert_eq!(updated_at, 123);
            assert_eq!(
                connection
                    .query_row("SELECT count(*) FROM app_settings", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                2
            );
            assert_eq!(
                connection
                    .query_row("SELECT seconds FROM check_ins", [], |row| row
                        .get::<_, f64>(0))
                    .unwrap(),
                900.0
            );
            assert_eq!(
                connection
                    .query_row("SELECT time FROM video_progress", [], |row| row
                        .get::<_, f64>(0))
                    .unwrap(),
                90.0
            );
        }
        connection
            .execute(
                "UPDATE app_settings SET value_json='invalid' WHERE key='learning-management:v1'",
                [],
            )
            .unwrap();
        clear(directory.path(), &mut connection).unwrap();
        let value: String = connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key='learning-management:v1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "invalid");
        assert!(fs::read_dir(directory.path()).unwrap().all(|entry| {
            matches!(
                entry.unwrap().file_name().to_str(),
                Some("ai-player.db" | "ai-player.db-wal" | "ai-player.db-shm")
            )
        }));
    }

    #[test]
    fn deletes_todos_contracts_and_works_without_backups_or_learning_data_loss() {
        let directory = tempfile::tempdir().unwrap();
        let mut connection = db::open(&directory.path().join("ai-player.db")).unwrap();
        let retained = serde_json::json!({
            "version": 1,
            "preferences": {"calendarTime": "08:30", "calendarDays": 14, "calendarEnabled": false}
        });
        let mut legacy = retained.clone();
        legacy["cards"] = serde_json::json!([{"id": "retired-card"}]);
        legacy["flows"] = serde_json::json!([{"id": "retired-flow"}]);
        legacy["protections"] = serde_json::json!([{"date": "2026-10-31"}]);
        legacy["preferences"]["flowPrompt"] = serde_json::json!(true);
        legacy["contracts"] = serde_json::json!([{"goal": "retired goal"}]);
        legacy["works"] = serde_json::json!([{"screenshot": "retired image"}]);
        connection
            .execute(
                "INSERT INTO app_settings VALUES ('learning-management:v1', ?1, 123)",
                [legacy.to_string()],
            )
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO app_settings VALUES ('home-tasks:v1','{\"todos\":[{}]}',1);
             INSERT INTO app_settings VALUES ('home-tasks:v0','invalid',1);
             INSERT INTO app_settings VALUES ('study-tools:v1','{\"reminders\":[{}]}',1);
             INSERT INTO video_progress VALUES ('course','lesson',90,100,0.9,1,1);
             INSERT INTO lesson_practices VALUES ('course','lesson','[{\"draft\":\"keep\"}]',1);
             INSERT INTO lesson_practices VALUES ('course','weak-lesson','[{\"id\":\"keep\",\"sources\":[{\"id\":\"s1\"}]},{\"id\":\"remove\",\"sources\":[{\"id\":\"weak1\"}]}]',1);",
            )
            .unwrap();
        for _ in 0..2 {
            clear(directory.path(), &mut connection).unwrap();
            let (value, updated_at): (String, i64) = connection.query_row(
                "SELECT value_json,updated_at FROM app_settings WHERE key='learning-management:v1'",
                [], |row| Ok((row.get(0)?, row.get(1)?)),
            ).unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&value).unwrap(),
                retained
            );
            assert_eq!(updated_at, 123);
            let drills: String = connection
                .query_row(
                    "SELECT records_json FROM lesson_practices WHERE video_path='weak-lesson'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&drills).unwrap(),
                serde_json::json!([{"id":"keep", "sources":[{"id":"s1"}]}])
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT count(*) FROM app_settings WHERE key GLOB 'home-tasks:*'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                0
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT records_json FROM lesson_practices WHERE video_path='lesson'",
                        [],
                        |row| { row.get::<_, String>(0) },
                    )
                    .unwrap(),
                "[{\"draft\":\"keep\"}]"
            );
            assert_eq!(
                connection
                    .query_row("SELECT time FROM video_progress", [], |row| row
                        .get::<_, f64>(0),)
                    .unwrap(),
                90.0
            );
        }
        assert!(fs::read_dir(directory.path()).unwrap().all(|entry| {
            matches!(
                entry.unwrap().file_name().to_str(),
                Some("ai-player.db" | "ai-player.db-wal" | "ai-player.db-shm")
            )
        }));
    }

    #[test]
    fn removes_only_retired_data_without_creating_a_backup() {
        let directory = tempfile::tempdir().unwrap();
        let mut connection = db::open(&directory.path().join("ai-player.db")).unwrap();
        connection
            .execute_batch(
                "INSERT INTO notes VALUES ('course','lesson','old note',1);
            INSERT INTO note_images VALUES ('image','course','lesson','image.png','old image',1);
            INSERT INTO app_settings VALUES ('milestones:v1','{}',1);
            INSERT INTO app_settings VALUES ('notion-page:lesson','{}',1);
            INSERT INTO app_settings VALUES ('ai_settings','{}',1);
            INSERT INTO video_progress VALUES ('course','lesson',10,100,0.1,0,1);",
            )
            .unwrap();
        fs::create_dir(directory.path().join("backups")).unwrap();
        fs::write(directory.path().join("backups/old.sqlite"), b"backup").unwrap();
        for name in [
            "backup-settings.json",
            "ai-player.db.bak",
            "restore-pending.sqlite",
            "restore-rejected-test.sqlite",
        ] {
            fs::write(directory.path().join(name), b"legacy").unwrap();
        }
        fs::create_dir(directory.path().join("models")).unwrap();
        fs::write(directory.path().join("models/keep"), b"model").unwrap();
        clear(directory.path(), &mut connection).unwrap();
        clear(directory.path(), &mut connection).unwrap();
        for table in ["notes", "note_images"] {
            assert_eq!(
                connection
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM app_settings", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT time FROM video_progress", [], |r| r
                    .get::<_, f64>(0))
                .unwrap(),
            10.0
        );
        assert!(!directory.path().join("backups").exists());
        assert!(directory.path().join("models/keep").exists());
        assert_eq!(
            fs::read_dir(directory.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().ends_with(".bak"))
                .count(),
            0
        );
    }
}

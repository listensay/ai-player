use crate::db;
use rusqlite::Connection;
use std::{fs, path::Path};

/// Remove retired local-note data without copying it or touching Notion/session data.
pub fn clear(directory: &Path, connection: &mut Connection) -> db::Result<()> {
    connection
        .execute_batch("PRAGMA secure_delete=ON;")
        .map_err(|e| e.to_string())?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute_batch(
            "DELETE FROM note_images;
             DELETE FROM notes;
             DELETE FROM app_settings WHERE key = 'milestones:v1';",
        )
        .map_err(|e| e.to_string())?;
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
        result.map_err(|e| format!("旧笔记数据清理失败（{name}）：{e}"))?;
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

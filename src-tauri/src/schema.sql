
    -- 1. 最近打开的课程
    CREATE TABLE IF NOT EXISTS recent_courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      video_count INTEGER DEFAULT 0,
      last_opened_at INTEGER NOT NULL,
      last_video_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 2. 视频观看进度
    CREATE TABLE IF NOT EXISTS video_progress (
      course_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      time REAL NOT NULL,
      duration REAL NOT NULL,
      ratio REAL NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (course_id, video_path)
    );

    -- 3. 每日学习打卡记录
    CREATE TABLE IF NOT EXISTS check_ins (
      course_id TEXT NOT NULL,
      date TEXT NOT NULL,
      seconds REAL NOT NULL DEFAULT 0,
      target_seconds INTEGER NOT NULL DEFAULT 0,
      checked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (course_id, date)
    );

    -- 4. 课节笔记 (Markdown 内容)
    CREATE TABLE IF NOT EXISTS notes (
      course_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (course_id, video_path)
    );

    -- 5. 笔记截图与图片 (Base64 存储)
    CREATE TABLE IF NOT EXISTS note_images (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      name TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- 6. AI 智能导学路线与学情反馈
    CREATE TABLE IF NOT EXISTS learning_guides (
      course_id TEXT PRIMARY KEY,
      plan_json TEXT,
      metadata_json TEXT,
      view TEXT DEFAULT 'all',
      include_optional INTEGER DEFAULT 0,
      mastery_json TEXT,
      questions_json TEXT,
      today_json TEXT,
      updated_at INTEGER NOT NULL
    );

    -- 7. 课后微练习记录
    CREATE TABLE IF NOT EXISTS lesson_practices (
      course_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      records_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (course_id, video_path)
    );

    -- 8. 应用全局配置与 AI 密钥
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  
CREATE TABLE IF NOT EXISTS course_aliases (alias_id TEXT PRIMARY KEY, course_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS course_locations (course_id TEXT PRIMARY KEY, path TEXT NOT NULL);

-- 课程库独立于最近打开列表；归档与移出最近列表均保留学习记录。
CREATE TABLE IF NOT EXISTS course_library (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, video_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at INTEGER NOT NULL, last_video_path TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  pinned INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO course_library (id,name,video_count,last_opened_at,last_video_path)
  SELECT id,name,video_count,last_opened_at,last_video_path FROM recent_courses;
CREATE TRIGGER IF NOT EXISTS library_recent_insert AFTER INSERT ON recent_courses BEGIN
  INSERT INTO course_library (id,name,video_count,last_opened_at,last_video_path)
  VALUES (NEW.id,NEW.name,NEW.video_count,NEW.last_opened_at,NEW.last_video_path)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,video_count=excluded.video_count,last_opened_at=excluded.last_opened_at,last_video_path=excluded.last_video_path;
END;
CREATE TRIGGER IF NOT EXISTS library_recent_update AFTER UPDATE ON recent_courses BEGIN
  INSERT INTO course_library (id,name,video_count,last_opened_at,last_video_path)
  VALUES (NEW.id,NEW.name,NEW.video_count,NEW.last_opened_at,NEW.last_video_path)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,video_count=excluded.video_count,last_opened_at=excluded.last_opened_at,last_video_path=excluded.last_video_path;
END;
CREATE TABLE IF NOT EXISTS daily_plan_snapshots (
  course_id TEXT NOT NULL, date TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  PRIMARY KEY(course_id,date)
);

-- 导学变更保留最近 20 个版本；元数据扫描不会挤掉路线快照。
CREATE TABLE IF NOT EXISTS learning_guide_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL,
  plan_json TEXT,
  metadata_json TEXT,
  view TEXT,
  include_optional INTEGER,
  mastery_json TEXT,
  questions_json TEXT,
  today_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS learning_guide_history_course ON learning_guide_history(course_id, id);

CREATE TRIGGER IF NOT EXISTS preserve_learning_guide_plan
BEFORE UPDATE ON learning_guides
WHEN OLD.plan_json IS NOT NULL AND OLD.plan_json != 'null'
  AND (NEW.plan_json IS NULL OR NEW.plan_json = 'null')
BEGIN
  SELECT RAISE(ABORT, '已有学习路线不能被空状态覆盖，请重新打开课程');
END;

CREATE TRIGGER IF NOT EXISTS backup_learning_guide
BEFORE UPDATE ON learning_guides
WHEN OLD.plan_json IS NOT NULL AND OLD.plan_json != 'null'
  AND (OLD.plan_json IS NOT NEW.plan_json OR OLD.mastery_json IS NOT NEW.mastery_json
    OR OLD.questions_json IS NOT NEW.questions_json)
BEGIN
  INSERT INTO learning_guide_history (course_id, plan_json, metadata_json, view, include_optional, mastery_json, questions_json, today_json, updated_at)
  VALUES (OLD.course_id, OLD.plan_json, OLD.metadata_json, OLD.view, OLD.include_optional, OLD.mastery_json, OLD.questions_json, OLD.today_json, OLD.updated_at);
  DELETE FROM learning_guide_history WHERE course_id = OLD.course_id AND id NOT IN
    (SELECT id FROM learning_guide_history WHERE course_id = OLD.course_id ORDER BY id DESC LIMIT 20);
END;

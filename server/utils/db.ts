import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

let dbInstance: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance

  const dbDir = path.resolve(process.cwd(), 'data')
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = path.join(dbDir, 'ai-player.db')
  const db = new DatabaseSync(dbPath)

  // 启用 WAL 模式提高并发性能与稳健性
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  // 初始化所有数据表
  db.exec(`
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
  `)

  dbInstance = db
  return dbInstance
}

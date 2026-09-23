import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

test('SQLite 数据库表初始化与基础配置', () => {
  // 使用独立的测试数据库
  const testDbDir = path.resolve(process.cwd(), 'data')
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true })
  }
  const testDbPath = path.join(testDbDir, 'test-ai-player.db')
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }

  const db = new DatabaseSync(testDbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  // 初始化所有 8 张数据表
  db.exec(`
    CREATE TABLE IF NOT EXISTS recent_courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      video_count INTEGER DEFAULT 0,
      last_opened_at INTEGER NOT NULL,
      last_video_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS notes (
      course_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (course_id, video_path)
    );

    CREATE TABLE IF NOT EXISTS note_images (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      name TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS lesson_practices (
      course_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      records_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (course_id, video_path)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  // 验证 8 张数据表均成功创建
  const tablesStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  const tables = tablesStmt.all().map((r) => r.name)
  assert.ok(tables.includes('recent_courses'))
  assert.ok(tables.includes('video_progress'))
  assert.ok(tables.includes('check_ins'))
  assert.ok(tables.includes('notes'))
  assert.ok(tables.includes('note_images'))
  assert.ok(tables.includes('learning_guides'))
  assert.ok(tables.includes('lesson_practices'))
  assert.ok(tables.includes('app_settings'))

  // 1. 最近课程 CRUD
  const insertCourse = db.prepare(`
    INSERT INTO recent_courses (id, name, video_count, last_opened_at, last_video_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  insertCourse.run('c1', 'Vue 3 高级教程', 12, 1700000000000, '01-intro.mp4', 1700000000000, 1700000000000)

  const getCourse = db.prepare('SELECT * FROM recent_courses WHERE id = ?')
  const course = getCourse.get('c1')
  assert.equal(course.name, 'Vue 3 高级教程')
  assert.equal(course.video_count, 12)

  // 2. 视频进度 UPSERT
  const upsertProgress = db.prepare(`
    INSERT INTO video_progress (course_id, video_path, time, duration, ratio, done, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(course_id, video_path) DO UPDATE SET
      time = excluded.time,
      duration = excluded.duration,
      ratio = excluded.ratio,
      done = excluded.done,
      updated_at = excluded.updated_at
  `)
  upsertProgress.run('c1', '01-intro.mp4', 150.5, 300, 0.5, 0, 1700000010000)
  const prog1 = db.prepare('SELECT * FROM video_progress WHERE course_id = ? AND video_path = ?').get('c1', '01-intro.mp4')
  assert.equal(prog1.time, 150.5)
  assert.equal(prog1.done, 0)

  // 更新为播放完毕
  upsertProgress.run('c1', '01-intro.mp4', 290, 300, 0.96, 1, 1700000020000)
  const prog2 = db.prepare('SELECT * FROM video_progress WHERE course_id = ? AND video_path = ?').get('c1', '01-intro.mp4')
  assert.equal(prog2.done, 1)

  // 3. 每日打卡存储
  const insertCheckIn = db.prepare(`
    INSERT INTO check_ins (course_id, date, seconds, target_seconds, checked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(course_id, date) DO UPDATE SET
      seconds = excluded.seconds,
      target_seconds = excluded.target_seconds,
      checked_at = excluded.checked_at,
      updated_at = excluded.updated_at
  `)
  insertCheckIn.run('c1', '2026-09-23', 21600, 21600, 1774320000000, 1774300000000, 1774320000000)
  const checkIn = db.prepare('SELECT * FROM check_ins WHERE course_id = ? AND date = ?').get('c1', '2026-09-23')
  assert.equal(checkIn.seconds, 21600)
  assert.equal(checkIn.checked_at, 1774320000000)

  // 4. 笔记内容与 Base64 图片存储
  const insertNote = db.prepare(`
    INSERT INTO notes (course_id, video_path, content, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(course_id, video_path) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at
  `)
  const testMarkdown = '# 学习笔记\n\n[00:15] 核心知识点梳理\n![1.78](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII= "截图")'
  insertNote.run('c1', '01-intro.mp4', testMarkdown, 1700000030000)

  const note = db.prepare('SELECT * FROM notes WHERE course_id = ? AND video_path = ?').get('c1', '01-intro.mp4')
  assert.equal(note.content, testMarkdown)

  // 5. 笔记截图 Base64 存储
  const fakeBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const insertImg = db.prepare(`
    INSERT INTO note_images (id, course_id, video_path, name, data_base64, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  insertImg.run('img-001', 'c1', '01-intro.mp4', '00-15.png', fakeBase64, 1700000035000)

  const img = db.prepare('SELECT * FROM note_images WHERE id = ?').get('img-001')
  assert.equal(img.name, '00-15.png')
  assert.equal(img.data_base64, fakeBase64)

  // 6. AI 密钥与安全配置存取
  const insertSetting = db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `)
  const aiConfig = {
    apiKey: 'sk-test-secret-key-12345678',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    targetMinutes: 360,
  }
  insertSetting.run('ai_guide_settings', JSON.stringify(aiConfig), 1700000040000)

  const settingRow = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('ai_guide_settings')
  const restoredConfig = JSON.parse(settingRow.value_json)
  assert.equal(restoredConfig.apiKey, 'sk-test-secret-key-12345678')
  assert.equal(restoredConfig.targetMinutes, 360)

  // 关闭并清理测试数据库
  db.close()
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }
  const walPath = `${testDbPath}-wal`
  const shmPath = `${testDbPath}-shm`
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
})

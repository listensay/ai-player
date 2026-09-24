import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DesktopBackend } from './browser/desktop.ts'

// e2e 夹具中的 SQLite 后端需与 src-tauri/src/db.rs 行为一致；以下用例与 db.rs 中的 Rust 测试一一对应。
test('SQLite 初始化全部数据表', async () => {
  const desktop = await DesktopBackend.create()
  try {
    const tables = desktop.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    for (const name of ['recent_courses', 'video_progress', 'check_ins', 'notes', 'note_images', 'learning_guides', 'lesson_practices', 'app_settings', 'course_aliases', 'course_locations']) {
      assert.ok(tables.includes(name), `缺少数据表 ${name}`)
    }
  } finally { await desktop.close() }
})

test('SQLite 完整保存学习记录与各类设置值', async () => {
  const desktop = await DesktopBackend.create()
  try {
    desktop.write('recent-courses', { id: 'c1', name: '中文课程', videoCount: 2, lastVideoPath: '基础/01.mp4' })
    desktop.write('progress', { courseId: 'c1', path: '基础/01.mp4', time: 24, duration: 120, ratio: 0.2, done: false })
    desktop.write('notes', { courseId: 'c1', videoPath: '基础/01.mp4', content: '笔记 [00:24]' })
    desktop.write('guide', { courseId: 'c1', plan: { summary: '路线' }, metadata: {}, includeOptional: true, mastery: {}, questions: [], today: null })
    desktop.write('practice', { courseId: 'c1', videoPath: '基础/01.mp4', records: [{ id: 'p1' }] })
    desktop.write('check-in', { courseId: 'c1', days: [{ date: '2026-09-23', seconds: 180, targetSeconds: 600, checkedAt: null }] })
    desktop.write('note-images', { courseId: 'c1', videoPath: '基础/01.mp4', name: '图.png', dataBase64: 'data:image/png;base64,AA==' })
    assert.equal(desktop.read('recent-courses', { id: 'c1' }).name, '中文课程')
    assert.equal(desktop.read('progress')['c1']['基础/01.mp4'].time, 24)
    assert.equal(desktop.read('progress')['c1']['基础/01.mp4'].done, false)
    assert.equal(desktop.read('notes', { courseId: 'c1', videoPath: '基础/01.mp4' }).content, '笔记 [00:24]')
    assert.equal(desktop.read('guide', { courseId: 'c1' }).includeOptional, true)
    assert.deepEqual(desktop.read('guide', { courseId: 'c1' }).plan, { summary: '路线' })
    assert.equal(desktop.read('practice', { courseId: 'c1' })['基础/01.mp4'][0].id, 'p1')
    assert.equal(desktop.read('check-in', { courseId: 'c1' })['2026-09-23'].seconds, 180)
    assert.equal(desktop.read('note-images', { courseId: 'c1', videoPath: '基础/01.mp4' })[0].name, '图.png')
    for (const value of ['网址', 2, false, { profiles: [{ model: 'test' }] }, null]) {
      desktop.write('settings', { key: 'test', value })
      assert.deepEqual(desktop.read('settings', { key: 'test' }), value)
    }
  } finally { await desktop.close() }
})

test('SQLite 批量写入失败时整体回滚', async () => {
  const desktop = await DesktopBackend.create()
  try {
    const reply = await desktop.handle('database_request', {
      endpoint: 'check-in', method: 'POST', query: {},
      body: { courseId: 'c1', days: [{ date: '2026-09-23', seconds: 10, targetSeconds: 600 }, {}] },
    })
    assert.equal(reply.ok, false)
    assert.match(reply.error, /缺少参数：date/)
    assert.deepEqual(desktop.read('check-in', { courseId: 'c1' }), {})
  } finally { await desktop.close() }
})

test('课程文件仅限已选择的目录，且只允许写入笔记、字幕和图片', async () => {
  const desktop = await DesktopBackend.create()
  try {
    desktop.course.paths = ['lesson.mp4']
    const root = (await desktop.handle('choose_course_folder', {})).value.path
    assert.equal((await desktop.handle('fs_stat', { root, relative: 'lesson.mp4' })).ok, true)
    assert.equal((await desktop.handle('fs_child', { root, relative: 'lesson.md', directory: false, create: true })).ok, true)
    assert.match((await desktop.handle('fs_stat', { root, relative: '../ai-player.db' })).error, /无效的课程文件路径/)
    assert.match((await desktop.handle('fs_stat', { root: desktop.dir, relative: 'ai-player.db' })).error, /未授权/)
    assert.match((await desktop.handle('fs_write', { root, relative: 'lesson.mp4', bytes: [1] })).error, /仅支持写入/)
    assert.match((await desktop.handle('fs_child', { root, relative: 'missing.md', directory: false, create: false })).error, /os error 2/)
  } finally { await desktop.close() }
})

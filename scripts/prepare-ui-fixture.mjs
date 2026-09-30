import { mkdir, copyFile, link, writeFile, readFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import ffmpeg from 'ffmpeg-static'
import { calculateDay } from '../app/utils/dailyPlan.ts'
import { localDayKey } from '../app/utils/learningFeedback.ts'
import { performanceContext } from '../tests/fixtures/performance.mjs'

// Dedicated app identifier: never seed the production or an existing test database.
if (process.platform !== 'darwin') throw Error('该原生界面样例目前使用 macOS 独立应用目录。')
const large = process.argv.includes('--large')
const data = join(homedir(), `Library/Application Support/app.aiplayer.regression${large ? '.large' : ''}`)
const database = join(data, 'ai-player.db')
try {
  await access(database)
  throw Error(`回归数据库已经存在，保留现有记录：${database}`)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const count = large ? 2000 : 8
const directory = resolve(large ? '.cache/ui-regression-large' : '.cache/ui-regression-course')
await mkdir(directory, { recursive: true })
await mkdir(data, { recursive: true })
const result = spawnSync(ffmpeg, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=5',
  '-t',
  '60',
  '-an',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  join(directory, '.sample.mp4'),
])
if (result.status !== 0) throw Error(result.stderr.toString())
const lessonPath = (index) => (large ? `chapter-${Math.floor(index / 100)}/lesson-${index}.mp4` : `lesson-${index}.mp4`)
function timestamp(ms) {
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}
const subtitle = large
  ? Array.from(
      { length: 10000 },
      (_, i) =>
        `${i + 1}\n${timestamp(i * 6)} --> ${timestamp((i + 1) * 6)}\n${i === 9999 ? '末尾检索目标' : `字幕样例 ${i + 1}`}：${'学习列表、索引与切片，并验证长文本换行。'.repeat((i % 3) + 1)}\n`,
    ).join('\n')
  : '1\n00:00:00,000 --> 00:00:30,000\n界面回归样例：学习列表、索引和切片。\n\n2\n00:00:30,000 --> 00:01:00,000\n保存笔记，再切换课程检查恢复。\n'
for (let i = 0; i < count; i++) {
  const target = join(directory, lessonPath(i))
  await mkdir(resolve(target, '..'), { recursive: true })
  try {
    await link(join(directory, '.sample.mp4'), target)
  } catch (error) {
    if (error.code !== 'EEXIST') await copyFile(join(directory, '.sample.mp4'), target)
  }
  // One long transcript is sufficient; other lessons use a small fixture.
  if (!large || i === 0) await writeFile(target.replace(/\.mp4$/, '.srt'), subtitle)
}
const date = localDayKey(),
  id = 'ui-regression-course',
  now = Date.now()
const context = performanceContext(count)
context.plan.lessons = context.plan.lessons.map((lesson, i) => ({ ...lesson, path: lessonPath(i), prerequisites: [] }))
context.plan.dailyMinutes = 5
context.plan.program.startDate = date
context.plan.program.budget = { video: 5, code: 0, project: 0, recap: 0 }
context.progress = {}
context.metadata = Object.fromEntries(context.plan.lessons.map((l) => [l.path, { duration: 60, size: 0, modified: 0 }]))
const today = calculateDay(context, date).today
today.items.forEach((item) => {
  item.done = true
})
const db = new DatabaseSync(database)
db.exec(await readFile('src-tauri/src/schema.sql', 'utf8'))
db.prepare(
  'INSERT INTO recent_courses (id,name,video_count,last_opened_at,last_video_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
).run(id, large ? '大目录与长字幕回归' : '界面回归样例', count, now, lessonPath(0), now, now)
db.prepare('INSERT INTO course_locations VALUES (?,?)').run(id, directory)
db.prepare(
  'INSERT INTO learning_guides (course_id,plan_json,metadata_json,view,include_optional,mastery_json,questions_json,today_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
).run(
  id,
  JSON.stringify(context.plan),
  JSON.stringify(context.metadata),
  'route',
  0,
  '{}',
  '[]',
  JSON.stringify(today),
  now,
)
db.prepare('INSERT INTO app_settings VALUES (?,?,?)').run(
  `daily-practice-notice:${JSON.stringify([id, date])}`,
  'true',
  now,
)
db.prepare('INSERT INTO app_settings VALUES (?,?,?)').run('desktop-auto-open-companion', 'false', now)
db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(
  id,
  lessonPath(0),
  '# 回归笔记\n\n这段内容需要在收起侧栏、切换课节后保留。',
  now,
)
db.close()
console.log(`已准备独立界面回归样例：${directory}\n数据库：${database}`)

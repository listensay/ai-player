import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import ffmpeg from 'ffmpeg-static'
import { programmingQuestion } from '../tests/fixtures/programming.mjs'

if (process.platform !== 'darwin') throw Error('该桌面样例使用 macOS 独立应用目录。')
const data = join(homedir(), 'Library/Application Support/app.aiplayer.programming-check')
const database = join(data, 'ai-player.db')
try {
  await access(database)
  throw Error('编程回归数据库已存在，保留现有记录。')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const directory = resolve('.cache/programming-course')
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
  'color=c=white:s=640x360:r=5',
  '-t',
  '60',
  '-an',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  join(directory, 'lesson-0.mp4'),
])
if (result.status !== 0) throw Error(result.stderr.toString())
const material =
  'JavaScript 数组的 filter 方法根据条件筛选元素，reduce 方法将元素依次累加为一个结果。累加时传入初始值零，可以正确处理空数组。函数通过 return 返回最终结果。'
await writeFile(join(directory, 'lesson-0.srt'), `1\n00:00:00,000 --> 00:01:00,000\n${material}\n`)
const db = new DatabaseSync(database),
  id = 'programming-check-course',
  now = Date.now()
db.exec(await readFile('src-tauri/src/schema.sql', 'utf8'))
db.prepare(
  'INSERT INTO recent_courses (id,name,video_count,last_opened_at,last_video_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
).run(id, 'JavaScript 编程练习', 1, now, 'lesson-0.mp4', now, now)
db.prepare('INSERT INTO course_locations VALUES (?,?)').run(id, directory)
db.prepare('INSERT INTO app_settings VALUES (?,?,?)').run('desktop-auto-open-companion', 'false', now)
db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(id, 'lesson-0.mp4', material, now)
const implementation = structuredClone(programmingQuestion)
implementation.programming.mode = 'implementation'
implementation.programming.starterCode = 'function sumPositive(numbers) {\n  // TODO: 实现正数求和\n}'
const choice = {
  kind: 'single-choice',
  prompt: '哪个方法可以按照条件筛选数组？',
  concepts: ['数组筛选'],
  criteria: ['选择筛选方法'],
  referenceAnswer: '`filter` 用于筛选数组。',
  sourceIds: ['s1'],
  options: [
    { id: 'A', text: 'filter' },
    { id: 'B', text: 'reduce' },
  ],
  correctOptionIds: ['A'],
}
const records = [programmingQuestion, implementation, choice].map((question, i) => ({
  id: `code-${i}`,
  groupId: 'programming-check',
  path: 'lesson-0.mp4',
  createdAt: now + 2 - i,
  scope: null,
  sources: [{ id: 's1', kind: 'note', text: material }],
  question,
  draft: question.programming?.starterCode ?? '',
  attempts: [],
}))
db.prepare('INSERT INTO lesson_practices VALUES (?,?,?,?)').run(id, 'lesson-0.mp4', JSON.stringify(records), now)
db.close()
console.log('编程练习独立样例已准备。')

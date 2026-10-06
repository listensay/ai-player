import { mkdir, readFile, copyFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import ffmpeg from 'ffmpeg-static'
import { emptyStudyRecords, addDays } from '../app/utils/studyProgram.ts'
import { localDayKey } from '../app/utils/learningFeedback.ts'

if (process.platform !== 'darwin') throw Error('此独立回归样例使用 macOS 应用目录。')
const directory = resolve('.cache/learning-management-course')
const data = join(homedir(), 'Library/Application Support/app.aiplayer.learning-management-check')
const file = join(data, 'ai-player.db')
try {
  await access(file)
  throw Error(`测试数据库已存在，保留现有记录：${file}`)
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}
await mkdir(directory, { recursive: true })
await mkdir(data, { recursive: true })
const sample = join(directory, '01-变量.mp4')
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
  sample,
])
if (result.status !== 0) throw Error(result.stderr.toString())
const paths = ['01-变量.mp4', '02-函数.mp4', '03-Todo.mp4']
for (const path of paths.slice(1)) await copyFile(sample, join(directory, path))
const id = 'learning-management-fixture',
  now = Date.now(),
  today = localDayKey(),
  yesterday = addDays(today, -1)
const plan = {
  version: 1,
  createdAt: now,
  summary: '从变量到 Todo 应用',
  profile: '通过小作品学习前端',
  dailyMinutes: 30,
  messages: [],
  modules: [
    {
      id: 'stage-one',
      title: '基础与实践',
      description: '理解变量与函数',
      practice: {
        startDay: 1,
        endDay: 21,
        goal: '实现 Todo',
        project: 'Todo 应用',
        skipWhen: '能独立完成',
        tasks: [{ id: 'todo', kind: 'project', title: '实现 Todo', instructions: '添加、完成和删除任务' }],
        checks: [{ id: 'demo', kind: 'project', text: '提交可运行作品' }],
      },
    },
  ],
  lessons: paths.map((path) => ({
    path,
    moduleId: 'stage-one',
    concepts: ['变量', '函数'],
    prerequisites: [],
    status: 'required',
    reason: '循序学习',
  })),
  program: {
    days: 21,
    startDate: addDays(today, -7),
    budget: { video: 30, code: 0, project: 15, recap: 15 },
    lightEvery: 0,
    lightMinutes: 15,
  },
}
const db = new DatabaseSync(file)
db.exec(await readFile('src-tauri/src/schema.sql', 'utf8'))
db.prepare('INSERT INTO recent_courses VALUES (?,?,?,?,?,?,?)').run(id, '前端学习实验室', 3, now, paths[0], now, now)
db.prepare('INSERT INTO course_locations VALUES (?,?)').run(id, directory)
db.prepare('INSERT INTO learning_guides VALUES (?,?,?,?,?,?,?,?,?)').run(
  id,
  JSON.stringify(plan),
  JSON.stringify(Object.fromEntries(paths.map((path) => [path, { duration: 60, size: 0, modified: 0 }]))),
  'route',
  0,
  '{}',
  '[]',
  'null',
  now,
)
db.prepare('INSERT INTO video_progress VALUES (?,?,?,?,?,?,?)').run(id, paths[0], 60, 60, 1, 1, now - 86400000)
db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(
  id,
  paths[0],
  '# 变量的作用\n\n变量给数据一个名称，让代码更容易理解。\n\n# const 与 let\n\n需要重新赋值时使用 let，否则使用 const。',
  now - 86400000,
)
const setting = (key, value) =>
  db.prepare('INSERT INTO app_settings VALUES (?,?,?)').run(key, JSON.stringify(value), now)
setting(`study-records:${id}`, emptyStudyRecords())
setting(`lesson-knowledge:${JSON.stringify([id, paths[0], null])}`, {
  version: 2,
  path: paths[0],
  fingerprint: 'fixture',
  createdAt: now - 86400000,
  overview: '变量用于表示数据。',
  points: [
    {
      id: 'p1',
      title: 'const 与 let 有什么区别？',
      text: 'const 禁止重新赋值；let 可以重新赋值。对象自身仍可被修改。',
      start: 0,
      end: 30,
    },
  ],
})
const practice = {
  id: 'practice-one',
  groupId: 'group-one',
  path: paths[0],
  createdAt: now - 86400000,
  scope: null,
  sources: [
    { id: 's1', kind: 'note', text: 'const 禁止重新赋值；let 可以重新赋值。对象属性仍可改变。', path: paths[0] },
  ],
  question: {
    kind: 'single-choice',
    prompt: '哪个声明允许重新赋值？',
    concepts: ['变量声明'],
    criteria: ['正确选择'],
    referenceAnswer: 'let 允许重新赋值。',
    sourceIds: ['s1'],
    options: [
      { id: 'a', text: 'const' },
      { id: 'b', text: 'let' },
    ],
    correctOptionIds: ['b'],
    knowledge: { category: 'concept', level: 'awareness', reason: '理解变量声明' },
  },
  draft: '["a"]',
  attempts: [
    {
      answer: '["a"]',
      feedback: {
        result: 'retry',
        strengths: [],
        gaps: ['区分 const 与 let'],
        nextStep: '回看变量声明',
        sourceIds: ['s1'],
      },
      at: now - 86400000,
    },
  ],
}
db.prepare('INSERT INTO lesson_practices VALUES (?,?,?,?)').run(id, paths[0], JSON.stringify([practice]), now)
for (let i = 1; i <= 7; i++) {
  const date = addDays(today, -i)
  db.prepare('INSERT INTO check_ins VALUES (?,?,?,?,?,?,?)').run(id, date, 600, 3600, null, now, now)
  db.prepare('INSERT INTO daily_plan_snapshots VALUES (?,?,?)').run(
    id,
    date,
    JSON.stringify({
      date,
      plannedMinutes: 60,
      initialMinutes: 60,
      capturedAt: now,
      tasks: [{ id: `${date}:lesson`, kind: 'lesson', path: paths[0], start: 0, end: 60, title: '变量', done: false }],
    }),
  )
}
setting('learning-management:v1', {
  version: 1,
  cards: [],
  rewardDays: [],
  contracts: [],
  works: [],
  protections: [],
  flows: [
    {
      id: 'flow1',
      courseId: id,
      path: paths[0],
      startedAt: now - 86400000,
      endedAt: now - 85000000,
      hour: 8,
      mood: 'deep',
    },
    {
      id: 'flow2',
      courseId: id,
      path: paths[0],
      startedAt: now - 172800000,
      endedAt: now - 171400000,
      hour: 8,
      mood: 'steady',
    },
    {
      id: 'flow3',
      courseId: id,
      path: paths[0],
      startedAt: now - 86400000,
      endedAt: now - 85000000,
      hour: 22,
      mood: 'tired',
    },
    {
      id: 'flow4',
      courseId: id,
      path: paths[0],
      startedAt: now - 172800000,
      endedAt: now - 171400000,
      hour: 22,
      mood: 'struggling',
    },
  ],
  preferences: {
    flowPrompt: true,
    quietFocus: true,
    shortcut: '',
    calendarTime: '20:00',
    calendarDays: 30,
    calendarEnabled: false,
  },
})
db.close()
console.log(`独立学习管理样例已创建：${file}（${yesterday} 的待复习卡）`)

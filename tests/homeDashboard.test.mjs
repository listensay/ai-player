import assert from 'node:assert/strict'
import { test } from 'node:test'
import { continueLearning, totalCourseStudyTime, formatHomeDuration } from '../app/utils/homeDashboard.ts'
import { createHomeTasks, parseHomeTasks, sortedHomeTasks } from '../app/utils/homeTasks.ts'
import { reviewDay } from '../app/utils/learningHome.ts'
import { performanceContext } from './fixtures/performance.mjs'

const task = (id, extra = {}) => ({ id, title: id, deadline: '', createdAt: 1, completedAt: null, ...extra })
test('短时学习显示秒数，分钟显示不向上补足', () => {
  assert.equal(formatHomeDuration(0), '0 分钟')
  assert.equal(formatHomeDuration(59.8), '59 秒')
  assert.equal(formatHomeDuration(61), '1 分钟')
  assert.equal(formatHomeDuration(3599), '59 分钟')
})
function course(id = 'course', extra = {}) {
  return {
    course: {
      id,
      name: id,
      videoCount: 3,
      status: 'active',
      lastOpenedAt: 10,
      lastVideoPath: 'lesson-0.mp4',
      ...extra,
    },
    context: performanceContext(3),
    days: {},
    snapshots: {},
    error: '',
  }
}

test('首页时长使用实际学习记录，暂停和归档课程保留历史投入', () => {
  const active = course(),
    paused = course('paused', { status: 'paused' }),
    archived = course('archived', { status: 'archived' })
  active.days = { '2026-10-17': { seconds: 720 }, '2026-10-18': { seconds: 180 } }
  archived.days = { '2026-10-18': { seconds: 60 } }
  paused.days = { '2026-10-16': { seconds: 120 } }
  active.context.records.entries = [{ date: '2026-10-18', minutes: 10 }]
  archived.context.records.entries = [{ date: '2026-10-17', minutes: 5 }]
  const courses = [active, paused, archived]
  assert.deepEqual(totalCourseStudyTime(courses, '2026-10-18'), { videoSeconds: 1080, workSeconds: 900 })
  const day = reviewDay(courses, '2026-10-18')
  assert.equal(day.videoSeconds, 240)
  assert.equal(day.workSeconds, 600)
  assert.equal(reviewDay(courses, '2026-10-19').videoSeconds, 0)
  assert.deepEqual(totalCourseStudyTime([], '2026-10-18'), { videoSeconds: 0, workSeconds: 0 })
  active.days['2026-10-19'] = { seconds: 3600 }
  active.days['invalid'] = { seconds: 3600 }
  active.context.records.entries.push({ date: '2026-10-19', minutes: 30 })
  const broken = { ...course('broken'), days: { '2026-10-18': { seconds: 3600 } }, error: '读取失败' }
  assert.deepEqual(totalCourseStudyTime([...courses, broken], '2026-10-18'), { videoSeconds: 1080, workSeconds: 900 })
})

test('继续学习跳过已完成课节，优先最近未完成进度并正确编码课程路径', () => {
  const entry = course('课程 / A')
  entry.context.progress['lesson-2.mp4'] = { time: 30, duration: 120, ratio: 0.25, done: false, updatedAt: 100 }
  const [resume] = continueLearning([entry])
  assert.equal(resume.path, 'lesson-2.mp4')
  assert.equal(resume.to.path, '/courses/%E8%AF%BE%E7%A8%8B%20%2F%20A/player')
  assert.deepEqual(resume.to.query, { lesson: 'lesson-2.mp4', autoplay: '1' })
  assert.equal(resume.percent, 33)
  assert.equal(entry.course.lastVideoPath, 'lesson-0.mp4')
})

test('继续学习按学习进度时间排序，忽略打开时间与零进度，只显示三门进行中课程', () => {
  const entries = [1, 2, 3, 4].map((n) => {
    const entry = course(String(n), { lastOpenedAt: 100 - n })
    entry.context.progress['lesson-0.mp4'].updatedAt = n
    return entry
  })
  entries[0].context.progress['lesson-1.mp4'] = { time: 0, duration: 120, ratio: 0, done: false, updatedAt: 1000 }
  const paused = course('paused', { status: 'paused', lastOpenedAt: 100 })
  const complete = course('complete', { videoCount: 1 })
  const broken = { ...course('broken'), error: '读取失败' }
  assert.deepEqual(
    continueLearning([...entries, paused, complete, broken]).map((c) => c.id),
    ['4', '3', '2'],
  )
  const unknown = course('new', { lastVideoPath: undefined })
  unknown.context = null
  assert.deepEqual(continueLearning([unknown]), [])
})

test('导入、生成计划、打开课程和只有零进度的课程不进入继续学习', () => {
  const unopened = course('unopened', { lastOpenedAt: 1000 })
  unopened.context.progress = {}
  unopened.days = { '2026-10-18': { seconds: 0, checkedAt: 1000 } }
  const opened = structuredClone(unopened)
  opened.course.id = 'opened'
  opened.context.progress['lesson-0.mp4'] = { time: 0, duration: 120, ratio: 0, done: false, updatedAt: 2000 }
  assert.deepEqual(continueLearning([unopened, opened]), [])
  opened.context.progress['lesson-0.mp4'] = { time: 1, duration: 120, ratio: 1 / 120, done: false, updatedAt: 3000 }
  assert.deepEqual(
    continueLearning([unopened, opened]).map((entry) => entry.id),
    ['opened'],
  )
})

test('继续最近学过的未完成课节，不跳到仅打开过的新课节', () => {
  const entry = course('started', { lastVideoPath: 'lesson-2.mp4' })
  entry.context.progress['lesson-1.mp4'] = { time: 30, duration: 120, ratio: 0.25, done: false, updatedAt: 100 }
  entry.context.progress['lesson-2.mp4'] = { time: 0, duration: 120, ratio: 0, done: false, updatedAt: 200 }
  assert.equal(continueLearning([entry])[0].path, 'lesson-1.mp4')
})

test('播放位置归零后仍保留有实际学习时长的课程，按最近学习日期排序', () => {
  const entries = ['2026-10-16', '2026-10-18', '2026-10-17'].map((date) => {
    const entry = course(date)
    entry.context.progress = {}
    entry.days = { [date]: { seconds: 60 } }
    return entry
  })
  assert.deepEqual(
    continueLearning(entries).map((entry) => entry.id),
    ['2026-10-18', '2026-10-17', '2026-10-16'],
  )
})

test('目标按截止日期排列，已完成项置后且不修改原记录', () => {
  const rows = [
    task('undated'),
    task('later', { deadline: '2026-10-22' }),
    task('done', { deadline: '2026-10-10', completedAt: 8 }),
    task('overdue', { deadline: '2026-10-16' }),
  ]
  assert.deepEqual(
    sortedHomeTasks(rows).map((t) => t.id),
    ['overdue', 'later', 'undated', 'done'],
  )
  assert.equal(rows[0].id, 'undated')
})

test('兼容尚无首页任务的旧数据库，拒绝无效版本、日期和重复记录', () => {
  assert.deepEqual(parseHomeTasks(null), { version: 1, todos: [], goals: [] })
  const value = { version: 1, todos: [task('one')], goals: [task('goal', { deadline: '2026-10-31' })] }
  assert.deepEqual(parseHomeTasks(value), value)
  assert.throws(() => parseHomeTasks({ ...value, version: 2 }))
  assert.throws(() => parseHomeTasks({ ...value, goals: [task('no-date')] }))
  assert.throws(() => parseHomeTasks({ ...value, goals: [task('invalid', { deadline: '2026-02-30' })] }))
  assert.throws(() => parseHomeTasks({ ...value, todos: [task('same'), task('same')] }))
})

test('快速连续添加、完成和编辑串行保存，重载后保留结果', async () => {
  let saved = null
  const writes = []
  const io = {
    read: async () => saved,
    write: async (data) => {
      saved = structuredClone(data)
      writes.push(saved)
    },
  }
  const store = createHomeTasks(io)
  await store.load()
  await Promise.all([
    store.mutate((data) => data.todos.push(task('first'))),
    store.mutate((data) => data.goals.push(task('goal', { deadline: '2026-10-25' }))),
    store.mutate((data) => {
      data.todos[0].completedAt = 10
    }),
    store.mutate((data) => {
      data.goals[0].title = '编辑后的目标'
    }),
  ])
  assert.equal(writes.length, 4)
  assert.equal(saved.todos[0].completedAt, 10)
  assert.equal(saved.goals[0].title, '编辑后的目标')
  const restarted = createHomeTasks(io)
  await restarted.load()
  assert.deepEqual(JSON.parse(JSON.stringify(restarted.state.data)), saved)
  await restarted.mutate((data) => {
    data.todos[0].completedAt = null
  })
  await restarted.mutate((data) => {
    data.goals = []
  })
  assert.equal(saved.todos[0].completedAt, null)
  assert.equal(saved.goals.length, 0)
})

test('读取或写入失败不覆盖已存任务，并能重试后继续保存', async () => {
  let failRead = true,
    failWrite = false
  let saved = { version: 1, todos: [task('existing')], goals: [] }
  const store = createHomeTasks({
    read: async () => {
      if (failRead) throw Error('read')
      return saved
    },
    write: async (data) => {
      if (failWrite) throw Error('write')
      saved = data
    },
  })
  await store.load()
  assert.equal(store.state.ready, false)
  assert.equal(await store.mutate((data) => data.todos.push(task('lost'))), false)
  failRead = false
  await store.load()
  failWrite = true
  assert.equal(await store.mutate((data) => data.todos.push(task('failed'))), false)
  assert.deepEqual(
    store.state.data.todos.map((t) => t.id),
    ['existing'],
  )
  failWrite = false
  assert.equal(await store.mutate((data) => data.todos.push(task('new'))), true)
  assert.deepEqual(
    saved.todos.map((t) => t.id),
    ['existing', 'new'],
  )
  assert.equal(store.state.saving, 0)
})

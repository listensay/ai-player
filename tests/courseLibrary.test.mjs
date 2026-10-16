import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  courseLibraryProgress,
  courseLibraryRemaining,
  courseLibraryStatus,
  searchCourseLibrary,
} from '../app/utils/courseLibrary.ts'
import { performanceContext } from './fixtures/performance.mjs'

const date = '2026-10-16'
function course(id, { status = 'active', pinned = false, done = 0, started = false, planned = true, opened = 1 } = {}) {
  const context = performanceContext(4)
  if (!planned) context.plan = null
  context.progress = Object.fromEntries(
    Array.from({ length: done }, (_, index) => [
      `lesson-${index}.mp4`,
      { time: 60, duration: 60, ratio: 1, done: true, updatedAt: 1 },
    ]),
  )
  if (started) context.progress['lesson-3.mp4'] = { time: 20, duration: 60, ratio: 1 / 3, done: false, updatedAt: 1 }
  return {
    course: { id, name: id, status, pinned, videoCount: 4, lastOpenedAt: opened },
    context,
    error: '',
    days: {},
    snapshots: {},
  }
}
function ids(entries, query = '') {
  return searchCourseLibrary(entries, query).map((entry) => entry.course.id)
}

test('搜索忽略首尾空格和大小写，覆盖进行中、暂停与归档课程', () => {
  const entries = [
    course('Python 入门', { started: true, opened: 3 }),
    course('PYTHON 实战', { status: 'paused', done: 2, opened: 2 }),
    course('Python 已归档', { status: 'archived', planned: false }),
    course('JavaScript 入门'),
  ]
  assert.deepEqual(ids(entries, ' python '), ['Python 入门', 'PYTHON 实战', 'Python 已归档'])
  assert.deepEqual(ids(entries, '不存在'), [])
})

test('课程状态显示计划暂停，恢复日期当天重新显示进行中', () => {
  const entry = course('计划暂停')
  entry.context.plan.program.calendar = {
    weekdays: [1, 2, 3, 4, 5],
    overrides: {},
    pause: { from: date, until: '2026-10-18' },
  }
  assert.equal(courseLibraryStatus(entry, date), 'paused')
  assert.deepEqual(ids([entry]), ['计划暂停'])
  assert.equal(courseLibraryStatus(entry, '2026-10-18'), 'active')
  entry.course.status = 'archived'
  assert.equal(courseLibraryStatus(entry, date), 'archived')
})

test('观看过但尚无完成课节的课程仍属于学习中，完成进度保持为零', () => {
  const entry = course('已开始', { started: true })
  assert.deepEqual(courseLibraryProgress(entry), { done: 0, percent: 0, state: 'started' })
  assert.equal(courseLibraryProgress(course('未开始')).state, 'new')
  assert.equal(courseLibraryProgress(course('全部完成', { done: 4 })).state, 'done')
})

test('读取失败的课程不显示虚假进度，仍可通过搜索找到', () => {
  const entry = course('读取失败')
  entry.error = '读取失败'
  entry.context = null
  assert.equal(courseLibraryProgress(entry), null)
  assert.deepEqual(ids([entry]), ['读取失败'])
  assert.deepEqual(ids([entry], '读取'), ['读取失败'])
})

test('置顶优先、组内按最近学习排序，清除搜索恢复完整课程且不改变原列表', () => {
  const entries = [
    course('旧课程', { opened: 1 }),
    course('最新课程', { opened: 5, status: 'archived' }),
    course('置顶课程', { opened: 2, pinned: true }),
    course('最近置顶', { opened: 4, pinned: true }),
  ]
  const original = entries.map((entry) => entry.course.id)
  assert.deepEqual(ids(entries), ['最近置顶', '置顶课程', '最新课程', '旧课程'])
  assert.deepEqual(ids(entries, '不存在'), [])
  assert.deepEqual(
    entries.map((entry) => entry.course.id),
    original,
  )
  assert.deepEqual(ids(entries, '置顶'), ['最近置顶', '置顶课程'])
  assert.deepEqual(ids(entries, ''), ['最近置顶', '置顶课程', '最新课程', '旧课程'])
})

test('空课程不算已学完，完成比例不会超过百分之百', () => {
  const empty = course('空课程')
  empty.course.videoCount = 0
  assert.deepEqual(courseLibraryProgress(empty), { done: 0, percent: 0, state: 'new' })
  const entry = course('完整课程', { done: 4 })
  entry.course.videoCount = 2
  assert.deepEqual(courseLibraryProgress(entry), { done: 2, percent: 100, state: 'done' })
})

test('课程剩余时长覆盖全部视频，扣除已完成课节和当前播放位置', () => {
  const entry = course('完整课程', { done: 1, started: true })
  entry.context.plan.lessons = entry.context.plan.lessons.slice(0, 1)
  // 剩余三节：660 秒、720 秒，以及播放器记录的 60 秒减去已播放 20 秒。
  assert.deepEqual(courseLibraryRemaining(entry), { seconds: 1420, estimated: false })
  entry.context.plan = null
  assert.deepEqual(courseLibraryRemaining(entry), { seconds: 1420, estimated: false })
})

test('重播已完成视频仍为零，播放位置超过时长时剩余时间不为负', () => {
  const entry = course('已学完', { done: 4 })
  entry.context.progress['lesson-0.mp4'].time = 5
  assert.deepEqual(courseLibraryRemaining(entry), { seconds: 0, estimated: false })
  entry.context.progress['lesson-0.mp4'].done = false
  entry.context.progress['lesson-0.mp4'].time = 70
  assert.deepEqual(courseLibraryRemaining(entry), { seconds: 0, estimated: false })
})

test('未知时长和未读取的课节纳入剩余时长，并标记估算', () => {
  const entry = course('时长不全', { planned: false })
  entry.context.metadata = {
    'lesson-0.mp4': { duration: 600, size: 1, modified: 1 },
    'lesson-1.mp4': { duration: null, size: 1, modified: 1 },
  }
  entry.context.progress['lesson-1.mp4'] = { time: 100, duration: 0, ratio: 0, done: false, updatedAt: 1 }
  assert.deepEqual(courseLibraryRemaining(entry), { seconds: 2300, estimated: true })
})

test('完全未知或读取失败时不显示虚假时长，已完成的未知时长不影响结果', () => {
  const entry = course('未知时长', { planned: false })
  entry.context.metadata = {}
  assert.equal(courseLibraryRemaining(entry), null)
  entry.course.videoCount = 0
  assert.deepEqual(courseLibraryRemaining(entry), { seconds: 0, estimated: false })
  entry.error = '读取失败'
  assert.equal(courseLibraryRemaining(entry), null)
  const completed = course('全部完成', { done: 4 })
  completed.context.metadata = {}
  for (const progress of Object.values(completed.context.progress)) progress.duration = 0
  assert.deepEqual(courseLibraryRemaining(completed), { seconds: 0, estimated: false })
})

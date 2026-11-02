import assert from 'node:assert/strict'
import { test } from 'node:test'
import { continueLearning, totalCourseStudyTime, formatHomeDuration } from '../app/utils/homeDashboard.ts'
import { reviewDay } from '../app/utils/learningHome.ts'
import { performanceContext } from './fixtures/performance.mjs'

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

test('播放器自动实践时间计入每日趋势和累计投入，不混入网课', () => {
  const entry = course()
  entry.days = {
    '2026-11-02': { seconds: 120, practiceSeconds: 30.5 },
    '2026-11-03': { seconds: 0, practiceSeconds: 60 },
  }
  entry.context.records.entries = [{ date: '2026-11-02', minutes: 1 }]
  assert.deepEqual(totalCourseStudyTime([entry], '2026-11-02'), { videoSeconds: 120, workSeconds: 90.5 })
  assert.equal(reviewDay([entry], '2026-11-02').workSeconds, 90.5)
  entry.context.progress = {}
  assert.equal(continueLearning([entry])[0].id, entry.course.id)
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

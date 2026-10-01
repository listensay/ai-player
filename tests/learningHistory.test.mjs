import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateDay, daySnapshot } from '../app/utils/dailyPlan.ts'
import { restoreCompletionHistory } from '../app/utils/learningHistory.ts'
import { masteryKey, restoreFeedback } from '../app/utils/learningFeedback.ts'
import { emptyStudyRecords } from '../app/utils/studyProgram.ts'
const yesterday = '2026-09-30',
  today = '2026-10-01'
const item = (path = 'a.mp4', end = 300) => ({
  id: `${yesterday}:lesson:${path}:0`,
  path,
  kind: 'lesson',
  start: 0,
  end,
  seconds: end,
  estimated: false,
  done: true,
})
function context() {
  return {
    plan: {
      dailyMinutes: 5,
      modules: [{ id: 'm' }],
      lessons: ['a.mp4', 'b.mp4'].map((path) => ({
        path,
        moduleId: 'm',
        status: 'required',
        concepts: [],
        prerequisites: [],
      })),
    },
    includeOptional: false,
    metadata: { 'a.mp4': { duration: 600 }, 'b.mp4': { duration: 600 } },
    progress: {},
    mastery: {},
    questions: [],
    records: emptyStudyRecords(),
    today: { date: yesterday, minutes: 5, override: null, items: [item()] },
  }
}
test('跨天沿用任务完成位置，即使播放器没有保存看完进度，也不重复已学片段', () => {
  const c = context(),
    before = structuredClone(c)
  const next = calculateDay(c, today).today
  assert.equal(next.items[0].start, 300)
  assert.equal(next.items[0].end, 600)
  assert.equal(next.items[0].done, false)
  assert.deepEqual(next.completedBeforeToday, { 'a.mp4': 300 })
  assert.deepEqual(c, before)
  next.items[0].done = true
  const tomorrow = calculateDay({ ...c, today: next }, '2026-10-02').today
  assert.equal(tomorrow.items[0].path, 'b.mp4')
  const restored = restoreFeedback(JSON.parse(JSON.stringify({ today: tomorrow })), ['a.mp4', 'b.mp4']).today
  assert.equal(calculateDay({ ...c, today: restored }, '2026-10-03').today.items[0].path, 'b.mp4')
})
test('前一天追加学完的课程也跳过，未完成、撤销完成和未来记录不会被跳过', () => {
  const c = context()
  c.today.extraDays = [{ date: today, minutes: 5 }]
  c.today.items = [item('a.mp4', 600), { ...item('b.mp4'), done: false }]
  assert.equal(calculateDay(c, today).today.items[0].path, 'b.mp4')
  c.today.items[0].done = false
  assert.equal(calculateDay(c, today).today.items[0].path, 'a.mp4')
  c.today.items[0].done = true
  c.today.date = '2026-10-02'
  assert.equal(calculateDay(c, today).today.items[0].path, 'a.mp4')
})
test('明确标记需要补学仍安排复习，历史完成不冒充今天的打卡或完成任务', () => {
  const c = context()
  c.today.items = [item('a.mp4', 600)]
  c.mastery[masteryKey('a.mp4', '本课知识')] = { path: 'a.mp4', concept: '本课知识', level: 'needs-review' }
  const next = calculateDay(c, today)
  assert.equal(next.today.items[0].kind, 'review')
  assert.equal(next.today.items[0].start, 0)
  assert.equal(next.today.items[0].done, false)
  assert.equal(next.budget.video, 5)
})
test('旧快照只在完成标记与保存的练习范围一致时恢复精确终点', () => {
  const c = context()
  const snapshots = {
    [yesterday]: { date: yesterday, tasks: [{ id: item().id, kind: 'lesson', done: true, title: 'a' }] },
  }
  const scopes = [`daily:${yesterday}:comprehensive-v1:${JSON.stringify([['a.mp4', 0, 300]])}`]
  const reset = {
    date: today,
    minutes: 5,
    override: null,
    items: [{ ...item(), id: `${today}:lesson:a.mp4:0`, done: false }],
  }
  const recovered = restoreCompletionHistory(reset, today, ['a.mp4', 'b.mp4'], snapshots, scopes)
  assert.equal(calculateDay({ ...c, today: recovered }, today).today.items[0].start, 300)
  assert.equal(restoreCompletionHistory(reset, today, ['a.mp4'], snapshots, []).completedBeforeToday, undefined)
  snapshots[yesterday].tasks[0].done = false
  assert.equal(restoreCompletionHistory(reset, today, ['a.mp4'], snapshots, scopes).completedBeforeToday, undefined)
})
test('新快照保存明确片段范围，历史恢复不依赖视频标题或时长猜测', () => {
  const c = context()
  const snapshot = daySnapshot(c, yesterday)
  assert.equal(snapshot.tasks[0].path, 'a.mp4')
  assert.equal(snapshot.tasks[0].end, 300)
  const restored = restoreCompletionHistory(null, today, ['a.mp4'], { [yesterday]: snapshot }, [])
  assert.deepEqual(restored.completedBeforeToday, { 'a.mp4': 300 })
})
test('浮点尾差不会生成几乎零时长的重复课程', () => {
  const c = context()
  c.today = null
  c.progress['a.mp4'] = { time: 600 - 1e-10, duration: 600, done: false }
  assert.equal(calculateDay(c, today).today.items[0].path, 'b.mp4')
})

test('首页与播放器使用同一份历史完成起点', async () => {
  const { restoreHomeCourse } = await import('../app/utils/learningHome.ts')
  const { performanceContext } = await import('./fixtures/performance.mjs')
  const c = performanceContext(2)
  const snapshot = {
    date: yesterday,
    capturedAt: 1,
    initialMinutes: 120,
    plannedMinutes: 120,
    tasks: [{ id: 'completed', kind: 'lesson', title: 'first', path: 'lesson-0.mp4', start: 0, end: 300, done: true }],
  }
  const restored = restoreHomeCourse(
    {
      course: { id: 'one', name: 'course', status: 'active' },
      data: {
        guide: { plan: c.plan, metadata: c.metadata, today: null },
        progress: {},
        days: {},
        records: null,
        snapshots: { [yesterday]: snapshot },
        practiceScopes: [],
      },
    },
    today,
  )
  assert.equal(restored.error, '')
  assert.equal(calculateDay(restored.context, today).today.items[0].start, 300)
})

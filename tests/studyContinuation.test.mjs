import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateDay, nextStudyDay } from '../app/utils/dailyPlan.ts'
import { masteryKey, restoreFeedback } from '../app/utils/learningFeedback.ts'
import { emptyStudyRecords } from '../app/utils/studyProgram.ts'
import { segmentPlaybackStart } from '../app/utils/segmentReminder.ts'
import { dailyPracticeItems } from '../app/utils/dailyPracticeScope.ts'

const budget = video => ({ video, code: 10, project: 0, recap: 0 })
function context(date = '2026-09-25') {
  const plan = { dailyMinutes: 30, program: { startDate: date, days: 10, budget: budget(30), lightEvery: 0, lightMinutes: 30 },
    modules: [{ id: 'm' }], lessons: ['a.mp4', 'b.mp4'].map(path => ({ path, moduleId: 'm', status: 'required', concepts: [], prerequisites: [] })) }
  const result = { plan, includeOptional: false, metadata: { 'a.mp4': { duration: 3600 }, 'b.mp4': { duration: 3600 } },
    progress: {}, mastery: {}, questions: [], records: emptyStudyRecords(), today: null }
  result.today = calculateDay(result, date).today
  return result
}
function complete(c) { c.today.items.forEach(item => { item.done = true }) }

function shortLessons() {
  const c = context(), date = c.today.date
  c.plan.lessons = Array.from({ length: 12 }, (_, i) => ({ ...c.plan.lessons[0], path: `${i + 1}.mp4` }))
  c.metadata = Object.fromEntries(c.plan.lessons.map(lesson => [lesson.path, { duration: 600 }]))
  c.today = calculateDay({ ...c, today: null }, date).today
  complete(c)
  c.today = nextStudyDay(c, date).today
  return c
}

test('追加次日课程后，播放完成但任务尚未勾选的课节仍保留并计入当天预算', () => {
  const c = shortLessons(), before = structuredClone(c.today)
  c.progress['4.mp4'] = { time: 600, duration: 600, done: true }
  c.progress['5.mp4'] = { time: 600, duration: 600, done: true }
  c.today = calculateDay(c, c.today.date).today
  assert.deepEqual(c.today.items.map(item => item.path), before.items.map(item => item.path))
  assert.deepEqual(c.today.items.filter(item => item.done).map(item => item.path), ['1.mp4', '2.mp4', '3.mp4', '4.mp4', '5.mp4'])
  assert.equal(c.today.items.reduce((sum, item) => sum + item.seconds, 0), 3600)
  assert.equal(nextStudyDay(c, c.today.date), null)
  assert.equal(before.items[3].done, false)
})

test('追加课程学到一半时刷新保留片段起止与 ID，不因观看进度不断补入后续课程', () => {
  const c = shortLessons(), before = structuredClone(c.today)
  for (const time of [120, 300, 500]) {
    c.progress['4.mp4'] = { time, duration: 600, done: false }
    c.today = calculateDay(c, c.today.date).today
    assert.deepEqual(c.today, before)
  }
  const paths = c.plan.lessons.map(lesson => lesson.path)
  const restored = restoreFeedback(JSON.parse(JSON.stringify({ today: c.today })), paths)
  assert.deepEqual(JSON.parse(JSON.stringify(calculateDay({ ...c, today: restored.today }, c.today.date).today)), before)
})

test('固定计划片段后仍可续播，补学和已完成片段从安排起点播放', () => {
  const c = context(), date = c.today.date
  complete(c)
  const item = nextStudyDay(c, date).next
  const before = structuredClone(item)
  assert.equal(segmentPlaybackStart(item, { time: 2400 }), 2400)
  assert.equal(segmentPlaybackStart(item, { time: 1200 }), 1800)
  assert.equal(segmentPlaybackStart(item, { time: 3600 }), 1800)
  assert.equal(segmentPlaybackStart(item), 1800)
  assert.equal(segmentPlaybackStart({ ...item, done: true }, { time: 2400 }), 1800)
  assert.equal(segmentPlaybackStart({ ...item, kind: 'review' }, { time: 2400 }), 1800)
  assert.deepEqual(item, before)
})

test('长课追加片段已看完时同步任务完成，继续第三天从后续片段开始', () => {
  const c = context(), date = c.today.date
  c.metadata['a.mp4'].duration = 7200
  complete(c)
  c.today = nextStudyDay(c, date).today
  const second = structuredClone(c.today.items[1])
  c.progress['a.mp4'] = { time: 3000, duration: 7200, done: false }
  c.today = calculateDay(c, date).today
  assert.deepEqual(c.today.items[1], second)
  c.progress['a.mp4'].time = 3600
  c.today = calculateDay(c, date).today
  assert.equal(c.today.items[1].done, true)
  const next = nextStudyDay(c, date)
  assert.equal(next.date, '2026-09-27')
  assert.equal(next.next.start, 3600)
  assert.equal(next.next.end, 5400)
  assert.equal(next.today.items.reduce((sum, item) => sum + item.seconds, 0), 5400)
})

test('补学任务不因历史看完记录而自动完成，调整预算仍可收缩未完成安排', () => {
  const c = shortLessons(), date = c.today.date
  c.mastery[masteryKey('4.mp4', '本课知识')] = { path: '4.mp4', concept: '本课知识', level: 'needs-review' }
  c.progress['4.mp4'] = { time: 600, duration: 600, done: true }
  c.today = calculateDay(c, date).today
  const review = c.today.items.find(item => item.kind === 'review')
  assert.ok(review)
  assert.equal(review.done, false)
  assert.deepEqual(calculateDay(c, date).today, c.today)
  const shorter = calculateDay(c, date, 5).today
  assert.equal(shorter.items.reduce((sum, item) => sum + item.seconds, 0), 2100)
  assert.equal(shorter.items.at(-1).end, 300)
})

test('当天全部课程完成后才可追加下一天，保留完成记录、连续片段和原打卡目标', () => {
  const c = context(), date = c.today.date
  assert.equal(nextStudyDay(c, date), null)
  complete(c)
  const before = structuredClone(c)
  const next = nextStudyDay(c, date)
  assert.deepEqual(c, before)
  assert.equal(next.date, '2026-09-26')
  assert.equal(next.today.date, date)
  assert.equal(next.next.path, 'a.mp4')
  assert.equal(next.next.start, 1800)
  assert.equal(next.next.end, 3600)
  assert.deepEqual(next.today.items[0], c.today.items[0])
  c.today = next.today
  assert.equal(nextStudyDay(c, date), null)
  assert.equal(calculateDay(c, date).budget.video, 30)
  assert.equal(calculateDay(c, date).budget.code, 10)
  assert.equal(c.today.minutes, 30)
  complete(c)
  const third = nextStudyDay(c, date)
  assert.equal(third.date, '2026-09-27')
  assert.equal(third.next.path, 'b.mp4')
  assert.equal(third.next.start, 0)
})

test('跳过休息和复盘日期，并采用下一日期所属阶段的看课额度', () => {
  const c = context(), date = c.today.date
  c.plan.program.calendar = { weekdays: [1, 2, 3, 4, 5], overrides: {} }
  c.plan.program.lightEvery = 4
  c.plan.modules = [{ id: 'm', practice: { startDay: 1, endDay: 3, budget: budget(30), tasks: [] } },
    { id: 'next', practice: { startDay: 4, endDay: 10, budget: budget(45), tasks: [] } }]
  c.records.activeModuleId = 'm'
  complete(c)
  const next = nextStudyDay(c, date)
  assert.equal(next.date, '2026-09-29')
  assert.equal(next.minutes, 45)
  assert.equal(next.today.items.filter(item => !item.done).reduce((sum, item) => sum + item.seconds, 0), 2700)
})

test('追加安排可恢复和刷新，已完成记录保留且不会重复追加', () => {
  const c = context(), date = c.today.date
  complete(c)
  c.today = nextStudyDay(c, date).today
  const restored = restoreFeedback(JSON.parse(JSON.stringify({ today: c.today })), ['a.mp4', 'b.mp4'])
  const refreshed = calculateDay({ ...c, today: restored.today }, date).today
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed)), c.today)
  assert.equal(nextStudyDay({ ...c, today: refreshed }, date), null)
  assert.equal(new Set(refreshed.items.map(item => item.id)).size, refreshed.items.length)
})

test('巩固范围在首次追加时保留，修改今日额度和连续追加不扩展，跨日重新计算', () => {
  const c = context(), date = c.today.date
  complete(c)
  const original = structuredClone(c.today.items)
  c.today = nextStudyDay(c, date).today
  assert.deepEqual(c.today.practiceItemIds, original.map(item => item.id))
  c.today = calculateDay(c, date, 45).today
  assert.deepEqual(dailyPracticeItems(c.today, date), original)
  complete(c)
  c.today = nextStudyDay(c, date).today
  const restored = restoreFeedback(JSON.parse(JSON.stringify({ today: c.today })), ['a.mp4', 'b.mp4']).today
  assert.deepEqual(dailyPracticeItems(restored, date).map(item => [item.path, item.start, item.end]), original.map(item => [item.path, item.start, item.end]))
  const tomorrow = calculateDay({ ...c, today: restored }, '2026-09-26').today
  assert.equal(tomorrow.practiceItemIds, undefined)
  assert.ok(dailyPracticeItems(tomorrow, tomorrow.date).some(item => !item.done))
})

test('恢复巩固范围时拒绝空值、重复或不存在的任务，不保留残缺范围', () => {
  const c = shortLessons(), date = c.today.date
  const ids = c.today.practiceItemIds
  for (const invalid of [[], [ids[0], ids[0]], [ids[0], 'missing'], [1], 'broken']) {
    const restored = restoreFeedback({ today: { ...c.today, practiceItemIds: invalid } }, c.plan.lessons.map(lesson => lesson.path)).today
    assert.equal(restored.practiceItemIds, undefined)
    assert.deepEqual(dailyPracticeItems(restored, date).map(item => item.id), ids)
  }
})

test('跨天不重复当天追加额度，已观看的后续课程从保存的进度继续', () => {
  const c = context(), date = c.today.date
  complete(c)
  c.today = nextStudyDay(c, date).today
  c.progress['a.mp4'] = { time: 3600, duration: 3600, done: true }
  const next = calculateDay(c, '2026-09-26').today
  assert.equal(next.extraDays, undefined)
  assert.equal(next.items[0].path, 'b.mp4')
  assert.equal(next.items[0].seconds, 1800)
})

test('无计划、旧日期、已停用、计划结束或课程学完时不开放下一天', () => {
  const c = context(), date = c.today.date
  complete(c)
  assert.equal(nextStudyDay({ ...c, plan: null }, date), null)
  assert.equal(nextStudyDay(c, '2026-09-26'), null)
  assert.equal(nextStudyDay({ ...c, enabled: false }, date), null)
  assert.equal(nextStudyDay({ ...c, today: { ...c.today, items: [] } }, date), null)
  c.plan.program.days = 1
  assert.equal(nextStudyDay(c, date), null)
  c.plan.program.days = 10
  c.progress = { 'a.mp4': { done: true }, 'b.mp4': { done: true } }
  assert.equal(nextStudyDay(c, date), null)
})

test('旧版无完整周期计划也可追加，跨月日期正确，暂停后只保留已完成项', () => {
  const c = context('2026-12-31'), date = c.today.date
  delete c.plan.program
  complete(c)
  const next = nextStudyDay(c, date)
  assert.equal(next.date, '2027-01-01')
  c.today = next.today
  const paused = calculateDay({ ...c, enabled: false }, date)
  assert.equal(paused.today.items.length, 1)
  assert.equal(paused.today.items[0].done, true)
  assert.equal(paused.budget.video, 0)
})

test('损坏的追加日期和额度不进入恢复后的安排', () => {
  const c = context()
  c.today.extraDays = [{ date: '2026-02-30', minutes: 30 }, { date: c.today.date, minutes: 30 },
    { date: '2026-09-26', minutes: 30 }, { date: '2026-09-26', minutes: 30 },
    { date: '2026-09-27', minutes: -1 }, { date: '2026-09-28', minutes: 1441 }, { date: '2026-09-29', minutes: 20 }]
  assert.deepEqual(restoreFeedback({ today: c.today }, ['a.mp4', 'b.mp4']).today.extraDays,
    [{ date: '2026-09-26', minutes: 30 }, { date: '2026-09-29', minutes: 20 }])
})

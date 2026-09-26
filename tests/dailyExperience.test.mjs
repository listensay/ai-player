import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adjustLearningPlan } from '../app/utils/planAdjustment.ts'
import { calculateDay, daySnapshot } from '../app/utils/dailyPlan.ts'
import { reviewDay, restoreHomeCourse } from '../app/utils/learningHome.ts'
import { setStudyTarget } from '../app/utils/checkIn.ts'
import { addDays, budgetForDay, emptyStudyRecords, parseProgram, programDay, videoFinishDay } from '../app/utils/studyProgram.ts'

const budget = (video = 30, code = 0) => ({ video, code, project: 0, recap: 0 })
const plan = () => ({ version: 1, createdAt: 1, summary: '课程学习', profile: '基础', dailyMinutes: 30, messages: [],
  program: { days: 30, startDate: '2026-09-21', budget: budget(30, 15), lightEvery: 0, lightMinutes: 30 },
  modules: [{ id: 'm', title: '基础阶段', description: '学习基础', practice: { startDay: 1, endDay: 15, goal: '完成练习', project: '作品', skipWhen: '已完成',
    tasks: [{ id: 'code', kind: 'code', title: '实现练习', instructions: '完成代码练习' }], checks: [] } }],
  lessons: ['a.mp4', 'b.mp4'].map((path, i) => ({ path, moduleId: 'm', concepts: ['概念'], prerequisites: i ? ['a.mp4'] : [], status: 'required', reason: '学习' })),
})
const context = () => ({ plan: plan(), metadata: { 'a.mp4': { duration: 3600, size: 1, modified: 1 }, 'b.mp4': { duration: 3600, size: 1, modified: 1 } },
  progress: {}, includeOptional: false, mastery: {}, questions: [], records: emptyStudyRecords(), today: null, enabled: true })

test('旧计划保持原预算，每周学习日与周末预算按本地日期键计算', () => {
  const p = parseProgram(plan().program)
  assert.deepEqual(budgetForDay(p, undefined, 6), budget(30, 15))
  p.calendar = { weekdays: [1, 2, 3, 4, 5, 6], weekendBudget: budget(60), overrides: {} }
  assert.equal(budgetForDay(p, undefined, 6).video, 60)
  assert.equal(budgetForDay(p, undefined, 7).video, 0)
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(programDay(p, '2026-09-21'), 1)
})

test('休息日清除未达标目标但不制造打卡，已有打卡保留原目标', () => {
  const day = { date: '2026-09-26', targetSeconds: 1800, seconds: 600, checkedAt: null }
  setStudyTarget(day, 0, 123)
  assert.equal(day.targetSeconds, 0); assert.equal(day.checkedAt, null); assert.equal(day.seconds, 600)
  const done = { ...day, targetSeconds: 1800, checkedAt: 100 }
  setStudyTarget(done, 0, 123)
  assert.equal(done.targetSeconds, 1800); assert.equal(done.checkedAt, 100)
})
test('拒绝非法日历数据，单日允许零预算休息', () => {
  assert.throws(() => parseProgram({ ...plan().program, calendar: { weekdays: [1, 1], overrides: {} } }))
  assert.throws(() => parseProgram({ ...plan().program, calendar: { weekdays: [1], overrides: { '2026-02-30': budget() } } }))
  const p = parseProgram({ ...plan().program, calendar: { weekdays: [], overrides: { '2026-09-26': budget(0) } } })
  assert.equal(budgetForDay(p, undefined, 6).video, 0)
})
test('休息只移除未投入任务，已完成视频与实践投入保留；预览不改变原计划', () => {
  const c = context(), date = '2026-09-26'
  c.today = calculateDay(c, date).today
  c.today.items[0].done = true
  c.records.entries = [{ id: 'work', date, moduleId: 'm', taskId: 'code', kind: 'code', title: '实现练习', instructions: '完成代码练习', minutes: 8, targetMinutes: 15, evidence: '已写一部分', done: false }]
  const next = adjustLearningPlan(c.plan, date, { kind: 'today', budget: budget(0) }, 7200)
  assert.equal(c.plan.program.calendar, undefined)
  const day = calculateDay({ ...c, plan: next.plan }, date)
  assert.equal(day.today.items.length, 1)
  assert.equal(day.today.items[0].done, true)
  assert.equal(day.work[0].minutes, 8)
  assert.equal(day.work[0].targetMinutes, 8)
  assert.equal(day.work[0].evidence, '已写一部分')
  const restored = calculateDay({ ...c, records: { ...c.records, entries: day.work } }, date)
  assert.equal(restored.work[0].targetMinutes, 15)
})
test('暂停优先于旧当天覆盖值，到恢复日期才重新安排', () => {
  const c = context(), date = '2026-09-26'
  c.today = { ...calculateDay(c, date).today, override: 120 }
  c.plan = adjustLearningPlan(c.plan, date, { kind: 'pause', until: '2026-09-29' }, 7200).plan
  assert.equal(calculateDay(c, date).budget.video, 0)
  assert.equal(calculateDay(c, '2026-09-28').today.items.length, 0)
  assert.equal(calculateDay(c, '2026-09-29').budget.video, 30)
})
test('手动恢复顺延当前阶段和结束日期，不改变课节顺序和原始计划', () => {
  const source = adjustLearningPlan(plan(), '2026-09-26', { kind: 'pause', until: null }, 7200).plan
  const result = adjustLearningPlan(source, '2026-09-29', { kind: 'resume', strategy: 'extend', limit: 120 }, 7200)
  assert.equal(result.shifted, 3)
  assert.equal(result.plan.program.days, 33)
  assert.equal(result.plan.modules[0].practice.endDay, 18)
  assert.equal(result.plan.modules[0].practice.startDay, 1)
  assert.deepEqual(result.plan.lessons, source.lessons)
  assert.equal(source.program.calendar.pause.until, null)
  assert.equal(budgetForDay(result.plan.program, undefined, 6).video, 0)
})
test('保留截止日期不会突破每日上限，容量不足返回明确缺口', () => {
  const p = plan(); p.program.days = 6; p.modules[0].practice.endDay = 6
  const result = adjustLearningPlan(p, '2026-09-26', { kind: 'replan', strategy: 'deadline', days: 0, limit: 60 }, 90 * 60)
  const b = budgetForDay(result.plan.program, undefined, 6)
  assert.equal(b.video + b.code, 60)
  assert.equal(result.shortage, 45 * 60)
  assert.equal(result.plan.program.days, 6)
})
test('调整截止日期保留轻量复盘日，不在复盘日追加新视频', () => {
  const p = plan(); p.program.lightEvery = 7
  const result = adjustLearningPlan(p, '2026-09-26', { kind: 'replan', strategy: 'deadline', days: 0, limit: 120 }, 24 * 3600)
  assert.equal(budgetForDay(result.plan.program, undefined, 7).video, 0)
})
test('归档或暂停课程不生成任务，跨日不重复昨日已完成片段', () => {
  const c = context(), date = '2026-09-26'
  assert.equal(calculateDay({ ...c, enabled: false }, date).today.items.length, 0)
  c.today = calculateDay(c, date).today; c.today.items[0].done = true
  c.progress['a.mp4'] = { time: 1800, duration: 3600, ratio: .5, done: false, updatedAt: 1 }
  const tomorrow = calculateDay(c, '2026-09-27')
  assert.equal(tomorrow.today.items[0].start, 1800)
  assert.equal(tomorrow.today.items[0].done, false)
  assert.ok(tomorrow.today.items.every(i => i.id.startsWith('2026-09-27:')))
})
test('无限暂停无法给出观看结束日期，周末排休参与预计结束时间', () => {
  const p = plan().program
  p.calendar = { weekdays: [1, 2, 3, 4, 5], overrides: {} }
  assert.equal(videoFinishDay(p, [], '2026-09-26', 1800), 8)
  p.calendar.pause = { from: '2026-09-26', until: null }
  assert.equal(videoFinishDay(p, [], '2026-09-26', 1800), Infinity)
})

test('当日已经完成的视频占用当日预算，预计日期与截止日期调整不重复分配', () => {
  const p = plan(); p.program.days = 6; p.modules[0].practice.endDay = 6
  assert.equal(videoFinishDay(p.program, [], '2026-09-26', 30 * 60, 30 * 60), 7)
  const result = adjustLearningPlan(p, '2026-09-26', { kind: 'replan', strategy: 'deadline', days: 0, limit: 45 }, 30 * 60, 30 * 60)
  assert.equal(result.shortage, 30 * 60)
})
test('跨课程周回顾累加实际投入，旧数据不补造计划完成率', () => {
  const c = context(), date = '2026-09-26'
  c.records.entries = [{ date, minutes: 10 }]
  const entries = [{ course: { id: 'one', name: '课程一' }, context: c, days: { [date]: { seconds: 1200 } }, snapshots: {}, error: '' },
    { course: { id: 'two', name: '课程二' }, context: context(), days: { [date]: { seconds: 600 } }, snapshots: { [date]: daySnapshot(context(), date) }, error: '' }]
  const row = reviewDay(entries, date)
  assert.equal(row.videoSeconds, 1800); assert.equal(row.workSeconds, 600)
  assert.equal(row.missingPlan, true)
  assert.equal(row.plannedMinutes, 45)
  assert.equal(reviewDay(entries, '2026-09-25').plannedMinutes, null)
})
test('单门课程损坏时显示错误，不将其作为零进度参与汇总', () => {
  const row = restoreHomeCourse({ course: { id: 'one', name: '课程' }, data: { guide: { plan: { broken: true } }, progress: {}, days: {}, snapshots: {}, records: null } })
  assert.equal(row.context, null); assert.ok(row.error)
  assert.equal(reviewDay([row], '2026-09-26').details.length, 0)
})

test('损坏的课节信息、观看进度和计划快照仅影响所属课程', () => {
  const raw = () => ({ course: { id: 'one', name: '课程', status: 'active' }, data: {
    guide: { metadata: context().metadata }, progress: {}, days: {}, snapshots: {}, records: null,
  } })
  const healthy = restoreHomeCourse(raw())
  assert.ok(healthy.context); assert.equal(healthy.error, '')
  const corrupt = [raw(), raw(), raw()]
  corrupt[0].data.progress['a.mp4'] = null
  corrupt[1].data.guide.metadata['a.mp4'].duration = '3600'
  corrupt[2].data.snapshots['2026-09-26'] = { ...daySnapshot(context(), '2026-09-26'), plannedMinutes: -1 }
  for (const input of corrupt) {
    const row = restoreHomeCourse(input)
    assert.equal(row.context, null); assert.ok(row.error)
    assert.equal(reviewDay([healthy, row], '2026-09-26').details.length, 0)
  }
})

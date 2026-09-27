import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deferLearningPlan } from '../app/utils/planDeferral.ts'
import { calculateDay } from '../app/utils/dailyPlan.ts'
import { budgetForDay, emptyStudyRecords, programDay } from '../app/utils/studyProgram.ts'

const budget = (video = 30, code = 0) => ({ video, code, project: 0, recap: 0 })
const stage = (id, startDay, endDay) => ({ id, title: id, description: id,
  practice: { startDay, endDay, goal: '练习', project: '作品', skipWhen: '完成', tasks: [], checks: [] } })
const context = () => ({ plan: { version: 1, createdAt: 1, summary: '课程', profile: '', messages: [], dailyMinutes: 30,
  program: { days: 10, startDate: '2026-09-21', budget: budget(), lightEvery: 0, lightMinutes: 30,
    calendar: { weekdays: [1, 2, 3, 4, 5], overrides: {} } },
  modules: [stage('past', 1, 4), stage('current', 5, 7), stage('future', 8, 10)],
  lessons: ['past', 'current', 'future'].map(id => ({ path: `${id}.mp4`, moduleId: id, concepts: [], prerequisites: [], status: 'required', reason: '' })) },
  includeOptional: false, metadata: Object.fromEntries(['past', 'current', 'future'].map(id => [`${id}.mp4`, { duration: 1800 }])),
  progress: { 'past.mp4': { time: 1800, duration: 1800, done: true, ratio: 1 } }, mastery: {}, questions: [], records: emptyStudyRecords(), today: null, enabled: true })

test('未完成安排跨周末顺延，预览纯计算且保留已完成阶段和课程顺序', () => {
  const c = context(), before = structuredClone(c)
  const result = deferLearningPlan(c, '2026-09-25', '2026-09-26')
  assert.deepEqual(c, before)
  assert.deepEqual(result.plan.modules[0], c.plan.modules[0])
  assert.deepEqual(result.plan.lessons, c.plan.lessons)
  assert.equal(result.resumeDate, '2026-09-28')
  assert.equal(result.plan.modules[1].practice.startDay, 6)
  assert.equal(result.plan.modules[1].practice.endDay, 8)
  assert.equal(result.plan.modules[2].practice.startDay, 9)
  assert.equal(result.plan.program.days, 11)
  assert.equal(calculateDay({ ...c, plan: result.plan }, '2026-09-25').today.items.length, 0)
  assert.equal(calculateDay({ ...c, plan: result.plan }, '2026-09-28').today.items[0].path, 'current.mp4')
})

test('临时休息保留已完成片段、部分观看、实践证据和原定休息日', () => {
  const c = context(), date = '2026-09-25'
  c.today = calculateDay(c, date).today
  c.today.items[0].done = true
  c.progress['current.mp4'] = { time: 1800, duration: 3600, done: false, ratio: .5 }
  c.metadata['current.mp4'].duration = 3600
  c.plan.program.budget.code = 15
  c.plan.modules[1].practice.tasks = [{ id: 'code', kind: 'code', title: '练习', instructions: '实现' }]
  c.records.entries.push({ id: 'work', date, moduleId: 'current', taskId: 'code', title: '练习', kind: 'code', instructions: '实现', minutes: 8, targetMinutes: 15, evidence: '已写部分', done: false })
  c.plan.program.calendar.overrides['2026-09-30'] = budget(0)
  const result = deferLearningPlan(c, date, '2026-09-29')
  const rest = calculateDay({ ...c, plan: result.plan }, date)
  assert.ok(rest.today.items.every(i => i.done))
  assert.equal(rest.work[0].minutes, 8); assert.equal(rest.work[0].evidence, '已写部分')
  assert.equal(calculateDay({ ...c, plan: result.plan }, '2026-09-29').today.items[0].start, 1800)
  assert.equal(budgetForDay(result.plan.program, undefined, programDay(result.plan.program, '2026-09-30')).video, 0)
  // Applying a copied prior schedule is sufficient for the existing undo flow to restore tasks.
  assert.equal(calculateDay({ ...c, plan: c.plan }, date).work[0].targetMinutes, 15)
})

test('积压的过期阶段自动补足观看时间，后续阶段一起移动', () => {
  const c = context()
  c.plan.modules[1].practice.endDay = 5
  c.plan.modules[2].practice.startDay = 6
  c.metadata['current.mp4'].duration = 3 * 1800
  const result = deferLearningPlan(c, '2026-09-28', '2026-09-29')
  assert.equal(result.plan.modules[1].practice.endDay, 11)
  assert.ok(result.plan.modules[2].practice.startDay > 11)
  assert.ok(result.plan.program.days >= result.plan.modules[2].practice.endDay)
  assert.deepEqual(result.plan.modules[0], c.plan.modules[0])
})

test('同一休息区间不可反复延长，延长休息仅增加新增日期', () => {
  const c = context()
  const first = deferLearningPlan(c, '2026-09-25', '2026-09-29')
  assert.throws(() => deferLearningPlan({ ...c, plan: first.plan }, '2026-09-25', '2026-09-29'), /已经安排休息/)
  const second = deferLearningPlan({ ...c, plan: first.plan }, '2026-09-25', '2026-09-30')
  assert.equal(second.plan.program.days, first.plan.program.days + 1)
})

test('不可行安排、暂停课程、无效日期及周期溢出不产生可应用结果', () => {
  const c = context()
  for (const date of ['2026-02-30', 'not-a-date', '2026-09-25']) assert.throws(() => deferLearningPlan(c, '2026-09-25', date))
  assert.throws(() => deferLearningPlan({ ...c, enabled: false }, '2026-09-25', '2026-09-26'))
  c.plan.program.calendar.weekdays = []
  assert.throws(() => deferLearningPlan(c, '2026-09-25', '2026-09-26'), /无法排完/)
  c.plan.program.calendar.weekdays = [1, 2, 3, 4, 5]
  c.plan.program.days = 1095
  assert.throws(() => deferLearningPlan(c, '2026-09-25', '2026-09-26'), /1095/)
})

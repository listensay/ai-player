import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateLearningPlan, orderedRoute } from '../app/utils/guide.ts'
import { checkStudyDay, setStudyTarget } from '../app/utils/checkIn.ts'
import {
  applyPractice, arrangeWork, budgetForDay, checkKey, compareRoutes, conciseLessonTitle, conciseSource, dailyBudget, emptyStudyRecords,
  inheritProgram, isLightDay, parsePracticeImport, parseProgram, programDay, restoreStudyRecords, stageForDay, stageProgress, videoFinishDay,
} from '../app/utils/studyProgram.ts'

const paths = ['01-a.mp4', '02-b.mp4', '03-c.mp4', '04-d.mp4']
const budget = (video, code, project, recap) => ({ video, code, project, recap })
const program = () => ({ days: 30, startDate: '2026-09-01', budget: budget(90, 120, 120, 30), lightEvery: 7, lightMinutes: 120 })
const stage = (startDay, endDay, extra = {}) => ({
  startDay, endDay, goal: '阶段目标', project: '阶段交付', skipWhen: '已掌握时跳过',
  tasks: [
    { id: 'c1', kind: 'code', title: '编码一', instructions: '完成编码一' },
    { id: 'c2', kind: 'code', title: '编码二', instructions: '完成编码二' },
    { id: 'p1', kind: 'project', title: '项目一', instructions: '完成项目一' },
    { id: 'r1', kind: 'recap', title: '每日复盘', instructions: '复述要点', repeat: true },
  ],
  checks: [{ id: 'e1', kind: 'exercise', text: '练习验收' }, { id: 'j1', kind: 'project', text: '项目验收' }],
  ...extra,
})
function rawPlan() {
  return { summary: '路线', profile: '画像', dailyMinutes: 90, program: program(),
    modules: [{ id: 'm1', title: '一', description: '一', practice: stage(1, 14) }, { id: 'm2', title: '二', description: '二', practice: stage(15, 30, { budget: budget(60, 60, 210, 30) }) }],
    lessons: paths.map((path, i) => ({ path, moduleId: i < 2 ? 'm1' : 'm2', concepts: ['知识'], prerequisites: [], status: 'required', reason: '原因' })) }
}

test('学习路线保留完整计划与阶段实践安排；无效或超出周期的安排只被忽略', () => {
  const plan = validateLearningPlan(rawPlan(), paths)
  assert.equal(plan.program.days, 30)
  assert.equal(plan.modules[1].practice.budget.project, 210)
  assert.equal(plan.modules[0].practice.tasks[3].repeat, true)
  const broken = rawPlan()
  broken.program.budget.video = -1
  broken.modules[0].practice.tasks[0].kind = 'unknown'
  const restored = validateLearningPlan(broken, paths)
  assert.equal(restored.program, undefined)
  assert.equal(restored.modules[0].practice, undefined)
  assert.ok(restored.modules[1].practice)
  const overflow = rawPlan()
  overflow.modules[1].practice.endDay = 40
  assert.equal(validateLearningPlan(overflow, paths).modules[1].practice, undefined)
})

test('计划日、复盘日与每日分配：复盘日只安排复盘，阶段可覆盖默认分配', () => {
  const p = program()
  const modules = validateLearningPlan(rawPlan(), paths).modules
  assert.equal(programDay(p, '2026-09-01'), 1)
  assert.equal(programDay(p, '2026-08-31'), 0)
  assert.equal(programDay(p, '2026-10-01'), 31)
  assert.equal(isLightDay(p, 7), true)
  assert.equal(isLightDay(p, 8), false)
  assert.deepEqual(budgetForDay(p, stageForDay(modules, 7)?.practice, 7), budget(0, 0, 0, 120))
  assert.deepEqual(dailyBudget(p, stageForDay(modules, 16)?.practice, '2026-09-16'), budget(60, 60, 210, 30))
  assert.deepEqual(dailyBudget(p, undefined, '2026-08-01'), budget(0, 0, 0, 0))
  assert.throws(() => parseProgram({ ...p, budget: budget(1000, 1000, 0, 0) }), /每日总投入/)
  assert.throws(() => parseProgram({ ...p, startDate: '2026-02-30' }), /开始日期/)
})

test('视频看完日按各阶段看课额度推算，复盘日不计看课', () => {
  const p = program()
  const modules = validateLearningPlan(rawPlan(), paths).modules
  // 第 1–6 天每天 90 分钟，第 7 天为复盘日。
  assert.equal(videoFinishDay(p, modules, '2026-09-01', 90 * 60 * 6), 6)
  assert.equal(videoFinishDay(p, modules, '2026-09-01', 90 * 60 * 6 + 1), 8)
  assert.equal(videoFinishDay(p, modules, '2026-09-01', 0), null)
  assert.equal(videoFinishDay({ ...p, budget: budget(0, 60, 0, 0) }, [], '2026-09-01', 60), Infinity)
})

test('今日实践按类型安排下一项任务；完成后顺延剩余时间，重复任务每天重新安排', () => {
  const s = validateLearningPlan(rawPlan(), paths).modules[0].practice
  const records = emptyStudyRecords()
  const ctx = { date: '2026-09-02', moduleId: 'm1', stage: s, budget: budget(90, 120, 120, 30) }
  let entries = arrangeWork(ctx, records)
  assert.deepEqual(entries.map(e => [e.taskId, e.targetMinutes]), [['c1', 120], ['p1', 120], ['r1', 30]])
  records.entries = entries
  entries[0].minutes = 50; entries[0].done = true
  entries = arrangeWork(ctx, records)
  assert.deepEqual(entries.filter(e => e.kind === 'code').map(e => [e.taskId, e.targetMinutes]), [['c1', 120], ['c2', 70]])
  records.entries = entries
  entries.find(e => e.taskId === 'r1').done = true
  // 次日：已完成的一次性任务不再出现，重复任务重新安排。
  const next = arrangeWork({ ...ctx, date: '2026-09-03' }, records)
  assert.deepEqual(next.map(e => e.taskId), ['c2', 'p1', 'r1'])
  // 切换阶段：已投入的记录保留，未开始的安排移除。
  records.entries = [...records.entries, ...next]
  const other = arrangeWork({ ...ctx, moduleId: 'm2' }, records)
  assert.deepEqual(other.map(e => `${e.moduleId}:${e.taskId}`), ['m1:c1', 'm1:r1', 'm2:c1', 'm2:p1', 'm2:r1'])
  // 复盘日只有复盘任务。
  const light = arrangeWork({ ...ctx, date: '2026-09-07', budget: budget(0, 0, 0, 120), light: { title: '复盘日', instructions: '回顾', minutes: 120 } }, records)
  assert.deepEqual(light.map(e => [e.taskId, e.targetMinutes]), [['light-review', 120]])
})

test('学习记录恢复时丢弃无效条目；验收通过必须有证据，要求变化后失效', () => {
  const raw = {
    entries: [
      { id: 'a', date: '2026-09-01', moduleId: 'm1', taskId: 'c1', kind: 'code', title: '编码一', instructions: '', targetMinutes: 60, minutes: 30, evidence: '', done: false },
      { id: 'a', date: '2026-09-01', moduleId: 'm1', taskId: 'c1', kind: 'code', title: '重复', instructions: '', targetMinutes: 60, minutes: 30, evidence: '', done: false },
      { id: 'b', date: '2026-13-01', moduleId: 'm1', taskId: 'c1', kind: 'code', title: '日期无效', instructions: '', targetMinutes: 60, minutes: 30, evidence: '', done: false },
      { id: 'c', date: '2026-09-01', moduleId: 'm1', taskId: 'c1', kind: 'sleep', title: '类型无效', instructions: '', targetMinutes: 60, minutes: 30, evidence: '', done: false },
    ],
    checks: { [checkKey('m1', 'e1')]: { text: '练习验收', evidence: '', passed: true, updatedAt: 1 }, [checkKey('m1', 'j1')]: { text: '旧要求', evidence: '链接', passed: true, updatedAt: 1 } },
    activeModuleId: 'm2',
    undo: { plan: { modules: [] }, includeOptional: true, view: 'route', label: 'AI 调整路线', at: 5 },
  }
  const records = restoreStudyRecords(raw)
  assert.deepEqual(records.entries.map(e => e.id), ['a'])
  assert.equal(records.checks[checkKey('m1', 'e1')].passed, false)
  assert.equal(records.activeModuleId, 'm2')
  assert.equal(records.undo.label, 'AI 调整路线')
  assert.deepEqual(restoreStudyRecords(null), emptyStudyRecords())
  const plan = validateLearningPlan(rawPlan(), paths)
  const progress = stageProgress(plan.modules[0], orderedRoute(plan.lessons, false), { [paths[0]]: { done: true } }, records)
  assert.deepEqual([progress.video, progress.exercise, progress.project], [{ done: 1, total: 2 }, { done: 0, total: 1 }, { done: 0, total: 1 }])
  records.checks[checkKey('m1', 'j1')] = { text: '项目验收', evidence: '链接', passed: true, updatedAt: 2 }
  records.checks[checkKey('m1', 'e1')] = { text: '练习验收', evidence: '测试结果', passed: true, updatedAt: 2 }
  assert.equal(stageProgress(plan.modules[0], orderedRoute(plan.lessons, false), { [paths[0]]: { done: true }, [paths[1]]: { done: true } }, records).complete, true)
})

test('导入实践安排：阶段须对应现有板块且不超出周期；AI 重排未返回时沿用原安排', () => {
  const plan = validateLearningPlan(rawPlan(), paths)
  delete plan.program
  plan.modules.forEach(m => delete m.practice)
  assert.throws(() => parsePracticeImport({ stages: { m1: stage(1, 5) } }, plan.modules), /总天数/)
  assert.throws(() => parsePracticeImport({ program: program(), stages: { m9: stage(1, 5) } }, plan.modules), /不在当前学习路线/)
  assert.throws(() => parsePracticeImport({ program: program(), stages: [{ moduleId: 'm1', ...stage(1, 40) }] }, plan.modules), /超出计划总天数/)
  const parsed = parsePracticeImport({ program: { ...program(), budget: budget(60, 0, 0, 0) }, stages: [{ moduleId: 'm1', ...stage(1, 5) }] }, plan.modules)
  applyPractice(plan, parsed)
  assert.equal(plan.dailyMinutes, 60)
  assert.equal(plan.modules[0].practice.endDay, 5)
  const next = validateLearningPlan({ ...rawPlan(), program: undefined, modules: rawPlan().modules.map(({ practice, ...m }) => m) }, paths)
  inheritProgram(next, plan)
  assert.equal(next.program.days, 30)
  assert.equal(next.modules[0].practice.endDay, 5)
  assert.equal(next.modules[1].practice, undefined)
})

test('路线对比只统计真正变化的课节', () => {
  const lesson = path => ({ path })
  const diff = compareRoutes(['a', 'b', 'c', 'd'].map(lesson), ['x', 'a', 'c', 'b'].map(lesson))
  assert.deepEqual(diff.added.map(l => l.path), ['x'])
  assert.deepEqual(diff.removed.map(l => l.path), ['d'])
  assert.deepEqual(diff.moved, ['c', 'b'])
  assert.deepEqual(compareRoutes(['a', 'b'].map(lesson), ['x', 'a', 'b'].map(lesson)).moved, [])
})

test('课节精简标题与来源说明', () => {
  assert.equal(conciseLessonTitle('07_python版本以及解释器'), 'python版本以及解释器')
  assert.equal(conciseLessonTitle('10【AI_掌柜智库（安装Docker服务）】'), '安装Docker服务')
  assert.equal(conciseLessonTitle('10【AI_掌柜智库（PDF转MD节点编码实现) 测试'), 'PDF转MD节点编码实现：测试')
  assert.equal(conciseLessonTitle('05-AI大模型之Python基础_字符串类型'), '字符串类型')
  assert.equal(conciseLessonTitle('20260327_084648'), '20260327_084648')
  assert.equal(conciseSource('01_尚硅谷大模型技术之Python基础/4.视频/day02'), 'Python基础 · Day 2')
  assert.equal(conciseSource('17_尚硅谷大模型项目之掌柜智库/4.视频/day01_环境搭建/1_vcr'), '掌柜智库 · Day 1')
  assert.equal(conciseSource(''), '')
})

test('打卡目标包含实践时间：看课与实践合计达标才打卡', () => {
  const day = { date: '2026-09-01', seconds: 3600, targetSeconds: 0, checkedAt: null }
  setStudyTarget(day, 360, 100, 3600 * 4)
  assert.equal(day.targetSeconds, 21600)
  assert.equal(day.checkedAt, null)
  checkStudyDay(day, 200, 3600 * 5)
  assert.equal(day.checkedAt, 200)
})

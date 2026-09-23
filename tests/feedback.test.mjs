import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMastery, buildTodayPlan, lessonMastery, localDayKey, masteryKey, restoreFeedback } from '../app/utils/learningFeedback.ts'
import { dependencyRisks, validateLearningPlan } from '../app/utils/guide.ts'
import { planPrompt } from '../app/utils/guideAi.ts'

const lessons = () => [
  { path: 'base.mp4', moduleId: 'm', concepts: ['反射', '注解'], prerequisites: [], status: 'required', reason: '基础' },
  { path: 'app.mp4', moduleId: 'm', concepts: ['项目'], prerequisites: ['base.mp4'], status: 'required', reason: '目标' },
]
const record = (path, concept, level) => ({ path, concept, level, updatedAt: 100 })
const feedback = (...records) => Object.fromEntries(records.map(r => [masteryKey(r.path, r.concept), r]))
const question = { id: 'q', path: 'app.mp4', seconds: 42, text: '为什么？', status: 'open', createdAt: 1, updatedAt: 1, recommendations: [], reviewedPaths: [] }

test('部分知识掌握不能代表整课掌握；补学反馈优先', () => {
  const lesson = lessons()[0]
  const mastery = feedback(record('base.mp4', '反射', 'mastered'))
  assert.equal(lessonMastery(lesson, {}), undefined)
  assert.equal(lessonMastery(lesson, mastery), 'uncertain')
  mastery[masteryKey('base.mp4', '注解')] = record('base.mp4', '注解', 'needs-review')
  assert.equal(lessonMastery(lesson, mastery), 'needs-review')
})

test('全部知识明确掌握可满足前置依赖，重新标为补学后恢复必修', () => {
  const list = lessons()
  const mastery = feedback(record('base.mp4', '反射', 'mastered'), record('base.mp4', '注解', 'mastered'))
  const mastered = applyMastery(list, mastery)
  assert.equal(list[0].status, 'skipped')
  assert.equal(dependencyRisks(list, false, mastered).length, 0)
  mastery[masteryKey('base.mp4', '反射')].level = 'needs-review'
  applyMastery(list, mastery)
  assert.equal(list[0].status, 'required')
})

test('全部掌握后的空路线可以从缓存恢复，AI 首次空路线仍被拒绝', () => {
  const value = { summary: '已掌握', profile: '学习者', dailyMinutes: 30, modules: [{ id: 'm', title: '模块', description: '课程' }],
    lessons: lessons().map(l => ({ ...l, status: 'skipped' })) }
  assert.throws(() => validateLearningPlan(value, ['base.mp4', 'app.mp4']))
  assert.equal(validateLearningPlan(value, ['base.mp4', 'app.mp4'], true).lessons.length, 2)
})

test('AI 改写知识点时保留已有反馈，不将新知识点推定为已掌握', () => {
  const list = lessons()
  list[0].concepts = ['运行时机制']
  list[0].status = 'skipped'
  applyMastery(list, feedback(record('base.mp4', '反射', 'needs-review')))
  assert.ok(list[0].concepts.includes('反射'))
  assert.equal(list[0].status, 'required')
  assert.equal(lessonMastery(list[0], feedback(record('base.mp4', '反射', 'mastered'))), 'uncertain')
})

test('今日预算拆分长课且不越过前置课，给疑问预留时间', () => {
  const today = buildTodayPlan(lessons(), { 'base.mp4': 1800, 'app.mp4': 600 }, {}, {}, [question], 15, '2026-09-23')
  assert.equal(today.items.length, 2)
  assert.deepEqual(today.items.map(i => i.kind), ['lesson', 'question'])
  assert.equal(today.items[0].end, 720)
  assert.equal(today.items[1].seconds, 180)
  assert.equal(today.items.reduce((s, i) => s + i.seconds, 0), 900)
})

test('当天完成事项不重复排入，缩短预算保留完成记录，跨天恢复每日预算', () => {
  const durations = { 'base.mp4': 1800, 'app.mp4': 600 }
  const first = buildTodayPlan(lessons(), durations, {}, {}, [], 15, '2026-09-23')
  first.items[0].done = true
  const shortened = buildTodayPlan(lessons(), durations, {}, {}, [], 5, first.date, first, 5)
  assert.equal(shortened.items.length, 1)
  assert.equal(shortened.items[0].done, true)
  const continued = buildTodayPlan(lessons(), durations, {}, {}, [], 30, first.date, first)
  assert.equal(continued.items[1].start, 900)
  assert.equal(continued.items[1].end, 1800)
  const nextDay = buildTodayPlan(lessons(), durations, { 'base.mp4': { time: 900, done: false } }, {}, [], 30, '2026-09-24', shortened)
  assert.equal(nextDay.override, null)
  assert.equal(nextDay.items[0].done, false)
  assert.equal(nextDay.items[0].start, 900)
})

test('观看完成不推断掌握；明确补学的已看课程仍安排复习', () => {
  const list = lessons(), progress = { 'base.mp4': { done: true, time: 1800 } }
  const normal = buildTodayPlan(list, {}, progress, {}, [], 30, '2026-09-23')
  assert.equal(normal.items[0].path, 'app.mp4')
  const review = buildTodayPlan(list, {}, progress, feedback(record('base.mp4', '反射', 'needs-review')), [], 15, '2026-09-23')
  assert.equal(review.items[0].kind, 'review')
  assert.equal(review.items[0].start, 0)
  assert.equal(review.items[0].estimated, true)
  assert.equal(progress['base.mp4'].done, true)
})

test('已解决疑问不排入今日；仍不理解优先，不修改输入记录', () => {
  const qs = [{ ...question, id: 'a', status: 'resolved' }, { ...question, id: 'b' }, { ...question, id: 'c', status: 'still-confused' }]
  const today = buildTodayPlan([], {}, {}, {}, qs, 5, '2026-09-23')
  assert.equal(today.items[0].questionId, 'c')
  assert.equal(today.items[0].seconds, 300)
  assert.equal(qs[2].status, 'still-confused')
})

test('旧缓存向前兼容；无效反馈和不存在的课程不会恢复', () => {
  assert.deepEqual(restoreFeedback({}, []), { mastery: {}, questions: [], today: null })
  const mastery = feedback(record('base.mp4', '反射', 'mastered'), record('missing.mp4', '注解', 'uncertain'))
  const raw = { mastery, questions: [question, question, { ...question, id: 'bad', seconds: -1 }] }
  const restored = restoreFeedback(raw, ['base.mp4', 'app.mp4'])
  assert.equal(Object.keys(restored.mastery).length, 1)
  assert.equal(restored.questions.length, 1)
  assert.equal(restored.questions[0].seconds, 42)
})

test('掌握反馈和疑问状态进入 AI 调整上下文；本地日期不使用 UTC 截断', () => {
  const prompt = planPrompt([], '调整路线', 30, null, { mastery: [record('base.mp4', '反射', 'needs-review')], questions: [question] })[0].content
  assert.ok(prompt.includes('needs-review'))
  assert.ok(prompt.includes('为什么？'))
  assert.equal(localDayKey(new Date(2026, 8, 24, 0, 1)), '2026-09-24')
})

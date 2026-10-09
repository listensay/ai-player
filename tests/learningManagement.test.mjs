import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest=async()=>null;export const flushDatabaseWrites=async()=>{}',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const {
  emptyLearningManagement,
  parseLearningManagement,
  collectReviewCards,
  mergeReviewCards,
  rateReview,
  dueReviewCards,
  addProtection,
  canMakeUp,
  protectedStreak,
  parseLearningSources,
} = await import('../app/utils/learningManagement.ts')
const {
  adaptivePlan,
  planHealth,
  learningCalendar,
  knowledgeDocument,
  graduationReport,
  flowInsights,
  foldCalendarLine,
  learningContractDraft,
} = await import('../app/utils/learningOutcomes.ts')
const { mergeKnowledgeDocument } = await import('../app/utils/knowledgeSync.ts')
const { recordReview } = await import('../app/utils/learningManagement.ts')
const { createLearningManagement } = await import('../app/composables/useLearningManagement.ts')
const { restoreHomeCourse } = await import('../app/utils/learningHome.ts')
const { calculateDayBudget } = await import('../app/utils/dailyPlan.ts')
const { emptyStudyRecords } = await import('../app/utils/studyProgram.ts')
const today = '2026-10-05'
const now = new Date(`${today}T12:00:00`).getTime()
function course() {
  return {
    course: { id: 'course', name: '前端学习', status: 'active' },
    days: {},
    snapshots: {},
    error: '',
    context: {
      plan: {
        version: 1,
        createdAt: now,
        summary: '搭建页面',
        profile: '学习基础',
        messages: [],
        dailyMinutes: 60,
        program: {
          days: 14,
          startDate: '2026-09-28',
          budget: { video: 60, code: 0, project: 0, recap: 0 },
          lightEvery: 0,
          lightMinutes: 15,
          calendar: { weekdays: [1, 2, 3, 4, 5], overrides: {} },
        },
        modules: [
          {
            id: 'stage',
            title: '阶段一',
            description: '基础',
            practice: {
              startDay: 1,
              endDay: 14,
              goal: '作品',
              project: 'Todo',
              skipWhen: '完成',
              tasks: [],
              checks: [{ id: 'check', kind: 'project', text: '完成作品' }],
            },
          },
        ],
        lessons: [1, 2, 3].map((i) => ({
          path: `${i}.mp4`,
          moduleId: 'stage',
          concepts: ['概念'],
          prerequisites: [],
          status: 'required',
          reason: '必修基础',
        })),
      },
      metadata: Object.fromEntries([1, 2, 3].map((i) => [`${i}.mp4`, { duration: 3600, size: 0, modified: 0 }])),
      progress: {},
      mastery: {},
      questions: [],
      records: emptyStudyRecords(),
      today: null,
      enabled: true,
    },
  }
}
function card() {
  return {
    id: 'card',
    courseId: 'course',
    path: '1.mp4',
    kind: 'knowledge',
    front: '问题',
    back: '解析',
    concepts: ['概念'],
    category: 'concept',
    seconds: 0,
    sourceAt: now - 86400000,
    due: today,
    step: 0,
    recall: null,
    reviewedAt: null,
    weak: false,
  }
}
const sources = () => ({ notes: [], summaries: [], practices: [] })
test('学习契约不使用路线修改说明，切换无实践目标的阶段和整门课程时清空默认目标', () => {
  const c = course()
  c.context.plan.summary = '已移除数据结构与算法的学习计划，保留目录及课节；请确认后续前置关系。'
  c.context.plan.modules.push({ id: 'empty', title: '无实践阶段', description: '' })
  assert.equal(learningContractDraft(c, '', today).goal, '')
  assert.equal(learningContractDraft(c, 'stage', today).goal, 'Todo')
  assert.equal(learningContractDraft(c, 'empty', today).goal, '')
  assert.equal(learningContractDraft(c, '', today).goal, '')
  c.context.plan.modules[0].practice.project = '  '
  assert.equal(learningContractDraft(c, 'stage', today).goal, '作品')
})
test('契约默认值跟随所选阶段，已有承诺可修改，缺少计划和过期计划都有可填写的日期', () => {
  const c = course()
  c.context.plan.modules[0].practice.budget = { video: 15, code: 10, project: 10, recap: 5 }
  c.context.plan.modules[0].practice.endDay = 9
  assert.deepEqual(learningContractDraft(c, 'stage', today), {
    moduleId: 'stage',
    goal: 'Todo',
    deadline: '2026-10-06',
    minutes: 40,
  })
  const saved = {
    id: 'contract',
    courseId: 'course',
    moduleId: 'stage',
    goal: '我自己的作品目标',
    deadline: '2026-11-01',
    minutes: 25,
    signedAt: now,
  }
  assert.equal(learningContractDraft(c, 'stage', today, [{ ...saved, courseId: 'other' }]).goal, 'Todo')
  assert.deepEqual(learningContractDraft(c, 'stage', today, [saved]), {
    moduleId: 'stage',
    goal: saved.goal,
    deadline: saved.deadline,
    minutes: 25,
  })
  assert.equal(learningContractDraft(c, '', '2027-01-01').deadline, '2027-01-01')
  c.context.plan = null
  assert.deepEqual(learningContractDraft(c, '', today), { moduleId: '', goal: '', deadline: '2026-11-04', minutes: 30 })
})
test('旧库首次启用使用默认值，未来版本、损坏记录不能覆盖；作品和契约往返保留', () => {
  const data = parseLearningManagement(null)
  assert.equal(data.preferences.flowPrompt, true)
  data.cards.push(card())
  data.works.push({
    id: 'work',
    courseId: 'course',
    moduleId: 'stage',
    title: '作品',
    description: '描述',
    location: '/tmp/demo',
    screenshot: '',
    createdAt: now,
    acceptedAt: null,
  })
  assert.deepEqual(parseLearningManagement(JSON.parse(JSON.stringify(data))), data)
  assert.throws(() => parseLearningManagement({ ...data, version: 2 }))
  assert.throws(() => parseLearningManagement({ ...data, cards: [{ ...card(), due: '2026-02-30' }] }))
  assert.throws(() => parseLearningManagement({ ...data, cards: [card(), card()] }))
  assert.throws(() => parseLearningManagement({ ...data, preferences: { ...data.preferences, calendarTime: '25:99' } }))
})
test('复习间隔跨月推进；忘记回到次日，模糊缩短，重复当日评价被拒绝', () => {
  const remembered = rateReview(card(), 'remembered', now)
  assert.equal(remembered.due, '2026-10-07')
  assert.throws(() => rateReview(remembered, 'remembered', now + 1000))
  const forgotten = rateReview({ ...card(), step: 5 }, 'forgotten', now)
  assert.equal(forgotten.due, '2026-10-06')
  assert.equal(forgotten.step, 0)
  assert.equal(forgotten.weak, true)
  assert.equal(rateReview({ ...card(), step: 4 }, 'uncertain', now).due, '2026-10-12')
  assert.equal(
    rateReview({ ...card(), step: 5 }, 'remembered', new Date('2026-12-20T12:00:00').getTime()).due,
    '2027-01-19',
  )
})
test('已学章节才加入笔记与知识卡；刷新、编辑笔记不会重置复习记录', () => {
  const c = course(),
    s = sources()
  s.summaries.push({
    courseId: 'course',
    path: '1.mp4',
    overview: '概要',
    createdAt: now - 86400000,
    points: [{ id: 'point', title: '概念', text: '答案', start: 12 }],
  })
  s.notes.push({ courseId: 'course', path: '1.mp4', content: '# 重点\n笔记正文', updatedAt: now - 86400000 })
  assert.equal(collectReviewCards(s, [c], today).length, 0)
  c.context.progress['1.mp4'] = { done: true }
  const collected = collectReviewCards(s, [c], today)
  assert.equal(collected.length, 2)
  assert.equal(collected[0].seconds, 12)
  const reviewed = collected.map((c) => rateReview(c, 'remembered', now))
  s.notes[0].content = '# 重点\n更新笔记'
  s.notes[0].updatedAt = now + 1000
  const merged = mergeReviewCards(reviewed, collectReviewCards(s, [c], today))
  assert.equal(merged.length, 2)
  assert.equal(merged[1].reviewedAt, now)
  assert.equal(merged[1].back, '更新笔记')
  const data = emptyLearningManagement()
  data.cards = merged
  assert.equal(dueReviewCards(data, [c], today).length, 0)
  c.course.status = 'paused'
  assert.equal(dueReviewCards(data, [c], '2026-11-01').length, 0)
})
test('新错题立即进入复习，已复习后再次答错会重置；今日巩固定位真实源课节', () => {
  const c = course(),
    s = sources()
  s.practices.push({
    courseId: 'course',
    record: {
      id: 'record',
      path: 'daily:2026-10-05:scope',
      scope: null,
      sources: [{ path: '2.mp4', start: 25 }],
      question: { prompt: '问题', referenceAnswer: '答案', concepts: ['变量'] },
      attempts: [{ at: now, feedback: { result: 'retry' } }],
    },
  })
  const cards = collectReviewCards(s, [c], today)
  assert.equal(cards[0].path, '2.mp4')
  assert.equal(cards[0].due, today)
  assert.equal(cards[0].weak, true)
  const reviewed = rateReview(cards[0], 'remembered', now)
  s.practices[0].record.attempts.push({ at: now + 86400000, feedback: { result: 'partial' } })
  const next = mergeReviewCards([reviewed], collectReviewCards(s, [c], '2026-10-06'))[0]
  assert.equal(next.weak, true)
  assert.equal(next.due, '2026-10-06')
  assert.equal(next.step, 0)
})
test('补卡必须完成当日全部任务；保护每月最多两次且不能补造学习时长', () => {
  const c = course(),
    data = emptyLearningManagement()
  c.snapshots['2026-10-04'] = {
    date: '2026-10-04',
    plannedMinutes: 60,
    tasks: [{ id: 'task', path: '1.mp4', end: 3600, done: false }],
  }
  assert.equal(canMakeUp(c, '2026-10-04', today), false)
  c.context.progress['1.mp4'] = { done: true }
  assert.equal(canMakeUp(c, '2026-10-04', today), true)
  const before = structuredClone(c)
  addProtection(data, c, '2026-10-04', 'makeup', now)
  assert.deepEqual(c, before)
  assert.equal(protectedStreak(c, data, today), 1)
  assert.throws(() => addProtection(data, c, '2026-10-04', 'makeup', now))
  data.protections = []
  addProtection(data, c, '2026-10-04', 'freeze', now)
  addProtection(data, { ...c, course: { ...c.course, id: 'two' } }, '2026-10-04', 'freeze', now)
  assert.throws(() => addProtection(data, { ...c, course: { ...c.course, id: 'three' } }, '2026-10-04', 'freeze', now))
})
test('健康度不把休息日和缺记录当失败，连续低完成率给出减负建议', () => {
  const c = course()
  for (const date of ['2026-10-01', '2026-10-02', '2026-10-03']) {
    c.snapshots[date] = { date, initialMinutes: 60, plannedMinutes: 60, tasks: [] }
    c.days[date] = { seconds: 20 * 60, checkedAt: null }
  }
  const health = planHealth(c, today)
  assert.equal(health.days.length, 3)
  assert.equal(health.average, 20)
  assert.equal(health.overloaded, true)
  assert.equal(health.recommended, 20)
})
test('自适应减负保留历史、阶段证据与休息日，并延长到足够排完课程', () => {
  const c = course(),
    before = structuredClone(c)
  c.context.plan.program.calendar.overrides['2026-10-07'] = { video: 0, code: 0, project: 0, recap: 0 }
  const result = adaptivePlan(c, today, 15)
  assert.ok(result.shifted > 0)
  assert.equal(result.plan.program.startDate, before.context.plan.program.startDate)
  assert.deepEqual(result.plan.lessons, c.context.plan.lessons)
  assert.deepEqual(c.context.records, before.context.records)
  assert.equal(calculateDayBudget({ ...c.context, plan: result.plan }, '2026-10-01').video, 60)
  assert.equal(calculateDayBudget({ ...c.context, plan: result.plan }, '2026-10-07').video, 0)
  assert.equal(calculateDayBudget({ ...c.context, plan: result.plan }, '2026-10-06').video, 15)
  assert.throws(() => adaptivePlan(c, today, NaN))
})
test('日历逐日推进章节、课程不重叠，UID 稳定，中文折行按字节计算', () => {
  const c = course()
  c.context.plan.program.calendar.weekdays = [1, 2, 3, 4, 5, 6, 7]
  const calendar = learningCalendar([c], today, '20:00', 3, now)
  const unfolded = calendar.replace(/\r\n /g, '')
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) ?? []).length, 3)
  for (const path of ['1.mp4', '2.mp4', '3.mp4']) assert.ok(unfolded.includes(path))
  assert.ok(unfolded.includes('DTSTART:'))
  assert.ok(unfolded.includes('URL:aiplayer://lesson?'))
  assert.equal(calendar, learningCalendar([c], today, '20:00', 3, now))
  assert.ok(calendar.split('\r\n').every((line) => Buffer.byteLength(line) <= 75))
  assert.equal(foldCalendarLine('学'.repeat(100)).replace(/\r\n /g, ''), '学'.repeat(100))
  assert.throws(() => learningCalendar([c], today, '99:00', 30))
})
test('笔记双向同步独立合并正文与生成区域，同时修改显示冲突，删除需决策', () => {
  const c = course(),
    s = sources()
  s.notes.push({ courseId: 'course', path: '1.mp4', content: '原笔记', updatedAt: now })
  const base = knowledgeDocument(c, '1.mp4', s).content
  const local = base.replace('暂无总结', '新知识总结'),
    remote = base.replace('原笔记', '外部编辑')
  const merged = mergeKnowledgeDocument(base, local, remote)
  assert.equal(merged.conflict, false)
  assert.equal(merged.note, '外部编辑')
  assert.match(merged.content, /新知识总结/)
  assert.equal(mergeKnowledgeDocument(base, base.replace('原笔记', '本地编辑'), remote).conflict, true)
  assert.equal(mergeKnowledgeDocument(base, local, null).conflict, true)
  assert.equal(mergeKnowledgeDocument(null, base, null).conflict, false)
  assert.equal(mergeKnowledgeDocument(base, local, remote, 'local').content, local)
  assert.equal(mergeKnowledgeDocument(base, local, '移除了笔记标记').conflict, true)
})
test('完成观看但未验收的课程不发结课证书；实践、契约和掌握清单进入报告', () => {
  const c = course(),
    data = emptyLearningManagement()
  for (const l of c.context.plan.lessons) c.context.progress[l.path] = { done: true }
  data.contracts.push({
    id: 'contract',
    courseId: 'course',
    moduleId: 'stage',
    goal: 'Todo',
    deadline: today,
    minutes: 30,
    signedAt: now,
  })
  assert.equal(graduationReport(c, data, sources(), today).graduated, false)
  c.context.records.checks['["stage","check"]'] = { passed: true }
  data.works.push({
    id: 'work',
    courseId: 'course',
    moduleId: 'stage',
    title: 'Todo App',
    location: 'https://example.com',
    description: '成果',
    acceptedAt: now,
  })
  const report = graduationReport(c, data, sources(), today)
  assert.equal(report.graduated, true)
  assert.match(report.markdown, /Todo App/)
})
test('心流按时段和课程聚合，读取材料端点拒绝非法外部记录', () => {
  const flows = [
    { courseId: 'course', hour: 8, mood: 'deep' },
    { courseId: 'course', hour: 8, mood: 'steady' },
    { courseId: 'course', hour: 22, mood: 'tired' },
    { courseId: 'course', hour: 22, mood: 'struggling' },
    { courseId: 'other', hour: 8, mood: 'tired' },
  ]
  assert.equal(flowInsights(flows, 'course').best.hour, 8)
  assert.equal(flowInsights(flows, 'course').hard.hour, 22)
  assert.deepEqual(parseLearningSources(sources()), sources())
  assert.throws(() => parseLearningSources({ notes: [{ content: 42 }], summaries: [], practices: [] }))
})
test('保存失败不提交状态，并发操作按成功保存的状态继续，复习奖励不会重复', async () => {
  let fail = true,
    persisted = null
  const store = createLearningManagement({
    read: async () => null,
    write: async (value) => {
      if (fail) throw Error('disk full')
      persisted = structuredClone(value)
    },
  })
  await store.load()
  assert.equal(await store.mutate((data) => data.cards.push(card())), false)
  assert.equal(store.state.data.cards.length, 0)
  fail = false
  await Promise.all([
    store.mutate((data) => data.cards.push(card())),
    store.mutate((data) => {
      data.preferences.shortcut = 'Focus'
    }),
  ])
  assert.equal(persisted.cards.length, 1)
  assert.equal(persisted.preferences.shortcut, 'Focus')
  const data = emptyLearningManagement()
  data.cards = [card()]
  assert.equal(recordReview(data, [course()], 'card', 'remembered', now), true)
  assert.throws(() => recordReview(data, [course()], 'card', 'remembered', now + 1000))
  data.cards.push({ ...card(), id: 'later' })
  assert.equal(recordReview(data, [course()], 'later', 'remembered', now + 2000), false)
  assert.equal(data.rewardDays.length, 1)
})
test('重复同步保留外部对生成区域的编辑，新的笔记修改仍可合并', () => {
  const c = course(),
    s = sources()
  s.notes.push({ courseId: 'course', path: '1.mp4', content: '原笔记', updatedAt: now })
  const original = knowledgeDocument(c, '1.mp4', s).content
  const remote = original.replace('暂无总结', '补充知识')
  const first = mergeKnowledgeDocument(original, original, remote)
  assert.equal(first.conflict, false)
  assert.equal(mergeKnowledgeDocument(first.content, original, remote, undefined, original).content, remote)
  const second = mergeKnowledgeDocument(
    first.content,
    original.replace('原笔记', '新笔记'),
    remote,
    undefined,
    original,
  )
  assert.match(second.content, /补充知识/)
  assert.equal(second.note, '新笔记')
})
test('首页恢复保留计划创建时间；减负保留未来实践总时间，周末分担不改过去的休息日', () => {
  const c = course(),
    createdAt = c.context.plan.createdAt
  const restored = restoreHomeCourse(
    {
      course: c.course,
      data: {
        guide: { plan: c.context.plan, metadata: c.context.metadata, mastery: {}, questions: [], today: null },
        progress: {},
        days: {},
        snapshots: {},
        records: c.context.records,
      },
    },
    today,
  )
  assert.equal(restored.context.plan.createdAt, createdAt)
  c.context.plan.program.budget.project = 30
  const lighter = adaptivePlan(c, today, 10)
  assert.ok(lighter.shifted > 0)
  const overrides = Object.entries(lighter.plan.program.calendar.overrides)
  assert.ok(overrides.every(([, b]) => Object.values(b).reduce((n, v) => n + v, 0) <= 10))
  assert.ok(overrides.reduce((n, [, b]) => n + b.project, 0) >= 120)
  const weekend = adaptivePlan(c, today, 10, 'weekend')
  assert.ok(calculateDayBudget({ ...c.context, plan: weekend.plan }, '2026-10-10').video > 0)
  assert.equal(calculateDayBudget({ ...c.context, plan: weekend.plan }, '2026-10-04').video, 0)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  catalogFolders,
  constrainLearningPlan,
  emptyRouteConstraints,
  excludedRoutePaths,
  fixedCatalogRoute,
  parseRouteConstraints,
  pathInScope,
  readRouteDirective,
  routeArrangement,
} from '../app/utils/guideConstraints.ts'
import { orderedRoute, validateLearningPlan } from '../app/utils/guide.ts'
import { applyMastery, masteryKey } from '../app/utils/learningFeedback.ts'
import {
  guideConversationMessages,
  parseGuideConversation,
  restoreConversationConstraints,
} from '../app/utils/guideConversation.ts'
import { calculateDay } from '../app/utils/dailyPlan.ts'
import { emptyStudyRecords } from '../app/utils/studyProgram.ts'
import { abbreviatedScopeCatalog, explicitRemainingScope, sourceCourseRoots } from './fixtures/guideScope.mjs'

export const courseCatalog = () =>
  [
    { path: '1 安装软件教程/安装.mp4', title: '安装' },
    { path: '2 Python快速入门/语法.mp4', title: '语法' },
    { path: '3 数据科学必备工具包/Numpy.mp4', title: 'Numpy' },
    ...['函数', '极限', '无穷小', '连续性与导数', '偏导数', '方向导数', '梯度'].map((title, index) => ({
      path: `4 必备数学课程/1.高等数学基础/${index + 1}-${title}.mp4`,
      title: `${index + 1}-${title}`,
      done: index < 5,
    })),
    { path: '4 必备数学课程/2.微积分/微积分.mp4', title: '微积分' },
    { path: '5 机器学习算法精讲/回归.mp4', title: '回归' },
    { path: '6 建模实战项目/项目.mp4', title: '项目' },
    { path: '环境/Jupyter.mp4', title: 'Jupyter' },
  ].map((entry) => ({ duration: 600, done: false, ...entry }))
const confirmed = (catalog = courseCatalog()) => {
  let constraints = emptyRouteConstraints()
  for (const question of [
    '不学的章节：\n1安装软件教程\n2python快速入门\n3数据科学必备工具包\n环境\n\n剩下的都是要学的内容',
    '除了不学的，剩下的直接按照顺序去学',
    '剩下的直接按照原来的顺序去学就可以了 不要改学习顺序了',
    '我不学1、2、3的目录\n我的学习路线从4开始学道6\n最后一个环境目录的课不学。',
  ])
    constraints = readRouteDirective(constraints, question, catalog).constraints
  return constraints
}

test('真实目录前缀与用户简称不同时，按编号与名称对应排除四个目录，不丢掉后面的环境', () => {
  const catalog = abbreviatedScopeCatalog()
  const result = readRouteDirective(emptyRouteConstraints(), explicitRemainingScope, catalog)
  assert.equal(result.explicit, true)
  assert.deepEqual(result.constraints.excludedFolders, [...sourceCourseRoots.slice(0, 3), '环境'])
  assert.equal(fixedCatalogRoute(result.constraints), true)
  assert.ok(
    catalog
      .filter((lesson) => pathInScope(lesson.path, result.constraints))
      .every((lesson) => /^[456]-/.test(lesson.path)),
  )
  const before = JSON.parse(JSON.stringify(result.constraints))
  const plan = constrainLearningPlan(badPlan(catalog), result.constraints, catalog)
  assert.deepEqual(
    plan.lessons.filter((lesson) => lesson.status === 'required').map((lesson) => lesson.path),
    catalog.filter((lesson) => /^[456]-/.test(lesson.path)).map((lesson) => lesson.path),
  )
  assert.deepEqual(result.constraints, before)
  assert.equal(
    routeArrangement(result.constraints, catalog).find((row) => row.label === '接着学习').value,
    '6-方向导数',
  )
})

test('编号后的简称必须匹配目录名称，不能把投入时间、基础描述或其他同编号主题当作排除目录', () => {
  const catalog = abbreviatedScopeCatalog()
  for (const input of ['不学3小时以内的计划', '不学2年前的内容', '不学1概率论', '不学3D建模', '每周5–10小时']) {
    assert.deepEqual(readRouteDirective(emptyRouteConstraints(), input, catalog).constraints.excludedFolders, [])
  }
  assert.deepEqual(
    readRouteDirective(
      emptyRouteConstraints(),
      '不学1安装软件教程、2python快速入门、3数据科学必备工具包、环境，其余都学',
      catalog,
    ).constraints.excludedFolders,
    [...sourceCourseRoots.slice(0, 3), '环境'],
  )
})

test('询问或否定全量学习时不能被当成已确认范围', () => {
  const catalog = abbreviatedScopeCatalog()
  for (const input of [
    '是不是剩下的都要学？',
    '如果其余全部学会不会太赶？',
    '不是剩下的都学',
    '不要全部课程都要学',
    '要不要所有课程都学习？',
  ]) {
    assert.equal(readRouteDirective(emptyRouteConstraints(), input, catalog).constraints.includeRemaining, false)
  }
})
function badPlan(catalog) {
  return {
    version: 1,
    createdAt: 1,
    summary: '直接从微积分开始学习，先复习工具包',
    profile: '能写脚本，数学较弱',
    dailyMinutes: 30,
    modules: [{ id: 'm', title: '数学与算法', description: '学习目标' }],
    lessons: [...catalog].reverse().map((entry) => ({
      path: entry.path,
      moduleId: 'm',
      status: entry.title.includes('方向导数') || entry.title.includes('梯度') ? 'skipped' : 'required',
      concepts: ['概念'],
      reason: 'AI 自行筛选',
      prerequisites: entry.title.includes('方向导数') ? [catalog[2].path] : [],
    })),
    messages: [],
  }
}

test('用户原话逐轮固定排除目录、4→6 范围和原始顺序，无课程名称写死在实现中', () => {
  const catalog = courseCatalog(),
    constraints = confirmed(catalog)
  assert.equal(fixedCatalogRoute(constraints), true)
  assert.deepEqual(
    new Set(constraints.excludedFolders),
    new Set(['1 安装软件教程', '2 Python快速入门', '3 数据科学必备工具包', '环境']),
  )
  assert.deepEqual(constraints.includedFolders, ['4 必备数学课程', '5 机器学习算法精讲', '6 建模实战项目'])
  const other = catalog.map((entry) => ({
    ...entry,
    path: entry.path.replace('4 必备数学课程', '4 物理').replace('环境', '工具安装'),
  }))
  const parsed = readRouteDirective(
    emptyRouteConstraints(),
    '不学1、2、3的目录，工具安装也不学。学习范围从4开始到6结束，其余都学，按原顺序。',
    other,
  )
  assert.equal(parsed.constraints.excludedFolders.includes('工具安装'), true)
  assert.equal(parsed.constraints.includedFolders[0], '4 物理')
  assert.equal(
    readRouteDirective(emptyRouteConstraints(), '不学1、2、3，其余都学', catalog).constraints.order,
    'catalog',
  )
  const optimized = readRouteDirective(emptyRouteConstraints(), '让AI安排顺序', catalog).constraints
  assert.equal(readRouteDirective(optimized, '不学1、2、3，其余都学', catalog).constraints.order, 'ai')
})

test('不会把数学薄弱、Python 基础或每周投入数字当成排除目录的指令', () => {
  for (const text of [
    '数学比较薄弱，需要重新学',
    'Python 能独立写小脚本',
    '每周 5–10 小时',
    '不是不学3，只是想晚一点学',
    '不要跳过4',
  ]) {
    assert.deepEqual(readRouteDirective(emptyRouteConstraints(), text, courseCatalog()).constraints.excludedFolders, [])
  }
  const constraints = readRouteDirective(
    emptyRouteConstraints(),
    '不学的章节：\n1安装软件教程\n每周5–10小时\n6建模实战项目',
    courseCatalog(),
  ).constraints
  assert.deepEqual(constraints.excludedFolders, ['1 安装软件教程'])
  const changed = readRouteDirective(confirmed(), '不要按原顺序，让AI安排顺序', courseCatalog())
  assert.equal(changed.constraints.order, 'ai')
  assert.equal(readRouteDirective(confirmed(), '不再优化学习顺序', courseCatalog()).constraints.order, 'catalog')
  assert.equal(
    readRouteDirective(confirmed(), '之前按原顺序，现在让 AI 安排顺序', courseCatalog()).constraints.order,
    'ai',
  )
  assert.deepEqual(
    readRouteDirective(emptyRouteConstraints(), '不学3 数据科学必备工具包会影响后面的学习吗', courseCatalog())
      .constraints.excludedFolders,
    [],
  )
})

test('目录匹配保留精确层级，恢复某目录和取消全部排除不被旧要求覆盖', () => {
  const catalog = courseCatalog()
  const nested = readRouteDirective(emptyRouteConstraints(), '不学4 必备数学课程/2.微积分', catalog).constraints
  assert.deepEqual(nested.excludedFolders, ['4 必备数学课程/2.微积分'])
  assert.ok(pathInScope(catalog[8].path, nested))
  const restored = readRouteDirective(confirmed(), '不要跳过3', catalog).constraints
  assert.ok(pathInScope(catalog[2].path, restored))
  assert.ok(pathInScope(catalog[2].path, readRouteDirective(confirmed(), '3的目录我也学', catalog).constraints))
  assert.deepEqual(readRouteDirective(confirmed(), '只学6的目录', catalog).constraints.includedFolders, [
    '6 建模实战项目',
  ])
  const all = readRouteDirective(restored, '取消所有排除，全部课程都要学', catalog).constraints
  assert.equal(all.includedFolders, null)
  assert.deepEqual(all.excludedFolders, [])
})

test('排除目录不被前置课或掌握反馈补回，方向导数和梯度不能被 AI 删掉', () => {
  const catalog = courseCatalog(),
    constraints = confirmed(catalog)
  const plan = constrainLearningPlan(badPlan(catalog), constraints, catalog)
  const excluded = excludedRoutePaths(plan)
  applyMastery(
    plan.lessons,
    { [masteryKey(catalog[2].path, '概念')]: { path: catalog[2].path, concept: '概念', level: 'needs-review' } },
    excluded,
    excluded,
  )
  assert.equal(plan.lessons.find((lesson) => lesson.path === catalog[2].path).status, 'skipped')
  constrainLearningPlan(plan, constraints, catalog)
  const route = orderedRoute(plan.lessons, false, plan.constraints.order)
  assert.deepEqual(
    route.map((lesson) => lesson.path),
    catalog.filter((entry) => pathInScope(entry.path, constraints)).map((entry) => entry.path),
  )
  assert.ok(plan.lessons.find((lesson) => lesson.path === catalog[2].path).status === 'skipped')
  assert.equal(route.find((lesson) => lesson.path === catalog[8].path).status, 'required')
  assert.equal(route.find((lesson) => lesson.path === catalog[9].path).status, 'required')
  assert.ok(!plan.summary.includes('微积分'))
  assert.equal(
    validateLearningPlan(
      plan,
      catalog.map((entry) => entry.path),
    ).constraints.order,
    'catalog',
  )
})

test('首页和播放器共用的排期从真实第一节未完成课接续，不伪造完成标记或越过梯度', () => {
  const catalog = courseCatalog(),
    plan = constrainLearningPlan(badPlan(catalog), confirmed(catalog), catalog)
  const progress = Object.fromEntries(
    catalog.map((entry) => [
      entry.path,
      { time: entry.done ? 600 : 0, duration: 600, done: entry.done, ratio: entry.done ? 1 : 0 },
    ]),
  )
  const before = structuredClone(progress)
  const day = calculateDay(
    {
      plan,
      includeOptional: false,
      progress,
      metadata: Object.fromEntries(catalog.map((entry) => [entry.path, { duration: 600, size: 1, modified: 1 }])),
      mastery: {
        [masteryKey(catalog[3].path, '概念')]: { path: catalog[3].path, concept: '概念', level: 'needs-review' },
      },
      questions: [],
      records: emptyStudyRecords(),
      today: null,
    },
    '2026-11-02',
  )
  assert.deepEqual(
    day.today.items.map((item) => item.path),
    [catalog[8].path, catalog[9].path, catalog[10].path],
  )
  assert.deepEqual(progress, before)
  assert.equal(routeArrangement(plan.constraints, catalog).find((row) => row.label === '接着学习').value, '6-方向导数')
})

test('学习安排不展示顺序说明，保留学习范围、跳过、接着学习和每周投入，不改变路线约束', () => {
  const catalog = courseCatalog()
  const constraints = { ...confirmed(catalog), weeklyMinutes: { min: 300, max: 600 } }
  const before = structuredClone(constraints)
  assert.deepEqual(routeArrangement(constraints, catalog), [
    { label: '学习范围', value: '4 必备数学课程 → 5 机器学习算法精讲 → 6 建模实战项目' },
    { label: '跳过', value: '1 安装软件教程、2 Python快速入门、3 数据科学必备工具包、环境' },
    { label: '接着学习', value: '6-方向导数' },
    { label: '每周投入', value: '5–10 小时' },
  ])
  assert.deepEqual(constraints, before)
  assert.equal(constraints.order, 'catalog')
})

test('旧对话从用户原话恢复学习安排，忽略 AI 错误总结；较长历史不丢最初问卷答案', () => {
  const catalog = courseCatalog()
  const data = parseGuideConversation({
    version: 1,
    profile: '旧摘要',
    preferences: {},
    turns: [
      {
        id: 'one',
        question: '初始问卷',
        reply: {
          message: '基础问卷',
          profile: '',
          planRequest: null,
          form: { id: 'form', submitLabel: '提交', fields: [{ id: 'goal', type: 'text', label: '目标' }] },
        },
        answers: { goal: '每周5–10小时，数学薄弱，求职' },
        status: 'done',
        error: '',
      },
      ...Array.from({ length: 15 }, (_, index) => ({
        id: `t${index}`,
        question: index === 0 ? '不学1、2、3和环境的目录，其余都学，按原来的顺序学习' : '保留之前的要求',
        reply: {
          message: 'AI 错误建议：跳过方向导数和梯度从微积分开始',
          profile: '错误摘要',
          form: null,
          planRequest: '错误起点',
        },
        status: 'done',
        error: '',
      })),
    ],
  })
  data.constraints = restoreConversationConstraints(data, catalog)
  assert.equal(fixedCatalogRoute(data.constraints), true)
  assert.equal(data.constraints.excludedFolders.length, 4)
  assert.ok(
    guideConversationMessages(data).some(
      (message) => message.role === 'user' && message.content.includes('每周5–10小时'),
    ),
  )
  const restored = parseGuideConversation(JSON.parse(JSON.stringify(data)))
  assert.deepEqual(restored.constraints, data.constraints)
})

test('不把旧 AI 推荐跳过的课当成用户明确排除，真实补学反馈仍然生效', () => {
  const lesson = {
    path: 'lesson.mp4',
    moduleId: 'm',
    status: 'skipped',
    reason: '旧建议',
    concepts: ['概念'],
    prerequisites: [],
  }
  applyMastery(
    [lesson],
    { [masteryKey(lesson.path, '概念')]: { path: lesson.path, concept: '概念', level: 'needs-review' } },
    new Set([lesson.path]),
  )
  assert.equal(lesson.status, 'required')
})

test('损坏的学习范围记录和变更后的目录不能被默默应用', () => {
  for (const raw of [
    {},
    { ...emptyRouteConstraints(), order: 'anything' },
    { ...emptyRouteConstraints(), excludedFolders: ['../outside'] },
    { ...emptyRouteConstraints(), excludedFolders: [3] },
  ])
    assert.throws(() => parseRouteConstraints(raw))
  const catalog = courseCatalog()
  assert.throws(
    () => constrainLearningPlan(badPlan(catalog), { ...confirmed(), excludedFolders: ['不存在的目录'] }, catalog),
    /目录已变化/,
  )
  assert.ok(catalogFolders(catalog).includes('4 必备数学课程/1.高等数学基础'))
})

test('AI 问卷选项中的周时间作为用户约束保留，不把不确定答案变成固定时间', () => {
  const catalog = courseCatalog()
  const known = readRouteDirective(
    emptyRouteConstraints(),
    '你每周大概能投入多少学习时间（看课 + 练习）？：5–10 小时',
    catalog,
  ).constraints
  assert.deepEqual(known.weeklyMinutes, { min: 300, max: 600 })
  assert.equal(known.excludedFolders.length, 0)
  const unknown = readRouteDirective(known, '每周时间：暂时不确定，按建议来', catalog).constraints
  assert.equal(unknown.weeklyMinutes, null)
  assert.equal(
    readRouteDirective(emptyRouteConstraints(), '每周2天，每天3小时', catalog).constraints.weeklyMinutes,
    null,
  )
  assert.deepEqual(
    readRouteDirective(emptyRouteConstraints(), '每周时间：20 小时以上', catalog).constraints.weeklyMinutes,
    { min: 1200, max: null },
  )
  assert.deepEqual(
    readRouteDirective(emptyRouteConstraints(), '每周时间：5 小时以内', catalog).constraints.weeklyMinutes,
    { min: 0, max: 300 },
  )
  assert.throws(() => parseRouteConstraints({ ...emptyRouteConstraints(), weeklyMinutes: { min: 600, max: 300 } }))
})

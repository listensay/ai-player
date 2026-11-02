import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { parseAiJson } from '../app/utils/guideAi.ts'
import { catalogModules, lessonDirectory } from '../app/utils/guideCatalog.ts'
import { emptyRouteConstraints, pathInScope, readRouteDirective } from '../app/utils/guideConstraints.ts'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest=(...args)=>globalThis.planGenerationIO(...args)',
        shortCircuit: true,
      }
    return next(specifier, context)
  },
})
const { generateLearningPlan } = await import('../app/utils/guidePlanGeneration.ts')
const outline = () => ({
  summary: '先掌握前置基础，再按目标学习应用。',
  profile: '已确认需要学习基础和应用。',
  dailyMinutes: 30,
  program: {
    days: 180,
    startDate: '2026-11-02',
    budget: { video: 30, code: 15, project: 0, recap: 5 },
    lightEvery: 0,
    lightMinutes: 30,
  },
  modules: [
    { id: 'application', title: '应用', description: '练习实际应用' },
    { id: 'foundation', title: '基础', description: '掌握必要前置知识' },
  ],
})
const rows = (ids) =>
  [...ids].reverse().map((id) => ({
    id,
    status: Number(id.slice(1)) % 3 === 0 ? 'skipped' : Number(id.slice(1)) % 3 === 1 ? 'required' : 'optional',
    reason: `按已确认学情选择 ${id}`,
    concepts: ['基础概念'],
    prerequisites: id === 'l21' ? ['l1'] : [],
  }))
const targetData = (messages) => {
  const message = [...messages].reverse().find((message) => message.content.includes('以下是输入数据：'))
  return message ? JSON.parse(message.content.split('以下是输入数据：').at(-1)) : null
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
function harness(t, count = 493) {
  const cache = new Map()
  let failWrite = false
  globalThis.planGenerationIO = async (_endpoint, options) => {
    if (options.method === 'POST') {
      if (failWrite) throw Error('disk write failure')
      cache.set(options.body.key, structuredClone(options.body.value))
      return null
    }
    return structuredClone(cache.get(options.query.key) ?? null)
  }
  t.after(() => delete globalThis.planGenerationIO)
  const catalog = Array.from({ length: count }, (_, index) => ({
    path: `课程资源/完整材料/阶段${Math.floor(index / 20)}/第${index + 1}课-完整课程名称.mp4`,
    title: `课程 ${index + 1}`,
    duration: 1200,
    done: index % 5 === 0,
  }))
  const calls = []
  const options = {
    courseId: crypto.randomUUID(),
    courseName: '完整课程',
    catalog,
    settings: { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'selected-model', apiKey: '' },
    signal: new AbortController().signal,
    messages: [{ role: 'user', content: '生成完整路线' }],
    request: '按已确认方案学习基础与应用',
    dailyMinutes: null,
    previous: null,
    feedback: { mastery: [{ path: catalog[0].path, concept: '已有知识点', level: 'needs-review', updatedAt: 1 }] },
    today: '2026-11-02',
    preferences: { conversation: [{ role: 'user', content: '采用稳步推进的方案' }], dailyTotalMinutes: null },
    complete: async (messages) => {
      calls.push(structuredClone(messages))
      const data = targetData(messages)
      return data
        ? { lessons: rows(data.targetIds) }
        : { ...outline(), modules: catalogModules(options.catalog, options.courseName) }
    },
  }
  return { options, calls, cache, setFailWrite: (value) => (failWrite = value) }
}

for (const count of [493, 1812])
  test(`${count} 节课程完整生成，短编号逐批覆盖全部必修、选修和跳过课节`, async (t) => {
    const h = harness(t, count)
    const plan = await generateLearningPlan(h.options)
    assert.equal(h.calls.length, Math.ceil(count / 20) + 1)
    assert.equal(plan.lessons.length, count)
    assert.equal(new Set(plan.lessons.map((lesson) => lesson.path)).size, count)
    assert.deepEqual(new Set(plan.lessons.map((lesson) => lesson.path)), new Set(h.options.catalog.map((v) => v.path)))
    assert.ok(plan.lessons.some((lesson) => lesson.status === 'skipped'))
    assert.ok(plan.lessons.some((lesson) => lesson.status === 'optional'))
    assert.ok(plan.lessons.some((lesson) => lesson.status === 'required'))
    assert.ok(
      plan.lessons.findIndex((l) => l.path === h.options.catalog[0].path) <
        plan.lessons.findIndex((l) => l.path === h.options.catalog[20].path),
    )
    assert.deepEqual(plan.lessons.find((l) => l.path === h.options.catalog[20].path).prerequisites, [
      h.options.catalog[0].path,
    ])
    for (const call of h.calls.slice(1)) assert.ok(targetData(call).targetIds.length <= 20)
    const input = JSON.parse(h.calls[0][0].content.split('以下是本次课程与学情数据：')[1])
    assert.equal(input.catalog.length, count)
    assert.deepEqual(input.mastery, [{ id: 'l1', concept: '已有知识点', level: 'needs-review' }])
    assert.equal(input.preferences.conversation[0].content, '采用稳步推进的方案')
    assert.ok(!h.calls[0][0].content.includes('第1课-完整课程名称.mp4'))
    assert.equal(plan.catalogVersion, 1)
    assert.ok(
      plan.lessons.every(
        (lesson) =>
          plan.modules.find((module) => module.id === lesson.moduleId).sourcePath === lessonDirectory(lesson.path),
      ),
    )
  })

test('批次漏掉课节时只补缺失编号，保留已生成状态、理由与顺序', async (t) => {
  const h = harness(t, 45)
  const base = h.options.complete
  let partial = false
  h.options.complete = async (messages) => {
    const data = targetData(messages)
    if (data?.targetIds.includes('l1') && !partial) {
      partial = true
      h.calls.push(structuredClone(messages))
      return { lessons: rows(data.targetIds.filter((id) => !['l2', 'l3'].includes(id))) }
    }
    return base(messages)
  }
  const plan = await generateLearningPlan(h.options)
  assert.equal(plan.lessons.length, 45)
  assert.equal(h.calls.length, 5)
  assert.deepEqual(targetData(h.calls[2]).targetIds, ['l2', 'l3'])
  assert.equal(plan.lessons.find((l) => l.path === h.options.catalog[2].path).status, 'skipped')
  assert.equal(plan.lessons.find((l) => l.path === h.options.catalog[0].path).reason, '按已确认学情选择 l1')
})

test('小课程原回复漏掉跳过课节时单独补齐，不将漏课默认为跳过或必修', async (t) => {
  const h = harness(t, 3)
  const complete = h.options.complete
  h.options.complete = async (messages) => {
    const data = targetData(messages)
    if (!data || data.targetIds.length !== 3) return complete(messages)
    h.calls.push(structuredClone(messages))
    return { lessons: rows(['l1', 'l2']) }
  }
  const plan = await generateLearningPlan(h.options)
  assert.equal(h.calls.length, 3)
  assert.deepEqual(targetData(h.calls[2]).targetIds, ['l3'])
  assert.equal(plan.lessons.find((l) => l.path === h.options.catalog[2].path).status, 'skipped')
  assert.equal(plan.lessons.length, 3)
})

test('补齐仍漏课或网络失败不返回残缺路线，重试只请求未完成批次', async (t) => {
  const h = harness(t, 45)
  const base = h.options.complete
  let fail = true
  h.options.complete = async (messages) => {
    const data = targetData(messages)
    if (data?.targetIds.includes('l21') && fail) {
      h.calls.push(structuredClone(messages))
      return { lessons: [] }
    }
    return base(messages)
  }
  await assert.rejects(generateLearningPlan(h.options), /未完成课节/)
  assert.equal(h.calls.length, 4)
  assert.equal([...h.cache.values()][0].values.length, 2)
  fail = false
  const plan = await generateLearningPlan(h.options)
  assert.equal(h.calls.length, 6)
  assert.equal(plan.lessons.length, 45)
  assert.deepEqual(
    targetData(h.calls[4]).targetIds,
    Array.from({ length: 20 }, (_, i) => `l${21 + i}`),
  )
})

test('JSON 语法错误纠正一次；传输错误不重放，失败批次可在新调用中恢复', async (t) => {
  const h = harness(t, 21)
  const base = h.options.complete
  let malformed = true,
    networkFailure = true
  h.options.complete = async (messages) => {
    const data = targetData(messages)
    if (data?.targetIds.includes('l1') && malformed) {
      malformed = false
      h.calls.push(structuredClone(messages))
      return parseAiJson('{"lessons":[')
    }
    if (data?.targetIds.includes('l21') && networkFailure) {
      h.calls.push(structuredClone(messages))
      throw Error('HTTP 520：网关异常')
    }
    return base(messages)
  }
  await assert.rejects(generateLearningPlan(h.options), /HTTP 520/)
  assert.equal(h.calls.length, 4)
  assert.ok(h.calls[2].at(-1).content.includes('修正回复'))
  networkFailure = false
  assert.equal((await generateLearningPlan(h.options)).lessons.length, 21)
  assert.equal(h.calls.length, 5)
})

for (const kind of ['unknown', 'duplicate', 'foreign-batch', 'module', 'dependency'])
  test(`拒绝 ${kind} 引用，不写入无效批次`, async (t) => {
    const h = harness(t, 21)
    const base = h.options.complete
    h.options.complete = async (messages) => {
      const data = targetData(messages)
      if (!data) return base(messages)
      h.calls.push(structuredClone(messages))
      const lessons = rows(data.targetIds)
      if (kind === 'unknown') lessons[0].id = 'l9999'
      if (kind === 'duplicate') lessons.push(lessons[0])
      if (kind === 'foreign-batch') lessons[0].id = 'l21'
      if (kind === 'module') lessons[0].moduleId = 'unknown'
      if (kind === 'dependency') lessons[0].prerequisites = ['l9999']
      return { lessons }
    }
    await assert.rejects(generateLearningPlan(h.options))
    assert.equal(h.calls.length, 3)
    assert.equal([...h.cache.values()][0].values.length, 1)
  })

test('跨批次循环在提交本批前被拒绝，修正当前批次后可以完成且不会卡在错误缓存', async (t) => {
  const h = harness(t, 21)
  const base = h.options.complete
  let corrected = false
  h.options.complete = async (messages) => {
    const data = targetData(messages)
    if (!data) return base(messages)
    h.calls.push(structuredClone(messages))
    const lessons = rows(data.targetIds)
    if (data.targetIds.includes('l1')) lessons.find((l) => l.id === 'l1').prerequisites = ['l21']
    else if (corrected) lessons[0].prerequisites = []
    else corrected = true
    return { lessons }
  }
  const plan = await generateLearningPlan(h.options)
  assert.equal(h.calls.length, 4)
  assert.ok(h.calls[3].at(-1).content.includes('循环依赖'))
  assert.deepEqual(plan.lessons.find((l) => l.path === h.options.catalog[20].path).prerequisites, [])
})

test('取消补齐请求后迟到结果被丢弃，不开始后续批次或写入当前批次', async (t) => {
  const h = harness(t, 45)
  const abort = new AbortController()
  h.options.signal = abort.signal
  const base = h.options.complete
  let release
  const waiting = new Promise((resolve) => (release = resolve))
  h.options.complete = async (messages) => {
    const data = targetData(messages)
    if (!data) return base(messages)
    h.calls.push(structuredClone(messages))
    if (h.calls.length === 2) return { lessons: [] }
    await waiting
    return { lessons: rows(data.targetIds) }
  }
  const task = generateLearningPlan(h.options)
  while (h.calls.length < 3) await settle()
  abort.abort()
  release()
  await assert.rejects(task, (error) => error.name === 'AbortError')
  assert.equal(h.calls.length, 3)
  assert.equal([...h.cache.values()][0].values.length, 1)
})

test('缓存保存失败后重试保留已取得回复；目录、日期、方案、课程或模型变化不能复用旧任务', async (t) => {
  const h = harness(t, 21)
  h.setFailWrite(true)
  await assert.rejects(generateLearningPlan(h.options), /保存失败/)
  assert.equal(h.calls.length, 1)
  h.setFailWrite(false)
  assert.equal((await generateLearningPlan(h.options)).lessons.length, 21)
  assert.equal(h.calls.length, 3)
  for (const change of [
    { courseId: 'another-course' },
    { today: '2026-11-03' },
    { request: '新的学习方案' },
    { settings: { ...h.options.settings, model: 'another-model' } },
    { settings: { ...h.options.settings, apiKey: 'different-private-key' } },
    { catalog: h.options.catalog.map((lesson) => ({ ...lesson, path: lesson.path.replace('.mp4', '.mkv') })) },
  ]) {
    const before = h.calls.length
    await generateLearningPlan({ ...h.options, ...change })
    assert.equal(h.calls.length, before + 3)
  }
  assert.ok(!JSON.stringify([...h.cache]).includes('different-private-key'))
})

test('整体方案缺周期或违背已确认时间时不能进入缓存，纠正失败不开始课节请求', async (t) => {
  const h = harness(t, 21)
  h.options.dailyMinutes = 90
  h.options.complete = async (messages) => {
    h.calls.push(structuredClone(messages))
    return { ...outline(), modules: catalogModules(h.options.catalog, h.options.courseName) }
  }
  await assert.rejects(generateLearningPlan(h.options), /指定的每日/)
  assert.equal(h.calls.length, 2)
  assert.equal(h.cache.size, 0)
})

test('明确原顺序和学习范围时不让 AI 逐课筛选；即使 AI 想改名、跳课，路线仍由用户决定', async (t) => {
  const h = harness(t, 493)
  h.options.catalog = h.options.catalog.map((entry, index) => ({
    ...entry,
    path: `${index < 30 ? '1 安装' : index < 60 ? '2 Python' : index < 90 ? '3 工具' : index < 220 ? '4 数学' : index < 350 ? '5 算法' : index < 480 ? '6 项目' : '环境'}/${index}.mp4`,
    done: index >= 90 && index < 95,
  }))
  h.options.constraints = readRouteDirective(
    emptyRouteConstraints(),
    '不学1、2、3和环境，其余都学。学习范围从4开始到6结束，按原目录顺序，不要改顺序。',
    h.options.catalog,
  ).constraints
  h.options.preferences.conversation.push({ role: 'assistant', content: '旧 AI 错误建议：跳过数学，从微积分开始。' })
  h.options.previous = {
    ...outline(),
    version: 1,
    createdAt: 1,
    lessons: h.options.catalog.map((entry) => ({
      path: entry.path,
      moduleId: 'foundation',
      status: 'required',
      reason: '旧判断',
      concepts: ['已有概念'],
      prerequisites: [],
    })),
    messages: [{ role: 'assistant', content: '旧 AI 的长篇方案' }],
  }
  h.options.complete = async (messages) => {
    h.calls.push(structuredClone(messages))
    const input = JSON.parse(messages[0].content.split('以下是本次课程与学情数据：')[1])
    assert.ok(input.fixedModules.length > 0)
    assert.ok(input.preferences.conversation.every((message) => message.role === 'user'))
    assert.deepEqual(Object.keys(input.previous).sort(), ['dailyMinutes', 'program'])
    assert.equal(targetData(messages), null)
    return {
      ...outline(),
      summary: '直接跳过数学进入算法',
      modules: [...input.fixedModules].reverse().map((module) => ({ ...module, title: 'AI 不应该改的标题' })),
    }
  }
  const plan = await generateLearningPlan(h.options)
  assert.equal(h.calls.length, 1)
  assert.equal(plan.lessons.length, 493)
  assert.deepEqual(
    plan.lessons.map((lesson) => lesson.path),
    h.options.catalog.map((lesson) => lesson.path),
  )
  assert.ok(
    plan.lessons.every(
      (lesson) => lesson.status === (pathInScope(lesson.path, h.options.constraints) ? 'required' : 'skipped'),
    ),
  )
  assert.deepEqual(
    plan.modules
      .filter((module) => plan.lessons.some((lesson) => lesson.moduleId === module.id && lesson.status === 'required'))
      .map((module) => module.title),
    ['4 数学', '5 算法', '6 项目'],
  )
  assert.ok(!plan.summary.includes('跳过数学'))
  assert.deepEqual(
    h.options.catalog.filter((entry) => entry.done).map((entry) => entry.path),
    h.options.catalog.slice(90, 95).map((entry) => entry.path),
  )
})

test('每周可用时间包含所有实践预算，超过上限的整体方案先纠正而不应用', async (t) => {
  const h = harness(t, 21)
  h.options.constraints = { ...emptyRouteConstraints(), weeklyMinutes: { min: 300, max: 600 } }
  const base = h.options.complete
  let first = true
  h.options.complete = async (messages) => {
    if (!targetData(messages) && first) {
      first = false
      h.calls.push(structuredClone(messages))
      return {
        ...outline(),
        modules: catalogModules(h.options.catalog, h.options.courseName),
        program: { ...outline().program, budget: { video: 30, code: 120, project: 0, recap: 30 } },
      }
    }
    return base(messages)
  }
  const plan = await generateLearningPlan(h.options)
  assert.equal(h.calls.length, 4)
  assert.ok(h.calls[1].at(-1).content.includes('学习时间超出'))
  assert.ok(Object.values(plan.program.budget).reduce((sum, value) => sum + value, 0) * 7 <= 600)
})

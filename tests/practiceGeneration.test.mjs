import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { programmingQuestion as code } from './fixtures/programming.mjs'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest = () => { throw Error("Unexpected database access") }',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { generatePracticeBatch, validateGeneratedPractice } = await import('../app/utils/practiceGeneration.ts')
const { practiceLearningContext, practiceFocusBatch } = await import('../app/utils/practiceLearning.ts')
const { practicePrompt } = await import('../app/utils/practice.ts')

const sources = [
  {
    id: 's1',
    kind: 'subtitle',
    text: 'JavaScript 用 filter 筛选数组，用 reduce 累加；空数组的初始值设为零。用函数封装处理逻辑。',
  },
]
const concept = (prompt = '数组累加为什么需要初始值？') => ({
  kind: 'single-choice',
  prompt,
  concepts: ['数组累加'],
  criteria: ['辨别初始值的作用'],
  knowledge: { category: 'concept', level: 'awareness', reason: '辨别初始值的作用。' },
  referenceAnswer: '初始值用于空数组并确定累加起点。',
  sourceIds: ['s1'],
  options: [
    { id: 'A', text: '确定累加起点' },
    { id: 'B', text: '决定数组长度' },
  ],
  correctOptionIds: ['A'],
})
const completion = structuredClone(code)
const implementation = {
  ...structuredClone(code),
  prompt: '独立实现负数的总和。',
  programming: { ...structuredClone(code.programming), mode: 'implementation' },
}
const standard = [completion, implementation, concept()]
const options = (extra = {}) => ({
  title: '数组',
  sources,
  scope: null,
  recent: [],
  count: 'auto',
  limit: 5,
  daily: false,
  preference: 'auto',
  languages: ['javascript'],
  learning: [],
  ...extra,
})
function review(questions, profile = {}) {
  return {
    profile: {
      programming: true,
      language: 'javascript',
      requiresProject: false,
      density: 'normal',
      reason: '本课教授数组筛选、累加和函数实现。',
      goals: [{ id: 'g1', skill: '处理数组', sourceIds: ['s1'] }],
      ...profile,
    },
    items: questions.map((q, index) => ({
      index,
      goalIds: ['g1'],
      withinScope: true,
      evidenceSupported: true,
      conditionsComplete: true,
      skillFocused: true,
      distinct: true,
      adapted: true,
      practice: q.programming?.mode ?? 'understanding',
      revision: '',
    })),
  }
}
const envelope = (questions, profile) => ({ version: 1, response: { questions }, review: review(questions, profile) })

test('普通课严格验收三题，少量两题、丰富四至五题、单目标一题和预算上限分别生效', () => {
  assert.throws(() => validateGeneratedPractice(envelope([concept()]), options()), /应生成 3 道题/)
  assert.throws(() => validateGeneratedPractice(envelope(standard.slice(0, 2)), options()), /应生成 3 道题/)
  assert.equal(validateGeneratedPractice(envelope(standard), options()).length, 3)
  assert.equal(validateGeneratedPractice(envelope(standard, { language: 'JavaScript' }), options()).length, 3)
  assert.equal(validateGeneratedPractice(envelope(standard.slice(0, 2), { density: 'small' }), options()).length, 2)
  const four = [...standard, concept('空数组应返回什么结果？')]
  assert.equal(validateGeneratedPractice(envelope(four, { density: 'rich' }), options()).length, 4)
  assert.throws(() => validateGeneratedPractice(envelope(four), options()), /应生成 3 道题/)
  assert.equal(validateGeneratedPractice(envelope([completion], { density: 'narrow' }), options()).length, 1)
  assert.equal(validateGeneratedPractice(envelope([completion]), options({ limit: 1 })).length, 1)
  assert.throws(() => validateGeneratedPractice({ questions: standard }, options()), /尚未通过内容审查/)
})

test('单题续练兼容单元素题组包装，仍拒绝空题组、多题和缺失题目字段', () => {
  const q = concept()
  for (const response of [q, [q], { questions: [q] }]) {
    const raw = envelope([q], { programming: false, language: '' })
    raw.response = response
    assert.equal(validateGeneratedPractice(raw, options({ count: 1, limit: 1 }))[0].prompt, q.prompt)
  }
  for (const response of [[], { questions: [] }, [q, q], { questions: [q, q] }]) {
    const raw = envelope([q], { programming: false, language: '' })
    raw.response = response
    assert.throws(() => validateGeneratedPractice(raw, options({ count: 1, limit: 1 })), /题目数量/)
  }
  const raw = envelope([q], { programming: false, language: '' })
  raw.response = { questions: [{ ...q, referenceAnswer: '' }] }
  assert.throws(() => validateGeneratedPractice(raw, options({ count: 1, limit: 1 })), /内容不完整/)
})

test('一次反馈全部题量、内容与覆盖问题，修正请求携带固定教学目标', async () => {
  const questions = [concept('调度概念'), concept('共享数据'), concept('阻塞操作')]
  const teaching = {
    programming: false,
    language: '',
    goals: [
      { id: 'g1', skill: '区分调度方式', sourceIds: ['s1'] },
      { id: 'g2', skill: '解释阻塞处理', sourceIds: ['s1'] },
    ],
  }
  let generations = 0,
    reviews = 0
  const raw = await generatePracticeBatch({
    ...options(),
    signal: new AbortController().signal,
    verify: async () => {
      throw Error('概念题不执行代码')
    },
    request: async (messages) => {
      if (messages[0].content.startsWith('审查')) {
        reviews++
        const result = review(questions.slice(0, generations === 1 ? 2 : 3), teaching)
        if (reviews === 1) {
          result.items[0].withinScope = false
          result.items[0].revision = '只考本课介绍的概念。'
          result.items[1].conditionsComplete = false
          result.items[1].revision = '给出共享数据操作是否会主动让出的条件。'
        } else result.items[2].goalIds = ['g2']
        return result
      }
      generations++
      if (generations === 2) {
        const correction = messages.at(-1).content
        for (const expected of [/应生成 3 道题/, /第 1 题需修正/, /第 2 题需修正/, /遗漏/, /"id":"g2"/])
          assert.match(correction, expected)
      }
      return { questions: questions.slice(0, generations === 1 ? 2 : 3) }
    },
  })
  assert.equal(generations, 2)
  assert.equal(reviews, 2)
  assert.equal(validateGeneratedPractice(raw, options()).length, 3)
})

test('编程比例、补全与独立实现组合、课程语言及实际提交要求不可由题型标签绕过', () => {
  const choices = [concept('问题一'), concept('问题二'), concept('问题三')]
  assert.throws(() => validateGeneratedPractice(envelope(choices), options()), /至少需要 2 道动手题/)
  const onlyCompletion = [completion, { ...completion, prompt: '另一个补全任务' }, concept()]
  assert.throws(() => validateGeneratedPractice(envelope(onlyCompletion), options()), /同时包含/)
  assert.equal(
    validateGeneratedPractice(
      envelope([completion, { ...completion, prompt: '补全第二题' }, { ...completion, prompt: '补全第三题' }]),
      options({ preference: 'completion' }),
    ).length,
    3,
  )
  const tasks = standard.map((q) => {
    const { programming: _programming, ...task } = q
    return { ...task, kind: 'task', knowledge: { category: 'procedure', level: 'proficiency', reason: '完成实现' } }
  })
  const submitted = envelope(tasks)
  submitted.review.items[0].practice = 'completion'
  submitted.review.items[1].practice = 'implementation'
  assert.throws(() => validateGeneratedPractice(submitted, options()), /动手题/)
  assert.equal(validateGeneratedPractice(submitted, options({ languages: [] })).length, 3)
  submitted.review.items[1].practice = 'understanding'
  assert.throws(() => validateGeneratedPractice(submitted, options({ languages: [] })), /动手题/)
  assert.throws(
    () => validateGeneratedPractice(envelope(standard, { language: 'python' }), options()),
    /语言必须与课程/,
  )
})

test('每题都需通过范围、业务条件、技能、去重和适应性审查，引用必须真实且支持目标', () => {
  for (const key of ['withinScope', 'evidenceSupported', 'conditionsComplete', 'skillFocused', 'distinct', 'adapted']) {
    const raw = envelope(standard)
    raw.review.items[1][key] = false
    raw.review.items[1].revision = '请练数组实现，不要背业务结局或引入未学框架。'
    assert.throws(() => validateGeneratedPractice(raw, options()), /第 2 题需修正/)
  }
  const missing = envelope(standard)
  missing.review.items.pop()
  assert.throws(() => validateGeneratedPractice(missing, options()), /未覆盖全部题目/)
  const duplicate = envelope(standard)
  duplicate.review.items[1].index = 0
  assert.throws(() => validateGeneratedPractice(duplicate, options()), /题号/)
  const invented = envelope(standard)
  invented.review.profile.goals[0].sourceIds = ['outside']
  assert.throws(() => validateGeneratedPractice(invented, options()), /无效/)
  const uncovered = envelope(standard, {
    goals: [
      { id: 'g1', skill: '筛选', sourceIds: ['s1'] },
      { id: 'g2', skill: '累加', sourceIds: ['s1'] },
    ],
  })
  assert.throws(() => validateGeneratedPractice(uncovered, options()), /遗漏/)
})

test('协程概念在不同字幕重复讲解时按语义核对依据，不要求题目与目标引用同一条字幕', () => {
  const material = [
    { id: 's4', kind: 'subtitle', text: '协程是一种用户态的轻量级线程。' },
    { id: 's37', kind: 'subtitle', text: '进程和线程由操作系统调度，协程由程序自身调度。' },
    { id: 's70', kind: 'subtitle', text: '协程的调度者是程序自身，程序员控制何时让出执行权限。' },
  ]
  const q = { ...concept('协程的调度由谁控制？'), sourceIds: ['s70'] }
  const raw = envelope([q], {
    programming: false,
    language: '',
    goals: [{ id: 'g1', skill: '辨别协程调度方式', sourceIds: ['s4', 's37'] }],
  })
  raw.response = q
  const opts = options({ sources: material, count: 1, limit: 1 })
  assert.equal(validateGeneratedPractice(raw, opts).length, 1)
  raw.review.items[0].evidenceSupported = false
  raw.review.items[0].revision = '引用的材料没有说明调度方式。'
  assert.throws(() => validateGeneratedPractice(raw, opts), /引用的材料没有说明/)
  delete raw.review.items[0].evidenceSupported
  assert.throws(() => validateGeneratedPractice(raw, opts), /缺少检查结果/)
  raw.review.items[0].evidenceSupported = true
  raw.response.sourceIds = ['invented']
  assert.throws(() => validateGeneratedPractice(raw, opts), /不存在的学习材料/)
})

test('先修正少出题，再修正整组选择题，第三次通过才返回可保存结果', async () => {
  const controller = new AbortController(),
    corrections = [],
    verified = []
  let generations = 0,
    reviews = 0
  const raw = await generatePracticeBatch({
    ...options(),
    signal: controller.signal,
    verify: async (exercise) => {
      verified.push(exercise)
    },
    request: async (messages) => {
      if (messages[0].content.startsWith('审查课后练习质量')) {
        reviews++
        return review(JSON.parse(messages[0].content.split('输入数据：')[1]).questions)
      }
      generations++
      if (messages.length > 1) corrections.push(messages.at(-1).content)
      return {
        questions:
          generations === 1
            ? [concept()]
            : generations === 2
              ? [concept('甲'), concept('乙'), concept('丙')]
              : standard,
      }
    },
  })
  assert.equal(generations, 3)
  assert.equal(reviews, 3)
  assert.equal(verified.length, 2)
  assert.match(corrections[0], /应生成 3 道题/)
  assert.match(corrections[1], /至少需要 2 道动手题/)
  assert.equal(validateGeneratedPractice(raw, options()).length, 3)
})

test('持续不合格最多修正两次，网络失败和取消不触发额外生成', async () => {
  let requests = 0
  await assert.rejects(
    generatePracticeBatch({
      ...options(),
      signal: new AbortController().signal,
      verify: async () => {},
      request: async (messages) => {
        requests++
        return messages[0].content.startsWith('审查') ? review([concept()]) : { questions: [concept()] }
      },
    }),
    /应生成 3 道题/,
  )
  assert.equal(requests, 4) // 首次审查后固定三题要求；后两次少出题在本地就被拒绝。
  requests = 0
  await assert.rejects(
    generatePracticeBatch({
      ...options(),
      signal: new AbortController().signal,
      verify: async () => {},
      request: async () => {
        requests++
        throw Error('offline')
      },
    }),
    /offline/,
  )
  assert.equal(requests, 1)
  const controller = new AbortController()
  requests = 0
  await assert.rejects(
    generatePracticeBatch({
      ...options(),
      signal: controller.signal,
      verify: async () => {},
      request: async () => {
        requests++
        controller.abort()
        return { questions: standard }
      },
    }),
    { name: 'AbortError' },
  )
  assert.equal(requests, 1)
})

function record(id, { help = 0, result = 'solid', at = 1, gaps = [], codeRun, concepts = ['数组累加'] } = {}) {
  return {
    id,
    path: 'a.mp4',
    createdAt: at,
    scope: null,
    sources,
    question: { ...concept(), concepts },
    draft: '',
    attempts: [
      {
        answer: 'A',
        helpLevel: help,
        at,
        codeRun,
        feedback: { result, strengths: [], gaps, nextStep: '继续', sourceIds: ['s1'] },
      },
    ],
  }
}
test('续练区分错误、完整答案、提示、独立完成及未知记录，重复提交同一题不构成连续掌握', () => {
  const records = [
    record('wrong', { result: 'retry', at: 6, gaps: ['退出条件错误'] }),
    record('answer', { help: 4, at: 5 }),
    record('hint', { help: 2, at: 4 }),
    record('independent2', { at: 3 }),
    record('independent1', { at: 2 }),
    record('legacy', { at: 1 }),
  ]
  delete records.at(-1).attempts[0].helpLevel
  records[3].help = { level: 4, hints: [] } // 提交后查看答案不改写之前独立完成的事实。
  const context = practiceLearningContext(records)
  assert.deepEqual(
    context.map((item) => item.action),
    ['remediate', 'transfer', 'scaffold', 'advance', 'consolidate', 'unknown'],
  )
  const single = record('repeat')
  single.attempts.push({ ...single.attempts[0], at: 2 })
  assert.equal(practiceLearningContext([single])[0].action, 'consolidate')
  assert.equal(
    practiceLearningContext([
      record('two-skills', { at: 2, concepts: ['数组累加', '数组筛选'] }),
      record('one-skill'),
    ])[0].action,
    'consolidate',
  )
  const failed = record('failed', { codeRun: { cases: [{ id: 'empty', status: 'failed' }] } })
  assert.equal(practiceLearningContext([failed])[0].action, 'remediate')
  const prompt = practicePrompt('数组', sources, null, [], 1, false, 'auto', ['javascript'], 5, context)[0].content
  const data = JSON.parse(prompt.split('输入数据：')[1])
  assert.equal(data.learning[0].gaps[0], '退出条件错误')
  assert.equal(data.learning.at(-1).helpLevel, null)
  assert.equal('answer' in data.learning[0], false)
})

test('单题续练优先选错误知识所在材料，今日巩固保持一道且基础课不强制大项目', () => {
  const other = [{ id: 's2', kind: 'subtitle', text: '另一个主题' }]
  assert.equal(practiceFocusBatch([other, sources], [record('wrong', { result: 'retry' })], 0), sources)
  assert.equal(
    practiceFocusBatch([other, sources], [record('wrong', { result: 'retry' }), record('fixed', { at: 2 })], 0),
    other,
  )
  const prompt = practicePrompt('数组', sources, null, [], 1, true)[0].content
  assert.match(prompt, /基础技能时出一个短小应用/)
  assert.match(prompt, /不必每天强行凑大项目/)
  assert.match(prompt, /生成 1 道「今日巩固」/)
})

test('修正时固定材料分类，不允许把实操课改成概念课绕过编程数量', async () => {
  const choices = [concept('甲'), concept('乙'), concept('丙')]
  let reviews = 0
  await assert.rejects(
    generatePracticeBatch({
      ...options(),
      signal: new AbortController().signal,
      verify: async () => {},
      request: async (messages) => {
        if (!messages[0].content.startsWith('审查')) return { questions: choices }
        reviews++
        const data = JSON.parse(messages[0].content.split('输入数据：')[1])
        if (reviews > 1) assert.equal(data.teachingProfile.programming, true)
        return review(choices, reviews === 1 ? {} : { programming: false, language: '' })
      },
    }),
    /至少需要 2 道动手题/,
  )
  assert.equal(reviews, 3)
})

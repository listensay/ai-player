import assert from 'node:assert/strict'
import { approvedPracticeReview } from './fixtures/practiceReview.mjs'
globalThis.approvedPracticeReview = approvedPracticeReview
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { programmingQuestion as codeQuestion } from './fixtures/programming.mjs'
import { verifyProgrammingExercise } from '../app/utils/programmingRunner.ts'
const boundaries = {
  '~/utils/database': ['databaseRequest'],
  '~/utils/dbClient': ['dbFetchPractice', 'dbSavePractice'],
  '~/utils/guideAi': ['requestGuideJson'],
  '~/utils/programmingEnvironments': ['availableProgrammingLanguages'],
  '~/utils/programmingRunner': ['verifyProgrammingExercise'],
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/guideAi')
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(`export const requestGuideJson = (...args) =>
        args[1][0].content.startsWith('审查课后练习质量。')
          ? (globalThis.autoPracticeIO.reviewPractice ?? globalThis.approvedPracticeReview)(args[1])
          : globalThis.autoPracticeIO.requestGuideJson(...args)`),
        shortCircuit: true,
      }
    if (boundaries[specifier])
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(
            boundaries[specifier]
              .map((name) => `export const ${name} = (...args) => globalThis.autoPracticeIO.${name}(...args)`)
              .join('\n'),
          ),
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { generateAutomaticPractice, automaticPracticeRevision, createAutomaticPracticePreparer } =
  await import('../app/utils/automaticPractice.ts')
const { restorePractice } = await import('../app/utils/practice.ts')
const settings = { baseUrl: 'https://example.test/v1', model: 'test', apiKey: '', timeoutMinutes: 1 }
const cues = [
  {
    start: 0,
    end: 30,
    text: '变量用于给数据命名，列表可以保存多个值。访问列表元素使用索引，从零开始计数。列表推导式可以筛选和转换数据，避免重复编写循环。',
  },
]
function fixture() {
  const saved = new Map()
  const executions = []
  let calls = 0
  globalThis.autoPracticeIO = {
    availableProgrammingLanguages: async () => ['javascript', 'python'],
    verifyProgrammingExercise: (exercise, signal) =>
      verifyProgrammingExercise(exercise, signal, async (input) => {
        executions.push(input)
        return {
          version: 1,
          mode: input.mode,
          code: input.code,
          at: Date.now(),
          cases: input.exercise.tests.map((test) => ({
            id: test.id,
            status: input.code === input.exercise.referenceCode ? 'passed' : 'failed',
            actual: '',
            output: '',
            error: '',
            durationMs: 1,
          })),
        }
      }),
    dbFetchPractice: async (id) => structuredClone(saved.get(id) ?? {}),
    dbSavePractice: async (id, path, records) => {
      saved.set(id, { ...saved.get(id), [path]: structuredClone(records) })
      return true
    },
    requestGuideJson: async (_settings, messages) => {
      calls++
      const source = JSON.parse(messages[0].content.split('输入数据：')[1]).sources[0]
      return {
        kind: 'single-choice',
        prompt: '列表的第一个元素使用哪个索引？',
        concepts: ['列表索引'],
        criteria: ['选择一个答案'],
        referenceAnswer: '索引从零开始。',
        sourceIds: [source.id],
        knowledge: { category: 'concept', level: 'awareness', reason: '辨认索引规则。' },
        options: [
          { id: 'A', text: '0' },
          { id: 'B', text: '1' },
        ],
        correctOptionIds: ['A'],
      }
    },
  }
  return { saved, executions, calls: () => calls }
}
test('自动练习保存未作答记录，重复完成事件和重新打开不重复出题', async () => {
  const h = fixture()
  const first = generateAutomaticPractice('a', 'a.mp4', '列表', cues, settings)
  assert.equal(generateAutomaticPractice('a', 'a.mp4', '列表', cues, settings), first)
  await first
  const records = h.saved.get('a')['a.mp4']
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].attempts, [])
  assert.equal(records[0].scope, null)
  assert.equal(automaticPracticeRevision('a', 'a.mp4'), 1)
  await generateAutomaticPractice('a', 'a.mp4', '列表', cues, settings)
  assert.equal(h.calls(), 1)
})

test('普通实操课自动纠正单题结果，通过三题及内容审查后才保存两道编程题', async () => {
  const h = fixture()
  const original = globalThis.autoPracticeIO.requestGuideJson
  let generated = 0
  globalThis.autoPracticeIO.requestGuideJson = async (...args) => {
    generated++
    const choice = await original(...args)
    if (generated === 1) return choice
    assert.match(args[1].at(-1).content, /应生成 3 道题/)
    return {
      questions: [
        codeQuestion,
        {
          ...structuredClone(codeQuestion),
          prompt: '独立实现数组总和。',
          programming: { ...structuredClone(codeQuestion.programming), mode: 'implementation' },
        },
        choice,
      ],
    }
  }
  globalThis.autoPracticeIO.reviewPractice = (messages) => {
    assert.equal(h.saved.size, 0)
    const result = approvedPracticeReview(messages)
    result.profile = { ...result.profile, density: 'normal', programming: true, language: 'javascript' }
    return result
  }
  await generateAutomaticPractice('three-code', 'a.mp4', 'JavaScript 数组', cues, settings)
  const records = h.saved.get('three-code')['a.mp4']
  assert.equal(generated, 2)
  assert.equal(records.length, 3)
  assert.equal(records.filter((record) => record.question.kind === 'code').length, 2)
  assert.equal(h.executions.length, 4)
  assert.equal(restorePractice(records, ['a.mp4']).length, 3)
})
test('并行课节使用各自的课程和路径保存，不串课', async () => {
  const h = fixture()
  await Promise.all(['b', 'c'].map((id) => generateAutomaticPractice(id, 'same.mp4', id, cues, settings)))
  assert.equal(h.saved.get('b')['same.mp4'][0].path, 'same.mp4')
  assert.equal(h.saved.get('c')['same.mp4'].length, 1)
  assert.notEqual(h.saved.get('b')['same.mp4'][0].id, h.saved.get('c')['same.mp4'][0].id)
})
test('AI 或保存失败不会留下伪完成记录，之后可重试', async () => {
  const h = fixture()
  const request = globalThis.autoPracticeIO.requestGuideJson
  globalThis.autoPracticeIO.requestGuideJson = async () => {
    throw Error('offline')
  }
  await assert.rejects(generateAutomaticPractice('d', 'd.mp4', '列表', cues, settings), /offline/)
  assert.equal(h.saved.size, 0)
  globalThis.autoPracticeIO.requestGuideJson = request
  await generateAutomaticPractice('d', 'd.mp4', '列表', cues, settings)
  assert.equal(h.saved.get('d')['d.mp4'].length, 1)
})

test('字幕与页面重复触发仅提示一次，关闭重开不自动重发，显式重试仍可成功', async () => {
  const h = fixture()
  const original = globalThis.autoPracticeIO.requestGuideJson
  let requests = 0
  const errors = []
  globalThis.autoPracticeIO.requestGuideJson = async () => {
    requests++
    throw Error('offline')
  }
  const prepare = createAutomaticPracticePreparer((error, id, path) => errors.push([error.message, id, path]))
  const args = ['duplicate-error', 'a.mp4', '协程介绍', cues, settings]
  const first = prepare(...args)
  assert.equal(prepare(...args), first)
  await first
  await prepare(...structuredClone(args))
  assert.equal(requests, 1)
  assert.deepEqual(errors, [['offline', 'duplicate-error', 'a.mp4']])
  globalThis.autoPracticeIO.requestGuideJson = original
  await generateAutomaticPractice(...args)
  assert.equal(h.saved.get('duplicate-error')['a.mp4'].length, 1)
})

test('自动准备按课节隔离，材料或配置变更后可重新尝试', async () => {
  const calls = [],
    errors = []
  const prepare = createAutomaticPracticePreparer(
    (error, id, path) => errors.push([error.message, id, path]),
    async (...args) => {
      calls.push(args)
      throw Error('offline')
    },
  )
  const args = ['changed', 'a.mp4', '协程介绍', cues, settings]
  await prepare(...args)
  await prepare('other-course', ...args.slice(1))
  await prepare('changed', 'b.mp4', ...args.slice(2))
  await prepare(...args.slice(0, 4), { ...settings, model: 'new-model' })
  await prepare(...args.slice(0, 3), [{ ...cues[0], text: cues[0].text + '修正' }], settings)
  assert.equal(calls.length, 5)
  assert.equal(errors.length, 5)
})

test('配置在请求中变化时等待旧任务结束，只执行最新快照并抑制旧失败提示', async () => {
  let rejectFirst
  const calls = [],
    errors = []
  const prepare = createAutomaticPracticePreparer(
    (error) => errors.push(error.message),
    async (...args) => {
      calls.push(args)
      if (calls.length === 1)
        await new Promise((_, reject) => {
          rejectFirst = reject
        })
    },
  )
  const first = prepare('pending', 'a.mp4', '协程介绍', cues, settings)
  await new Promise((resolve) => setImmediate(resolve))
  const submitted = { ...settings, model: 'latest-model' }
  const middle = prepare('pending', 'a.mp4', '协程介绍', cues, { ...settings, model: 'intermediate-model' })
  const latest = prepare('pending', 'a.mp4', '协程介绍', cues, submitted)
  submitted.model = 'edited-after-submission'
  rejectFirst(Error('old failure'))
  await Promise.all([first, middle, latest])
  assert.deepEqual(errors, [])
  assert.deepEqual(
    calls.map((args) => args[4].model),
    [settings.model, 'latest-model'],
  )
})
test('未配置 AI 不发送请求，也不写入空练习', async () => {
  const h = fixture()
  await assert.rejects(generateAutomaticPractice('e', 'e.mp4', '列表', cues, { ...settings, model: '' }), /配置 AI/)
  assert.equal(h.calls(), 0)
  assert.equal(h.saved.size, 0)
})

test('自动生成 Python 题组，检测可用语言并验证代码后保存可继续作答的草稿', async () => {
  const h = fixture()
  const python = structuredClone(codeQuestion)
  python.programming = {
    ...python.programming,
    language: 'python',
    starterCode: 'def sumPositive(numbers):\n    # TODO: 筛选并累加正数\n    pass',
    referenceCode: 'def sumPositive(numbers):\n    return sum(n for n in numbers if n > 0)',
    signature: 'sumPositive(numbers: list) -> int，返回正数之和，空列表返回 0。',
  }
  const request = globalThis.autoPracticeIO.requestGuideJson
  globalThis.autoPracticeIO.requestGuideJson = async (settings, messages) => {
    assert.match(messages[0].content, /本次可用编程语言：javascript, python/)
    assert.match(messages[0].content, /至少一半（向上取整）为 code/)
    assert.match(messages[0].content, /自主评估并决定生成最合适数量/)
    return { questions: [python, await request(settings, messages)] }
  }
  await generateAutomaticPractice('python', 'a.mp4', 'Python 列表', cues, settings)
  const records = h.saved.get('python')['a.mp4']
  assert.equal(records.length, 2)
  assert.equal(new Set(records.map((r) => r.groupId)).size, 1)
  assert.equal(records[0].draft, python.programming.starterCode)
  assert.deepEqual(records[0].question.programming, python.programming)
  assert.equal(restorePractice(records, ['a.mp4'])[0].draft, python.programming.starterCode)
  assert.deepEqual(records[0].attempts, [])
  assert.deepEqual(
    h.executions.map((input) => input.code),
    [python.programming.referenceCode, python.programming.starterCode],
  )
})

test('缺少环境时仍要求代码实现任务，非法语言、错误参考实现或无待填代码均不保存', async () => {
  for (const failure of ['environment', 'reference', 'starter']) {
    const h = fixture()
    const code = structuredClone(codeQuestion)
    globalThis.autoPracticeIO.requestGuideJson = async () => code
    if (failure === 'environment') globalThis.autoPracticeIO.availableProgrammingLanguages = async () => []
    if (failure === 'reference' || failure === 'starter')
      globalThis.autoPracticeIO.verifyProgrammingExercise = (exercise, signal) =>
        verifyProgrammingExercise(exercise, signal, async () => ({
          cases: exercise.tests.map((test) => ({ id: test.id, status: failure === 'reference' ? 'failed' : 'passed' })),
        }))
    await assert.rejects(
      generateAutomaticPractice(`invalid-${failure}`, 'a.mp4', '编程', cues, settings),
      failure === 'environment' ? /未安装.*编程环境/ : failure === 'reference' ? /参考实现未通过/ : /初始代码已通过/,
    )
    assert.equal(h.saved.size, 0)
  }
  const h = fixture()
  globalThis.autoPracticeIO.availableProgrammingLanguages = async () => []
  globalThis.autoPracticeIO.requestGuideJson = async (_settings, messages) => {
    assert.match(messages[0].content, /使用 task.*提交实现/)
    const { programming: _programming, ...task } = codeQuestion
    return { ...task, kind: 'task' }
  }
  await generateAutomaticPractice('no-env', 'a.mp4', '编程', cues, settings)
  assert.equal(h.saved.get('no-env')['a.mp4'][0].question.kind, 'task')
  assert.equal(h.executions.length, 0)
})

test('自动出题覆盖长逐字稿的末尾，后续批次不合格时整组不保存', async () => {
  const longCues = Array.from({ length: 8 }, (_, i) => ({
    start: i * 30,
    end: i * 30 + 30,
    text: `主题${i}：${'循环用于处理多次输入。'.repeat(180)}`,
  }))
  longCues.push({ start: 240, end: 270, text: '末尾知识：使用 return 提前结束函数，区别于 break 只结束当前循环。' })
  for (const invalid of [false, true]) {
    const h = fixture()
    const batches = []
    const request = globalThis.autoPracticeIO.requestGuideJson
    globalThis.autoPracticeIO.requestGuideJson = async (settings, messages) => {
      const data = JSON.parse(messages[0].content.split('输入数据：')[1])
      batches.push(data.sources)
      const question = await request(settings, messages)
      return {
        ...question,
        prompt: `第 ${batches.length} 批练习`,
        sourceIds: invalid && batches.length > 1 ? ['missing'] : question.sourceIds,
      }
    }
    const job = generateAutomaticPractice(`long-${invalid}`, 'a.mp4', '循环', longCues, settings)
    if (invalid) {
      await assert.rejects(job, /不存在的学习材料/)
      assert.equal(h.saved.size, 0)
    } else {
      await job
      assert.ok(batches.length > 1)
      assert.match(batches.flat().at(-1).text, /末尾知识/)
      assert.equal(h.saved.get('long-false')['a.mp4'].length, batches.length)
    }
  }
})

test('自动题组拒绝空题组、超限题组及重复题目', async () => {
  for (const kind of ['empty', 'overflow', 'duplicate']) {
    const h = fixture()
    const request = globalThis.autoPracticeIO.requestGuideJson
    globalThis.autoPracticeIO.requestGuideJson = async (...args) => ({
      questions: Array(kind === 'empty' ? 0 : kind === 'overflow' ? 21 : 2).fill(await request(...args)),
    })
    await assert.rejects(generateAutomaticPractice(kind, 'a.mp4', '列表', cues, settings), /数量|已有题目/)
    assert.equal(h.saved.size, 0)
  }
})

test('长课程为后续批次预留题目额度，全部材料出题后一起保存且不超过 20 题', async () => {
  for (const batchCount of [7, 20]) {
    const h = fixture()
    const longCues = Array.from({ length: batchCount }, (_, index) => ({
      start: index * 30,
      end: (index + 1) * 30,
      text: `第 ${index + 1} 批讲解：`.padEnd(12000, '循环与判断'),
    }))
    const seen = []
    const request = globalThis.autoPracticeIO.requestGuideJson
    globalThis.autoPracticeIO.requestGuideJson = async (settings, messages) => {
      const prompt = messages[0].content
      const limit = Number(prompt.match(/本批最多 (\d+) 题/)[1])
      const data = JSON.parse(prompt.split('输入数据：')[1])
      seen.push(...data.sources)
      assert.ok(limit >= 1)
      if (limit === 1) {
        assert.match(prompt, /生成 1 道互不重复/)
        assert.doesNotMatch(prompt, /生成 2–5 道|数量通常为 2–5 题/)
      }
      const question = await request(settings, messages)
      return {
        questions: Array.from({ length: limit }, (_, index) => ({
          ...question,
          prompt: `${data.sources[0].id} 的第 ${index + 1} 题`,
        })),
      }
    }
    await generateAutomaticPractice(`budget-${batchCount}`, 'a.mp4', '循环', longCues, settings)
    const records = h.saved.get(`budget-${batchCount}`)['a.mp4']
    assert.equal(h.calls(), batchCount)
    assert.equal(records.length, 20)
    assert.equal(restorePractice(records, ['a.mp4']).length, 20)
    assert.equal(new Set(records.map((record) => record.groupId)).size, 1)
    assert.equal(seen.map((source) => source.text).join(''), longCues.map((cue) => cue.text).join(''))
  }
})

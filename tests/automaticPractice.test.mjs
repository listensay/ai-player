import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
const boundaries = {
  '~/utils/database': ['databaseRequest'],
  '~/utils/dbClient': ['dbFetchPractice', 'dbSavePractice'],
  '~/utils/guideAi': ['requestGuideJson'],
}
registerHooks({
  resolve(specifier, context, next) {
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
const { generateAutomaticPractice, automaticPracticeRevision } = await import('../app/utils/automaticPractice.ts')
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
  let calls = 0
  globalThis.autoPracticeIO = {
    dbFetchPractice: async (id) => structuredClone(saved.get(id) ?? {}),
    dbSavePractice: async (id, path, records) => {
      saved.set(id, { ...saved.get(id), [path]: structuredClone(records) })
      return true
    },
    requestGuideJson: async (_settings, messages) => {
      calls++
      const source = JSON.parse(messages.at(-1).content.split('输入数据：')[1]).sources[0]
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
  return { saved, calls: () => calls }
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
test('未配置 AI 不发送请求，也不写入空练习', async () => {
  const h = fixture()
  await assert.rejects(generateAutomaticPractice('e', 'e.mp4', '列表', cues, { ...settings, model: '' }), /配置 AI/)
  assert.equal(h.calls(), 0)
  assert.equal(h.saved.size, 0)
})

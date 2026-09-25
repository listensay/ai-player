import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, reactive, ref } from 'vue'

// 只替换网络、文件和数据库边界；使用实际 Vue 状态、题目校验及练习流程。
const boundaries = {
  '~/utils/guideAi': ['requestGuideJson'],
  '~/utils/guideMedia': ['loadLessonSubtitles'],
  '~/utils/dbClient': ['dbFetchPractice', 'dbSavePractice'],
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (boundaries[specifier]) {
      const source = boundaries[specifier].map(name => `export const ${name} = (...args) => globalThis.practiceTestIO.${name}(...args)`).join('\n')
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    if (specifier.startsWith('~/')) return nextResolve(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return nextResolve(specifier, context)
  },
})

const { useLessonPractice } = await import('../app/composables/useLessonPractice.ts')
const { appendPracticeRecord, restorePractice, isRepeatedPracticeQuestion, practiceAnswerText } = await import('../app/utils/practice.ts')
const note = '变量用于给数据命名，列表可以保存多个值。访问列表元素使用索引，从零开始计数。列表推导式可以筛选和转换数据，避免重复编写循环。'
const sources = [{ id: 's1', kind: 'note', text: note }]
const question = (prompt = '列表的第一个元素使用哪个索引？') => ({
  kind: 'single-choice', prompt, concepts: ['列表索引'], criteria: ['选择一个答案'],
  referenceAnswer: '索引从零开始。', sourceIds: ['s1'],
  knowledge: { category: 'concept', level: 'awareness', reason: '辨认索引规则。' },
  options: [{ id: 'A', text: '0' }, { id: 'B', text: '1' }], correctOptionIds: ['A'],
})
const record = (id, path = 'a.mp4', createdAt = 1) => ({
  id, path, createdAt, scope: null, sources, question: question(), draft: '', attempts: [],
})
const video = path => ({ path, title: path.slice(0, -4) })
const course = id => ({ id, videos: [video('a.mp4'), video('b.mp4')] })
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness(t, overrides = {}) {
  const saves = [], calls = []
  const io = {
    dbFetchPractice: async () => ({}),
    dbSavePractice: async (...args) => { saves.push(args); return true },
    loadLessonSubtitles: async () => [],
    requestGuideJson: async (...args) => { calls.push(args); return question() },
    ...overrides,
  }
  globalThis.practiceTestIO = io
  const activeCourse = ref(course('one'))
  const settings = reactive({ baseUrl: 'https://example.test/v1', model: 'test', apiKey: '', timeoutMinutes: 1 })
  const available = ref(true)
  let practice
  const renderer = createRenderer({
    createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null,
  })
  const app = renderer.createApp({ setup() { practice = useLessonPractice(activeCourse, settings, available); return () => null } })
  app.mount({})
  t.after(() => app.unmount())
  return { practice, saves, calls, io, settings, available, course: activeCourse }
}
async function open(h, path = 'a.mp4') { await h.practice.open(video(path), null, note) }

test('每课节独立保留 20 题，追加新题不挤掉其他课节', () => {
  const old = Array.from({ length: 20 }, (_, i) => record(`a${i}`, 'a.mp4', 20 - i))
  const other = Array.from({ length: 20 }, (_, i) => record(`b${i}`, 'b.mp4', 20 - i))
  const result = appendPracticeRecord([...old, ...other], record('new', 'a.mp4', 21))
  assert.equal(result.length, 40)
  assert.equal(result[0].id, 'new')
  assert.ok(!result.some(r => r.id === 'a19'))
  assert.deepEqual(result.filter(r => r.path === 'b.mp4'), other)
})

test('恢复跨课节超过 20 道题，跳过坏记录和课程外路径', () => {
  const records = ['a.mp4', 'b.mp4'].flatMap(path => Array.from({ length: 25 }, (_, i) => record(`${path}-${i}`, path, 25 - i)))
  const result = restorePractice([null, { ...record('bad'), question: {} }, record('outside', 'x.mp4'), ...records], ['a.mp4', 'b.mp4'])
  assert.equal(result.length, 40)
  assert.equal(result.filter(r => r.path === 'a.mp4').length, 20)
  assert.equal(result.filter(r => r.path === 'b.mp4').length, 20)
})

test('重复检测忽略空白和选项顺序，但允许相同题干使用不同选项', () => {
  const original = question('读取列表\n第一个元素')
  assert.equal(isRepeatedPracticeQuestion({ ...original, prompt: '读取列表 第一个元素', options: [...original.options].reverse() }, [original]), true)
  assert.equal(isRepeatedPracticeQuestion({ ...original, options: [{ id: 'A', text: '2' }, { id: 'B', text: '3' }] }, [original]), false)
  assert.equal(isRepeatedPracticeQuestion(question('a + b'), [question('a - b')]), false)
})

test('同一视频连续出题、切题及重新打开保留草稿', async t => {
  const h = harness(t)
  await open(h)
  await h.practice.generate()
  const first = h.practice.current.value.id
  h.practice.updateDraft('["A"]')
  h.io.requestGuideJson = async () => question('列表索引从哪个数字开始？')
  await h.practice.generate()
  assert.equal(h.practice.history.value.length, 2)
  assert.equal(h.practice.current.value.draft, '')
  h.practice.select(first)
  assert.equal(h.practice.current.value.draft, '["A"]')
  h.practice.close()
  await open(h)
  assert.equal(h.practice.history.value.length, 2)
  assert.notEqual(h.practice.current.value.id, first)
  assert.equal(h.saves.at(-1)[2].length, 2)
})

test('历史未读完时等待，关闭也不会把空记录写回数据库', async t => {
  const pending = deferred()
  const h = harness(t, { dbFetchPractice: () => pending.promise })
  const opening = open(h)
  await h.practice.generate()
  h.practice.close()
  assert.equal(h.saves.length, 0)
  pending.resolve({ 'a.mp4': [record('saved')] })
  await opening
  await open(h)
  assert.equal(h.practice.current.value.id, 'saved')
  assert.equal(h.calls.length, 0)
})

test('读取失败不覆盖历史，重新打开可以重试', async t => {
  const h = harness(t, { dbFetchPractice: async () => { throw new Error('read failed') } })
  await open(h)
  assert.match(h.practice.state.storageError, /读取失败/)
  await h.practice.generate()
  h.practice.close()
  assert.equal(h.saves.length, 0)
  h.io.dbFetchPractice = async () => ({ 'a.mp4': [record('saved')] })
  await open(h)
  assert.equal(h.practice.current.value.id, 'saved')
  assert.equal(h.practice.state.storageError, '')
})

test('切换课程后丢弃旧课程迟到的读取结果', async t => {
  const pending = deferred()
  const h = harness(t, { dbFetchPractice: id => id === 'one' ? pending.promise : Promise.resolve({ 'b.mp4': [record('new-course', 'b.mp4')] }) })
  h.course.value = course('two')
  await tick()
  pending.resolve({ 'a.mp4': [record('old-course')] })
  await tick()
  assert.deepEqual(h.practice.state.records.map(r => r.id), ['new-course'])
})

test('空答案不能提交，客观题本地核对，重复提交不消耗次数', async t => {
  const h = harness(t, { dbFetchPractice: async () => ({ 'a.mp4': [record('saved')] }) })
  await open(h)
  assert.equal(h.practice.canReview.value, false)
  await h.practice.review()
  assert.equal(h.practice.current.value.attempts.length, 0)
  h.available.value = false
  h.practice.updateDraft('["A"]')
  assert.equal(h.practice.canReview.value, true)
  await h.practice.review()
  assert.equal(h.practice.current.value.attempts[0].feedback.result, 'solid')
  assert.equal(h.practice.answerSubmitted.value, true)
  assert.equal(h.practice.canReview.value, false)
  await h.practice.review()
  assert.equal(h.practice.current.value.attempts.length, 1)
  assert.equal(h.calls.length, 0)
})

test('修改答案可以再交，每题最多三次反馈', async t => {
  const h = harness(t, { dbFetchPractice: async () => ({ 'a.mp4': [record('saved')] }) })
  await open(h)
  for (const id of ['A', 'B', 'A', 'B']) {
    h.practice.updateDraft(JSON.stringify([id]))
    await h.practice.review()
  }
  assert.equal(h.practice.current.value.attempts.length, 3)
  assert.equal(h.practice.canReview.value, false)
})

test('多选的选择顺序不改变提交的答案', () => {
  const q = { ...question(), kind: 'multiple-choice', correctOptionIds: ['A', 'B'] }
  assert.equal(practiceAnswerText(q, '["B","A"]'), practiceAnswerText(q, '["A","B"]'))
})

test('重复题和无效来源不替换当前题目', async t => {
  const h = harness(t, { dbFetchPractice: async () => ({ 'a.mp4': [record('saved')] }) })
  await open(h)
  await h.practice.generate()
  assert.match(h.practice.state.error, /已有题目/)
  assert.equal(h.practice.history.value.length, 1)
  h.io.requestGuideJson = async () => ({ ...question('新题'), sourceIds: ['missing'] })
  await h.practice.generate()
  assert.match(h.practice.state.error, /不存在/)
  assert.equal(h.practice.current.value.id, 'saved')
})

test('取消生成后，即使服务返回也不新增题目', async t => {
  const pending = deferred()
  const h = harness(t, { requestGuideJson: () => pending.promise })
  await open(h)
  const generation = h.practice.generate()
  h.practice.cancel()
  pending.resolve(question())
  await generation
  assert.equal(h.practice.history.value.length, 0)
  assert.equal(h.practice.state.busy, '')
})

test('切换课节取消请求，旧题不会进入新课节', async t => {
  const pending = deferred()
  const h = harness(t, { requestGuideJson: () => pending.promise })
  await open(h)
  const generation = h.practice.generate()
  await open(h, 'b.mp4')
  pending.resolve(question())
  await generation
  assert.equal(h.practice.state.path, 'b.mp4')
  assert.equal(h.practice.state.records.length, 0)
})

test('请求期间更换 AI 配置，旧结果不会写入', async t => {
  const pending = deferred()
  const h = harness(t, { requestGuideJson: () => pending.promise })
  await open(h)
  const generation = h.practice.generate()
  h.settings.model = 'another'
  pending.resolve(question())
  await generation
  assert.equal(h.practice.history.value.length, 0)
  assert.match(h.practice.state.error, /配置已变更/)
})

test('保存失败明确提示，成功重试后清除提示', async t => {
  const h = harness(t, {
    dbFetchPractice: async () => ({ 'a.mp4': [record('saved')] }),
    dbSavePractice: async () => false,
  })
  await open(h)
  h.practice.updateDraft('["A"]')
  await tick()
  assert.match(h.practice.state.storageError, /保存失败/)
  h.io.dbSavePractice = async () => true
  h.practice.persist()
  await tick()
  assert.equal(h.practice.state.storageError, '')
})

test('主观题取消评估不消耗次数，重新提交可得到反馈', async t => {
  const pending = deferred()
  const saved = record('written')
  saved.question = { kind: 'explain', prompt: '解释列表索引的作用。', concepts: ['列表索引'], criteria: ['说明用途'], referenceAnswer: '按位置读取元素。', sourceIds: ['s1'] }
  const h = harness(t, { dbFetchPractice: async () => ({ 'a.mp4': [saved] }), requestGuideJson: () => pending.promise })
  await open(h)
  h.practice.updateDraft('按位置读取列表元素。')
  const review = h.practice.review()
  h.practice.cancel()
  const feedback = { result: 'solid', strengths: ['说明了用途'], gaps: [], nextStep: '继续练习。', sourceIds: ['s1'] }
  pending.resolve(feedback)
  await review
  assert.equal(h.practice.current.value.attempts.length, 0)
  assert.equal(h.practice.canReview.value, true)
  h.io.requestGuideJson = async () => feedback
  await h.practice.review()
  assert.equal(h.practice.current.value.attempts.length, 1)
  assert.equal(h.practice.answerSubmitted.value, true)
})

test('生成失败后保留历史、草稿及下一次重试能力', async t => {
  const saved = record('saved')
  saved.draft = '["B"]'
  const h = harness(t, {
    dbFetchPractice: async () => ({ 'a.mp4': [saved] }),
    requestGuideJson: async () => { throw new Error('network failed') },
  })
  await open(h)
  await h.practice.generate()
  assert.equal(h.practice.current.value.id, 'saved')
  assert.equal(h.practice.current.value.draft, '["B"]')
  assert.equal(h.practice.state.busy, '')
  h.io.requestGuideJson = async () => question('访问第二个元素应使用哪个索引？')
  await h.practice.generate()
  assert.equal(h.practice.history.value.length, 2)
  assert.equal(h.practice.state.error, '')
})

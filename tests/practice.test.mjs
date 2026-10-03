import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive, ref, nextTick, h as vueH } from 'vue'

// 只替换网络、文件和数据库边界；使用实际 Vue 状态、题目校验及练习流程。
const boundaries = {
  '~/utils/guideAi': ['requestGuideJson'],
  '~/utils/guideMedia': ['loadLessonSubtitles'],
  '~/utils/database': ['databaseRequest'],
  '~/utils/dbClient': ['dbFetchPractice', 'dbSavePractice', 'dbFetchNote'],
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (boundaries[specifier]) {
      const source = boundaries[specifier]
        .map((name) => `export const ${name} = (...args) => globalThis.practiceTestIO.${name}(...args)`)
        .join('\n')
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    if (specifier.startsWith('~/'))
      return nextResolve(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return nextResolve(specifier, context)
  },
})

const { useLessonPractice } = await import('../app/composables/useLessonPractice.ts')
const { appendPracticeRecord, restorePractice, isRepeatedPracticeQuestion, practiceAnswerText } =
  await import('../app/utils/practice.ts')
const { readPracticeFile, validateAttachments } = await import('../app/utils/practiceAttachments.ts')
const { criterionPoints, validatePracticeGrade } = await import('../app/utils/practiceGrading.ts')
const { practiceGroup, practiceGroupScore } = await import('../app/utils/practiceSession.ts')
const note =
  '变量用于给数据命名，列表可以保存多个值。访问列表元素使用索引，从零开始计数。列表推导式可以筛选和转换数据，避免重复编写循环。'
const sources = [{ id: 's1', kind: 'note', text: note }]
const question = (prompt = '列表的第一个元素使用哪个索引？') => ({
  kind: 'single-choice',
  prompt,
  concepts: ['列表索引'],
  criteria: ['选择一个答案'],
  referenceAnswer: '索引从零开始。',
  sourceIds: ['s1'],
  knowledge: { category: 'concept', level: 'awareness', reason: '辨认索引规则。' },
  options: [
    { id: 'A', text: '0' },
    { id: 'B', text: '1' },
  ],
  correctOptionIds: ['A'],
})
const record = (id, path = 'a.mp4', createdAt = 1) => ({
  id,
  path,
  createdAt,
  scope: null,
  sources,
  question: question(),
  draft: '',
  attempts: [],
})
const video = (path) => ({ path, title: path.slice(0, -4) })
const course = (id) => ({ id, videos: [video('a.mp4'), video('b.mp4')] })
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function harness(t, overrides = {}, options = {}) {
  const saves = [],
    calls = [],
    checkpoints = new Map()
  const io = {
    databaseRequest: async (_, options) => {
      if (options.method === 'POST') {
        checkpoints.set(options.body.key, structuredClone(options.body.value))
        return true
      }
      return structuredClone(checkpoints.get(options.query.key) ?? null)
    },
    dbFetchNote: async () => ({ content: '', updatedAt: null }),
    dbFetchPractice: async () => ({}),
    dbSavePractice: async (...args) => {
      saves.push(args)
      return true
    },
    loadLessonSubtitles: async () => [],
    requestGuideJson: async (...args) => {
      calls.push(args)
      return question()
    },
    ...overrides,
  }
  globalThis.practiceTestIO = io
  const activeCourse = ref(course('one'))
  const settings = reactive({ baseUrl: 'https://example.test/v1', model: 'test', apiKey: '', timeoutMinutes: 1 })
  const available = ref(true)
  let practice
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      practice = useLessonPractice(activeCourse, settings, available, options)
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return { practice, saves, calls, io, settings, available, course: activeCourse, checkpoints }
}
async function open(h, path = 'a.mp4') {
  await h.practice.open(video(path), null, note)
}

test('每课节独立保留 20 题，追加新题不挤掉其他课节', () => {
  const old = Array.from({ length: 20 }, (_, i) => record(`a${i}`, 'a.mp4', 20 - i))
  const other = Array.from({ length: 20 }, (_, i) => record(`b${i}`, 'b.mp4', 20 - i))
  const result = appendPracticeRecord([...old, ...other], record('new', 'a.mp4', 21))
  assert.equal(result.length, 40)
  assert.equal(result[0].id, 'new')
  assert.ok(!result.some((r) => r.id === 'a19'))
  assert.deepEqual(
    result.filter((r) => r.path === 'b.mp4'),
    other,
  )
})

test('恢复跨课节超过 20 道题，跳过坏记录和课程外路径', () => {
  const records = ['a.mp4', 'b.mp4'].flatMap((path) =>
    Array.from({ length: 25 }, (_, i) => record(`${path}-${i}`, path, 25 - i)),
  )
  const result = restorePractice(
    [null, { ...record('bad'), question: {} }, record('outside', 'x.mp4'), ...records],
    ['a.mp4', 'b.mp4'],
  )
  assert.equal(result.length, 40)
  assert.equal(result.filter((r) => r.path === 'a.mp4').length, 20)
  assert.equal(result.filter((r) => r.path === 'b.mp4').length, 20)
})

test('重复检测忽略空白和选项顺序，但允许相同题干使用不同选项', () => {
  const original = question('读取列表\n第一个元素')
  assert.equal(
    isRepeatedPracticeQuestion(
      { ...original, prompt: '读取列表 第一个元素', options: [...original.options].reverse() },
      [original],
    ),
    true,
  )
  assert.equal(
    isRepeatedPracticeQuestion(
      {
        ...original,
        options: [
          { id: 'A', text: '2' },
          { id: 'B', text: '3' },
        ],
      },
      [original],
    ),
    false,
  )
  assert.equal(isRepeatedPracticeQuestion(question('a + b'), [question('a - b')]), false)
})

test('同一视频连续出题、切题及重新打开保留草稿', async (t) => {
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

test('历史未读完时等待，关闭也不会把空记录写回数据库', async (t) => {
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

test('读取失败不覆盖历史，重新打开可以重试', async (t) => {
  const h = harness(t, {
    dbFetchPractice: async () => {
      throw new Error('read failed')
    },
  })
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

test('切换课程后丢弃旧课程迟到的读取结果', async (t) => {
  const pending = deferred()
  const h = harness(t, {
    dbFetchPractice: (id) =>
      id === 'one' ? pending.promise : Promise.resolve({ 'b.mp4': [record('new-course', 'b.mp4')] }),
  })
  h.course.value = course('two')
  await tick()
  pending.resolve({ 'a.mp4': [record('old-course')] })
  await tick()
  assert.deepEqual(
    h.practice.state.records.map((r) => r.id),
    ['new-course'],
  )
})

test('空答案不能提交，客观题本地核对，重复提交不消耗次数', async (t) => {
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

test('修改答案可以再交，每题最多三次反馈', async (t) => {
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

test('重复题和无效来源不替换当前题目', async (t) => {
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

test('取消生成后，即使服务返回也不新增题目', async (t) => {
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

test('切换课节取消请求，旧题不会进入新课节', async (t) => {
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

for (const [field, value] of [
  ['model', 'another'],
  ['provider', 'anthropic'],
  ['contextWindow', '1m'],
])
  test(`请求期间更换 AI ${field}，旧结果不会写入`, async (t) => {
    const pending = deferred()
    const h = harness(t, { requestGuideJson: () => pending.promise })
    await open(h)
    const generation = h.practice.generate()
    h.settings[field] = value
    pending.resolve(question())
    await generation
    assert.equal(h.practice.history.value.length, 0)
    assert.match(h.practice.state.error, /配置已变更/)
  })

test('保存失败明确提示，成功重试后清除提示', async (t) => {
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

test('主观题取消评估不消耗次数，重新提交可得到反馈', async (t) => {
  const pending = deferred()
  const saved = record('written')
  saved.question = {
    kind: 'explain',
    prompt: '解释列表索引的作用。',
    concepts: ['列表索引'],
    criteria: ['说明用途'],
    referenceAnswer: '按位置读取元素。',
    sourceIds: ['s1'],
  }
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

test('生成失败后保留历史、草稿及下一次重试能力', async (t) => {
  const saved = record('saved')
  saved.draft = '["B"]'
  const h = harness(t, {
    dbFetchPractice: async () => ({ 'a.mp4': [saved] }),
    requestGuideJson: async () => {
      throw new Error('network failed')
    },
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

const assignment = () => ({
  ...record('assignment'),
  question: {
    kind: 'code',
    prompt: '完成一个学习清单工具。',
    concepts: ['列表', '切片'],
    criteria: ['实现清单读取和筛选', '处理空清单'],
    criterionPoints: [70, 30],
    referenceAnswer: '先检查空清单，再用索引和切片读取。',
    sourceIds: ['s1'],
    knowledge: { category: 'application', level: 'proficiency', reason: '组合列表操作完成一个工具。' },
  },
})
const gradeReply = () => ({
  result: 'solid',
  strengths: ['清单读取和筛选已实现。'],
  gaps: ['空清单处理不完整。'],
  nextStep: '补充空清单处理。',
  sourceIds: ['s1'],
  grade: {
    items: [
      {
        criterionIndex: 0,
        score: 70,
        status: 'implemented',
        evidence: 'main.py 使用索引与切片。',
        improvement: '无需补充。',
      },
      {
        criterionIndex: 1,
        score: 15,
        status: 'partial',
        evidence: '空清单分支没有返回值。',
        improvement: '补全空清单返回值。',
      },
    ],
  },
})

test('读取代码保留全部内容，拒绝二进制、伪图片、压缩包和过大文本', async () => {
  const text = 'def plan(items):\n    return items[:3]\n'
  const parsed = await readPracticeFile(new File([text], 'main.py'))
  assert.equal(parsed.content.text, text)
  assert.equal(parsed.attachment.characters, text.length)
  for (const file of [
    new File(['zip'], 'source.zip'),
    new File(['\0binary'], 'main.py'),
    new File(['not png'], 'screen.png'),
    new File(['a'.repeat(40001)], 'large.js'),
    new File([''], 'empty.py'),
    new File([new Uint8Array([255, 255])], 'bad.txt'),
  ]) {
    await assert.rejects(readPracticeFile(file))
  }
  assert.throws(
    () => validateAttachments(Array.from({ length: 9 }, (_, i) => ({ ...parsed.attachment, id: `file-${i}` }))),
    /8/,
  )
})

test('上传代码可单独提交评分，文件单独持久化，替换附件不覆盖上次提交', async (t) => {
  const h = harness(t, {
    dbFetchPractice: async () => ({ 'a.mp4': [assignment()] }),
    requestGuideJson: async (...args) => {
      h.calls.push(args)
      return gradeReply()
    },
  })
  await open(h)
  await h.practice.addAttachments([new File(['def plan(items):\n    return items[:3]\n'], 'main.py')])
  assert.equal(h.practice.attachments.value.length, 1)
  assert.equal(h.practice.canReview.value, true)
  const firstFile = { ...h.practice.attachments.value[0] }
  assert.ok([...h.checkpoints.keys()].some((key) => key.startsWith('practice-file:')))
  assert.ok(!JSON.stringify(h.saves.at(-1)).includes('def plan'))
  await h.practice.review()
  const current = h.practice.current.value
  assert.equal(current.attempts[0].answer, '')
  assert.equal(current.attempts[0].feedback.grade.score, 85)
  assert.equal(h.practice.answerSubmitted.value, true)
  const prompt = h.calls[0][1][0]
  assert.match(prompt.content, /def plan/)
  assert.match(prompt.content, /只按这些标准评分/)
  assert.equal(prompt.images, undefined)
  await h.practice.review()
  assert.equal(h.calls.length, 1)
  h.practice.removeAttachment(firstFile.id)
  await h.practice.addAttachments([new File(['def plan(items):\n    return items[:3] if items else []\n'], 'main.py')])
  assert.equal(h.practice.canReview.value, true)
  assert.equal(current.attempts[0].attachments[0].id, firstFile.id)
  h.practice.close()
  await open(h)
  assert.equal((await h.practice.loadAttachment(firstFile)).text, 'def plan(items):\n    return items[:3]\n')
  assert.match((await h.practice.loadAttachment(h.practice.attachments.value[0])).text, /if items/)
  const stored = structuredClone(h.saves.at(-1)[2])
  const restored = restorePractice(stored, ['a.mp4'])
  assert.equal(restored[0].attempts[0].feedback.grade.score, 85)
  assert.equal(restored[0].attempts[0].attachments[0].id, firstFile.id)
  assert.equal(restored[0].attachments[0].id, h.practice.attachments.value[0].id)
})

test('图片作业以真正的图像提交，截图无法证明的功能标为待验证', async (t) => {
  const file = { id: 'picture', name: 'screen.png', kind: 'image', size: 3 }
  const saved = { ...assignment(), attachments: [file] }
  const h = harness(t, {
    dbFetchPractice: async () => ({ 'a.mp4': [saved] }),
    requestGuideJson: async (...args) => {
      h.calls.push(args)
      const reply = gradeReply()
      reply.grade.items[0] = {
        criterionIndex: 0,
        score: 0,
        status: 'unverified',
        evidence: '截图未展示筛选交互。',
        improvement: '补充筛选实现代码。',
      }
      return reply
    },
  })
  h.checkpoints.set(`practice-file:${JSON.stringify(['one', 'assignment', 'picture'])}`, {
    version: 1,
    attachment: file,
    content: { kind: 'image', mediaType: 'image/png', data: 'AQID' },
  })
  await open(h)
  assert.equal(h.practice.canReview.value, true)
  await h.practice.review()
  const sent = h.calls[0][1][0]
  assert.deepEqual(sent.images, [{ name: 'screen.png', mediaType: 'image/png', data: 'AQID' }])
  assert.match(sent.content, /仅凭静态截图不能确认/)
  assert.equal(h.practice.current.value.attempts[0].feedback.grade.score, 15)
  assert.equal(h.practice.current.value.attempts[0].feedback.result, 'retry')
})

test('作业文件写入失败不添加引用，文件丢失时不忽略附件进行评分', async (t) => {
  const h = harness(t, { dbFetchPractice: async () => ({ 'a.mp4': [assignment()] }) })
  await open(h)
  h.io.databaseRequest = async () => {
    throw Error('磁盘不可写')
  }
  await h.practice.addAttachments([new File(['print(1)'], 'main.py')])
  assert.equal(h.practice.attachments.value.length, 0)
  assert.match(h.practice.state.error, /磁盘不可写/)
  h.practice.current.value.attachments = [{ id: 'lost', name: 'lost.py', kind: 'code', size: 8, characters: 8 }]
  await h.practice.review()
  assert.equal(h.calls.length, 0)
  assert.equal(h.practice.current.value.attempts.length, 0)
  assert.equal(h.practice.attachments.value.length, 1)
})

test('文件读取中切换课节，迟到结果不会附到新课节', async (t) => {
  const h = harness(t, { dbFetchPractice: async () => ({ 'a.mp4': [assignment()] }) })
  await open(h)
  const pending = deferred(),
    file = new File(['print(1)'], 'main.py')
  file.arrayBuffer = () => pending.promise
  const uploading = h.practice.addAttachments([file])
  await open(h, 'b.mp4')
  pending.resolve(new TextEncoder().encode('print(1)').buffer)
  await uploading
  assert.equal(h.practice.state.path, 'b.mp4')
  assert.ok(!h.practice.state.records[0].attachments?.length)
  assert.equal(h.checkpoints.size, 0)
})

test('评分要求覆盖全部功能，拒绝超分、重复项、总分错误及无依据给分', () => {
  const q = assignment().question
  assert.deepEqual(criterionPoints({ criteria: ['一', '二', '三'] }), [34, 33, 33])
  assert.throws(() => criterionPoints({ criteria: ['一', '二'], criterionPoints: [60, 60] }), /100/)
  assert.equal(validatePracticeGrade(gradeReply().grade, q).score, 85)
  const invalid = [
    { items: gradeReply().grade.items.slice(0, 1) },
    { items: [gradeReply().grade.items[0], gradeReply().grade.items[0]] },
    { ...gradeReply().grade, score: 100 },
    { items: [{ ...gradeReply().grade.items[0], score: 71 }, gradeReply().grade.items[1]] },
    { items: [{ ...gradeReply().grade.items[0], status: 'unverified' }, gradeReply().grade.items[1]] },
  ]
  for (const raw of invalid) assert.throws(() => validatePracticeGrade(raw, q))
  const old = restorePractice([record('legacy')], ['a.mp4'])[0]
  assert.equal(old.question.criterionPoints, undefined)
  assert.equal(old.attachments, undefined)
})

test('同次生成的题目独立成组，保存恢复后顺序和计分范围不变', async (t) => {
  const h = harness(t, {
    requestGuideJson: async () => ({ questions: [question('题目一'), question('题目二'), question('题目三')] }),
  })
  await open(h)
  await h.practice.generate(3)
  const first = h.practice.current.value
  const group = practiceGroup(h.practice.history.value, first)
  assert.equal(group.length, 3)
  assert.ok(first.groupId)
  assert.equal(new Set(group.map((r) => r.groupId)).size, 1)
  assert.deepEqual(
    group.map((r) => r.question.prompt),
    ['题目一', '题目二', '题目三'],
  )
  h.io.requestGuideJson = async () => question('另一组题目')
  await h.practice.generate()
  const next = h.practice.current.value
  assert.notEqual(next.groupId, first.groupId)
  assert.equal(practiceGroup(h.practice.history.value, next).length, 1)
  const restored = restorePractice(JSON.parse(JSON.stringify(h.practice.state.records)), ['a.mp4'])
  assert.deepEqual(
    practiceGroup(restored, first).map((r) => r.id),
    group.map((r) => r.id),
  )
  assert.equal(h.saves.at(-1)[2].find((r) => r.id === first.id).groupId, first.groupId)
})

test('旧练习兼容无分组信息，只合并同课节同范围的旧题', () => {
  const first = record('one')
  const second = record('two')
  const others = [
    { ...record('new'), groupId: 'new-group' },
    { ...record('scoped'), scope: { start: 0, end: 30 } },
    record('another-video', 'b.mp4'),
  ]
  assert.deepEqual(
    practiceGroup([...others, second, first], first).map((r) => r.id),
    ['one', 'two'],
  )
  assert.deepEqual(practiceGroup([first], undefined), [])
})

test('整组百分制按最新提交等权汇总，支持部分正确、作业评分和未答', () => {
  const graded = (id, result, score) => ({
    ...record(id),
    attempts: [
      {
        answer: 'answer',
        at: 1,
        feedback: {
          result,
          ...(score !== undefined ? { grade: { score, items: [] } } : {}),
        },
      },
    ],
  })
  const items = [
    graded('one', 'solid'),
    graded('two', 'partial'),
    graded('three', 'retry'),
    graded('four', 'solid', 85),
    record('five'),
  ]
  assert.deepEqual(practiceGroupScore(items), { total: 5, completed: 4, unanswered: 1, score: 47 })
  items[2].attempts.push({ answer: 'corrected', at: 2, feedback: { result: 'solid' } })
  items[0].draft = '未提交的修改'
  assert.equal(practiceGroupScore(items).score, 67)
  assert.equal(practiceGroupScore([graded('a', 'solid'), graded('b', 'solid'), graded('c', 'retry')]).score, 67)
  assert.equal(practiceGroupScore([graded('a', 'solid'), graded('b', 'solid'), graded('c', 'solid')]).score, 100)
  assert.deepEqual(practiceGroupScore([]), { total: 0, completed: 0, unanswered: 0, score: 0 })
})

// 编译真实弹窗模板，按钮和选择组件仅替换渲染外壳，练习状态与事件使用真实流程。
async function mountDialog(t, practice, listeners = {}) {
  const { descriptor } = parse(readFileSync(new URL('../app/components/PracticeDialog.vue', import.meta.url), 'utf8'))
  const code = compileScript(descriptor, { id: 'practice-dialog-test', inlineTemplate: true })
    .content.replace(
      /import \{ useGuide \} from [^\n]+/,
      'const useGuide = () => ({ state: { mastery: {}, busy: false } })',
    )
    .replace(/import (\w+) from '~\/components\/[^\n]+/g, 'const $1 = globalThis.practiceDialogStubs.$1')
    .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
  const stub = (name) => ({
    props: ['text', 'modelValue'],
    setup(props, { slots, attrs }) {
      return () =>
        name === 'VDialog' && !props.modelValue
          ? null
          : vueH(
              name === 'UiButton' ? 'button' : name,
              attrs,
              props.text ?? [slots.default?.(), slots.label?.(), slots.selection?.()],
            )
    },
  })
  globalThis.practiceDialogStubs = Object.fromEntries(
    ['UiButton', 'AppIcon', 'PracticeText', 'PracticeAttachmentList', 'AiProfileSelector'].map((name) => [
      name,
      stub(name),
    ]),
  )
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  const Component = (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).default
  const element = (type) => ({
    type,
    props: {},
    style: {},
    children: [],
    parent: null,
    focus() {},
    scrollTo() {},
    scrollIntoView() {},
  })
  const renderer = createRenderer({
    createElement: element,
    createText: (text) => ({ ...element('#text'), text }),
    createComment: () => element('#comment'),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
      node.children = []
    },
    patchProp: (node, key, _old, value) => {
      node.props[key] = value
    },
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
    },
    remove(node) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = null
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  })
  const root = element('root'),
    app = renderer.createApp(Component, { practice, ...listeners })
  for (const name of new Set(descriptor.template.content.match(/\bV[A-Z]\w+/g))) app.component(name, stub(name))
  app.mount(root)
  t.after(() => app.unmount())
  await nextTick()
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  const text = (node) => `${node.text ?? ''}${node.children.map(text).join('')}`.trim()
  const button = (label) => walk(root).find((node) => node.type === 'button' && text(node) === label)
  return {
    button,
    find: (type) => walk(root).find((node) => node.type === type),
    text: () => text(root),
    async click(label) {
      const target = button(label)
      assert.ok(target, `可找到按钮：${label}`)
      assert.ok(!target.props.disabled, `按钮可用：${label}`)
      target.props.onClick()
      await nextTick()
      await nextTick()
    },
  }
}

test('知识点准备失败后明确提示并可在弹窗重试，恢复后正常出题', async (t) => {
  let attempts = 0,
    retry
  const recovered = deferred()
  const h = harness(
    t,
    {},
    {
      sources: async () => {
        if (++attempts === 1) throw new Error('HTTP 502：AI 服务网关异常，请稍后重试。')
        return recovered.promise
      },
    },
  )
  await open(h)
  const dialog = await mountDialog(t, h.practice, {
    onRetry: () => {
      retry = open(h)
    },
  })
  assert.match(dialog.text(), /HTTP 502/)
  assert.match(dialog.text(), /知识点尚未准备好，请重试准备/)
  assert.doesNotMatch(dialog.text(), /知识点准备完成后可生成练习/)
  assert.equal(h.practice.hasMaterial.value, false)
  await dialog.click('重试准备')
  await tick()
  assert.equal(h.practice.state.busy, 'loading')
  assert.equal(dialog.button('重试准备'), undefined)
  assert.equal(h.practice.state.error, '')
  recovered.resolve(sources)
  await retry
  await nextTick()
  assert.equal(h.practice.hasMaterial.value, true)
  assert.equal(dialog.button('重试准备'), undefined)
  await h.practice.generate()
  assert.equal(h.practice.history.value.length, 1)
})

test('取消知识点准备后仍可重试，旧响应不能覆盖重新准备的材料', async (t) => {
  const pending = deferred()
  const h = harness(t, {}, { sources: () => pending.promise })
  const loading = open(h)
  await tick()
  const dialog = await mountDialog(t, h.practice)
  await dialog.click('取消')
  assert.equal(h.practice.state.error, '')
  assert.ok(dialog.button('重试准备'))
  const fresh = [{ ...sources[0], text: `新的材料。${note}` }]
  await h.practice.openSources('a.mp4', 'a', async () => fresh)
  pending.resolve(sources)
  await loading
  assert.deepEqual(h.practice.state.preparedSources, fresh)
})

test('今日巩固准备失败和取消后都保留重试入口', async (t) => {
  const h = harness(t, {}, { mode: 'daily' })
  const load = async () => {
    throw new Error('HTTP 502：AI 服务网关异常，请稍后重试。')
  }
  const path = 'daily:2026-10-03:test'
  await h.practice.openSources(path, '今日巩固', load)
  const dialog = await mountDialog(t, h.practice)
  assert.ok(dialog.button('重试准备'))
  assert.doesNotMatch(dialog.text(), /知识点准备完成后可生成练习/)
  const pending = deferred()
  const loading = h.practice.openSources(path, '今日巩固', () => pending.promise)
  await tick()
  await dialog.click('取消')
  assert.ok(dialog.button('重试准备'))
  pending.resolve(sources)
  await loading
  assert.equal(h.practice.hasMaterial.value, false)
})

test('弹窗逐题提交后显示下一题，末题汇总分数并完成关闭，重新打开保留成绩', async (t) => {
  const h = harness(t, {
    requestGuideJson: async () => ({ questions: [question('第一题'), question('第二题'), question('第三题')] }),
  })
  await open(h)
  await h.practice.generate(3)
  const dialog = await mountDialog(t, h.practice)
  assert.ok(dialog.button('提交作答').props.disabled)
  assert.equal(dialog.button('下一题'), undefined)
  for (const answer of ['A', 'B', 'A']) {
    h.practice.updateDraft(JSON.stringify([answer]))
    await nextTick()
    await dialog.click('提交作答')
    if (h.practice.current.value.question.prompt !== '第三题') {
      assert.equal(dialog.button('完成'), undefined)
      await dialog.click('下一题')
    }
  }
  assert.equal(dialog.button('下一题'), undefined)
  assert.match(dialog.text(), /整组得分.*已答 3 \/ 3 题.*67.*100 分/s)
  await dialog.click('完成')
  assert.equal(h.practice.state.open, false)
  await open(h)
  await nextTick()
  assert.match(dialog.text(), /整组得分.*67/s)
  await dialog.click('完成')
})

test('返回作答后可重新提交并更新总分，末题提前提交显示未答计零', async (t) => {
  const h = harness(t, {
    requestGuideJson: async () => ({ questions: [question('第一题'), question('第二题'), question('第三题')] }),
  })
  await open(h)
  await h.practice.generate(3)
  const group = practiceGroup(h.practice.history.value, h.practice.current.value)
  h.practice.select(group.at(-1).id)
  const dialog = await mountDialog(t, h.practice)
  h.practice.updateDraft('["B"]')
  await nextTick()
  await dialog.click('提交作答')
  assert.match(dialog.text(), /未答 2 题，计 0 分/)
  await dialog.click('返回作答')
  h.practice.updateDraft('["A"]')
  await nextTick()
  assert.equal(dialog.button('完成'), undefined)
  await dialog.click('重新提交')
  assert.match(dialog.text(), /整组得分.*33.*100 分/s)
  assert.ok(dialog.button('完成'))
  await dialog.click('材料与设置')
  assert.equal(dialog.button('完成'), undefined)
  assert.ok(dialog.button('返回练习'))
})

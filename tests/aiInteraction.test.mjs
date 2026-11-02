import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aiFormAnswerText, parseAiInteractionForm, validateAiFormAnswers } from '../app/utils/aiInteraction.ts'
import {
  parseGuideConversation,
  parseGuideConversationReply,
  planningPreferences,
  guideConversationPrompt,
  parseGuideTurnReply,
  GUIDE_CONVERSATION_SYSTEM,
  guideReplyCorrection,
} from '../app/utils/guideConversation.ts'

const choice = () => ({
  id: 'foundation',
  type: 'single-choice',
  label: '你掌握了哪些基础？',
  options: [
    { id: 'some', label: '部分掌握' },
    { id: 'none', label: '想从头学习' },
  ],
})
const rawForm = () => ({ id: 'math-profile', title: '确认你的基础', submitLabel: '继续制定方案', fields: [choice()] })
test('初始化没有学情摘要仍接受有效问卷，摘要为空、缺省或 null 均不编造背景', () => {
  for (const profile of ['', '   ', null, undefined]) {
    const reply = parseGuideTurnReply(
      { message: '请先确认你的基础。', profile, form: rawForm(), planRequest: null },
      true,
    )
    assert.equal(reply.profile, '')
    assert.equal(reply.form.fields.length, 1)
  }
  assert.equal(parseGuideConversationReply({ form: rawForm() }).message, '确认你的基础')
  assert.equal(
    parseGuideTurnReply({ message: ' ', profile: null, form: rawForm(), planRequest: '' }, true).planRequest,
    null,
  )
  assert.throws(() => parseGuideConversationReply({ message: 123, profile: '', form: rawForm() }))
  assert.throws(() => parseGuideConversationReply({ message: '回复', profile: { fabricated: true } }))
  assert.throws(() =>
    parseGuideTurnReply({ message: '直接学习', profile: '', form: null, planRequest: '直接学习' }, true),
  )
})
test('空摘要及已有答案持久化可恢复，无效数据仍不能成为问卷', () => {
  const reply = parseGuideConversationReply({ message: '先回答', form: rawForm() })
  const raw = {
    version: 1,
    profile: '',
    preferences: { dailyMinutes: null, completionDate: null },
    turns: [
      {
        id: 'one',
        question: 'AI 定制初始化',
        kind: 'initialization',
        reply,
        status: 'done',
        error: '',
        answers: { foundation: 'some' },
      },
    ],
  }
  assert.equal(parseGuideConversation(raw).turns[0].reply.profile, '')
  assert.throws(() => parseGuideConversationReply(null))
  assert.throws(() => parseGuideConversationReply({ message: '', profile: '' }))
  assert.throws(() =>
    parseGuideConversationReply({ message: '问卷', form: { ...rawForm(), html: '<script>bad()</script>' } }),
  )
})
test('专用系统契约允许未知学情，修正请求有大小边界且不包含凭证', () => {
  assert.ok(GUIDE_CONVERSATION_SYSTEM.includes('初始化尚无用户回答时允许为空字符串'))
  const raw = { message: '已有问卷', questions: [{ label: '问题' }] }
  const repair = guideReplyCorrection(raw, true)
  assert.ok(repair.content.includes(JSON.stringify(raw)))
  assert.ok(repair.content.includes('profile=""'))
  assert.ok(guideReplyCorrection({ message: 'x'.repeat(60001) }, false).content.length < 1000)
})
test('AI 表单保留任意问题、方案描述和按钮文字，无预选答案', () => {
  const raw = rawForm()
  raw.fields[0].options[0].description = '通过实际代码和例子学习'
  const form = parseAiInteractionForm(raw)
  assert.equal(form.submitLabel, raw.submitLabel)
  assert.deepEqual(form.fields[0].options, raw.fields[0].options)
  assert.ok(!Object.hasOwn(form.fields[0], 'value'))
  raw.fields[0].options[0].label = 'changed'
  assert.equal(form.fields[0].options[0].label, '部分掌握')
})
test('拒绝脚本、任意组件、未知属性、重复编号和过大的表单', () => {
  const cases = [
    { ...rawForm(), html: '<script>alert(1)</script>' },
    { ...rawForm(), fields: [{ ...choice(), onClick: 'fetch(url)' }] },
    { ...rawForm(), fields: [{ ...choice(), type: 'component' }] },
    { ...rawForm(), fields: [{ ...choice(), id: '__proto__' }] },
    { ...rawForm(), fields: [{ ...choice(), id: 'constructor' }] },
    { ...rawForm(), fields: [choice(), choice()] },
    {
      ...rawForm(),
      fields: [
        {
          ...choice(),
          options: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'B' },
          ],
        },
      ],
    },
    { ...rawForm(), fields: [{ id: 'n', label: 'N', type: 'number', min: 10, max: 5 }] },
    { ...rawForm(), fields: [{ id: 'n', label: 'N', type: 'number', min: Infinity }] },
    { ...rawForm(), fields: [{ id: 'n', label: 'N', type: 'date', min: '2026-02-30' }] },
    { ...rawForm(), fields: [{ id: 'n', label: 'N', type: 'text', maxLength: 9000 }] },
    { ...rawForm(), fields: Array.from({ length: 9 }, (_, i) => ({ ...choice(), id: `q${i}` })) },
  ]
  for (const raw of cases) assert.throws(() => parseAiInteractionForm(raw))
})
test('表单答案仅接受原选项，单选、多选、文字、数字和日期均校验', () => {
  const form = parseAiInteractionForm({
    ...rawForm(),
    fields: [
      choice(),
      { ...choice(), id: 'topics', type: 'multiple-choice' },
      { id: 'goal', type: 'textarea', label: '目标', maxLength: 10 },
      { id: 'minutes', type: 'number', label: '时长', min: 5, max: 60 },
      { id: 'finish', type: 'date', label: '完成日期', min: '2026-11-02', max: '2026-12-01' },
      { id: 'notes', type: 'text', label: '补充', required: false },
    ],
  })
  const raw = { foundation: 'some', topics: ['none'], goal: '学习数学', minutes: '30', finish: '2026-11-20' }
  const answers = validateAiFormAnswers(form, raw)
  assert.equal(answers.minutes, 30)
  assert.equal(answers.notes, null)
  assert.ok(aiFormAnswerText(form, answers).includes('你掌握了哪些基础？：部分掌握'))
  for (const patch of [
    { foundation: 'invented' },
    { topics: ['some', 'some'] },
    { minutes: 'abc' },
    { minutes: 61 },
    { finish: '2026-11-01' },
    { goal: '12345678901' },
    { goal: '' },
    { other: 'x' },
  ])
    assert.throws(() => validateAiFormAnswers(form, { ...raw, ...patch }))
})
test('时间均选填，留空传 null，不偷偷填 120 分钟；日期按本地今天校验', () => {
  assert.deepEqual(planningPreferences('', '', '2026-11-02'), { dailyMinutes: null, completionDate: null })
  assert.deepEqual(planningPreferences(null, '2026-11-30', '2026-11-02'), {
    dailyMinutes: null,
    completionDate: '2026-11-30',
  })
  assert.deepEqual(planningPreferences('45', null, '2026-11-02'), { dailyMinutes: 45, completionDate: null })
  for (const [minutes, date] of [
    [0, null],
    [4, null],
    [10.5, null],
    [1441, null],
    ['abc', null],
    [null, '2026-11-01'],
    [null, '2026-02-30'],
  ])
    assert.throws(() => planningPreferences(minutes, date, '2026-11-02'))
})
test('对话持久化保留 AI 表单和已提交答案，恢复中断请求不重复发送', () => {
  const reply = parseGuideConversationReply({
    message: '请确认你的基础。',
    profile: '学习者希望入门数学。',
    form: rawForm(),
    planRequest: null,
  })
  const data = {
    version: 1,
    preferences: { dailyMinutes: null, completionDate: '2026-01-01' },
    profile: reply.profile,
    turns: [
      { id: 'one', question: '我想学数学', reply, status: 'done', error: '', answers: { foundation: 'some' } },
      { id: 'two', question: '请继续', reply: null, status: 'pending', error: '' },
    ],
  }
  const saved = parseGuideConversation(JSON.parse(JSON.stringify(data)))
  assert.equal(saved.turns[1].status, 'stopped')
  assert.deepEqual(saved.turns[0].answers, { foundation: 'some' })
  assert.deepEqual(saved.preferences, data.preferences)
  assert.throws(() => parseGuideConversation({ ...data, version: 2 }))
  assert.throws(() =>
    parseGuideConversation({ ...data, turns: [{ ...data.turns[0], answers: { foundation: 'invalid' } }] }),
  )
})
test('初始化发送课程名、目录层级和组件契约，无固定时间约束', () => {
  const messages = guideConversationPrompt({
    courseName: '数学',
    catalog: [{ path: '01-基础/方程.mp4', title: '方程', duration: 120, done: false }],
    previous: null,
    today: '2026-11-02',
    data: {
      version: 1,
      preferences: { dailyMinutes: null, completionDate: null },
      profile: '',
      turns: [
        { id: 'one', kind: 'initialization', question: 'AI 定制初始化', reply: null, status: 'pending', error: '' },
      ],
    },
  })
  assert.ok(messages[0].content.includes('single-choice'))
  assert.ok(messages[0].content.includes('提交按钮文字均由你生成'))
  assert.ok(messages[0].content.includes('"phase":"questionnaire"'))
  assert.ok(messages[0].content.includes('"courseName":"数学"'))
  assert.ok(messages[0].content.includes('01-基础/方程.mp4'))
  assert.ok(!messages[0].content.includes('"preferences"'))
  assert.equal(messages.at(-1).content, 'AI 定制初始化')
})
test('初始化类型往返保留，用户回答后请求方案阶段', () => {
  const data = {
    version: 1,
    preferences: { dailyMinutes: null, completionDate: null },
    profile: '',
    turns: [
      { id: 'one', kind: 'initialization', question: 'AI 定制初始化', reply: null, status: 'pending', error: '' },
    ],
  }
  const saved = parseGuideConversation(data)
  assert.equal(saved.turns[0].kind, 'initialization')
  assert.equal(saved.turns[0].status, 'stopped')
  saved.turns.push({ id: 'two', question: '完全不懂方程', reply: null, status: 'pending', error: '' })
  const messages = guideConversationPrompt({
    courseName: '数学',
    catalog: [],
    previous: null,
    today: '2026-11-02',
    data: saved,
  })
  assert.ok(messages[0].content.includes('"phase":"proposal"'))
  assert.equal(messages.at(-1).content, '完全不懂方程')
})

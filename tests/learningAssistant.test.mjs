import assert from 'node:assert/strict'
import { test } from 'node:test'
import { learningContext, chatMessages, chatSystem } from '../app/utils/learningAssistant.ts'
const input = {
  courseId: 'c',
  path: 'lesson.mp4',
  title: '并发控制',
  seconds: 150,
  duration: 600,
  segments: [
    { id: 1, start: 10, end: 25, text: '课前准备' },
    { id: 2, start: 60, end: 100, text: '锁的原理' },
    { id: 3, start: 100, end: 180, text: '互斥不是死锁' },
    { id: 4, start: 240, end: 270, text: '练习' },
  ],
  points: [{ id: 'lock', title: '互斥锁', text: '保护共享状态', start: 70, end: 190 }],
}
test('聊天上下文使用当前播放位置附近的字幕和知识点', () => {
  const ctx = learningContext(input)
  assert.equal(ctx.start, 60)
  assert.equal(ctx.end, 240)
  assert.deepEqual(
    ctx.evidence.map((s) => s.id),
    ['s:2', 's:3', 'k:lock'],
  )
  assert.equal(learningContext({ ...input, seconds: 0 }).start, 0)
  assert.equal(learningContext({ ...input, seconds: 590 }).end, 600)
  assert.ok(chatSystem(ctx).includes(JSON.stringify(ctx)))
})
test('上下文限制输入长度、去除重复证据，并处理无效时间', () => {
  const huge = learningContext({
    ...input,
    seconds: NaN,
    duration: Infinity,
    points: [],
    segments: Array.from({ length: 9 }, (_, i) => ({ id: i, start: i, end: i + 1, text: 'x'.repeat(10000) })),
  })
  assert.equal(huge.seconds, 0)
  assert.equal(huge.truncated, true)
  assert.ok(huge.evidence.reduce((sum, s) => sum + s.text.length, 0) <= 60000)
  assert.ok(Number.isFinite(huge.end))
  const dup = learningContext({ ...input, segments: [input.segments[1], input.segments[1]], points: [] })
  assert.equal(dup.evidence.length, 1)
})
test('聊天请求保留最近成功对话的角色顺序，不把错误或取消状态当作回答', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ question: `问题${i}`, markdown: `回答${i}`, status: 'done' }))
  turns.push({ question: '失败', markdown: '', status: 'error' }, { question: '取消', markdown: '', status: 'stopped' })
  const messages = chatMessages(turns, '继续')
  assert.equal(messages.length, 13)
  assert.deepEqual(messages[0], { role: 'user', content: '问题4' })
  assert.deepEqual(messages[1], { role: 'assistant', content: '回答4' })
  assert.deepEqual(messages.at(-1), { role: 'user', content: '继续' })
  assert.equal(
    chatMessages([{ question: '问题', markdown: 'x'.repeat(20000), status: 'done' }], '继续')[1].content.length,
    12000,
  )
})

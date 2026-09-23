import test from 'node:test'
import assert from 'node:assert/strict'
import { crossedSegmentEnd } from '../app/utils/segmentReminder.ts'
import { practiceSources, cleanPracticeText, enoughPracticeMaterial, validatePracticeQuestion, validatePracticeFeedback, restorePractice } from '../app/utils/practice.ts'

const sample = (seconds, at, extra = {}) => ({ seconds, at, duration: 600, rate: 1, playing: true, seeking: false, ended: false, ...extra })
const sources = [{ id: 's1', kind: 'note', text: '反射可以在运行时读取类的信息，获得构造函数、字段和方法。通过类对象获取方法，再在实例上调用方法。' }]
const question = { kind: 'code', prompt: '如何在运行时调用一个方法？', concepts: ['反射'], criteria: ['获取方法并调用'], referenceAnswer: '使用 getMethod 与 invoke。', sourceIds: ['s1'] }
const feedback = { result: 'partial', strengths: ['能获取方法'], gaps: ['需要传入目标实例'], nextStep: '补充调用时的实例参数。', sourceIds: ['s1'] }

test('片段提醒：连续播放、倍速和自然结束可触发', () => {
  assert.equal(crossedSegmentEnd(sample(59.7, 1000), sample(60.1, 1400), 60), true)
  assert.equal(crossedSegmentEnd(sample(58, 1000, { rate: 4 }), sample(61, 1800, { rate: 4 }), 60), true)
  assert.equal(crossedSegmentEnd(sample(599.6, 1000), sample(600, 1500, { playing: false, ended: true }), 600), true)
})
test('片段提醒：首个样本、跳转、暂停、回退与重复终点均不触发', () => {
  assert.equal(crossedSegmentEnd(null, sample(61, 1000), 60), false)
  assert.equal(crossedSegmentEnd(sample(10, 1000), sample(65, 1250), 60), false)
  for (const extra of [{ seeking: true }, { playing: false }]) {
    assert.equal(crossedSegmentEnd(sample(59, 1000, extra), sample(60, 2000), 60), false)
    assert.equal(crossedSegmentEnd(sample(59, 1000), sample(60, 2000, extra), 60), false)
  }
  assert.equal(crossedSegmentEnd(sample(61, 1000), sample(59, 2000), 60), false)
  assert.equal(crossedSegmentEnd(sample(60, 1000), sample(61, 2000), 60), false)
  assert.equal(crossedSegmentEnd(sample(59, 1000), sample(60, NaN), 60), false)
})
test('材料只选相交字幕，引用保留真实原始时间，笔记不丢失代码泛型', () => {
  const cues = [{ id: 0, start: 0, end: 10, text: '前文' }, { id: 1, start: 10, end: 20, text: '当前知识' }, { id: 2, start: 20, end: 30, text: '后文' }]
  const selected = practiceSources('List<T> ![截图](a.assets/frame.png)', cues, '', { start: 10, end: 20 })
  assert.equal(selected.length, 2)
  assert.equal(selected[0].text, 'List<T>')
  assert.deepEqual(selected[1], { id: 's2', kind: 'subtitle', text: '当前知识', start: 10, end: 20 })
  assert.equal(cleanPracticeText('<img src="data:image/png;base64,abc">'), '')
})
test('材料预算有上限，标题或图片不能满足出题条件', () => {
  const bounded = practiceSources('课'.repeat(5000), Array.from({ length: 300 }, (_, id) => ({ id, start: id, end: id + 1, text: '字'.repeat(3000) })), '补'.repeat(5000), null)
  assert.equal(bounded.reduce((n, s) => n + s.text.length, 0), 12000)
  assert.ok(bounded.every(s => s.text.length <= 2000))
  assert.equal(enoughPracticeMaterial(practiceSources('![图](file.png) 01-反射', [], '', null)), false)
  assert.equal(enoughPracticeMaterial(sources), true)
})
test('出题与反馈必须引用实际材料，拒绝未知引用、残缺结果和材料不足', () => {
  assert.deepEqual(validatePracticeQuestion(question, sources), question)
  assert.deepEqual(validatePracticeFeedback(feedback, sources), feedback)
  assert.throws(() => validatePracticeQuestion({ ...question, sourceIds: ['invented'] }, sources), /不存在/)
  assert.throws(() => validatePracticeFeedback({ ...feedback, sourceIds: ['invented'] }, sources), /不存在/)
  assert.throws(() => validatePracticeQuestion({ ...question, concepts: [] }, sources))
  assert.throws(() => validatePracticeQuestion({ kind: 'needs-material', reason: '需要示例' }, sources), /需要示例/)
  assert.throws(() => validatePracticeFeedback({ ...feedback, strengths: [], gaps: [] }, sources))
})
test('练习恢复按课节隔离，保留草稿和反馈，舍弃损坏或伪造记录', () => {
  const record = { id: 'q1', path: 'a.mp4', createdAt: 1000, scope: null, sources, question, draft: '尚未提交的改进答案', attempts: [{ answer: '第一次答案', feedback, at: 2000 }] }
  assert.deepEqual(restorePractice([record], ['a.mp4']), [record])
  assert.deepEqual(restorePractice([record], ['b.mp4']), [])
  const bad = [
    { ...record, sources: [{ id: 's1', kind: 'subtitle', text: '内容', start: 50, end: 10 }] },
    { ...record, scope: { start: 10, end: 5 } },
    { ...record, question: { ...question, sourceIds: ['bad'] } },
    { ...record, attempts: Array(4).map(() => record.attempts[0]) },
  ]
  assert.deepEqual(restorePractice([...bad, record, record], ['a.mp4']), [record])
})

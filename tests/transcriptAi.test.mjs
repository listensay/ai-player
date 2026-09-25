import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyTranscriptCorrections,
  batchTranscriptSegments,
  refineTranscriptPrompt,
  validateTranscriptCorrections,
} from '../app/utils/transcriptAi.ts'

test('batchTranscriptSegments 正确处理空列表、短列表与超长分批', () => {
  assert.deepEqual(batchTranscriptSegments([]), [])

  const segs = [
    { id: 1, start: 0, end: 1, text: 'hello' },
    { id: 2, start: 1, end: 2, text: 'world' },
  ]
  const batches = batchTranscriptSegments(segs, 10, 100)
  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0], segs)

  // 超过 maxCount 分批
  const many = Array.from({ length: 25 }, (_, i) => ({ id: i, start: i, end: i + 1, text: `sentence ${i}` }))
  const batchesMany = batchTranscriptSegments(many, 10, 1000)
  assert.equal(batchesMany.length, 3)
  assert.equal(batchesMany[0].length, 10)
  assert.equal(batchesMany[1].length, 10)
  assert.equal(batchesMany[2].length, 5)

  // 超过 maxChars 分批
  const longSegs = [
    { id: 1, start: 0, end: 1, text: 'a'.repeat(60) },
    { id: 2, start: 1, end: 2, text: 'b'.repeat(60) },
  ]
  const batchesChars = batchTranscriptSegments(longSegs, 10, 80)
  assert.equal(batchesChars.length, 2)
})

test('refineTranscriptPrompt 包含视频标题与待校对的 ID 列表', () => {
  const segs = [
    { id: 101, start: 0, end: 2, text: '今天讲 you state' },
    { id: 102, start: 2, end: 4, text: '使用 pie torch 训练' },
  ]
  const messages = refineTranscriptPrompt('React 与 AI 进阶', segs)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'user')
  assert.ok(messages[0].content.includes('React 与 AI 进阶'))
  assert.ok(messages[0].content.includes('101'))
  assert.ok(messages[0].content.includes('you state'))
})

test('validateTranscriptCorrections 校验合法格式并剔除无效/伪造的 ID', () => {
  const batch = [
    { id: 1, start: 0, end: 1, text: 'you state' },
    { id: 2, start: 1, end: 2, text: '正常句子' },
  ]

  // 非法 JSON 结构报错
  assert.throws(() => validateTranscriptCorrections(null, batch), /有效校对列表/)
  assert.throws(() => validateTranscriptCorrections({ notItems: [] }, batch), /有效校对列表/)

  // 正常校对并忽略不存在的 ID 999
  const raw = {
    items: [
      { id: 1, text: 'useState' },
      { id: 2, text: '正常句子' },
      { id: 999, text: '虚构的句子' },
    ],
  }
  const corrections = validateTranscriptCorrections(raw, batch)
  assert.equal(corrections.size, 2)
  assert.equal(corrections.get(1), 'useState')
  assert.equal(corrections.get(2), '正常句子')
  assert.ok(!corrections.has(999))
})

test('applyTranscriptCorrections 准确更新文本、设置 refined 标记并统计变动条数', () => {
  const segs = [
    { id: 1, start: 0, end: 2, text: '使用 you state' },
    { id: 2, start: 2, end: 4, text: '这是正常的一句' },
    { id: 3, start: 4, end: 6, text: '运行 pie torch' },
  ]

  const corrections = new Map([
    [1, '使用 useState'],
    [2, '这是正常的一句'], // 未发生变化
    [3, '运行 PyTorch'],
  ])

  const { updatedSegments, changedCount } = applyTranscriptCorrections(segs, corrections)
  assert.equal(changedCount, 2)
  assert.equal(updatedSegments[0].text, '使用 useState')
  assert.equal(updatedSegments[0].refined, true)
  assert.equal(updatedSegments[1].text, '这是正常的一句')
  assert.equal(updatedSegments[1].refined, undefined)
  assert.equal(updatedSegments[2].text, '运行 PyTorch')
  assert.equal(updatedSegments[2].refined, true)
})

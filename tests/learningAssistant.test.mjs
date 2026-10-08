import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  learningContext,
  parseAssistantAnswer,
  parseLearningMap,
  parseFlashcards,
  parseFeynmanFeedback,
  parseHighlights,
  parseExtraction,
  generatedReviewCards,
  mapMermaid,
  transitionEnd,
} from '../app/utils/learningAssistant.ts'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest=async()=>null;export const flushDatabaseWrites=async()=>{}',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { parseLearningManagement, emptyLearningManagement, mergeReviewCards, rateReview } =
  await import('../app/utils/learningManagement.ts')
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
const ctx = learningContext(input)
test('上下文固定前后90秒、相交字幕和知识点，默认不读取任何笔记', () => {
  assert.equal(ctx.start, 60)
  assert.equal(ctx.end, 240)
  assert.deepEqual(
    ctx.evidence.map((s) => s.id),
    ['s:2', 's:3', 'k:lock'],
  )
  assert.equal(ctx.note, '')
  assert.equal(learningContext({ ...input, seconds: 0 }).start, 0)
  assert.equal(learningContext({ ...input, seconds: 590 }).end, 600)
  assert.equal(learningContext({ ...input, whole: true }).evidence.length, 5)
})
test('输入限制、NaN边界与截断提示', () => {
  const huge = learningContext({
    ...input,
    seconds: NaN,
    duration: Infinity,
    whole: true,
    note: 'a'.repeat(15000),
    segments: Array.from({ length: 100 }, (_, i) => ({ id: i, start: i, end: i + 1, text: 'x'.repeat(10000) })),
  })
  assert.equal(huge.seconds, 0)
  assert.equal(huge.truncated, true)
  assert.ok(huge.evidence.reduce((sum, s) => sum + s.text.length, 0) <= 60000)
  assert.equal(huge.note.length, 12000)
  assert.ok(Number.isFinite(huge.end))
})
test('回答来源必须来自本次材料，拒绝虚构时间点和空输出', () => {
  assert.equal(parseAssistantAnswer({ markdown: '解释', sources: ['s:3'] }, ctx).sources[0].start, 100)
  assert.throws(() => parseAssistantAnswer({ markdown: '解释', sources: ['s:1'] }, ctx), /不存在/)
  assert.throws(() => parseAssistantAnswer({ markdown: '', sources: [] }, ctx))
  assert.throws(() => parseAssistantAnswer({ markdown: '解释', sources: 's:3' }, ctx))
})
const nodes = [
  { id: 'root', parent: null, label: '课程', sources: ['k:lock'] },
  { id: 'child', parent: 'root', label: '互斥', sources: ['s:3'] },
]
test('脑图只接受有证据的单根无环树，Mermaid不包含可执行指令', () => {
  const graph = parseLearningMap({ nodes }, ctx)
  assert.match(mapMermaid(graph), /n0 --> n1/)
  assert.throws(() => parseLearningMap({ nodes: [nodes[0], { ...nodes[1], parent: 'missing' }] }, ctx))
  assert.throws(() =>
    parseLearningMap({ nodes: [...nodes, { id: 'cycle', parent: 'cycle', label: 'c', sources: ['s:2'] }] }, ctx),
  )
  assert.throws(() => parseLearningMap({ nodes: [nodes[0], { ...nodes[1], id: 'root' }] }, ctx))
  assert.throws(() => parseLearningMap({ nodes: [{ ...nodes[0], sources: [] }] }, ctx))
  const escaped = mapMermaid([{ ...graph[0], label: 'a"]\nclick n0 "javascript:alert(1)"' }])
  assert.equal(escaped.split('\n').length, 2)
  assert.ok(!escaped.includes('\nclick'))
})
const rawCards = { cards: [1, 2, 3].map((n) => ({ front: `问题 ${n}`, back: `解释 ${n}`, sources: ['k:lock'] })) }
test('AI闪卡去重、有来源，可直接接入现有间隔复习而不重置旧复习进度', () => {
  const cards = parseFlashcards(rawCards, ctx)
  assert.throws(() => parseFlashcards({ cards: rawCards.cards.slice(0, 2) }, ctx))
  assert.throws(() => parseFlashcards({ cards: [rawCards.cards[0], rawCards.cards[0], rawCards.cards[2]] }, ctx))
  const reviews = generatedReviewCards(cards, ctx, '2026-10-07', 100)
  const data = parseLearningManagement({ ...emptyLearningManagement(), cards: reviews })
  assert.equal(data.cards.length, 3)
  assert.equal(data.cards[0].seconds, 70)
  const reviewed = rateReview(reviews[0], 'remembered', new Date(2026, 9, 7, 12).getTime())
  assert.equal(mergeReviewCards([reviewed], []).at(0).due, reviewed.due)
  assert.equal(generatedReviewCards(cards, ctx, '2026-10-08', 200)[0].id, reviews[0].id)
})
test('费曼评分检查范围与证据，识别空图与不确定内容不会伪造代码', () => {
  const feedback = {
    markdown: '需补充边界条件',
    sources: ['k:lock'],
    score: 70,
    gaps: ['死锁条件'],
    followUp: '怎样避免死锁？',
  }
  assert.equal(parseFeynmanFeedback(feedback, ctx).score, 70)
  for (const score of [NaN, -1, 101, '90']) assert.throws(() => parseFeynmanFeedback({ ...feedback, score }, ctx))
  assert.equal(parseExtraction({ markdown: '画面无法识别', code: '', warnings: '模糊' }).code, '')
})
test('高光片段必须使用字幕边界，不允许重叠；仅明确过渡可自动跳过', () => {
  const segments = parseHighlights(
    {
      segments: [
        { from: 's:2', to: 's:2', kind: 'transition', reason: '等待设备' },
        { from: 's:3', to: 's:3', kind: 'core', reason: '原理讲解' },
      ],
    },
    ctx,
  )
  assert.equal(transitionEnd(segments, 70, 600), 100)
  assert.equal(transitionEnd(segments, 110, 600), null)
  assert.equal(transitionEnd(segments, 40, 600), null)
  assert.equal(transitionEnd(segments, 99.8, 600), null)
  assert.equal(transitionEnd(segments, 70, 100), null)
  assert.throws(() =>
    parseHighlights({ segments: [{ from: 'k:lock', to: 'k:lock', kind: 'core', reason: '无字幕' }] }, ctx),
  )
  assert.throws(() =>
    parseHighlights(
      {
        segments: [
          { from: 's:2', to: 's:3', kind: 'core', reason: 'a' },
          { from: 's:3', to: 's:3', kind: 'core', reason: 'b' },
        ],
      },
      ctx,
    ),
  )
})

test('笔记可独立作为制卡依据，最后一条被裁剪时也明确标记截断', () => {
  const noteOnly = learningContext({ ...input, segments: [], points: [], note: '用户整理的互斥锁边界条件。' })
  assert.equal(noteOnly.evidence[0].id, 'n:note')
  assert.equal(
    parseFlashcards({ cards: rawCards.cards.map((c) => ({ ...c, sources: ['n:note'] })) }, noteOnly).length,
    3,
  )
  const clipped = learningContext({
    ...input,
    whole: true,
    points: [],
    segments: Array.from({ length: 8 }, (_, i) => ({ id: i, start: i, end: i + 1, text: 'x'.repeat(7800) })),
  })
  assert.equal(clipped.evidence.length, 8)
  assert.equal(clipped.truncated, true)
  assert.equal(parseExtraction({ markdown: '代码', language: 'C++' }).language, 'cpp')
})

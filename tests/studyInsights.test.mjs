import assert from 'node:assert/strict'
import { test } from 'node:test'
import { digestPeriod, buildStudyInsights, restoreStudyEvidence, digestMarkdown } from '../app/utils/studyInsights.ts'
const evidence = { notes: [], practices: [] }
const period = { start: '2026-09-01', end: '2026-09-30', label: '上月' }
function course(days = {}) {
  return {
    course: { id: 'a', name: 'A', videoCount: 2 },
    error: '',
    days,
    snapshots: {},
    context: { progress: {}, records: { entries: [] }, mastery: {} },
  }
}
test('本期截至今日，上一周跨年，上一月闰年边界', () => {
  assert.deepEqual(digestPeriod('week', 0, '2026-10-01'), { start: '2026-09-28', end: '2026-10-01', label: '本周' })
  assert.deepEqual(digestPeriod('week', -1, '2026-01-01'), { start: '2025-12-22', end: '2025-12-28', label: '上周' })
  assert.equal(digestPeriod('month', -1, '2024-03-10').end, '2024-02-29')
})
test('跨课程打卡按日期去重，连续天数不中断地跨月计算', () => {
  const days = {}
  for (let i = 1; i <= 21; i++) {
    const date = `2026-09-${String(i).padStart(2, '0')}`
    days[date] = { seconds: 600, targetSeconds: 600, checkedAt: new Date(`${date}T21:00:00`).getTime() }
  }
  const data = buildStudyInsights([course(days), course(days)], evidence, period, '2026-10-01')
  assert.equal(data.checked, 21)
  assert.equal(data.activity.days, 21)
  assert.equal(data.activity.totalSeconds, 21 * 1200)
  assert.equal(data.seconds, 21 * 1200)
})
test('倍速完成安排和实践达标的打卡计入周回顾，真实用时不被补足到目标', () => {
  const entry = course({
    '2026-09-29': { seconds: 11520, targetSeconds: 14400, checkedAt: new Date('2026-09-29T18:00:00').getTime() },
    '2026-09-30': { seconds: 600, targetSeconds: 1800, checkedAt: new Date('2026-09-30T18:00:00').getTime() },
  })
  entry.context.records.entries = [{ date: '2026-09-30', minutes: 20, done: true }]
  const data = buildStudyInsights([entry], evidence, period, '2026-10-01')
  assert.equal(data.checked, 2)
  assert.equal(data.seconds, 11520 + 600 + 1200)
  assert.match(digestMarkdown(data), /达标打卡：2 天/)
})
test('笔记为当前字符非新增字数，题目去重，自评掌握不以观看完成推断', () => {
  const at = new Date('2026-09-15T12:00:00').getTime()
  const e = {
    notes: [{ courseId: 'a', characters: 1200, updatedAt: at }],
    practices: [
      { courseId: 'a', id: 'q', solidAt: at },
      { courseId: 'a', id: 'q', solidAt: at },
    ],
  }
  const data = buildStudyInsights([course()], e, period)
  assert.equal(data.solved, 1)
  assert.equal(data.updatedCharacters, 1200)
  assert.equal(data.mastered.length, 0)
  assert.doesNotMatch(digestMarkdown(data), /笔记累计字符/)
})
test('学习证据拒绝损坏和非有限数字', () => {
  assert.throws(() =>
    restoreStudyEvidence({ notes: [{ courseId: 'a', characters: NaN, updatedAt: 0 }], practices: [] }),
  )
  assert.deepEqual(restoreStudyEvidence(evidence), evidence)
})

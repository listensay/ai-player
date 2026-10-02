import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  digestPeriod,
  buildStudyInsights,
  restoreFocusHistory,
  restoreStudyEvidence,
  digestMarkdown,
} from '../app/utils/studyInsights.ts'
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
  const data = buildStudyInsights([course(days), course(days)], evidence, [], period, '2026-10-01')
  assert.equal(data.checked, 21)
  assert.equal(data.growth.days, 21)
  assert.equal(data.growth.points, 210)
  assert.equal(data.badges[0].unlocked, true)
  assert.equal(data.seconds, 21 * 1200)
  assert.equal(data.best, null)
})
test('专注推荐需同一小时五个结束样本和三天，放弃视为中断，活动会话不计', () => {
  const sessions = Array.from({ length: 5 }, (_, i) => ({
    startedAt: i,
    endedAt: i + 1,
    startHour: 21,
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    interruptions: 0,
    outcome: 'completed',
  }))
  assert.equal(buildStudyInsights([], evidence, sessions.slice(0, 4), period).best, null)
  const d = buildStudyInsights([], evidence, sessions, period)
  assert.equal(d.best.hour, 21)
  assert.equal(d.best.samples, 5)
  sessions[0].outcome = 'abandoned'
  assert.equal(buildStudyInsights([], evidence, sessions, period).best.interrupted, 1)
  sessions.forEach((s) => (s.date = '2026-09-01'))
  assert.equal(buildStudyInsights([], evidence, sessions, period).best, null)
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
  const data = buildStudyInsights([course()], e, [], period)
  assert.equal(data.solved, 1)
  assert.equal(data.updatedCharacters, 1200)
  assert.equal(data.mastered.length, 0)
  assert.match(digestMarkdown(data), /笔记累计字符/)
})
test('新历史兼容旧记录，拒绝损坏和非有限数字', () => {
  assert.deepEqual(restoreFocusHistory(undefined), [])
  assert.throws(() => restoreFocusHistory([{}]))
  assert.throws(() =>
    restoreStudyEvidence({ notes: [{ courseId: 'a', characters: NaN, updatedAt: 0 }], practices: [] }),
  )
  assert.deepEqual(restoreStudyEvidence(evidence), evidence)
})

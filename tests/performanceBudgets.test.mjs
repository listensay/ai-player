import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPerformanceBudgets, performanceBudgets } from '../scripts/performance-budgets.mjs'
const report = () => ({
  results: performanceBudgets.map((r) => ({ ...r, medianMs: r.medianMs / 2, p95Ms: r.p95Ms / 2 })),
  typingBurst: { serializations: 1 },
  repeatedViewChanges: { writes: { records: 1, snapshot: 1 } },
  learningRefresh: { dashboard: 1, sources: 1, scopedDashboard: 1, scopedSources: 1 },
})
test('性能门槛接受有效样本，拒绝变慢、缺失指标和重复整库读取', () => {
  checkPerformanceBudgets(report())
  const slow = report()
  slow.results[0].p95Ms = 100
  assert.throws(() => checkPerformanceBudgets(slow), /p95Ms/)
  const missing = report()
  missing.results.pop()
  assert.throws(() => checkPerformanceBudgets(missing), /missing/)
  const reads = report()
  reads.learningRefresh.dashboard++
  assert.throws(() => checkPerformanceBudgets(reads), /full reads/)
  const writes = report()
  writes.repeatedViewChanges.writes.snapshot++
  assert.throws(() => checkPerformanceBudgets(writes), /writes/)
})

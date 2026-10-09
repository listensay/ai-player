import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startPerformanceMeasure, performanceReport } from '../app/utils/performance.ts'

test('耗时采样只记录完成操作、避免重复结束，并限制本地历史大小', () => {
  const cancelled = startPerformanceMeasure('video-ready')
  cancelled.cancel()
  cancelled.finish()
  assert.deepEqual(performanceReport(), [])
  const first = startPerformanceMeasure('video-ready')
  first.finish()
  first.finish()
  assert.equal(performanceReport()[0].count, 1)
  for (let i = 0; i < 205; i++) startPerformanceMeasure('course-open').finish()
  const report = performanceReport()
  assert.equal(
    report.reduce((n, row) => n + row.count, 0),
    200,
  )
  assert.ok(report.every((row) => row.medianMs >= 0 && row.p95Ms >= row.medianMs))
  assert.equal(performance.getEntriesByName('ai-player:course-open').length, 1)
})

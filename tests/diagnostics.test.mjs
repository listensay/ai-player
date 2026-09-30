import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diagnosticsReport } from '../app/utils/diagnostics.ts'
import { startPerformanceMeasure } from '../app/utils/performance.ts'
test('导出仅包含构建信息、窗口尺寸和聚合耗时', () => {
  startPerformanceMeasure('note-ready').finish()
  const report = diagnosticsReport({
    width: 1280.2,
    height: 900.2,
    course: 'private',
    apiKey: 'secret',
    note: 'private note',
  })
  assert.deepEqual(report.viewport, { width: 1280, height: 900 })
  assert.deepEqual(Object.keys(report).sort(), ['build', 'generatedAt', 'metrics', 'version', 'viewport'])
  assert.equal(report.metrics[0].metric, 'note-ready')
  assert.doesNotMatch(JSON.stringify(report), /private|secret|apiKey/)
})

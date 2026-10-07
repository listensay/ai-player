/** Local diagnostic samples only. Labels never include file paths, course names or content. */
export type PerformanceMetric =
  'webview-ready' | 'home-load' | 'course-open' | 'video-ready' | 'note-ready' | 'programming-ready'
const samples: Array<{ metric: PerformanceMetric; milliseconds: number }> = []
const LIMIT = 200

export function startPerformanceMeasure(metric: PerformanceMetric, start = performance.now()) {
  let settled = false
  return {
    finish() {
      if (settled) return
      settled = true
      const end = performance.now()
      const milliseconds = Math.max(0, end - start)
      samples.push({ metric, milliseconds })
      if (samples.length > LIMIT) samples.splice(0, samples.length - LIMIT)
      // Keep one latest entry per label in the WebView's standard Performance panel.
      performance.clearMeasures(`ai-player:${metric}`)
      performance.measure(`ai-player:${metric}`, { start, end })
    },
    cancel() {
      settled = true
    },
  }
}

export function performanceReport() {
  return [...new Set(samples.map((sample) => sample.metric))].map((metric) => {
    const values = samples
      .filter((sample) => sample.metric === metric)
      .map((sample) => sample.milliseconds)
      .sort((a, b) => a - b)
    return {
      metric,
      count: values.length,
      medianMs: values[Math.floor(values.length / 2)]!,
      p95Ms: values[Math.ceil(values.length * 0.95) - 1]!,
    }
  })
}

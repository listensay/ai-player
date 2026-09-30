import { performanceReport } from './performance.ts'

export const buildInfo =
  typeof __APP_BUILD__ === 'undefined'
    ? { version: 'development', commit: 'unknown', dirty: false, builtAt: '' }
    : __APP_BUILD__

/** Only build identifiers, viewport dimensions and aggregate durations are exported. */
export function diagnosticsReport(viewport: { width: number; height: number }) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    build: { ...buildInfo },
    viewport: { width: Math.round(viewport.width), height: Math.round(viewport.height) },
    metrics: performanceReport().map((row) => ({
      ...row,
      medianMs: +row.medianMs.toFixed(3),
      p95Ms: +row.p95Ms.toFixed(3),
    })),
  }
}

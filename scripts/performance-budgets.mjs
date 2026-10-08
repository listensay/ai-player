// Broad absolute limits tolerate shared CI runners; write counts are deterministic.
export const performanceBudgets = [
  { name: 'read-budget', lessons: 2000, medianMs: 0.2, p95Ms: 0.5 },
  { name: 'calculate-day', lessons: 2000, medianMs: 30, p95Ms: 60 },
  { name: 'day-snapshot', lessons: 2000, medianMs: 30, p95Ms: 60 },
  { name: 'many-completed-today', lessons: 2000, medianMs: 20, p95Ms: 40 },
]
export function checkPerformanceBudgets(report) {
  const errors = []
  for (const budget of performanceBudgets) {
    const actual = report.results?.find((r) => r.name === budget.name && r.lessons === budget.lessons)
    for (const key of ['medianMs', 'p95Ms'])
      if (!Number.isFinite(actual?.[key]) || actual[key] < 0 || actual[key] > budget[key])
        errors.push(`${budget.name} ${key}: ${actual?.[key] ?? 'missing'} (limit ${budget[key]} ms)`)
  }
  if (report.repeatedViewChanges?.writes?.records !== 1 || report.repeatedViewChanges?.writes?.snapshot !== 1)
    errors.push('View changes repeated record/snapshot writes')
  const reads = report.learningRefresh
  if (
    !reads ||
    reads.dashboard !== 1 ||
    reads.sources !== 1 ||
    reads.scopedDashboard !== 1 ||
    reads.scopedSources !== 1
  )
    errors.push('Learning refresh repeated full reads or missed a scoped update')
  if (errors.length) throw Error(`Performance budget exceeded:\n${errors.join('\n')}`)
}

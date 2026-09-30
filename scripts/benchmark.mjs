import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { reactive } from 'vue'
import { buildTodayPlan } from '../app/utils/learningFeedback.ts'
import { useNoteSession } from '../app/composables/useNoteSession.ts'
import * as dailyPlan from '../app/utils/dailyPlan.ts'
import { performanceContext } from '../tests/fixtures/performance.mjs'

const writes = { guide: 0, records: 0, snapshot: 0 }
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/dbClient')
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(
            'export const dbSaveGuide = async () => { globalThis.benchmarkWrites.guide++; return true }; export const dbSaveSetting = async () => { globalThis.benchmarkWrites.records++; return true }',
          ),
        shortCircuit: true,
      }
    if (specifier === '~/utils/database')
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(
            'export const databaseRequest = async () => { globalThis.benchmarkWrites.snapshot++; return true }',
          ),
        shortCircuit: true,
      }
    return next(specifier, context)
  },
})
globalThis.benchmarkWrites = writes
const { useGuidePersistence } = await import('../app/composables/useGuidePersistence.ts')
const date = '2026-09-30'
const results = []
function measure(name, size, work, iterations = 100) {
  for (let i = 0; i < 10; i++) work()
  const samples = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    work()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  results.push({
    name,
    lessons: size,
    iterations,
    medianMs: +samples[Math.floor(iterations / 2)].toFixed(3),
    p95Ms: +samples[Math.ceil(iterations * 0.95) - 1].toFixed(3),
  })
}
const budget = dailyPlan.calculateDayBudget ?? ((context, date) => dailyPlan.calculateDay(context, date).budget)
for (const size of [200, 2000]) {
  const context = reactive(performanceContext(size))
  context.today = dailyPlan.calculateDay(context, date).today
  measure('read-budget', size, () => budget(context, date))
  measure('calculate-day', size, () => dailyPlan.calculateDay(context, date))
  measure('day-snapshot', size, () => dailyPlan.daySnapshot(context, date))
}
const large = reactive(performanceContext(2000))
const shortDurations = Object.fromEntries(large.plan.lessons.map((lesson) => [lesson.path, 30]))
const completedDay = reactive({
  date,
  minutes: 600,
  override: null,
  items: large.plan.lessons.slice(0, 800).map((lesson) => ({
    id: lesson.path,
    kind: 'lesson',
    path: lesson.path,
    start: 0,
    end: 30,
    seconds: 30,
    done: true,
    estimated: false,
  })),
})
measure(
  'many-completed-today',
  2000,
  () => buildTodayPlan(large.plan.lessons, shortDurations, {}, {}, [], 600, date, completedDay),
  20,
)
let serializations = 0
const note = useNoteSession({
  read: async () => ({ content: '', updatedAt: 1 }),
  readCopy: async () => null,
  write: async () => ({ success: true }),
  writeCopy: async () => {},
})
await note.load()
for (let i = 0; i < 100; i++)
  note.editFrom(() => {
    serializations++
    return `synthetic note ${i}`
  })
await note.save()
note.dispose()
const context = performanceContext(2000)
let view = 'all'
const persistence = useGuidePersistence({
  revision: () => 1,
  guide: () => ({ courseId: 'benchmark', plan: context.plan, metadata: context.metadata, today: context.today, view }),
  records: () => ({ key: 'benchmark', value: context.records }),
  day: () => ({ courseId: 'benchmark', snapshot: dailyPlan.daySnapshot(context, date) }),
  error: (message) => {
    throw Error(message)
  },
})
for (let i = 0; i < 50; i++) {
  view = view === 'all' ? 'route' : 'all'
  persistence.persist()
  await new Promise((resolve) => setImmediate(resolve))
}
persistence.reset()
const report = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  date,
  results,
  typingBurst: { updates: 100, serializations },
  repeatedViewChanges: { changes: 50, writes },
  note: 'Synthetic Vue-reactive CPU benchmark and write counts. Not startup time, UI latency, or real database I/O.',
}
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
delete globalThis.benchmarkWrites

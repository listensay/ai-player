import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createRenderer, nextTick } from 'vue'
import { localDayKey } from '../app/utils/learningFeedback.ts'
import { emptyStudyTools } from '../app/utils/studyTools.ts'
let source = readFileSync(new URL('../app/composables/useStudyTools.ts', import.meta.url), 'utf8')
  .replace(
    "import { databaseRequest } from '~/utils/database'",
    'const databaseRequest = (...args) => globalThis.reminderHarness.request(...args)',
  )
  .replace(
    "import { desktopInvoke } from '~/utils/platform'",
    'const desktopInvoke = async () => ({available:false,links:{}})',
  )
  .replace(
    "import { useCourseStore } from './useCourseStore'",
    'const useCourseStore = () => globalThis.reminderHarness.store',
  )
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
  .replaceAll("from '~/utils/studyTools'", `from '${new URL('../app/utils/studyTools.ts', import.meta.url)}'`)
  .replaceAll(
    "from '~/utils/learningFeedback'",
    `from '${new URL('../app/utils/learningFeedback.ts', import.meta.url)}'`,
  )
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { provideStudyTools } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const reminder = (courseId) => ({
  id: courseId || 'general',
  courseId,
  title: '学习',
  time: '00:00',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  enabled: true,
  pending: true,
  lastNotifiedDate: '',
  snoozedUntil: null,
})
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
  await nextTick()
}
function mount(t, days = {}, fail = false) {
  const previous = globalThis.window
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  let data = { ...emptyStudyTools(), reminders: [reminder('a'), reminder('b'), reminder('')] }
  globalThis.reminderHarness = {
    store: {
      state: {
        libraryReady: true,
        library: [
          { id: 'a', status: 'active' },
          { id: 'b', status: 'active' },
        ],
      },
    },
    async request(endpoint, options = {}) {
      if (endpoint === 'check-in') {
        if (fail) throw Error('read failed')
        return days[options.query.courseId] ?? {}
      }
      if (options.query?.key?.startsWith('study-records:')) return null
      if (options.method === 'POST') {
        data = structuredClone(options.body.value)
        return null
      }
      return structuredClone(data)
    },
  }
  let tools
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      tools = provideStudyTools()
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    globalThis.window = previous
    delete globalThis.reminderHarness
  })
  return { tools, saved: () => data }
}
test('重启读取当天活动后压制该课程和通用提醒，其他课程仍提醒', async (t) => {
  const { tools, saved } = mount(t, { a: { [localDayKey()]: { seconds: 1 } } })
  await settle()
  assert.deepEqual(
    tools.pending.value.map((r) => r.courseId),
    ['b'],
  )
  assert.equal(saved().reminders.find((r) => r.id === 'a').pending, false)
  assert.equal(saved().reminders.find((r) => r.id === 'general').pending, false)
})
test('播放产生有效投入后立即隐藏现有提醒并持久取消稍后提醒', async (t) => {
  const { tools, saved } = mount(t)
  await settle()
  assert.equal(tools.pending.value.length, 3)
  await tools.snooze('a')
  tools.markStudied('a', localDayKey())
  assert.deepEqual(
    tools.pending.value.map((r) => r.courseId),
    ['b'],
  )
  await settle()
  assert.equal(saved().reminders.find((r) => r.id === 'a').snoozedUntil, null)
  assert.equal(saved().reminders.find((r) => r.id === 'a').lastNotifiedDate, localDayKey())
})
test('无法读取学习记录时不错误催学，也不覆盖已存提醒', async (t) => {
  const { tools, saved } = mount(t, {}, true)
  await settle()
  assert.equal(tools.pending.value.length, 0)
  assert.equal(
    saved().reminders.every((r) => r.pending),
    true,
  )
  assert.match(tools.state.notice, /重试/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createRenderer, nextTick, ref } from 'vue'
import { localDayKey } from '../app/utils/learningFeedback.ts'
import { emptyStudyTools } from '../app/utils/studyTools.ts'
let source = readFileSync(new URL('../app/composables/useStudyTools.ts', import.meta.url), 'utf8')
  .replace(
    "import { databaseRequest } from '~/utils/database'",
    'const databaseRequest = (...args) => globalThis.reminderHarness.request(...args)',
  )
  .replace(
    "import { desktopInvoke } from '~/utils/platform'",
    'const desktopInvoke = (...args) => globalThis.reminderHarness.invoke(...args)',
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
function mount(t, days = {}, fail = false, { sound = false, soundFailure = false, saveFailure = false } = {}) {
  const previous = globalThis.window
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  let data = { ...emptyStudyTools(), reminderSound: sound, reminders: [reminder('a'), reminder('b'), reminder('')] }
  const calls = []
  globalThis.reminderHarness = {
    async invoke(command) {
      calls.push(command)
      if (command === 'play_reminder_sound' && soundFailure) throw Error('sound failed')
      return { available: false, links: {} }
    },
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
        if (saveFailure) throw Error('save failed')
        data = structuredClone(options.body.value)
        return null
      }
      return structuredClone(data)
    },
  }
  let tools
  const studyingCourse = ref(null)
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      tools = provideStudyTools(studyingCourse)
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    globalThis.window = previous
    delete globalThis.reminderHarness
  })
  return { tools, studyingCourse, calls, saved: () => data }
}
test('读取当天学习活动后隐藏整个顶部提醒，保留其他课程的提醒状态', async (t) => {
  const { tools, saved } = mount(t, { a: { [localDayKey()]: { seconds: 1 } } })
  await settle()
  assert.deepEqual(tools.pending.value, [])
  assert.equal(saved().reminders.find((r) => r.id === 'a').pending, false)
  assert.equal(saved().reminders.find((r) => r.id === 'general').pending, false)
  assert.equal(saved().reminders.find((r) => r.id === 'b').pending, true)
})
test('播放产生有效投入后立即隐藏现有提醒并持久取消稍后提醒', async (t) => {
  const { tools, saved } = mount(t)
  await settle()
  assert.equal(tools.pending.value.length, 3)
  await tools.snooze('a')
  tools.markStudied('a', localDayKey())
  assert.deepEqual(tools.pending.value, [])
  await settle()
  assert.equal(saved().reminders.find((r) => r.id === 'a').snoozedUntil, null)
  assert.equal(saved().reminders.find((r) => r.id === 'a').lastNotifiedDate, localDayKey())
})
test('开始播放即隐藏全部顶部提醒，尚未累计时长时暂停也不重新显示', async (t) => {
  const { tools, studyingCourse, saved } = mount(t)
  await settle()
  assert.equal(tools.pending.value.length, 3)
  studyingCourse.value = 'a'
  assert.deepEqual(tools.pending.value, [])
  studyingCourse.value = null
  assert.deepEqual(tools.pending.value, [])
  await settle()
  assert.equal(saved().reminders.find((r) => r.id === 'a').pending, false)
  assert.equal(saved().reminders.find((r) => r.id === 'general').pending, false)
  assert.equal(saved().reminders.find((r) => r.id === 'b').pending, true)
})
test('昨天的学习活动不隐藏今天的顶部提醒', async (t) => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const { tools } = mount(t, { a: { [localDayKey(yesterday)]: { seconds: 60 } } })
  await settle()
  assert.equal(tools.pending.value.length, 3)
})
test('重启读取当天只有实践用时的记录也不再催学', async (t) => {
  const { tools } = mount(t, { a: { [localDayKey()]: { seconds: 0, practiceSeconds: 1 } } })
  await settle()
  assert.deepEqual(tools.pending.value, [])
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
test('同批多个到时提醒只响一次，后续检查不重复响铃', async (t) => {
  const { tools, calls } = mount(t, {}, false, { sound: true })
  await settle()
  assert.equal(calls.filter((command) => command === 'play_reminder_sound').length, 1)
  await tools.checkReminders()
  await tools.checkReminders()
  assert.equal(calls.filter((command) => command === 'play_reminder_sound').length, 1)
})
test('关闭响铃、记录读取失败或保存失败都不发送声音', async (t) => {
  for (const [fail, settings] of [
    [false, {}],
    [true, { sound: true }],
    [false, { sound: true, saveFailure: true }],
  ]) {
    await t.test(JSON.stringify([fail, settings]), async (t) => {
      const { calls } = mount(t, {}, fail, settings)
      await settle()
      assert.ok(!calls.includes('play_reminder_sound'))
    })
  }
})
test('响铃失败不丢失页面提醒并显示可重试的错误', async (t) => {
  const { tools } = mount(t, {}, false, { sound: true, soundFailure: true })
  await settle()
  assert.equal(tools.pending.value.length, 3)
  assert.match(tools.state.notice, /响铃失败/)
})

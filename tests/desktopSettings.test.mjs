import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRenderer } from 'vue'
import ts from 'typescript'

const source = readFileSync(new URL('../app/composables/useDesktopSettings.ts', import.meta.url), 'utf8')
  .replace("from 'vue'", `from '${import.meta.resolve('vue')}'`)
  .replace(
    "import { desktopInvoke } from '~/utils/platform'",
    'const desktopInvoke = (...args) => globalThis.desktopSettingsHarness.invoke(...args)',
  )
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { useDesktopSettings } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
}
function mount(t) {
  let settings
  const state = { enabled: true, fail: '', calls: [], pending: null }
  globalThis.desktopSettingsHarness = {
    async invoke(command, args) {
      state.calls.push([command, args])
      if (state.fail === command) throw Error('failed')
      if (state.pending) await state.pending
      if (command === 'set_autostart') state.enabled = args.enabled
      return state.enabled
    },
  }
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      settings = useDesktopSettings()
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.desktopSettingsHarness
  })
  return { settings, state, unmount: () => app.unmount() }
}
test('自启从系统读取，成功写入后才更新开关，失败保留当前状态', async (t) => {
  const { settings, state } = mount(t)
  assert.equal(settings.state.ready, false)
  await settle()
  assert.equal(settings.state.autostart, true)
  await settings.setAutostart(false)
  assert.equal(settings.state.autostart, false)
  state.fail = 'set_autostart'
  await settings.setAutostart(true)
  assert.equal(settings.state.autostart, false)
  assert.match(settings.state.error, /设置失败/)
})
test('读取失败可重试，进行中的写入不重复发送，卸载后不接受旧结果', async (t) => {
  const { settings, state, unmount } = mount(t)
  await settle()
  state.fail = 'autostart_enabled'
  await settings.load()
  assert.match(settings.state.error, /读取失败/)
  state.fail = ''
  await settings.load()
  let release
  state.pending = new Promise((resolve) => {
    release = resolve
  })
  const first = settings.setAutostart(false)
  await settings.setAutostart(false)
  assert.equal(state.calls.filter(([command]) => command === 'set_autostart').length, 1)
  unmount()
  release()
  await first
  assert.equal(settings.state.autostart, true)
})
test('试听不依赖响铃开关，避免重叠播放并保留播放失败提示', async (t) => {
  const { settings, state } = mount(t)
  await settle()
  state.fail = 'play_reminder_sound'
  await settings.previewSound()
  assert.match(settings.state.error, /响铃播放失败/)
  state.fail = ''
  let release
  state.pending = new Promise((resolve) => {
    release = resolve
  })
  const first = settings.previewSound()
  await settings.previewSound()
  assert.equal(state.calls.filter(([command]) => command === 'play_reminder_sound').length, 2)
  release()
  await first
  assert.equal(settings.state.previewing, false)
})

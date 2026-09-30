import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createRenderer } from 'vue'
const source = readFileSync(new URL('../app/composables/useDesktopSettings.ts', import.meta.url), 'utf8')
  .replace(
    "import { databaseRequest } from '~/utils/database'",
    'const databaseRequest = (...args) => globalThis.desktopSettingsRequest(...args)',
  )
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { provideDesktopSettings } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
function mount(t, stored = null) {
  const control = { stored, fail: false, reads: 0 }
  globalThis.desktopSettingsRequest = async (_, options) => {
    if (control.fail) throw Error('database unavailable')
    if (options.method === 'POST') {
      control.stored = options.body.value
      return
    }
    control.reads++
    return control.stored
  }
  let settings
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      settings = provideDesktopSettings()
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.desktopSettingsRequest
  })
  return { settings, control }
}
test('默认不自动打开桌宠，并发启动读取共享一次数据库请求', async (t) => {
  const { settings, control } = mount(t)
  await Promise.all([settings.load(), settings.load()])
  assert.equal(settings.state.ready, true)
  assert.equal(settings.state.autoOpenCompanion, false)
  assert.equal(control.reads, 1)
})
test('恢复已保存的启动选项，关闭后持久保存，保存失败不假装成功', async (t) => {
  const { settings, control } = mount(t, true)
  await settings.load()
  assert.equal(settings.state.autoOpenCompanion, true)
  await settings.setAutoOpenCompanion(false)
  assert.equal(control.stored, false)
  assert.equal(settings.state.autoOpenCompanion, false)
  control.fail = true
  await settings.setAutoOpenCompanion(true)
  assert.equal(settings.state.autoOpenCompanion, false)
  assert.match(settings.state.error, /保存失败/)
})
test('损坏或读取失败的选项不覆盖数据库，也不启用自动打开', async (t) => {
  const { settings, control } = mount(t, 'corrupted')
  await settings.load()
  assert.equal(settings.state.ready, false)
  await settings.setAutoOpenCompanion(true)
  assert.equal(control.stored, 'corrupted')
  control.stored = true
  await settings.load()
  assert.equal(settings.state.ready, true)
  assert.equal(settings.state.autoOpenCompanion, true)
})

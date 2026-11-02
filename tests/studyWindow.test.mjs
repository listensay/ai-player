import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRenderer } from 'vue'
import ts from 'typescript'

const source = readFileSync(new URL('../app/composables/useStudyWindow.ts', import.meta.url), 'utf8')
  .replace("from 'vue'", `from '${import.meta.resolve('vue')}'`)
  .replace(
    "import { desktopInvoke } from '~/utils/platform'",
    'const desktopInvoke = () => globalThis.studyWindowHarness.read()',
  )
  .replace(
    "const { listen } = await import('@tauri-apps/api/event')",
    'const listen = (...args) => globalThis.studyWindowHarness.listen(...args)',
  )
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { useStudyWindow } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
}
function mount(t, read = async () => true) {
  let visible, listener
  const state = { stopped: false }
  globalThis.studyWindowHarness = {
    read,
    async listen(_event, callback) {
      listener = callback
      return () => {
        state.stopped = true
      }
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
      visible = useStudyWindow()
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.studyWindowHarness
  })
  return { visible, state, emit: (value) => listener({ payload: value }), unmount: () => app.unmount() }
}
test('确认窗口可见后才计时，隐藏和恢复事件立即更新状态', async (t) => {
  const { visible, emit } = mount(t)
  assert.equal(visible.value, false)
  await tick()
  assert.equal(visible.value, true)
  emit(false)
  assert.equal(visible.value, false)
  emit(true)
  assert.equal(visible.value, true)
})
test('旧查询不覆盖刚发生的隐藏状态，卸载清理监听器', async (t) => {
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const { visible, emit, state, unmount } = mount(t, () => pending)
  await tick()
  emit(false)
  release(true)
  await tick()
  assert.equal(visible.value, false)
  unmount()
  assert.equal(state.stopped, true)
})
test('状态读取失败不后台计时，后续恢复事件仍可启用', async (t) => {
  const { visible, emit } = mount(t, async () => {
    throw Error('read failed')
  })
  await tick()
  assert.equal(visible.value, false)
  emit(true)
  assert.equal(visible.value, true)
})

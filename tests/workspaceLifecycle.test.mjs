import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRenderer } from 'vue'
import ts from 'typescript'

const source = readFileSync(new URL('../app/composables/useWorkspaceLifecycle.ts', import.meta.url), 'utf8')
  .replace("from 'vue'", `from '${import.meta.resolve('vue')}'`)
  .replace(
    "import { desktopInvoke } from '~/utils/platform'",
    'const desktopInvoke = (...args) => globalThis.lifecycleHarness.invoke(...args)',
  )
  .replace(
    "const { listen } = await import('@tauri-apps/api/event')",
    'const listen = (...args) => globalThis.lifecycleHarness.listen(...args)',
  )
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { useWorkspaceLifecycle } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const settle = async () => {
  for (let i = 0; i < 15; i++) await new Promise((resolve) => setImmediate(resolve))
}
function mount(t) {
  const state = { calls: [], notices: [], jobs: false, confirm: true, fail: '', pending: null }
  const listeners = new Map()
  globalThis.lifecycleHarness = {
    async invoke(command) {
      state.calls.push(command)
      if (state.fail === command) throw Error('write failed')
      return state.confirm
    },
    async listen(event, callback) {
      if (state.fail === event) throw Error('listen failed')
      listeners.set(event, callback)
      return () => listeners.delete(event)
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
      useWorkspaceLifecycle({
        notify: (message) => state.notices.push(message),
        activeJobs: () => state.jobs,
        async flush() {
          state.calls.push('flush')
          if (state.pending) await state.pending
        },
      })
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.lifecycleHarness
  })
  return { state, listeners, emit: (event) => listeners.get(event)?.(), unmount: () => app.unmount() }
}
test('关闭窗口保存后仅隐藏，有转写任务也不确认退出或停止进程', async (t) => {
  const { state, emit } = mount(t)
  await settle()
  state.jobs = true
  emit('desktop-hide-requested')
  await settle()
  assert.deepEqual(state.calls, [
    'frontend_ready',
    'flush',
    'notes_storage_flush',
    'data_storage_flush',
    'hide_main_window',
  ])
})
test('退出先显示窗口，有任务时可取消，确认后完成保存才真正退出', async (t) => {
  const { state, emit } = mount(t)
  await settle()
  state.jobs = true
  state.confirm = false
  emit('desktop-quit-requested')
  await settle()
  assert.deepEqual(state.calls, ['frontend_ready', 'show_main_window', 'confirm_asr_quit'])
  state.confirm = true
  emit('desktop-quit-requested')
  await settle()
  assert.deepEqual(state.calls.slice(3), [
    'show_main_window',
    'confirm_asr_quit',
    'flush',
    'notes_storage_flush',
    'data_storage_flush',
    'finish_close',
  ])
})
test('保存失败不隐藏或退出，重试可完成', async (t) => {
  const { state, emit } = mount(t)
  await settle()
  state.fail = 'notes_storage_flush'
  emit('desktop-hide-requested')
  await settle()
  assert.ok(!state.calls.includes('hide_main_window'))
  assert.match(state.notices[0], /保存失败/)
  state.fail = ''
  emit('desktop-hide-requested')
  await settle()
  assert.equal(state.calls.at(-1), 'hide_main_window')
})
test('隐藏期间请求退出不丢失，重复关闭只保存一次，卸载清理监听器', async (t) => {
  const { state, emit, listeners, unmount } = mount(t)
  await settle()
  let release
  state.pending = new Promise((resolve) => {
    release = resolve
  })
  emit('desktop-hide-requested')
  emit('desktop-hide-requested')
  emit('desktop-quit-requested')
  assert.equal(state.calls.filter((call) => call === 'flush').length, 1)
  release()
  await settle()
  assert.equal(state.calls.at(-1), 'finish_close')
  assert.ok(state.calls.indexOf('hide_main_window') < state.calls.indexOf('finish_close'))
  unmount()
  assert.equal(listeners.size, 0)
})

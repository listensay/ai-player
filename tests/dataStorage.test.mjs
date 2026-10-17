import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer } from 'vue'
import ts from 'typescript'
const { descriptor } = parse(readFileSync(new URL('../app/components/DataStoragePanel.vue', import.meta.url), 'utf8'))
const code = compileScript(descriptor, { id: 'storage-test' })
  .content.replace(
    /import \{ desktopInvoke \} from [^\n]+/,
    'const desktopInvoke = (...args) => globalThis.storageTestInvoke(...args)',
  )
  .replace(/import UiButton from [^\n]+/, 'const UiButton = {}')
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
function mount(t, invoke) {
  globalThis.storageTestInvoke = invoke
  let panel
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      panel = Component.setup({}, { expose() {} })
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.storageTestInvoke
  })
  return panel
}
test('选择位置后保留当前目录，显示下次启动使用的目录', async (t) => {
  const panel = mount(t, async (command) =>
    command === 'data_storage_info'
      ? { path: '/old', pendingPath: null }
      : { path: '/old', pendingPath: '/new/Study Helper Data' },
  )
  await panel.load()
  assert.equal(panel.location.value.path, '/old')
  await panel.choose()
  assert.equal(panel.location.value.path, '/old')
  assert.equal(panel.location.value.pendingPath, '/new/Study Helper Data')
  assert.equal(panel.busy.value, false)
})
test('选择失败或取消保留现有位置，失败后可以重新选择', async (t) => {
  const panel = mount(t, async () => ({ path: '/old', pendingPath: null }))
  await panel.load()
  globalThis.storageTestInvoke = async () => {
    throw '文件夹不可写'
  }
  await panel.choose()
  assert.equal(panel.error.value, '文件夹不可写')
  assert.equal(panel.location.value.path, '/old')
  assert.equal(panel.busy.value, false)
  globalThis.storageTestInvoke = async () => ({ path: '/old', pendingPath: null })
  await panel.choose()
  assert.equal(panel.error.value, '')
  assert.equal(panel.location.value.pendingPath, null)
})

test('打开已有数据使用接续模式，取消切换恢复当前数据目录', async (t) => {
  const calls = []
  const panel = mount(t, async (command, args) => {
    calls.push([command, args])
    return command === 'choose_data_directory'
      ? { path: '/local', pendingPath: '/disk/Study Helper Data', pendingAction: 'open' }
      : { path: '/local', pendingPath: null, pendingAction: null }
  })
  await panel.load()
  await panel.choose(true)
  assert.deepEqual(calls.at(-1), ['choose_data_directory', { existing: true }])
  assert.equal(panel.location.value.pendingAction, 'open')
  assert.equal(panel.location.value.path, '/local')
  await panel.cancel()
  assert.equal(calls.at(-1)[0], 'cancel_data_directory')
  assert.equal(panel.location.value.pendingPath, null)
})

test('迁移使用独立模式，取消失败不丢失待切换位置', async (t) => {
  const panel = mount(t, async () => ({ path: '/local', pendingPath: null }))
  await panel.load()
  globalThis.storageTestInvoke = async (command, args) => {
    assert.equal(command, 'choose_data_directory')
    assert.deepEqual(args, { existing: false })
    return { path: '/local', pendingPath: '/disk/Study Helper Data', pendingAction: 'move' }
  }
  await panel.choose()
  globalThis.storageTestInvoke = async () => {
    throw Error('unavailable')
  }
  await panel.cancel()
  assert.equal(panel.location.value.pendingAction, 'move')
  assert.equal(panel.busy.value, false)
  assert.match(panel.error.value, /取消切换失败/)
})

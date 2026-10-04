import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createRenderer, ref } from 'vue'

const source = readFileSync(new URL('../app/composables/useCompanionWindow.ts', import.meta.url), 'utf8')
  .replace(
    "import { desktopInvoke } from '~/utils/platform'",
    'const desktopInvoke = (...args) => globalThis.windowControl.invoke(...args)',
  )
  .replace("await import('@tauri-apps/api/window')", '({ getCurrentWindow: () => globalThis.windowControl })')
  .replaceAll("from 'vue'", 'from ' + JSON.stringify(import.meta.resolve('vue')))
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { useCompanionWindow } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const tick = () => new Promise((resolve) => setImmediate(resolve))
function mount(t, initial = false) {
  const control = {
    opened: initial,
    calls: [],
    fail: '',
    fullscreen: false,
    delay: null,
    handler: null,
    removed: false,
    async listen(name, handler) {
      assert.equal(name, 'companion-window-state')
      control.handler = handler
      return () => {
        control.removed = true
      }
    },
    async invoke(command) {
      control.calls.push(command)
      if (control.delay) await control.delay
      if (control.fail === command) throw Error('native error')
      if (command === 'companion_is_open') return control.opened
      if (command === 'open_companion' && !control.fullscreen) control.opened = true
      if (command === 'close_companion') control.opened = false
    },
  }
  globalThis.windowControl = control
  const error = ref('')
  let pet,
    published = 0
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      pet = useCompanionWindow(async () => {
        published++
      }, error)
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.windowControl
  })
  return { pet, control, error, app, published: () => published }
}

test('打开后激活，再次点击关闭，自身关闭同步状态，卸载取消监听', async (t) => {
  const { pet, control, app, published } = mount(t)
  await tick()
  assert.equal(pet.miniOpen.value, false)
  await pet.toggleMini()
  assert.equal(pet.miniOpen.value, true)
  assert.equal(published(), 1)
  await pet.toggleMini()
  assert.equal(pet.miniOpen.value, false)
  assert.ok(control.calls.includes('close_companion'))
  await pet.openMini()
  control.handler({ payload: false })
  assert.equal(pet.miniOpen.value, false)
  app.unmount()
  assert.equal(control.removed, true)
})

test('恢复已打开窗口，自动打开不反向关闭，全屏隐藏不会误判关闭', async (t) => {
  const { pet, control } = mount(t, true)
  await tick()
  assert.equal(pet.miniOpen.value, true)
  control.fullscreen = true
  await pet.openMini()
  assert.equal(pet.miniOpen.value, true)
  assert.ok(!control.calls.includes('close_companion'))
})

test('全屏阻止新建时不假装激活，打开或关闭失败保留状态并提示', async (t) => {
  const { pet, control, error } = mount(t)
  await tick()
  control.fullscreen = true
  await pet.openMini()
  assert.equal(pet.miniOpen.value, false)
  control.fullscreen = false
  control.fail = 'open_companion'
  await pet.toggleMini()
  assert.equal(pet.miniOpen.value, false)
  assert.match(error.value, /打开失败/)
  control.fail = ''
  await pet.toggleMini()
  control.fail = 'close_companion'
  await pet.toggleMini()
  assert.equal(pet.miniOpen.value, true)
  assert.match(error.value, /关闭失败/)
})

test('操作期间重复点击只发送一次请求', async (t) => {
  const { pet, control } = mount(t)
  await tick()
  let release
  control.delay = new Promise((resolve) => {
    release = resolve
  })
  const pending = pet.toggleMini()
  assert.equal(pet.opening.value, true)
  await pet.toggleMini()
  assert.equal(control.calls.filter((command) => command === 'open_companion').length, 1)
  release()
  await pending
  assert.equal(pet.opening.value, false)
  assert.equal(pet.miniOpen.value, true)
})

test('顶栏绑定真实状态、忙碌禁用和开关动作', () => {
  const read = (path) => readFileSync(new URL('../app/' + path, import.meta.url), 'utf8')
  const top = read('components/AppTopBar.vue')
  assert.match(top, /:aria-pressed="!!companionActive"/)
  assert.match(top, /:disabled="companionBusy"/)
  assert.match(top, /companionActive \? '关闭桌面挂件' : '打开桌面挂件'/)
  assert.match(top, /aria-pressed='true'/)
  const app = read('app.vue')
  assert.match(app, /:companion-active="companion.miniOpen.value"/)
  assert.match(app, /@companion="companion.toggleMini\(\)"/)
})

test('关闭事件优先于较早发出的窗口查询，不会被旧结果重新点亮', async (t) => {
  const { pet, control } = mount(t, true)
  await tick()
  let resolveQuery
  const invoke = control.invoke
  control.invoke = (command) =>
    command === 'companion_is_open'
      ? new Promise((resolve) => {
          resolveQuery = resolve
        })
      : invoke(command)
  const opening = pet.openMini()
  await tick()
  control.handler({ payload: false })
  resolveQuery(true)
  await opening
  assert.equal(pet.miniOpen.value, false)
})

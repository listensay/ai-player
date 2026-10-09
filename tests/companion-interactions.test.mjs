import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive, nextTick } from 'vue'
import { emptyCompanionSnapshot } from '../app/utils/companion.ts'

// Exercise the real component setup and timers without a native WebView.
const filename = new URL('../app/components/CompanionPet.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const compiled = compileScript(descriptor, { id: 'pet-interactions' })
  .content.replace(/import PlayboMascot from .*\n/, 'const PlayboMascot = {}\n')
  .replace(/import AppIcon from .*\n/, 'const AppIcon = {}\n')
  .replace("from '~/utils/checkIn'", `from '${new URL('../app/utils/checkIn.ts', import.meta.url).href}'`)
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(compiled, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
function mount(t) {
  const previous = globalThis.document
  const previousWindow = globalThis.window
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  const windowEvents = new Map()
  globalThis.window = {
    addEventListener: (name, listener) => windowEvents.set(name, listener),
    removeEventListener: (name) => windowEvents.delete(name),
  }
  const events = []
  const props = reactive({
    state: { ...emptyCompanionSnapshot(), ready: true },
    connected: true,
    desktop: true,
    busy: false,
    error: '',
  })
  let pet
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      pet = Component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    globalThis.document = previous
    globalThis.window = previousWindow
  })
  return { pet, props, events, app, windowEvents }
}
test('全屏安静陪读收起气泡，退出后恢复原有提示', (t) => {
  const { pet, props } = mount(t)
  assert.equal(pet.bubbleVisible.value, true)
  props.state.quietFocus = true
  assert.equal(pet.bubbleVisible.value, false)
  props.state.quietFocus = false
  assert.equal(pet.bubbleVisible.value, true)
})
test('单击回应四秒后恢复状态，双击只发送一次播放指令', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { pet, events } = mount(t)
  pet.activate({ detail: 1 })
  t.mock.timers.tick(260)
  assert.match(pet.message.value, /陪你/)
  t.mock.timers.tick(4000)
  assert.equal(pet.reaction.value, '')
  pet.activate({ detail: 1 })
  pet.activate({ detail: 2 })
  pet.doubleClick()
  t.mock.timers.tick(300)
  assert.equal(pet.reaction.value, '')
  assert.equal(events.filter(([event]) => event === 'toggle').length, 1)
})
test('拖动不触发摸摸；断线或操作受阻时不能控制播放或休息', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { pet, props, events } = mount(t)
  pet.pointerDown({ button: 0, pointerId: 1, clientX: 0, clientY: 0 })
  pet.pointerMove({ pointerId: 1, clientX: 20, clientY: 20 })
  pet.activate({ detail: 1 })
  t.mock.timers.tick(300)
  assert.equal(pet.reaction.value, '')
  assert.ok(events.some(([event]) => event === 'nativeDrag'))
  props.connected = false
  pet.action('toggle')
  pet.action('rest')
  props.connected = true
  props.state.blocked = true
  pet.action('toggle')
  pet.action('rest')
  pet.action('snooze')
  assert.equal(events.filter(([event]) => ['toggle', 'rest', 'snooze'].includes(event)).length, 0)
})
test('隐藏日常提示仍显示休息提醒和错误；菜单与气泡互斥', async (t) => {
  const { pet, props } = mount(t)
  pet.toggleQuiet()
  assert.equal(pet.bubbleVisible.value, false)
  props.state.careDue = true
  props.state.message = '休息一下。'
  await nextTick()
  assert.equal(pet.bubbleVisible.value, true)
  pet.react()
  assert.equal(pet.message.value, '休息一下。')
  await pet.openMenu()
  assert.equal(pet.menuOpen.value, true)
  assert.equal(pet.bubbleVisible.value, false)
  pet.escape({ key: 'Escape', stopPropagation() {} })
  props.error = '连接失败。'
  await nextTick()
  assert.equal(pet.bubbleVisible.value, true)
  assert.equal(pet.message.value, '连接失败。')
})
test('点击穿透后窗口失焦会收起菜单，卸载会移除监听', async (t) => {
  const { pet, app, windowEvents } = mount(t)
  await pet.openMenu()
  assert.equal(pet.menuOpen.value, true)
  windowEvents.get('blur')()
  assert.equal(pet.menuOpen.value, false)
  app.unmount()
  assert.equal(windowEvents.size, 0)
})

test('桌宠移除番茄钟控件后，无视频、隐藏日常提示或主窗口弹窗时仍显示阶段消息', async (t) => {
  const { pet, props } = mount(t)
  props.state.ready = false
  props.state.blocked = true
  props.state.pomodoro = {
    ready: true,
    enabled: true,
    visible: true,
    phase: 'short-break',
    status: 'running',
    remainingSeconds: 300,
    totalSeconds: 300,
    completedFocuses: 1,
    round: 1,
    longBreakEvery: 4,
    revision: 2,
    notice: '专注完成，已开始短休息 5 分钟。',
    error: '',
  }
  await nextTick()
  pet.toggleQuiet()
  props.state.pomodoro.revision++
  await nextTick()
  assert.equal(pet.bubbleVisible.value, true)
  assert.match(pet.message.value, /专注完成/)
  assert.equal(pet.pomodoro.value.remainingSeconds, 300)
  pet.collapse()
  assert.equal(pet.panelOpen.value, false)
  props.state.pomodoro.notice = '休息结束，播放视频或手动开始下一次专注。'
  props.state.pomodoro.revision++
  await nextTick()
  assert.equal(pet.panelOpen.value, true)
  assert.match(pet.message.value, /休息结束/)
  assert.doesNotMatch(descriptor.template.content, /PomodoroBadge|pomodoroStart|pomodoroPause|pomodoroReset/)
  props.state.pomodoro.visible = false
  await nextTick()
  assert.equal(pet.pomodoro.value, undefined)
})

test('问问 Karen 只发送问答事件，离线或遮罩期间不可用', (t) => {
  const { pet, props, events } = mount(t)
  pet.action('ask')
  assert.deepEqual(
    events.filter(([event]) => event === 'ask'),
    [['ask']],
  )
  props.connected = false
  pet.action('ask')
  props.connected = true
  props.state.blocked = true
  pet.action('ask')
  assert.equal(events.filter(([event]) => event === 'ask').length, 1)
})

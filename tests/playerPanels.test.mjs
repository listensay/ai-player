import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, nextTick, ref, shallowRef } from 'vue'
import { usePlayerPanels } from '../app/composables/usePlayerPanels.ts'

function mount(t, { stored = {}, delayed = false, blockedStorage = false } = {}) {
  const previous = Object.fromEntries(['window', 'localStorage', 'ResizeObserver'].map((key) => [key, globalThis[key]]))
  const listeners = new Map(),
    storage = new Map(Object.entries(stored))
  let observer,
    panels,
    size = 1440
  globalThis.window = {
    innerWidth: 1440,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
  }
  globalThis.localStorage = {
    getItem(key) {
      if (blockedStorage) throw Error('Storage unavailable')
      return storage.get(key)
    },
    setItem(key, value) {
      if (blockedStorage) throw Error('Storage unavailable')
      storage.set(key, value)
    },
  }
  globalThis.ResizeObserver = class {
    targets = new Set()
    constructor(callback) {
      this.callback = callback
      observer = this
    }
    observe(element) {
      this.targets.add(element)
    }
    disconnect() {
      this.targets.clear()
    }
  }
  const layoutElement = { getBoundingClientRect: () => ({ width: size }) }
  const layout = shallowRef(delayed ? null : layoutElement)
  const directory = shallowRef({ getBoundingClientRect: () => ({ width: panels.directory.width.value }) })
  const learning = shallowRef({ getBoundingClientRect: () => ({ width: panels.learning.width.value }) })
  const directoryOpen = ref(true),
    learningOpen = ref(true)
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      panels = usePlayerPanels(layout, directory, learning, directoryOpen, learningOpen)
      return () => null
    },
  })
  app.mount({})
  let mounted = true
  function unmount() {
    if (mounted) app.unmount()
    mounted = false
  }
  t.after(() => {
    unmount()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  })
  const handle = {
    pointerId: null,
    setPointerCapture(id) {
      this.pointerId = id
    },
    hasPointerCapture(id) {
      return this.pointerId === id
    },
    releasePointerCapture() {
      this.pointerId = null
    },
  }
  const emit = (type, event = {}) => listeners.get(type)?.forEach((listener) => listener({ pointerId: 1, ...event }))
  return {
    panels,
    directoryOpen,
    learningOpen,
    storage,
    listeners,
    observer,
    handle,
    emit,
    unmount,
    start(side = 'directory', button = 0) {
      panels[side].start({ button, pointerId: 1, clientX: 600, currentTarget: handle, preventDefault() {} })
    },
    async attach() {
      layout.value = layoutElement
      await nextTick()
    },
    resize(width) {
      size = width
      window.innerWidth = width
      observer.callback()
    },
  }
}

test('恢复两侧宽度兼容旧笔记设置，键盘调整与收起保留可展开的宽度', (t) => {
  const ui = mount(t, { stored: { 'player-directory-width:v1': '320', 'learning-panel-width:v1': '560' } })
  assert.equal(ui.panels.directory.width.value, 320)
  assert.equal(ui.panels.learning.width.value, 560)
  ui.panels.learning.keydown({ key: 'ArrowRight', preventDefault() {} })
  assert.equal(ui.panels.learning.width.value, 536)
  ui.panels.learning.keydown({ key: 'Home', preventDefault() {} })
  assert.equal(ui.learningOpen.value, false)
  assert.equal(ui.storage.get('learning-panel-width:v1'), '536')
  ui.learningOpen.value = true
  assert.equal(ui.panels.learning.width.value, 536)
})

test('拖拽逐像素变化，只有接近关闭端才收起，其他指针与非主按钮不触发', (t) => {
  const ui = mount(t)
  ui.start('directory', 2)
  assert.equal(ui.panels.dragging.value, null)
  ui.start()
  ui.emit('pointermove', { pointerId: 2, clientX: 0 })
  ui.emit('pointerup', { pointerId: 2 })
  assert.equal(ui.panels.directory.width.value, 300)
  assert.equal(ui.panels.dragging.value, 'left')
  ui.emit('pointermove', { clientX: 381 })
  assert.equal(ui.panels.directory.width.value, 81)
  assert.equal(ui.directoryOpen.value, true)
  assert.equal(ui.panels.learning.width.value, 440)
  ui.emit('pointermove', { clientX: 380 })
  assert.equal(ui.directoryOpen.value, false)
  assert.equal(ui.panels.dragging.value, null)
  assert.equal(ui.handle.pointerId, null)
  assert.equal(ui.storage.get('player-directory-width:v1'), '300')
  ui.directoryOpen.value = true
  assert.equal(ui.panels.directory.width.value, 300)
  ui.emit('pointermove', { clientX: 1000 })
  assert.equal(ui.panels.directory.width.value, 300)
})

test('布局稍后挂载仍能监听，窄窗口与宽度上限不挤没视频，卸载清理观察器', async (t) => {
  const ui = mount(t, {
    delayed: true,
    stored: { 'learning-panel-width:v1': 'NaN', 'player-directory-width:v1': '80' },
  })
  assert.equal(ui.observer.targets.size, 0)
  await ui.attach()
  assert.equal(ui.observer.targets.size, 1)
  ui.resize(1024)
  assert.equal(ui.panels.directory.width.value, 280)
  assert.equal(ui.panels.learning.width.value, 400)
  ui.start('learning')
  ui.emit('pointermove', { clientX: -1000 })
  assert.equal(ui.panels.learning.width.value, 440)
  assert.equal(ui.panels.directory.width.value, 280)
  ui.resize(1100)
  assert.ok(ui.panels.directory.width.value + ui.panels.learning.width.value <= 1100 - 64 - 240)
  ui.unmount()
  assert.equal(ui.observer.targets.size, 0)
  assert.equal(ui.handle.pointerId, null)
  assert.ok([...ui.listeners.values()].every((set) => set.size === 0))
})

test('存储不可用仍可拉伸，取消与失焦都停止拖拽并释放指针', (t) => {
  const ui = mount(t, { blockedStorage: true })
  ui.start('learning')
  ui.emit('pointermove', { clientX: 700 })
  assert.equal(ui.panels.learning.width.value, 340)
  ui.emit('pointercancel')
  assert.equal(ui.panels.dragging.value, null)
  assert.equal(ui.handle.pointerId, null)
  ui.start()
  ui.emit('blur')
  assert.equal(ui.panels.dragging.value, null)
  assert.equal(ui.handle.pointerId, null)
})

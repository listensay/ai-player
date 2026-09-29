import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer } from 'vue'
import { usePlayerDirectory } from '../app/composables/usePlayerDirectory.ts'

function mount(t, wide) {
  const previousWindow = globalThis.window
  const listeners = new Set()
  const media = { matches: wide,
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener),
  }
  globalThis.window = { matchMedia: query => {
    assert.equal(query, '(min-width: 1024px)')
    return media
  } }
  let directory
  let mounted = true
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() { directory = usePlayerDirectory(); return () => null } })
  app.mount({})
  function unmount() { if (mounted) { app.unmount(); mounted = false } }
  t.after(() => { unmount(); globalThis.window = previousWindow })
  return { directory, listeners, unmount, resize(wide) { media.matches = wide; listeners.forEach(listener => listener()) } }
}

test('大窗口目录默认展开，顶部开关可以反复收起和展开，切课关闭抽屉不影响侧栏', t => {
  const { directory } = mount(t, true)
  assert.equal(directory.treeVisible.value, true)
  directory.toggleTree()
  assert.equal(directory.treeVisible.value, false)
  assert.equal(directory.desktopTreeOpen.value, false)
  directory.toggleTree()
  directory.treeOpen.value = false
  assert.equal(directory.treeVisible.value, true)
  assert.equal(directory.desktopTreeOpen.value, true)
})

test('窄窗口目录默认收起，开关和遮罩关闭只影响抽屉', t => {
  const { directory } = mount(t, false)
  assert.equal(directory.treeVisible.value, false)
  directory.toggleTree()
  assert.equal(directory.treeVisible.value, true)
  assert.equal(directory.treeOpen.value, true)
  directory.treeOpen.value = false
  assert.equal(directory.treeVisible.value, false)
  directory.toggleTree(); directory.toggleTree()
  assert.equal(directory.treeVisible.value, false)
  assert.equal(directory.desktopTreeOpen.value, true)
})

test('跨窗口宽度保留桌面收起选择，离开窄窗口关闭抽屉，卸载清理监听', t => {
  const { directory, resize, unmount, listeners } = mount(t, true)
  directory.toggleTree()
  resize(false)
  directory.toggleTree()
  assert.equal(directory.treeVisible.value, true)
  resize(true)
  assert.equal(directory.treeVisible.value, false)
  assert.equal(directory.treeOpen.value, false)
  resize(false)
  assert.equal(directory.treeVisible.value, false)
  assert.equal(listeners.size, 1)
  unmount()
  assert.equal(listeners.size, 0)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive } from 'vue'
const { descriptor } = parse(readFileSync(new URL('../app/components/VirtualList.vue', import.meta.url), 'utf8'))
const code = compileScript(descriptor, { id: 'virtual-list-test' })
  .content.replace(/import \{ VVirtualScroll \} from [^\n]+/, 'const VVirtualScroll = {}')
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const tick = () => new Promise((resolve) => setImmediate(resolve))
function mount(t) {
  let frameId = 0
  const pending = new Map(),
    before = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame]
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++frameId
    pending.set(id, callback)
    setImmediate(() => {
      pending.get(id)?.()
      pending.delete(id)
    })
    return id
  }
  globalThis.cancelAnimationFrame = (id) => pending.delete(id)
  const props = reactive({
    items: Array.from({ length: 10000 }, (_, i) => ({ id: i })),
    itemKey: (item) => item.id,
    active: true,
    itemHeight: 60,
  })
  const calls = [],
    events = []
  let rendered = false,
    target = 0,
    state
  const list = {
    clientHeight: 400,
    clientTop: 0,
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelector: () =>
      rendered ? { getBoundingClientRect: () => ({ top: 100 + target * 60 - list.scrollTop, height: 60 }) } : null,
    scrollTo: ({ top }) => {
      calls.push(top)
      list.scrollTop = Math.max(0, top)
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
      state = Component.setup(props, { expose() {}, emit: (event) => events.push(event) })
      return () => null
    },
  })
  app.mount({})
  state.virtual.value = {
    $el: list,
    scrollToIndex: (index) => {
      rendered = true
      target = index
      list.scrollTop = index * 60
    },
    calculateVisibleItems() {},
  }
  t.after(() => {
    app.unmount()
    ;[globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = before
  })
  return { state, props, list, calls, events, app }
}
test('远端行先进入可视区再居中，滚动仅作用于列表本身', async (t) => {
  const h = mount(t)
  await h.state.scrollToIndex(9999, 'center')
  assert.equal(h.list.scrollTop, 9999 * 60 - 170)
  assert.equal(h.calls.length, 1)
  h.props.active = false
  await h.state.scrollToIndex(0)
  assert.equal(h.calls.length, 1)
})
test('手动滚动或卸载会终止未完成的定位，隐藏区域不会被滚动', async (t) => {
  const h = mount(t)
  const work = h.state.scrollToIndex(5000, 'center')
  h.state.interrupt()
  await work
  assert.equal(h.calls.length, 0)
  assert.equal(h.list.scrollTop, 0)
  assert.deepEqual(h.events, ['interact'])
  h.list.clientHeight = 0
  await h.state.scrollToIndex(5)
  assert.equal(h.calls.length, 0)
  await tick()
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive, ref } from 'vue'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useNoteWorkspace } = await import('../app/composables/useNoteWorkspace.ts')
const { descriptor } = parse(readFileSync(new URL('../app/components/LazyNoteEditor.vue', import.meta.url), 'utf8'))
const source = compileScript(descriptor, { id: 'lazy-note-test' })
  .content.replace("import UiButton from './UiButton.vue'", 'const UiButton = {}')
  .replace("import('./NoteEditor.vue')", 'globalThis.loadNoteEditor()')
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const tick = () => new Promise((r) => setImmediate(r))
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { resolve, promise }
}
function mount(t, load) {
  globalThis.loadNoteEditor = load
  const props = reactive({ video: { path: 'a.mp4' }, courseId: 'one', active: false })
  let state, exposed
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      state = Component.setup(props, {
        expose(value) {
          exposed = value
        },
      })
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return { props, state, exposed, app }
}
test('只看知识点不加载编辑器；首次引用等待模块与编辑器就绪，只插入一次', async (t) => {
  const module = deferred(),
    editorReady = deferred(),
    calls = []
  let loads = 0
  const h = mount(t, () => {
    loads++
    return module.promise
  })
  await tick()
  assert.equal(loads, 0)
  const workspace = useNoteWorkspace(
    ref('one:a'),
    ref('knowledge'),
    { state: { ready: true, currentTime: 12 } },
    (message) => calls.push(message),
  )
  workspace.noteEditor.value = h.exposed
  const operation = workspace.quoteToNote('字幕引用')
  await tick()
  assert.equal(loads, 1)
  assert.deepEqual(calls, [])
  h.state.editor.value = { whenReady: () => editorReady.promise, insertInline: (text) => calls.push(text) }
  module.resolve({ default: {} })
  await tick()
  assert.deepEqual(calls, [])
  editorReady.resolve()
  await operation
  assert.deepEqual(calls, ['字幕引用', '已插入笔记'])
  await h.exposed.whenReady()
  assert.equal(loads, 1)
})
test('加载期间切课不会把时间戳插入新课节', async () => {
  const ready = deferred(),
    key = ref('one:a'),
    messages = [],
    inserted = []
  const workspace = useNoteWorkspace(key, ref('knowledge'), { state: { ready: true, currentTime: 12 } }, (text) =>
    messages.push(text),
  )
  workspace.noteEditor.value = { whenReady: () => ready.promise, insertTimestamp: (s) => inserted.push(s), focus() {} }
  const operation = workspace.noteAt(12)
  await tick()
  key.value = 'one:b'
  ready.resolve()
  await operation
  assert.deepEqual(inserted, [])
  assert.match(messages[0], /课节已切换/)
})
test('动态加载失败显示错误，重试可加载成功；截图保留发起时的播放位置', async (t) => {
  let loads = 0
  const h = mount(t, async () => {
    if (++loads === 1) throw Error('加载失败')
    return { default: {} }
  })
  await assert.rejects(h.exposed.whenReady(), /加载失败/)
  assert.match(h.state.error.value, /加载失败/)
  h.state.editor.value = { whenReady: async () => {} }
  await h.exposed.whenReady()
  assert.equal(loads, 2)
  const frame = deferred(),
    inserted = []
  const player = { state: { ready: true, currentTime: 12 }, captureFrame: () => frame.promise }
  const workspace = useNoteWorkspace(ref('one:a'), ref('knowledge'), player, () => {})
  workspace.noteEditor.value = {
    whenReady: async () => {},
    insertScreenshot: async (_blob, seconds) => inserted.push(seconds),
  }
  const operation = workspace.screenshot()
  player.state.currentTime = 18
  frame.resolve({ blob: new Blob(), ratio: 16 / 9 })
  await operation
  assert.deepEqual(inserted, [12])
})
test('保存按钮收到失败时不显示成功提示', async () => {
  const notices = [],
    workspace = useNoteWorkspace(ref('one:a'), ref('notes'), {}, (text) => notices.push(text))
  workspace.noteEditor.value = {
    whenReady: async () => {},
    save: async () => {
      throw Error('磁盘已满')
    },
    hasUnsavedChanges: () => true,
  }
  await workspace.saveNote()
  assert.deepEqual(notices, ['磁盘已满'])
})

test('保存快捷键等待编辑器就绪，读取失败不会显示保存成功', async () => {
  const ready = deferred(),
    calls = [],
    tab = ref('knowledge')
  const workspace = useNoteWorkspace(ref('one:a'), tab, {}, (text) => calls.push(text))
  workspace.noteEditor.value = {
    whenReady: () => ready.promise,
    save: async () => calls.push('save'),
    hasUnsavedChanges: () => false,
  }
  const saving = workspace.saveNote()
  await tick()
  assert.equal(tab.value, 'notes')
  assert.deepEqual(calls, [])
  ready.resolve()
  await saving
  assert.deepEqual(calls, ['save', '笔记已保存'])
  calls.length = 0
  workspace.noteEditor.value.whenReady = async () => {
    throw Error('笔记读取失败')
  }
  await workspace.saveNote()
  assert.deepEqual(calls, ['笔记读取失败'])
})

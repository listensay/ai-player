import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, reactive } from 'vue'

// Compile the real component; only replace Monaco's browser/worker boundary.
const filename = new URL('../app/components/ProgrammingEditor.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'programming-editor-test', inlineTemplate: true })
  .content.replace(/import UiButton from '[^']+'/u, 'const UiButton = { render: () => null }')
  .replace("import('~/utils/codeEditor')", 'globalThis.programmingEditorIO.load()')
const source = ts
  .transpileModule(script, { compilerOptions: { target: 99, module: 99 } })
  .outputText.replaceAll('from "vue"', `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replaceAll("from 'vue'", `from ${JSON.stringify(import.meta.resolve('vue'))}`)
const { default: Editor } = await import(`data:text/javascript,${encodeURIComponent(source)}`)
const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  await nextTick()
}
function mount(t, limit = 32000) {
  let content = '',
    changed,
    command
  const calls = []
  const instance = {
    getValue: () => content,
    setValue(value) {
      content = value
      changed?.()
    },
    onDidChangeModelContent(callback) {
      changed = callback
      return { dispose: () => calls.push('subscription disposed') }
    },
    addCommand(_key, callback) {
      command = callback
    },
    updateOptions: (value) => calls.push(value),
    revealLineInCenter: (line) => calls.push(['line', line]),
    setPosition: (position) => calls.push(position),
    focus: () => calls.push('focus'),
    dispose: () => calls.push('editor disposed'),
  }
  const monaco = {
    editor: {
      createModel(value) {
        content = value
        return { updateOptions() {}, dispose: () => calls.push('model disposed') }
      },
      create: () => instance,
    },
    Uri: { parse: (value) => value },
    KeyMod: { CtrlCmd: 1 },
    KeyCode: { KeyS: 2 },
  }
  globalThis.programmingEditorIO = { load: async () => ({ monaco }) }
  const state = reactive({ code: 'initial', readonly: false, location: undefined, rejected: false, saves: 0 })
  const renderer = createRenderer({
    createElement: () => ({}),
    createComment: () => ({}),
    createText: () => ({}),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    patchProp() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    render: () =>
      h(Editor, {
        modelValue: state.code,
        readonly: state.readonly,
        location: state.location,
        'onUpdate:modelValue': (value) => {
          if (value.length > limit) {
            state.rejected = true
            return
          }
          state.rejected = false
          state.code = value
        },
        onSave: () => state.saves++,
      }),
  })
  app.mount({})
  t.after(() => app.unmount())
  return { state, calls, edit: (value) => instance.setValue(value), value: () => content, save: () => command() }
}

test('编辑器被拒绝的超长输入回到实际草稿，后续编辑仍可保存', async (t) => {
  const editor = mount(t)
  await settle()
  editor.edit('x'.repeat(32001))
  await settle()
  assert.equal(editor.state.rejected, true)
  assert.equal(editor.value(), 'initial')
  assert.equal(editor.value(), editor.state.code)
  editor.edit('function solve() { return 1; }')
  await settle()
  assert.equal(editor.value(), editor.state.code)
  assert.match(editor.state.code, /return 1/)
})

test('连续输入、外部重置、只读、保存和错误定位同步到编辑器', async (t) => {
  const editor = mount(t)
  await settle()
  editor.edit('first')
  editor.edit('second')
  await settle()
  assert.equal(editor.value(), 'second')
  assert.equal(editor.state.code, 'second')
  editor.state.code = 'reset'
  editor.state.readonly = true
  editor.state.location = { line: 2, column: 3, nonce: 1 }
  await settle()
  assert.equal(editor.value(), 'reset')
  assert.ok(editor.calls.some((call) => call?.readOnly === true))
  assert.ok(editor.calls.some((call) => call?.lineNumber === 2 && call.column === 3))
  assert.ok(editor.calls.includes('focus'))
  editor.save()
  assert.equal(editor.state.saves, 1)
})

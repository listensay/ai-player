import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick } from 'vue'
import { programmingExercise as exercise, programmingQuestion as question } from './fixtures/programming.mjs'

// 编译真实工作台模板；编辑器与结果面板等子组件仅替换渲染外壳。
const { descriptor } = parse(
  readFileSync(new URL('../app/components/ProgrammingWorkspace.vue', import.meta.url), 'utf8'),
)
const code = compileScript(descriptor, { id: 'programming-workspace-test', inlineTemplate: true })
  .content.replace(
    /import \{ PROGRAMMING_MODES \} from [^\n]+/,
    "const PROGRAMMING_MODES = { completion: '代码补全', implementation: '功能实现' }",
  )
  .replace(
    /from '~\/utils\/programmingLanguages'/g,
    `from '${new URL('../app/utils/programmingLanguages.ts', import.meta.url).href}'`,
  )
  .replace(/import (\w+) from '~\/components\/[^\n]+/g, 'const $1 = globalThis.programmingWorkspaceStubs.$1')
  .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
const stub = (name) => ({
  props: ['text', 'modelValue'],
  setup(props, { slots, attrs }) {
    return () =>
      name === 'VDialog' && !props.modelValue
        ? null
        : h(name === 'UiButton' ? 'button' : name, attrs, props.text ?? [slots.default?.()])
  },
})
globalThis.programmingWorkspaceStubs = Object.fromEntries(
  ['ProgrammingEditor', 'ProgrammingResults', 'PracticeText', 'UiButton', 'AppIcon'].map((name) => [name, stub(name)]),
)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Workspace } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

async function mount(t, language = exercise.language) {
  const element = (type) => ({
    type,
    props: {},
    style: {},
    children: [],
    parent: null,
    getBoundingClientRect: () => ({ left: 0, width: 1000 }),
  })
  const renderer = createRenderer({
    createElement: element,
    createText: (text) => ({ ...element('#text'), text }),
    createComment: () => element('#comment'),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
      node.children = []
    },
    patchProp: (node, key, _old, value) => {
      node.props[key] = value
    },
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
    },
    remove(node) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = null
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  })
  const events = []
  const root = element('root')
  const app = renderer.createApp(Workspace, {
    question,
    exercise: { ...exercise, language },
    draft: exercise.starterCode,
    busy: false,
    onExecute: (...args) => events.push(args),
  })
  for (const name of new Set(descriptor.template.content.match(/\bV[A-Z]\w+/g))) app.component(name, stub(name))
  app.mount(root)
  t.after(() => app.unmount())
  await nextTick()
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  const text = (node) => `${node.text ?? ''}${node.children.map(text).join('')}`.trim()
  return {
    events,
    root,
    text: () => text(root),
    find: (type) => walk(root).find((node) => node.type === type),
    findBy: (predicate) => walk(root).find(predicate),
    button: (label) => walk(root).find((node) => node.type === 'button' && text(node) === label),
  }
}

test('工作台不提供自选输入与用例预览，测试输入只在结果中展示', async (t) => {
  const ui = await mount(t)
  assert.equal(ui.find('select'), undefined)
  for (const hidden of ['运行示例', '全部测试用例', '正负数混合', '全部为负数', '示例'])
    assert.ok(!ui.text().includes(hidden), `界面不出现：${hidden}`)
  for (const shown of ['接口约定', '实现要求', '测试']) assert.ok(ui.text().includes(shown), `界面显示：${shown}`)
  assert.ok(!ui.text().includes(exercise.referenceCode), '工作台不再绕过分层提示直接暴露答案')
  for (const hint of exercise.hints) assert.ok(!ui.text().includes(hint), '旧提示由分层助手接管')
})

test('“测试”按钮一次发出无参数执行事件，由上层自动执行全部用例', async (t) => {
  const ui = await mount(t)
  const button = ui.button('测试')
  assert.ok(button)
  assert.ok(!button.props.disabled)
  button.props.onClick()
  await nextTick()
  assert.equal(ui.events.length, 1)
  assert.deepEqual(ui.events[0], [])
})

test('题目区可由分隔线拖动或键盘调整宽度', async (t) => {
  const ui = await mount(t)
  const workspace = ui.findBy((node) => node.props.class === 'programming-workspace')
  const handle = ui.findBy((node) => node.props.role === 'separator')
  assert.ok(handle, '存在分隔线')
  assert.equal(handle.props['aria-orientation'], 'vertical')
  assert.equal(handle.props['aria-valuemin'], 20)
  assert.equal(handle.props['aria-valuemax'], 70)
  assert.equal(handle.props['aria-valuenow'], 40)
  assert.equal(String(handle.props.tabindex), '0')
  const capture = {
    captured: false,
    setPointerCapture() {
      this.captured = true
    },
    hasPointerCapture() {
      return this.captured
    },
    releasePointerCapture() {
      this.captured = false
    },
  }
  handle.props.onPointerdown({ currentTarget: capture, pointerId: 7 })
  assert.equal(capture.captured, true)
  handle.props.onPointermove({ currentTarget: capture, pointerId: 7, clientX: 300 })
  await nextTick()
  assert.equal(workspace.props.style['--requirements-width'], '30%')
  assert.equal(handle.props['aria-valuenow'], 30)
  handle.props.onPointerup({ currentTarget: capture, pointerId: 7 })
  assert.equal(capture.captured, false)
  handle.props.onKeydown({ key: 'End', preventDefault() {} })
  await nextTick()
  assert.equal(handle.props['aria-valuenow'], 70)
  assert.equal(workspace.props.style['--requirements-width'], '70%')
  handle.props.onKeydown({ key: 'ArrowLeft', preventDefault() {} })
  await nextTick()
  assert.equal(handle.props['aria-valuenow'], 68)
})

test('工作台按题目显示语言并传递给编辑器', async (t) => {
  const ui = await mount(t, 'python')
  assert.ok(ui.text().includes('Python'))
  assert.ok(ui.text().includes('solution.py'))
  assert.ok(!ui.text().includes('solution.js'))
  assert.ok(!ui.text().includes('JavaScript'))
  assert.equal(ui.find('ProgrammingEditor').props.language, 'python')
})

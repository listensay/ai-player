import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parseAiInteractionForm } from '../app/utils/aiInteraction.ts'

globalThis.interactionStubs = {
  UiButton: {
    setup:
      (_props, { attrs, slots }) =>
      () =>
        h('button', attrs, slots.default?.()),
  },
  PracticeText: { props: ['text'], setup: (props) => () => h('p', props.text) },
  UiDatePicker: {
    setup:
      (_props, { attrs }) =>
      () =>
        h('div', attrs),
  },
}
const { descriptor } = parse(readFileSync(new URL('../app/components/AiInteractionForm.vue', import.meta.url), 'utf8'))
const source = compileScript(descriptor, { id: 'interaction-form-test', inlineTemplate: true })
  .content.replace(
    /import (UiButton|PracticeText|UiDatePicker) from [^\n]+/g,
    'const $1 = globalThis.interactionStubs.$1',
  )
  .replace(
    /from ['"]~\/utils\/aiInteraction['"]/g,
    `from '${new URL('../app/utils/aiInteraction.ts', import.meta.url)}'`,
  )
  .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const Form = (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).default
delete globalThis.interactionStubs

function mount(t) {
  const form = parseAiInteractionForm({
    id: 'math',
    title: '确认你的数学基础',
    submitLabel: '制定我的基础版计划',
    fields: [
      {
        id: 'basics',
        type: 'single-choice',
        label: '下面哪些你已经掌握？',
        options: [
          { id: 'some', label: '四则运算基本没问题', description: '分数、小数容易出错' },
          { id: 'all', label: '分数、小数、百分比基本会算' },
        ],
      },
      {
        id: 'equations',
        type: 'single-choice',
        label: '你知道什么是方程吗？',
        options: [
          { id: 'yes', label: '知道，能算出来' },
          { id: 'no', label: '完全不懂' },
        ],
      },
      {
        id: 'topics',
        type: 'multiple-choice',
        label: '关注哪些内容？',
        options: [
          { id: 'math', label: '数学' },
          { id: 'ai', label: 'AI' },
        ],
      },
      { id: 'minutes', type: 'number', label: '学习用时', min: 5, max: 60 },
      { id: 'goal', type: 'textarea', label: '你的目标' },
      { id: 'date', type: 'date', label: '日期', required: false },
      { id: 'note', type: 'text', label: '补充', required: false },
    ],
  })
  const props = reactive({ form, disabled: false, answers: undefined })
  const submitted = []
  const element = (type) => ({ type, props: {}, children: [], parent: null, text: '' })
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
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
    },
    remove(node) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1)
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  })
  const app = renderer.createApp({
    setup: () => () => h(Form, { ...props, onSubmit: (answers) => submitted.push(answers) }),
  })
  for (const name of ['VRadioGroup', 'VRadio', 'VCheckbox', 'VTextField', 'VTextarea'])
    app.component(name, {
      setup:
        (_props, { attrs, slots }) =>
        () =>
          h('div', { ...attrs, 'data-control': name }, [slots.default?.(), slots.label?.()]),
    })
  const root = element('root')
  app.mount(root)
  t.after(() => app.unmount())
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  return {
    props,
    submitted,
    nodes: () => walk(root),
    submit: () =>
      walk(root)
        .find((node) => node.type === 'form')
        .props.onSubmit({ preventDefault() {} }),
    input(label, value) {
      walk(root)
        .find((node) => node.props.label === label)
        .props['onUpdate:modelValue'](value)
    },
  }
}
test('AI 动态内容使用通用组件呈现，没有预选；必填校验后才提交全部答案', async (t) => {
  const ui = mount(t)
  assert.equal(ui.nodes().find((node) => node.props.label === '你知道什么是方程吗？').props['model-value'], null)
  assert.ok(ui.nodes().some((node) => node.text === '分数、小数容易出错'))
  ui.submit()
  await nextTick()
  assert.equal(ui.submitted.length, 0)
  assert.ok(ui.nodes().some((node) => node.props.role === 'alert'))
  ui.input('下面哪些你已经掌握？', 'some')
  ui.input('你知道什么是方程吗？', 'no')
  const checkbox = ui.nodes().find((node) => node.props['data-control'] === 'VCheckbox')
  checkbox.props['onUpdate:modelValue'](true)
  ui.input('学习用时', '30')
  ui.input('你的目标', '学数学和 AI')
  ui.submit()
  assert.deepEqual(ui.submitted[0], {
    basics: 'some',
    equations: 'no',
    topics: ['math'],
    minutes: 30,
    goal: '学数学和 AI',
    date: null,
    note: null,
  })
})
test('已提交答案保持显示且不可重复提交；禁用期间不发送答案', async (t) => {
  const ui = mount(t)
  ui.props.answers = {
    basics: 'all',
    equations: 'yes',
    topics: ['ai'],
    minutes: 45,
    goal: '应用数学',
    date: null,
    note: null,
  }
  await nextTick()
  assert.equal(ui.nodes().find((node) => node.props.label === '学习用时').props['model-value'], 45)
  assert.ok(!ui.nodes().some((node) => node.type === 'button'))
  ui.submit()
  assert.equal(ui.submitted.length, 0)
  ui.props.answers = undefined
  ui.props.disabled = true
  await nextTick()
  assert.equal(ui.nodes().find((node) => node.type === 'button').props.disabled, true)
  ui.submit()
  assert.equal(ui.submitted.length, 0)
})

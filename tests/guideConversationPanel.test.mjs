import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, createRenderer, h, nextTick, reactive, ref } from 'vue'

globalThis.guidePanelStubs = {
  AppIcon: { props: ['name'], setup: (props) => () => h('span', { 'data-icon': props.name }) },
  UiButton: {
    setup:
      (_props, { attrs, slots }) =>
      () =>
        h('button', attrs, slots.default?.()),
  },
  PracticeText: { props: ['text'], setup: (props) => () => h('p', props.text) },
  AiProfileSelector: {
    setup:
      (_props, { attrs, slots }) =>
      () =>
        h('div', { ...attrs, 'data-profile-selector': '' }, ['测试模型', slots.actions?.()]),
  },
  AiInteractionForm: {
    props: ['form'],
    setup: (props) => () => h('form', { 'aria-label': props.form.title }, props.form.submitLabel),
  },
}
const { descriptor } = parse(
  readFileSync(new URL('../app/components/GuideConversationPanel.vue', import.meta.url), 'utf8'),
)
const source = compileScript(descriptor, { id: 'guide-panel-test', inlineTemplate: true })
  .content.replace(/import \{ useGuide \} from [^\n]+/, 'const useGuide = () => globalThis.guidePanelHarness.guide')
  .replace(/import (\w+) from ['"]\.\/[^\n]+/g, 'const $1 = globalThis.guidePanelStubs.$1')
  .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const Panel = (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).default
delete globalThis.guidePanelStubs

function mount(t) {
  const chatState = reactive({
    ready: true,
    loading: false,
    busy: false,
    error: '',
    storageError: '',
    data: { turns: [] },
  })
  const calls = []
  const chat = {
    state: chatState,
    question: ref(''),
    initialized: computed(() => chatState.data.turns[0]?.status === 'done'),
    canPlan: ref(false),
    arrangement: ref([]),
    initialize() {
      calls.push('initialize')
      chatState.busy = true
      chatState.data.turns.push({
        id: 'first',
        kind: 'initialization',
        question: 'AI 定制初始化',
        reply: null,
        status: 'pending',
        error: '',
      })
    },
    cancel() {
      calls.push('cancel')
      chatState.busy = false
      chatState.data.turns[0].status = 'stopped'
    },
    ask: () => calls.push('ask'),
  }
  globalThis.guidePanelHarness = {
    guide: {
      state: reactive({ busy: '', plan: null }),
      guideReady: ref(true),
      configured: ref(true),
      courseName: ref('清楚显示的课程名称'),
      conversation: chat,
    },
  }
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
  const root = element('root')
  const app = renderer.createApp(Panel)
  app.component('VDialog', {
    props: ['modelValue'],
    setup:
      (props, { slots }) =>
      () =>
        props.modelValue ? slots.default?.() : null,
  })
  app.component('VTextarea', {
    setup:
      (_props, { attrs }) =>
      () =>
        h('textarea', attrs),
  })
  app.mount(root)
  t.after(() => {
    app.unmount()
    delete globalThis.guidePanelHarness
  })
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  return {
    chatState,
    chat,
    calls,
    nodes: () => walk(root),
    profile: () => walk(root).find((node) => 'data-profile-selector' in node.props),
    click(title) {
      const button = walk(root).find(
        (node) =>
          node.type === 'button' &&
          walk(node)
            .map((child) => child.text)
            .join('')
            .trim() === title,
      )
      assert.ok(button, title)
      button.props.onClick()
    },
  }
}
test('初始化前后保留同一配置选择器，生成问卷状态清晰且不回显初始化指令', async (t) => {
  const ui = mount(t)
  const profile = ui.profile()
  assert.ok(profile)
  assert.ok('compact' in profile.props)
  assert.ok(!ui.nodes().some((node) => node.props['aria-current'] === 'step'))
  ui.click('AI 定制初始化')
  await nextTick()
  assert.equal(ui.profile(), profile)
  assert.equal(ui.profile().props.disabled, true)
  assert.ok(ui.nodes().some((node) => node.text === '正在生成定制问卷'))
  assert.ok(ui.nodes().some((node) => node.text === '清楚显示的课程名称'))
  assert.ok(!ui.nodes().some((node) => node.props.class === 'guide-user-message'))
  assert.ok(
    ui.nodes().some((node) => node.props.class === 'guide-thinking-track' && node.props['aria-hidden'] === 'true'),
  )
  ui.click('停止')
  await nextTick()
  assert.equal(ui.profile(), profile)
  assert.equal(ui.profile().props.disabled, false)
  assert.ok(ui.nodes().some((node) => node.text === '已停止'))
})

test('重新定制挂在配置控件的操作行，保持禁用状态与确认弹窗', async (t) => {
  const ui = mount(t)
  ui.chatState.data.turns.push({ id: 'one', kind: 'initialization', status: 'done', error: '', reply: null })
  await nextTick()
  const action = ui
    .nodes()
    .find((node) => node.type === 'button' && node.children.some((child) => child.text === '重新定制'))
  assert.ok(action)
  assert.equal(action.parent, ui.profile())
  ui.chatState.busy = true
  await nextTick()
  assert.equal(action.props.disabled, true)
  ui.chatState.busy = false
  await nextTick()
  ui.click('重新定制')
  await nextTick()
  assert.ok(ui.nodes().some((node) => node.props.role === 'dialog' && node.props['aria-label'] === '重新定制'))
})
test('问卷与方案直接呈现内容，不展示流程步骤', async (t) => {
  const ui = mount(t)
  ui.chatState.data.turns.push({
    id: 'one',
    kind: 'initialization',
    question: 'AI 定制初始化',
    status: 'done',
    error: '',
    reply: { message: '请回答下面的问题', form: { title: '定制问卷', submitLabel: '提交回答' } },
  })
  await nextTick()
  assert.ok(ui.nodes().some((node) => node.type === 'form' && node.props['aria-label'] === '定制问卷'))
  assert.ok(!ui.nodes().some((node) => node.props['aria-current'] === 'step'))
  ui.chatState.data.turns.push({ id: 'two', question: '已有基础', status: 'pending', error: '', reply: null })
  ui.chatState.busy = true
  await nextTick()
  assert.ok(!ui.nodes().some((node) => node.props['aria-current'] === 'step'))
  assert.ok(!ui.nodes().some((node) => ['了解课程', '回答问卷', '定制方案'].includes(node.text)))
  assert.ok(ui.nodes().some((node) => node.props.class === 'guide-user-message' && node.text === '已有基础'))
  assert.ok(ui.nodes().some((node) => node.text === '正在整理学习方案'))
})

test('明确学习安排由真实选择呈现，不冒充 AI 回复或追加选择表单', async (t) => {
  const ui = mount(t)
  ui.chatState.data.turns.push({
    id: 'selection',
    question: '按原顺序学习4到6',
    replySource: 'selection',
    status: 'done',
    error: '',
    reply: { message: '按你的选择继续安排学习。', form: null },
  })
  ui.chat.canPlan.value = true
  ui.chat.arrangement.value = [
    { label: '学习范围', value: '4 数学 → 5 算法 → 6 项目' },
    { label: '接着学习', value: '6-方向导数' },
  ]
  await nextTick()
  assert.ok(ui.nodes().some((node) => node.props['aria-label'] === '已确认的学习安排'))
  assert.ok(ui.nodes().some((node) => node.text === '6-方向导数'))
  assert.ok(ui.nodes().some((node) => node.props.class === 'guide-speaker' && node.text === '学习安排'))
  assert.ok(!ui.nodes().some((node) => node.type === 'form' && node.props['aria-label']))
})

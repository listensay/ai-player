import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, ref } from 'vue'

test('学习管理只显示日历和提醒，退役分区链接回到日历且可切换提醒', async (t) => {
  globalThis.managementPanelHome = { courses: ref([]), error: ref('') }
  globalThis.managementPanelTools = { state: { ready: false, error: '' }, mac: { error: '' } }
  const stub = (name) => ({
    props: ['open'],
    setup(props, { attrs, slots }) {
      return () =>
        name === 'StudyFormDialog' && !props.open
          ? null
          : h('section', { ...attrs, 'data-panel': name }, slots.default?.())
    },
  })
  globalThis.managementPanelStubs = Object.fromEntries(
    ['PageSectionNav', 'ReminderTimePicker', 'UiButton', 'AppIcon', 'StudyFormDialog', 'LearningConnectionsPanel'].map(
      (name) => [name, stub(name)],
    ),
  )
  t.after(() => {
    delete globalThis.managementPanelHome
    delete globalThis.managementPanelTools
    delete globalThis.managementPanelStubs
  })
  const { descriptor } = parse(
    readFileSync(new URL('../app/components/StudyManagementPanel.vue', import.meta.url), 'utf8'),
  )
  const code = compileScript(descriptor, { id: 'management-panel-test', inlineTemplate: true })
    .content.replace(
      /import \{ useStudyTools \} from [^\n]+/,
      'const useStudyTools = () => globalThis.managementPanelTools',
    )
    .replace(/import \{ useLearningHome \} from [^\n]+/, 'const useLearningHome = () => globalThis.managementPanelHome')
    .replace(/import \{ updateReminder \} from [^\n]+/, 'const updateReminder = () => {}')
    .replace(/import (\w+) from '~\/components\/[^\n]+/g, 'const $1 = globalThis.managementPanelStubs.$1')
    .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  const Panel = (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).default
  const element = (type) => ({ type, props: {}, style: {}, children: [], parent: null })
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
  const root = element('root'),
    initialSection = ref('review')
  const app = renderer.createApp({ setup: () => () => h(Panel, { initialSection: initialSection.value }) })
  for (const name of new Set(descriptor.template.content.match(/\bV[A-Z]\w+/g))) app.component(name, stub(name))
  app.mount(root)
  t.after(() => app.unmount())
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  const nav = () => walk(root).find((node) => node.props['data-panel'] === 'PageSectionNav')
  assert.deepEqual(
    nav().props.items.map(({ id, title }) => ({ id, title })),
    [
      { id: 'connections', title: '学习日历' },
      { id: 'reminders', title: '学习提醒' },
    ],
  )
  assert.equal(nav().props.modelValue, 'connections')
  assert.ok(walk(root).some((node) => node.props['data-panel'] === 'LearningConnectionsPanel'))
  nav().props['onUpdate:modelValue']('reminders')
  await nextTick()
  assert.equal(nav().props.modelValue, 'reminders')
  assert.notEqual(walk(root).find((node) => node.props.id === 'study-reminders').style.display, 'none')
  initialSection.value = 'insights'
  await nextTick()
  assert.equal(nav().props.modelValue, 'connections')
})

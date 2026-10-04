import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, ref, nextTick } from 'vue'

const read = (path) => readFileSync(new URL('../app/' + path, import.meta.url), 'utf8')
const { descriptor } = parse(read('components/PageSectionNav.vue'))
const code = compileScript(descriptor, { id: 'section-nav-test', inlineTemplate: true })
  .content.replace(/import AppIcon[^\n]+/, 'const AppIcon = { render: () => null }')
  .replace(/from ['"]vue['"]/g, 'from ' + JSON.stringify(import.meta.resolve('vue')))
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Nav } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const node = (type) => ({ type, props: {}, children: [], parent: null })
const renderer = createRenderer({
  createElement: node,
  createText: (text) => ({ ...node('text'), text }),
  createComment: () => node('comment'),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
  },
  patchProp: (node, key, old, value) => {
    node.props[key] = value
  },
  insert: (node, parent, anchor) => {
    node.parent = parent
    const index = parent.children.indexOf(anchor)
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  },
  remove: (node) => {
    node.parent.children.splice(node.parent.children.indexOf(node), 1)
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
})
const walk = (node) => [node, ...node.children.flatMap(walk)]

test('共用菜单点击更新选中项、关联内容区和无障碍状态', async (t) => {
  const selected = ref('insights')
  const app = renderer.createApp({
    setup: () => () =>
      h(Nav, {
        modelValue: selected.value,
        'onUpdate:modelValue': (value) => {
          selected.value = value
        },
        label: '学习管理导航',
        prefix: 'study',
        items: [
          { id: 'insights', title: '成长与复盘', icon: 'dashboard' },
          { id: 'reminders', title: '学习提醒', icon: 'bell' },
        ],
      }),
  })
  const root = node('root')
  app.mount(root)
  t.after(() => app.unmount())
  const nav = walk(root).find((node) => node.type === 'nav')
  assert.equal(nav.props['aria-label'], '学习管理导航')
  assert.match(nav.props.class, /order-first/)
  assert.match(nav.props.class, /sm:order-last/)
  const buttons = walk(root).filter((node) => node.type === 'button')
  assert.deepEqual(
    buttons.map((button) => button.props['aria-controls']),
    ['study-insights', 'study-reminders'],
  )
  assert.equal(buttons[0].props['aria-current'], 'page')
  buttons[1].props.onClick()
  await nextTick()
  assert.equal(selected.value, 'reminders')
  assert.equal(buttons[0].props['aria-current'], undefined)
  assert.equal(buttons[1].props['aria-current'], 'page')
  assert.match(buttons[1].props.class, /bg-pure-white text-deep-indigo/)
  buttons[0].props.onClick()
  await nextTick()
  assert.equal(selected.value, 'insights')
})

test('学习管理与设置共用菜单和布局，报告保留状态、提醒弹窗不受切换影响', () => {
  const study = read('components/StudyManagementPanel.vue')
  const settings = read('components/SettingsPanel.vue')
  for (const source of [study, settings]) {
    assert.match(source, /<PageSectionNav[\s\S]*?v-model="activeSection"/)
    assert.match(source, /mx-auto max-w-5xl px-5 py-8/)
    assert.match(source, /sm:grid-cols-\[minmax\(0,1fr\)_168px\]/)
  }
  assert.match(study, /v-show="activeSection === 'insights'"\s+id="study-insights"/)
  assert.match(study, /v-show="activeSection === 'reminders'"\s+id="study-reminders"/)
  assert.match(study, /@reminder=/)
  assert.equal((study.match(/<StudyFormDialog/g) ?? []).length, 3)
  assert.match(settings, /props.initialSection/)
})

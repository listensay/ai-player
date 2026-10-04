import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, ref, nextTick, onBeforeUnmount } from 'vue'
import { createAppDialogs, provideAppDialogs } from '../app/composables/useAppDialogs.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('同一弹窗不重复叠加，指定设置分区可更新，返回保留原来的学习管理条目', () => {
  const dialogs = createAppDialogs()
  dialogs.open('study', 'insights')
  const study = dialogs.current.value
  dialogs.open('milestones')
  dialogs.back()
  assert.equal(dialogs.current.value, study)
  assert.equal(dialogs.isOpen.value, true)
  dialogs.open('settings', 'ai')
  dialogs.open('settings', 'pomodoro')
  assert.equal(dialogs.stack.value.length, 2)
  assert.equal(dialogs.current.value.section, 'pomodoro')
  dialogs.open('study')
  assert.equal(dialogs.stack.value.length, 1)
  assert.equal(dialogs.current.value, study)
})

test('关闭动画结束后清理内容，快速重开不会被旧动画回调清空', () => {
  const dialogs = createAppDialogs()
  dialogs.open('study')
  dialogs.open('milestones')
  dialogs.close()
  assert.equal(dialogs.isOpen.value, false)
  assert.equal(dialogs.stack.value.length, 2)
  dialogs.open('settings', 'ai')
  dialogs.afterLeave()
  assert.equal(dialogs.current.value.kind, 'settings')
  assert.equal(dialogs.stack.value.length, 1)
  dialogs.back()
  dialogs.afterLeave()
  assert.equal(dialogs.current.value, undefined)
})

const { descriptor } = parse(readFileSync(new URL('../app/components/AppUtilityDialog.vue', import.meta.url), 'utf8'))
const code = compileScript(descriptor, { id: 'utility-dialog-test', inlineTemplate: true })
  .content.replace(
    "from '~/composables/useAppDialogs'",
    `from '${new URL('../app/composables/useAppDialogs.ts', import.meta.url).href}'`,
  )
  .replace(/import (AppIcon|UiButton) from [^\n]+/g, 'const $1 = globalThis.utilityStubs.$1')
  .replace(
    /import\('\.\/(SettingsPanel|StudyManagementPanel|MilestonesPanel)\.vue'\)/g,
    'Promise.resolve(globalThis.utilityStubs.$1)',
  )
  .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})

function node(type) {
  return { type, props: {}, style: {}, children: [], parent: null, focus() {} }
}
const renderer = createRenderer({
  createElement: node,
  createText: (text) => ({ ...node('text'), text }),
  createComment: () => node('comment'),
  setText: (n, text) => {
    n.text = text
  },
  setElementText: (n, text) => {
    n.text = text
  },
  patchProp: (n, key, old, value) => {
    n.props[key] = value
  },
  insert(n, parent, anchor) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = parent
    const index = parent.children.indexOf(anchor)
    parent.children.splice(index < 0 ? parent.children.length : index, 0, n)
  },
  remove(n) {
    n.parent?.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = null
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
})
const walk = (n) => [n, ...n.children.flatMap(walk)]

test('实际全屏容器切换勋章后保留报告输入和实例，关闭按钮与 Escape 关闭事件清理内容', async (t) => {
  const mounts = {},
    unmounts = {}
  const previousDocument = globalThis.document
  let returnedFocus = 0
  globalThis.document = {
    activeElement: {
      isConnected: true,
      closest: () => null,
      focus: () => {
        returnedFocus++
      },
    },
  }
  t.after(() => {
    globalThis.document = previousDocument
  })
  const panel = (name) => ({
    props: ['initialSection'],
    setup(props) {
      mounts[name] = (mounts[name] ?? 0) + 1
      onBeforeUnmount(() => {
        unmounts[name] = (unmounts[name] ?? 0) + 1
      })
      const draft = ref('')
      return () =>
        h('input', {
          'data-panel': name,
          section: props.initialSection,
          value: draft.value,
          onInput: (e) => {
            draft.value = e.target.value
          },
        })
    },
  })
  globalThis.utilityStubs = {
    AppIcon: { render: () => null },
    UiButton: {
      setup:
        (_, { slots }) =>
        () =>
          h('button', {}, slots.default?.()),
    },
    SettingsPanel: panel('settings'),
    StudyManagementPanel: panel('study'),
    MilestonesPanel: panel('milestones'),
  }
  const { default: UtilityDialog } = await import(
    'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
  )
  let dialogs
  const app = renderer.createApp({
    setup() {
      dialogs = provideAppDialogs()
      return () => h(UtilityDialog)
    },
  })
  app.component('VDialog', {
    props: { modelValue: Boolean, fullscreen: Boolean },
    setup:
      (props, { slots, attrs }) =>
      () =>
        h(
          'dialog',
          { ...attrs, open: props.modelValue, fullscreen: props.fullscreen },
          props.modelValue ? slots.default?.() : [],
        ),
  })
  const root = node('root')
  app.mount(root)
  t.after(() => {
    app.unmount()
    delete globalThis.utilityStubs
  })
  const find = (name) => walk(root).find((n) => n.props['data-panel'] === name)
  dialogs.open('study')
  await tick()
  const original = find('study')
  original.props.onInput({ target: { value: '保留复盘报告' } })
  dialogs.open('milestones')
  await tick()
  assert.equal(find('study'), original)
  assert.equal(original.parent.style.display, 'none')
  assert.equal(original.parent.props.inert, true)
  assert.equal(mounts.study, 1)
  walk(root)
    .find((n) => n.props.title === '返回学习管理')
    .props.onClick()
  await nextTick()
  assert.equal(find('study').props.value, '保留复盘报告')
  assert.equal(original.parent.style.display, undefined)
  assert.equal(unmounts.study, undefined)
  walk(root)
    .find((n) => n.props.title === '关闭学习管理')
    .props.onClick()
  await nextTick()
  assert.equal(dialogs.isOpen.value, false)
  assert.equal(unmounts.study, 1)
  dialogs.afterLeave()
  dialogs.open('settings', 'pomodoro')
  await tick()
  assert.equal(find('settings').props.section, 'pomodoro')
  const shell = walk(root).find((n) => n.type === 'dialog')
  assert.equal(shell.props.fullscreen, true)
  shell.props['onUpdate:modelValue'](false)
  await nextTick()
  await shell.props.onAfterLeave()
  assert.equal(dialogs.stack.value.length, 0)
  assert.equal(unmounts.settings, 1)
  assert.equal(returnedFocus, 1)
})

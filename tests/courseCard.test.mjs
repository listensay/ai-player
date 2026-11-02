import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { performanceContext } from './fixtures/performance.mjs'

globalThis.courseCardStubs = {
  AppIcon: { setup: () => () => null },
  UiButton: {
    setup:
      (_props, { attrs, slots }) =>
      () =>
        h('button', attrs, slots.default?.()),
  },
}

const { descriptor } = parse(readFileSync(new URL('../app/components/CourseCard.vue', import.meta.url), 'utf8'))
const source = compileScript(descriptor, { id: 'course-card-test', inlineTemplate: true })
  .content.replace(/import (AppIcon|UiButton) from [^\n]+/g, 'const $1 = globalThis.courseCardStubs.$1')
  .replace(
    /from ['"]~\/utils\/([^'"]+)['"]/g,
    (_, name) => `from '${new URL('../app/utils/' + name + '.ts', import.meta.url)}'`,
  )
  .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Card } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
delete globalThis.courseCardStubs

function mount(t, options = {}) {
  const context = performanceContext(4)
  context.progress = { 'lesson-0.mp4': { time: 120, duration: 120, ratio: 1, done: true, updatedAt: 1 } }
  const entry = reactive({
    course: { id: 'one', name: '课程名称', videoCount: 4, status: 'active', pinned: false },
    context,
    days: {},
    snapshots: {},
    error: '',
  })
  const props = reactive({ entry, date: '2026-11-02', changing: '', index: 2, headingTag: 'h3', ...options })
  const events = []
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
    setup: () => () =>
      h(Card, {
        ...props,
        onOpen: (...args) => events.push(['open', ...args]),
        onUpdate: (...args) => events.push(['update', ...args]),
        onRename: (...args) => events.push(['rename', ...args]),
        onDelete: (...args) => events.push(['delete', ...args]),
      }),
  })
  app.component('VMenu', {
    setup:
      (_props, { slots }) =>
      () =>
        h('div', [slots.activator?.({ props: {} }), slots.default?.()]),
  })
  app.component('VList', {
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  app.component('VListItem', {
    setup:
      (_props, { attrs }) =>
      () =>
        h('button', attrs, attrs.title),
  })
  const root = element('root')
  app.mount(root)
  t.after(() => app.unmount())
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  return {
    props,
    entry,
    events,
    nodes: () => walk(root),
    click(title) {
      const button = walk(root).find(
        (node) =>
          node.type === 'button' &&
          (node.props.title === title ||
            walk(node)
              .map((child) => child.text)
              .join('')
              .trim() === title),
      )
      assert.ok(button, title)
      button.props.onClick()
    },
  }
}

test('课程卡片统一呈现颜色、剩余时长、进度和课节数，支持首页标题层级', async (t) => {
  const card = mount(t)
  assert.ok(card.nodes().some((node) => node.props.class?.includes('course-card--yellow')))
  assert.ok(card.nodes().some((node) => node.type === 'h3'))
  const progress = card.nodes().find((node) => node.props.role === 'progressbar')
  assert.equal(progress.props['aria-valuenow'], 25)
  assert.ok(card.nodes().some((node) => node.text.includes('视频剩余')))
  assert.ok(card.nodes().some((node) => node.text.includes('已完成 1 / 4 节')))
  card.click('继续学习')
  assert.deepEqual(card.events.at(-1), ['open', card.entry.course, 'player'])
  card.click('课程名称')
  assert.deepEqual(card.events.at(-1), ['open', card.entry.course])
  card.props.headingTag = 'h2'
  await nextTick()
  assert.ok(card.nodes().some((node) => node.type === 'h2'))
})
test('菜单保留重命名、置顶、暂停、归档与删除，忙碌时禁用操作入口', async (t) => {
  const card = mount(t)
  card.click('置顶课程')
  assert.deepEqual(card.events.at(-1), ['update', card.entry.course, { pinned: true }])
  for (const [title, event] of [
    ['重命名', 'rename'],
    ['删除课程', 'delete'],
  ]) {
    card.click(title)
    assert.equal(card.events.at(-1)[0], event)
  }
  card.click('暂停课程')
  assert.deepEqual(card.events.at(-1), ['update', card.entry.course, { status: 'paused' }])
  card.click('归档课程')
  assert.deepEqual(card.events.at(-1), ['update', card.entry.course, { status: 'archived' }])
  card.props.changing = 'one'
  await nextTick()
  assert.equal(card.nodes().find((node) => node.props.title === '课程名称的课程操作').props.disabled, true)
})
test('暂停课程显示查看入口，损坏数据不呈现虚假进度', async (t) => {
  const card = mount(t)
  card.entry.course.status = 'paused'
  await nextTick()
  card.click('查看课程')
  card.entry.error = '读取失败'
  card.entry.context = null
  await nextTick()
  assert.ok(!card.nodes().some((node) => node.props.role === 'progressbar'))
  assert.ok(card.nodes().some((node) => node.props.role === 'alert' && node.text === '读取失败'))
})

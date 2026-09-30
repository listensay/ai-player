import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, computed, reactive, ref, nextTick } from 'vue'
import { dependencyRisks } from '../app/utils/guide.ts'
import { dependencyOverview } from '../app/utils/dependencyOverview.ts'

const lesson = (path, status, prerequisites = [], moduleId = 'm') => ({
  path,
  status,
  prerequisites,
  moduleId,
  concepts: [],
  reason: '',
})
test('直接依赖与间接影响分开，保留缺失的中间课且不混入无关分支', () => {
  const lessons = [
    lesson('a', 'skipped'),
    lesson('b', 'skipped', ['a']),
    lesson('c', 'required', ['b']),
    lesson('d', 'required', ['c', 'b']),
    lesson('unused', 'skipped', ['a']),
  ]
  const before = structuredClone(lessons),
    risks = dependencyRisks(lessons, false)
  const rows = dependencyOverview(lessons, [{ id: 'm' }], risks)
  assert.deepEqual(
    rows.map((row) => [row.prerequisite, row.direct, row.indirect]),
    [
      ['a', ['b'], ['c', 'd']],
      ['b', ['c', 'd'], []],
    ],
  )
  assert.equal(rows.length, risks.length)
  assert.ok(rows.every((row) => row.affectedCount === 2))
  assert.deepEqual(lessons, before)
  assert.equal(dependencyOverview(lessons, [], dependencyRisks(lessons, false, new Set(['b']))).length, 0)
})

test('多条路径和重复引用只计一次，展示遵循板块与课节顺序', () => {
  const lessons = [
    lesson('a', 'skipped', [], 'first'),
    lesson('b', 'skipped', [], 'second'),
    lesson('c', 'required', ['a', 'a', 'b']),
  ]
  const rows = dependencyOverview(
    lessons,
    [{ id: 'second' }, { id: 'first' }],
    [
      { prerequisite: 'a', dependents: ['c', 'c'] },
      { prerequisite: 'b', dependents: ['c'] },
    ],
  )
  assert.deepEqual(
    rows.map((row) => row.prerequisite),
    ['b', 'a'],
  )
  assert.deepEqual(rows[1].direct, ['c'])
  assert.equal(rows[1].affectedCount, 1)
})

async function component(name) {
  const { descriptor } = parse(readFileSync(new URL(`../app/components/${name}.vue`, import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: name })
    .content.replace(/import \{ useGuide \} from [^\n]+/, 'const useGuide = () => globalThis.dependencyGuide')
    .replace(/import (AppIcon|UiButton|DependencyCourseList) from [^\n]+/g, 'const $1 = {}')
    .replace(/from '~\/(.*?)'/g, (_, path) => `from '${new URL(`../app/${path}.ts`, import.meta.url).href}'`)
    .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).default
}
const Panel = await component('PrerequisitePanel'),
  List = await component('DependencyCourseList')
function mount(t, Component, props = reactive({})) {
  const modules = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, title: `板块 ${i + 1}` }))
  const lessons = Array.from({ length: 240 }, (_, i) =>
    lesson(
      `v${i}.mp4`,
      i < 96 ? 'skipped' : 'required',
      i ? [`v${i - 1}.mp4`] : [],
      `m${Math.min(5, Math.floor(i / 16))}`,
    ),
  )
  const state = reactive({ plan: { createdAt: 1, lessons, modules }, busy: '' })
  let repairs = 0,
    view
  const guide = {
    state,
    risks: computed(() => dependencyRisks(state.plan.lessons, false)),
    moduleMap: computed(() => new Map(state.plan.modules.map((m) => [m.id, m]))),
    lessonMap: computed(() => new Map(state.plan.lessons.map((l) => [l.path, l]))),
    videoMap: ref(new Map(lessons.map((l, i) => [l.path, { title: `${i < 96 ? '前置课' : '后续课'} ${i + 1}` }]))),
    routePaths: computed(() => state.plan.lessons.filter((l) => l.status === 'required').map((l) => l.path)),
    repairDependencies: () => {
      repairs++
    },
  }
  globalThis.dependencyGuide = guide
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      view = Component.setup(props, { expose() {}, emit() {} })
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.dependencyGuide
  })
  return { view, guide, repairs: () => repairs, props }
}

test('96 节缺失前置课按页呈现，搜索和板块筛选可到达末项，浏览不会补齐课程', async (t) => {
  const { view, guide, repairs } = mount(t, Panel)
  const before = JSON.parse(JSON.stringify(guide.state.plan))
  assert.equal(view.rows.value.length, 96)
  assert.equal(view.groups.value.length, 6)
  assert.equal(view.visible.value.length, 6)
  assert.equal(view.open.value, false)
  view.page.value = view.pages.value
  assert.equal(view.visible.value.at(-1).prerequisite, 'v95.mp4')
  view.query.value = '前置课 96'
  await nextTick()
  assert.deepEqual(
    view.visible.value.map((row) => row.prerequisite),
    ['v95.mp4'],
  )
  view.query.value = ''
  view.moduleId.value = 'm2'
  await nextTick()
  assert.equal(view.filtered.value.length, 16)
  assert.ok(view.visible.value.every((row) => row.moduleId === 'm2'))
  view.toggle(view.visible.value[0].prerequisite)
  view.showIndirect.value = true
  view.page.value = 2
  await nextTick()
  assert.equal(view.expanded.value, '')
  assert.equal(view.showIndirect.value, false)
  assert.equal(repairs(), 0)
  assert.deepEqual(JSON.parse(JSON.stringify(guide.state.plan)), before)
})

test('关联列表也有分页与搜索，长依赖链不会一次铺开全部名称', async (t) => {
  const props = reactive({ paths: Array.from({ length: 240 }, (_, i) => `v${i}.mp4`), label: '间接影响的路线课节' })
  const { view } = mount(t, List, props)
  assert.equal(view.visible.value.length, 5)
  assert.equal(view.pages.value, 48)
  view.page.value = 48
  assert.equal(view.visible.value.at(-1), 'v239.mp4')
  view.query.value = '后续课 240'
  await nextTick()
  assert.deepEqual(view.visible.value, ['v239.mp4'])
  view.query.value = ''
  props.paths = ['v0.mp4', 'v0.mp4']
  await nextTick()
  assert.equal(view.currentPage.value, 1)
  assert.deepEqual(view.visible.value, ['v0.mp4'])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive, ref, computed, nextTick } from 'vue'

const { descriptor } = parse(readFileSync(new URL('../app/components/CourseTree.vue', import.meta.url), 'utf8'))
const code = compileScript(descriptor, { id: 'course-tree-test' }).content
  .replace(/import \{ useCourseStore \} from [^\n]+/, 'const useCourseStore = () => globalThis.treeIO.store')
  .replace(/import \{ useGuide \} from [^\n]+/, 'const useGuide = () => globalThis.treeIO.guide')
  .replace(/import \{ useProgress \} from [^\n]+/, 'const useProgress = () => globalThis.treeIO.progress')
  .replace(/import (AppIcon|CourseTreeNode) from [^\n]+/g, 'const $1 = {}')
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

function mount(t) {
  const videos = ['b', 'a', 'c'].map(path => ({ kind: 'video', path: `${path}.mp4`, title: path.toUpperCase() }))
  const item = (id, path, kind, done, start = 0) => ({ id, path: `${path}.mp4`, kind, done, start, end: start + 30, seconds: 30, estimated: false })
  const props = reactive({ course: { id: 'one', root: { kind: 'folder', path: '', children: videos, videoCount: 3 } }, currentPath: null })
  const guideState = reactive({ view: 'route', storageError: '', plan: { modules: [{ id: 'm', title: '基础' }] },
    today: { date: '2026-09-28', items: [item('a-done', 'a', 'lesson', true), item('a-review', 'a', 'review', false, 40),
      item('b', 'b', 'lesson', false, 10), item('legacy', 'c', 'question', false)] } })
  const guide = { state: guideState, routeView: computed(() => guideState.view === 'route'),
    routeVideos: ref(videos), todayDate: ref('2026-09-28'), guideReady: ref(true), recordsReady: ref(true),
    firstLesson: ref({ path: 'c.mp4' }), schedule: ref({ completed: 1 }), activeModule: ref({ id: 'm' }),
    lessonMap: ref(new Map(videos.map(v => [v.path, { moduleId: 'm' }]))),
  }
  const store = { state: reactive({ query: '', filter: 'all' }) }
  const progress = { state: reactive({ map: { 'a.mp4': { done: true } } }), get: (_id, path) => progress.state.map[path] }
  globalThis.treeIO = { guide, store, progress }
  let tree
  const events = []
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() {
    tree = Component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.mount({})
  t.after(() => { app.unmount(); delete globalThis.treeIO })
  return { tree, guide, store, props, events, videos }
}

test('路线默认只显示当天视频，保留路线顺序、已完成课节并去重，排除旧疑问', t => {
  const { tree } = mount(t)
  assert.equal(tree.showAllRoute.value, false)
  assert.deepEqual(tree.visibleRoute.value.map(v => v.path), ['b.mp4', 'a.mp4'])
})

test('显示全部可恢复整条路线，搜索和完成筛选仍作用于当前范围', t => {
  const { tree, store } = mount(t)
  tree.showAllRoute.value = true
  assert.deepEqual(tree.visibleRoute.value.map(v => v.path), ['b.mp4', 'a.mp4', 'c.mp4'])
  store.state.query = 'C'
  assert.deepEqual(tree.visibleRoute.value.map(v => v.path), ['c.mp4'])
  tree.showAllRoute.value = false
  assert.equal(tree.visibleRoute.value.length, 0)
  store.state.query = ''; store.state.filter = 'done'
  assert.deepEqual(tree.visibleRoute.value.map(v => v.path), ['a.mp4'])
})

test('今天为空、日期过期或尚未加载时不回退到全部，也不开始明天的视频', t => {
  const { tree, guide, events } = mount(t)
  for (const change of [() => { guide.guideReady.value = false },
    () => { guide.guideReady.value = true; guide.state.today.date = '2026-09-27' },
    () => { guide.state.today.date = guide.todayDate.value; guide.state.today.items = [] }]) {
    change()
    assert.equal(tree.visibleRoute.value.length, 0)
    assert.equal(tree.canStart.value, false)
    tree.startRoute()
  }
  assert.equal(events.length, 0)
  tree.showAllRoute.value = true
  assert.equal(tree.visibleRoute.value.length, 3)
})

test('开始学习选择当天未完成片段，点视频保留补学起点；显示全部沿用完整路线播放', t => {
  const { tree, guide, events, videos } = mount(t)
  tree.startRoute()
  assert.equal(events[0][0], 'startToday')
  assert.equal(events[0][1].id, 'b')
  tree.selectRouteVideo(videos[1])
  assert.equal(events[1][1].id, 'a-review')
  assert.equal(events[1][1].start, 40)
  guide.state.today.items.forEach(item => { item.done = true })
  assert.equal(tree.canStart.value, false)
  assert.equal(tree.visibleRoute.value.length, 2)
  tree.showAllRoute.value = true
  tree.startRoute(); tree.selectRouteVideo(videos[2])
  assert.deepEqual(events.slice(-2), [['start', 'c.mp4'], ['select', videos[2]]])
})

test('切换课程或跨天恢复只看今天，旧日期的视频不会混入', async t => {
  const { tree, props, guide } = mount(t)
  tree.showAllRoute.value = true
  props.course.id = 'two'
  await nextTick()
  assert.equal(tree.showAllRoute.value, false)
  tree.showAllRoute.value = true
  guide.todayDate.value = '2026-09-29'
  await nextTick()
  assert.equal(tree.showAllRoute.value, false)
  assert.equal(tree.visibleRoute.value.length, 0)
})

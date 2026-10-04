import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, computed, reactive, ref, nextTick } from 'vue'

const { descriptor } = parse(readFileSync(new URL('../app/components/CourseDashboard.vue', import.meta.url), 'utf8'))
const code = compileScript(descriptor, { id: 'dashboard-progress-test' })
  .content.replace(/import \{ useGuide \} from [^\n]+/, 'const useGuide = () => globalThis.dashboardIO.guide')
  .replace(/import \{ useProgress \} from [^\n]+/, 'const useProgress = () => globalThis.dashboardIO.progress')
  .replace(/import \{ useCheckIn \} from [^\n]+/, 'const useCheckIn = () => null')
  .replace(/import (\w+) from ['"]~\/components\/[^\n]+/g, 'const $1 = {}')
  .replace(
    /from ['"]~\/utils\/([^'"]+)['"]/g,
    (_, file) => `from '${new URL('../app/utils/' + file + '.ts', import.meta.url).href}'`,
  )
  .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Dashboard } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const tick = () => new Promise((resolve) => setImmediate(resolve))

function mount(t, { completed = 37, ready = true, route = true } = {}) {
  const videos = Array.from({ length: 64 }, (_, index) => ({ path: `${index}.mp4`, title: `课程 ${index + 1}`, index }))
  const progress = {
    state: reactive({
      ready,
      map: Object.fromEntries(videos.slice(0, completed).map((v) => [v.path, { done: true, ratio: 1 }])),
    }),
    courseProgress: () => progress.state.map,
  }
  const state = reactive({
    plan: {
      modules: [
        { id: 'a', title: '基础' },
        { id: 'b', title: '实战' },
      ],
    },
    includeOptional: false,
    view: route ? 'route' : 'all',
  })
  const lessons = videos.map((video, index) => ({ path: video.path, moduleId: index < 12 || index >= 48 ? 'a' : 'b' }))
  const guide = {
    state,
    guideReady: ref(ready),
    activeModule: ref({ id: 'a' }),
    routeView: computed(() => state.view === 'route'),
    routeVideos: ref(videos),
    firstLesson: computed(() => lessons.find((lesson) => !progress.state.map[lesson.path]?.done) ?? lessons[0]),
    lessonMap: ref(new Map(lessons.map((lesson) => [lesson.path, lesson]))),
    videoMap: ref(new Map(videos.map((video) => [video.path, video]))),
    routePositions: ref(new Map(videos.map((video, index) => [video.path, index + 1]))),
  }
  const props = reactive({
    course: { id: 'one', name: '课程', videos },
    currentVideo: videos[completed] ?? videos.at(-1),
    stats: { total: videos.length, done: completed, started: 0 },
  })
  globalThis.dashboardIO = { guide, progress }
  let view
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      view = Dashboard.setup(props, { expose() {}, emit() {} })
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.dashboardIO
  })
  return { view, guide, progress, props, app }
}

test('首页进入详情后按实际进度展开当前阶段并定位到第三页，支持重复出现的接续阶段', async (t) => {
  const { view, progress } = mount(t)
  await nextTick()
  assert.equal(view.progressTarget.value.path, '37.mp4')
  assert.equal(view.isOpen('b:12.mp4'), true)
  assert.equal(view.isOpen('a:0.mp4'), false)
  assert.equal(view.groups.value.find((group) => group.key === 'b:12.mp4').page, 3)
  assert.ok(
    view.groups.value.find((group) => group.key === 'b:12.mp4').visible.some((video) => video.path === '37.mp4'),
  )
  for (let i = 37; i < 61; i++) progress.state.map[`${i}.mp4`] = { done: true, ratio: 1 }
  await nextTick()
  assert.equal(view.progressTarget.value.groupKey, 'a:48.mp4')
  assert.equal(view.isOpen('a:48.mp4'), true)
  assert.equal(view.groupPages['a:48.mp4'], 2)
})

test('等待路线和观看进度读取完成，不会把异步加载前的第一页当成最终位置', async (t) => {
  const { view, guide, progress } = mount(t, { ready: false })
  assert.equal(view.openGroups.size, 0)
  guide.guideReady.value = true
  await nextTick()
  assert.equal(view.openGroups.size, 0)
  progress.state.ready = true
  await nextTick()
  assert.equal(view.groupPages['b:12.mp4'], 3)
  assert.equal(view.isOpen('b:12.mp4'), true)
})

test('用户手动翻页或收起后，普通进度刷新不抢位置；切换目录视图重新定位', async (t) => {
  const { view, progress, guide } = mount(t)
  await nextTick()
  view.groupPages['b:12.mp4'] = 1
  view.setGroupOpen('b:12.mp4', undefined)
  progress.state.map['37.mp4'] = { done: false, ratio: 0.3 }
  await nextTick()
  assert.equal(view.groupPages['b:12.mp4'], 1)
  assert.equal(view.isOpen('b:12.mp4'), false)
  guide.state.view = 'all'
  await nextTick()
  assert.equal(view.currentCatalogPage.value, 4)
  guide.state.view = 'route'
  await nextTick()
  assert.equal(view.isOpen('b:12.mp4'), true)
  assert.equal(view.groupPages['b:12.mp4'], 3)
})

test('搜索和完成筛选不会被自动定位干扰，清除后返回当前课节所在页', async (t) => {
  const { view } = mount(t)
  await nextTick()
  view.searchQuery.value = '课程 1'
  await nextTick()
  assert.equal(view.progressTarget.value, null)
  assert.ok(view.groups.value.every((group) => group.page === 1))
  view.searchQuery.value = ''
  view.filter.value = 'done'
  await nextTick()
  assert.equal(view.progressTarget.value, null)
  view.filter.value = 'all'
  await nextTick()
  assert.equal(view.groupPages['b:12.mp4'], 3)
})

test('全部学完后定位到最后观看课节，而非回到第一节', async (t) => {
  const { view, guide } = mount(t, { completed: 64 })
  await nextTick()
  assert.equal(view.progressVideo.value.path, '63.mp4')
  assert.equal(view.groupPages['a:48.mp4'], 2)
  guide.state.view = 'all'
  await nextTick()
  assert.equal(view.currentCatalogPage.value, 6)
})

test('展开动画完成后才滚动，手动操作及卸载会取消迟到的自动定位', async (t) => {
  const { view, app } = mount(t)
  const previousRaf = globalThis.requestAnimationFrame,
    previousCancel = globalThis.cancelAnimationFrame,
    previousCSS = globalThis.CSS
  globalThis.requestAnimationFrame = (callback) => setImmediate(callback)
  globalThis.cancelAnimationFrame = clearImmediate
  globalThis.CSS = { escape: (value) => value }
  t.after(() => {
    globalThis.requestAnimationFrame = previousRaf
    globalThis.cancelAnimationFrame = previousCancel
    globalThis.CSS = previousCSS
  })
  let finish
  const animation = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  let finished = animation()
  const scrolls = []
  const lesson = {
    isConnected: true,
    closest: () => ({ getAnimations: () => [{ finished }] }),
    getBoundingClientRect: () => ({ top: 800, height: 100 }),
  }
  view.catalogViewport.value = {
    querySelector: () => lesson,
    clientTop: 0,
    clientHeight: 600,
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => scrolls.push(options),
  }
  await tick()
  await tick()
  assert.equal(scrolls.length, 0)
  finish()
  await tick()
  assert.deepEqual(scrolls, [{ top: 550, behavior: 'auto' }])
  finished = animation()
  const interrupted = view.revealLesson('37.mp4')
  await tick()
  await tick()
  view.cancelReveal()
  finish()
  await interrupted
  assert.equal(scrolls.length, 1)
  finished = animation()
  const late = view.revealLesson('37.mp4')
  await tick()
  await tick()
  app.unmount()
  finish()
  await late
  assert.equal(scrolls.length, 1)
})

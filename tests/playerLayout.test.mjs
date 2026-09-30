import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, ref, computed, nextTick, h } from 'vue'
import { test } from 'node:test'

// Render actual page templates; replace native video and editor internals only.
test('播放器侧栏独立展开、笔记实例保留、页签恢复且顶部不再重复目录入口', async (t) => {
  const videos = [{ path: 'a.mp4', title: '课程一' }]
  const nil = () => {}
  globalThis.sidebarWorkspace = {
    player: { state: { ready: true } },
    noteEditor: ref(null),
    stage: ref(null),
    treeOpen: ref(false),
    desktopTreeOpen: ref(true),
    rightPanelOpen: ref(true),
    rightTab: ref('notes'),
    course: ref({ id: 'test' }),
    video: ref(videos[0]),
    guide: { state: { today: { items: [] } }, configured: ref(false) },
    segment: { active: ref(null), reminder: ref(null) },
    checkIn: { isAchieved: ref(false), percent: ref(30), seconds: ref(600), targetSeconds: ref(1800), streak: ref(2) },
    transcripts: { get: () => ({ status: 'ready' }) },
    hasPrev: ref(false),
    hasNext: ref(true),
    onVideoSample: nil,
    navigateEpisode: nil,
    openGuide: nil,
    openPractice: nil,
    practiceSegment: nil,
    completeSegment: nil,
    noteAfterSegment: nil,
    selectGuideVideo: nil,
    selectVideo: nil,
    startSegment: nil,
    insertTimestamp: nil,
    screenshot: nil,
    seekTo: nil,
    quoteToNote: nil,
    showToast: nil,
  }
  const w = globalThis.sidebarWorkspace
  w.treeVisible = computed(() => w.desktopTreeOpen.value)
  w.toggleTree = () => {
    w.desktopTreeOpen.value = !w.desktopTreeOpen.value
  }
  let noteMounts = 0
  const stub = (name) => ({
    name,
    props: ['active'],
    setup(props, { slots }) {
      if (name === 'LazyNoteEditor') noteMounts++
      return () =>
        h('section', { 'data-stub': name, 'data-active': props.active }, [
          slots.default?.(),
          slots['header-actions']?.(),
          slots.actions?.(),
        ])
    },
  })
  globalThis.sidebarStubs = Object.fromEntries(
    [
      'AppIcon',
      'CourseTree',
      'LazyNoteEditor',
      'TranscriptPanel',
      'LessonKnowledgePanel',
      'DailyPracticeCard',
      'UiButton',
      'VideoStage',
    ].map((name) => [name, stub(name)]),
  )
  globalThis.sidebarStubs.RouterLink = {
    setup:
      (_, { slots }) =>
      () =>
        h('a', {}, slots.default?.()),
  }
  async function component(file) {
    const { descriptor } = parse(readFileSync(new URL('../' + file, import.meta.url), 'utf8'))
    let code = compileScript(descriptor, { id: 'sidebar-check', inlineTemplate: true })
      .content.replace(
        /import \{ useCourseWorkspace \} from [^\n]+/,
        'const useCourseWorkspace = () => globalThis.sidebarWorkspace',
      )
      .replace(/import \{ usePageTitle \} from [^\n]+/, 'const usePageTitle = () => {}')
      .replace(/import \{ formatTime \} from [^\n]+/, 'const formatTime = String')
      .replace(
        /import \{ formatStudyClock, formatStudyHours \} from [^\n]+/,
        'const formatStudyClock = String, formatStudyHours = String',
      )
      .replace(/import (\w+) from '~\/components\/[^\n]+/g, 'const $1 = globalThis.sidebarStubs.$1')
      .replace(/import \{ RouterLink \} from [^\n]+/, 'const RouterLink = globalThis.sidebarStubs.RouterLink')
      .replace(/from ["']vue["']/g, `from '${import.meta.resolve('vue')}'`)
    const { outputText } = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    })
    return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).default
  }
  function element(type) {
    return { type, props: {}, style: {}, children: [], parent: null }
  }
  const renderer = createRenderer({
    createElement: element,
    createText: (text) => ({ ...element('#text'), text }),
    createComment: (text) => ({ ...element('#comment'), text }),
    setText: (n, text) => {
      n.text = text
    },
    setElementText: (n, text) => {
      n.text = text
      n.children = []
    },
    patchProp: (n, key, old, value) => {
      n.props[key] = value
    },
    insert(n, p, anchor) {
      if (n.parent) {
        const i = n.parent.children.indexOf(n)
        if (i >= 0) n.parent.children.splice(i, 1)
      }
      n.parent = p
      const i = anchor ? p.children.indexOf(anchor) : -1
      p.children.splice(i < 0 ? p.children.length : i, 0, n)
    },
    remove(n) {
      n.parent?.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = null
    },
    parentNode: (n) => n.parent,
    nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  })
  const walk = (n) => [n, ...n.children.flatMap(walk)]
  const root = element('root'),
    app = renderer.createApp(await component('app/pages/PlayerPage.vue'))
  app.mount(root)
  const find = (key, value) => walk(root).find((n) => n.props[key] === value)
  const click = async (label) => {
    const b = find('aria-label', label)
    assert.ok(b, label)
    b.props.onClick()
    await nextTick()
  }
  const results = []
  await click('收起左侧目录')
  assert.equal(w.desktopTreeOpen.value, false)
  assert.equal(w.rightPanelOpen.value, true)
  assert.match(walk(root).find((n) => n.props.class?.includes('player-layout')).props.class, /directory-collapsed/)
  results.push('左侧独立收起与布局切换')
  const panel = find('id', 'player-learning-panel'),
    editor = find('data-stub', 'LazyNoteEditor')
  await click('收起右侧面板')
  assert.equal(panel.style.display, 'none')
  assert.match(walk(root).find((n) => n.props.class?.includes('player-layout')).props.class, /right-panel-collapsed/)
  assert.equal(find('data-stub', 'LazyNoteEditor'), editor)
  assert.equal(find('aria-label', '展开左侧目录').parent, root.children[0])
  assert.equal(find('aria-label', '展开右侧面板').parent, root.children[0])
  assert.match(find('aria-label', '展开左侧目录').props.class, /sidebar-edge-left/)
  assert.match(find('aria-label', '展开右侧面板').props.class, /sidebar-edge-right/)
  results.push('两侧完全隐藏、展开按钮独立位于页面边缘，笔记实例保留')
  await click('展开左侧目录')
  assert.equal(w.desktopTreeOpen.value, true)
  assert.equal(w.rightPanelOpen.value, false)
  results.push('展开左侧不影响右侧')
  await click('展开右侧面板')
  assert.notEqual(panel.style.display, 'none')
  assert.equal(noteMounts, 1)
  assert.equal(find('data-stub', 'LazyNoteEditor'), editor)
  results.push('重新展开不重建笔记')
  w.rightTab.value = 'transcript'
  await nextTick()
  await click('收起右侧面板')
  assert.equal(find('data-stub', 'TranscriptPanel').props['data-active'], false)
  await click('展开右侧面板')
  assert.equal(w.rightTab.value, 'transcript')
  assert.equal(find('data-stub', 'TranscriptPanel').props['data-active'], true)
  results.push('逐字稿隐藏停用、展开保留页签')
  app.unmount()
  const header = element('root'),
    top = renderer.createApp(await component('app/components/AppTopBar.vue'), {
      courseName: '测试',
      currentView: 'player',
    })
  top.mount(header)
  assert.ok(
    !walk(header).some(
      (n) => n.props['aria-label'] === '目录' || n.props['aria-controls'] === 'player-course-directory',
    ),
  )
  results.push('顶部目录按钮已移除')
  top.unmount()
  assert.equal(results.length, 6)

  t.after(() => {
    delete globalThis.sidebarWorkspace
    delete globalThis.sidebarStubs
  })
})

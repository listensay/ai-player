import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, ref, reactive, computed, nextTick, h } from 'vue'
import { test } from 'node:test'

// Render actual page templates; replace native video and editor internals only.
test('播放器侧栏自由拉伸、接近边缘自动收起、笔记实例与页签保留', async (t) => {
  const previous = Object.fromEntries(['window', 'localStorage', 'ResizeObserver'].map((key) => [key, globalThis[key]]))
  const listeners = new Map(),
    storage = new Map()
  globalThis.window = {
    innerWidth: 1280,
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
  }
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
    delete globalThis.sidebarWorkspace
    delete globalThis.sidebarStubs
  })
  const videos = [{ path: 'a.mp4', title: '课程一' }]
  const nil = () => {}
  globalThis.sidebarWorkspace = {
    player: { state: { ready: true } },
    assistant: { open: nil },
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
    transcripts: { get: () => ({ status: 'transcribing', progress: null }) },
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
    props: ['active', 'blocked'],
    setup(props, { slots }) {
      if (name === 'AffineWorkspace') noteMounts++
      return () =>
        h('section', { 'data-stub': name, 'data-active': props.active, 'data-blocked': props.blocked }, [
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
      'AffineWorkspace',
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
      .replace(
        /from ['"]~\/composables\/usePlayerPanels['"]/g,
        `from '${new URL('../app/composables/usePlayerPanels.ts', import.meta.url).href}'`,
      )
      .replace(/import \{ usePageTitle \} from [^\n]+/, 'const usePageTitle = () => {}')
      .replace(/import \{ formatTime \} from [^\n]+/, 'const formatTime = String')
      .replace(
        /import \{ formatStudyClock, formatStudyHours \} from [^\n]+/,
        'const formatStudyClock = String, formatStudyHours = String',
      )
      .replace(/import (\w+) from ['"](?:~\/components\/|\.\/)[^\n]+/g, 'const $1 = globalThis.sidebarStubs.$1')
      .replace(/import \{ RouterLink \} from [^\n]+/, 'const RouterLink = globalThis.sidebarStubs.RouterLink')
      .replace(/from ["']vue["']/g, `from '${import.meta.resolve('vue')}'`)
    const { outputText } = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    })
    return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).default
  }
  function element(type) {
    return {
      type,
      props: {},
      style: {},
      children: [],
      parent: null,
      getBoundingClientRect() {
        const layout = walk(root).find((node) => node.props.class?.includes('player-layout'))
        const variable = this.props.id === 'player-course-directory' ? '--directory-width' : '--learning-panel-width'
        return {
          width: this.props.class?.includes('player-layout')
            ? window.innerWidth
            : parseFloat(layout?.props.style?.[variable]) || 0,
        }
      },
      setPointerCapture(id) {
        this.pointerId = id
      },
      hasPointerCapture(id) {
        return this.pointerId === id
      },
      releasePointerCapture() {
        this.pointerId = null
      },
    }
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
  await nextTick()
  const find = (key, value) => walk(root).find((n) => n.props[key] === value)
  const click = async (label) => {
    const b = find('aria-label', label)
    assert.ok(b, label)
    b.props.onClick()
    await nextTick()
  }
  const results = []
  const emit = async (type, props = {}) => {
    for (const listener of listeners.get(type) ?? []) listener({ pointerId: 1, ...props })
    await nextTick()
  }
  const resize = async (label, delta) => {
    const handle = find('aria-label', label)
    assert.ok(handle)
    handle.props.onPointerdown({ button: 0, pointerId: 1, clientX: 600, currentTarget: handle, preventDefault() {} })
    await nextTick()
    assert.equal(editor.props['data-blocked'], true, '任一侧拖拽时让原生笔记释放鼠标区域')
    await emit('pointermove', { clientX: 600 + delta })
    await emit('pointerup')
    assert.equal(editor.props['data-blocked'], false)
    assert.equal(listeners.get('pointermove').size, 0)
    assert.equal(handle.pointerId, null)
  }
  assert.ok(walk(root).some((n) => n.props.title === '转写中' && n.text === '…'))
  assert.equal(find('aria-label', '收起左侧目录'), undefined)
  assert.equal(find('aria-label', '收起右侧面板'), undefined)
  const panel = find('id', 'player-learning-panel'),
    editor = find('data-stub', 'AffineWorkspace')
  const leftWidth = () => find('aria-label', '调整目录宽度').props['aria-valuenow']
  const rightWidth = () => find('aria-label', '调整笔记面板宽度').props['aria-valuenow']
  assert.equal(leftWidth(), 300)
  assert.equal(rightWidth(), 440)
  await resize('调整目录宽度', 50)
  assert.equal(leftWidth(), 350)
  assert.equal(rightWidth(), 440)
  await resize('调整笔记面板宽度', 240)
  assert.equal(rightWidth(), 200, '右侧宽度可低于旧的 320px 限制')
  assert.equal(leftWidth(), 350)
  await resize('调整笔记面板宽度', -100)
  assert.equal(rightWidth(), 300)
  await resize('调整目录宽度', -271)
  assert.equal(w.desktopTreeOpen.value, false)
  assert.equal(w.rightPanelOpen.value, true)
  assert.match(walk(root).find((n) => n.props.class?.includes('player-layout')).props.class, /directory-collapsed/)
  results.push('左侧独立收起与布局切换')
  await resize('调整笔记面板宽度', 221)
  assert.equal(panel.style.display, 'none')
  assert.match(walk(root).find((n) => n.props.class?.includes('player-layout')).props.class, /right-panel-collapsed/)
  assert.equal(find('data-stub', 'AffineWorkspace'), editor)
  assert.equal(find('aria-label', '展开左侧目录').parent, root.children[0])
  assert.equal(find('aria-label', '展开右侧面板').parent, root.children[0])
  assert.match(find('aria-label', '展开左侧目录').props.class, /sidebar-edge-left/)
  assert.match(find('aria-label', '展开右侧面板').props.class, /sidebar-edge-right/)
  results.push('两侧完全隐藏、展开按钮独立位于页面边缘，本地笔记实例保留')
  await click('展开左侧目录')
  assert.equal(w.desktopTreeOpen.value, true)
  assert.equal(w.rightPanelOpen.value, false)
  assert.equal(leftWidth(), 350)
  results.push('展开左侧不影响右侧')
  await click('展开右侧面板')
  assert.notEqual(panel.style.display, 'none')
  assert.equal(noteMounts, 1)
  assert.equal(rightWidth(), 300)
  assert.equal(find('data-stub', 'AffineWorkspace'), editor)
  results.push('重新展开不重建本地笔记')
  w.rightTab.value = 'transcript'
  await nextTick()
  find('aria-label', '调整笔记面板宽度').props.onKeydown({ key: 'Home', preventDefault() {} })
  await nextTick()
  assert.equal(find('data-stub', 'TranscriptPanel').props['data-active'], false)
  await click('展开右侧面板')
  assert.equal(w.rightTab.value, 'transcript')
  assert.equal(find('data-stub', 'TranscriptPanel').props['data-active'], true)
  results.push('逐字稿隐藏停用、展开保留页签')
  window.innerWidth = 1024
  await emit('resize')
  assert.ok(leftWidth() + rightWidth() <= 1024 - 64 - 240, '窗口变窄时仍为视频保留空间')
  find('aria-label', '调整目录宽度').props.onKeydown({ key: 'End', preventDefault() {} })
  await nextTick()
  assert.ok(leftWidth() + rightWidth() <= 720)
  assert.equal(storage.get('learning-panel-width:v1'), '300')
  const handle = find('aria-label', '调整目录宽度')
  handle.props.onPointerdown({ button: 0, pointerId: 2, clientX: 600, currentTarget: handle, preventDefault() {} })
  app.unmount()
  assert.equal(handle.pointerId, null, '卸载时释放鼠标捕获')
  assert.ok(
    [...listeners.values()].every((handlers) => handlers.size === 0),
    '卸载时清理监听器',
  )
  const actions = []
  const headerProps = reactive({ courseName: '测试', currentView: 'player' })
  const TopBar = await component('app/components/AppTopBar.vue')
  const header = element('root'),
    top = renderer.createApp({
      setup: () => () =>
        h(TopBar, {
          ...headerProps,
          onBack: () => actions.push('back'),
          onSettings: () => actions.push('settings-dialog'),
          onStudy: () => actions.push('study-dialog'),
          onMilestones: () => actions.push('milestones-dialog'),
          onClose: () => actions.push('close'),
          onGuide: () => actions.push('guide'),
          onHelp: () => actions.push('help'),
        }),
    })
  top.mount(header)
  assert.ok(
    !walk(header).some(
      (n) => n.props['aria-label'] === '目录' || n.props['aria-controls'] === 'player-course-directory',
    ),
  )
  results.push('顶部目录按钮已移除')
  const headerFind = (label) => walk(header).find((n) => n.props['aria-label'] === label)
  const toolbarLabels = () =>
    walk(headerFind('顶部操作'))
      .filter((n) => n.props.title)
      .map((n) => n.props.title)
  assert.deepEqual(toolbarLabels(), ['返回视频信息'])
  assert.equal(headerFind('AI 导学'), undefined)
  assert.equal(headerFind('概览'), undefined)
  assert.equal(headerFind('播放器'), undefined)
  headerFind('返回视频信息').props.onClick()
  headerProps.currentView = 'dashboard'
  await nextTick()
  assert.deepEqual(toolbarLabels(), ['AI 导学', '返回首页'])
  assert.equal(headerFind('概览'), undefined)
  assert.equal(headerFind('播放器'), undefined)
  headerFind('AI 导学').props.onClick()
  headerFind('返回首页').props.onClick()
  assert.deepEqual(actions.slice(-3), ['back', 'guide', 'close'])
  headerProps.courseName = ''
  await nextTick()
  assert.deepEqual(toolbarLabels(), ['笔记', '学习管理', '设置', '快捷键（?）'])
  headerFind('快捷键').props.onClick()
  assert.equal(actions.at(-1), 'help')
  assert.equal(headerFind('返回上一页'), undefined)
  headerFind('设置').props.onClick()
  headerFind('学习管理').props.onClick()
  assert.deepEqual(actions.slice(-2), ['settings-dialog', 'study-dialog'])
  top.unmount()
  assert.equal(results.length, 6)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, ref, reactive, computed, nextTick, h } from 'vue'
import { test } from 'node:test'

// Render actual page templates; replace native video and editor internals only.
test('播放器侧栏独立展开、Notion 实例保留、页签恢复且顶部不再重复目录入口', async (t) => {
  const videos = [{ path: 'a.mp4', title: '课程一' }]
  const nil = () => {}
  globalThis.sidebarWorkspace = {
    player: { state: { ready: true } },
    assistant: { highlights: ref([]), open: nil },
    noteEditor: ref(null),
    stage: ref(null),
    treeOpen: ref(false),
    desktopTreeOpen: ref(true),
    rightPanelOpen: ref(true),
    rightTab: ref('notion'),
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
  let notionMounts = 0
  const stub = (name) => ({
    name,
    props: ['active'],
    setup(props, { slots }) {
      if (name === 'NotionPanel') notionMounts++
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
      'NotionPanel',
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
        /from ['"]~\/composables\/useLearningPanelWidth['"]/g,
        `from '${new URL('../app/composables/useLearningPanelWidth.ts', import.meta.url).href}'`,
      )
      .replace(/import \{ usePageTitle \} from [^\n]+/, 'const usePageTitle = () => {}')
      .replace(/import \{ formatTime \} from [^\n]+/, 'const formatTime = String')
      .replace(
        /import \{ formatStudyClock, formatStudyHours \} from [^\n]+/,
        'const formatStudyClock = String, formatStudyHours = String',
      )
      .replace(/import (\w+) from ['"](?:~\/components\/|\.\/)[^\n]+/g, 'const $1 = globalThis.sidebarStubs.$1')
      .replace(
        /from ['"]~\/utils\/pomodoro['"]/g,
        `from '${new URL('../app/utils/pomodoro.ts', import.meta.url).href}'`,
      )
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
  assert.ok(walk(root).some((n) => n.props.title === '转写中' && n.text === '…'))
  await click('收起左侧目录')
  assert.equal(w.desktopTreeOpen.value, false)
  assert.equal(w.rightPanelOpen.value, true)
  assert.match(walk(root).find((n) => n.props.class?.includes('player-layout')).props.class, /directory-collapsed/)
  results.push('左侧独立收起与布局切换')
  const panel = find('id', 'player-learning-panel'),
    editor = find('data-stub', 'NotionPanel')
  await click('收起右侧面板')
  assert.equal(panel.style.display, 'none')
  assert.match(walk(root).find((n) => n.props.class?.includes('player-layout')).props.class, /right-panel-collapsed/)
  assert.equal(find('data-stub', 'NotionPanel'), editor)
  assert.equal(find('aria-label', '展开左侧目录').parent, root.children[0])
  assert.equal(find('aria-label', '展开右侧面板').parent, root.children[0])
  assert.match(find('aria-label', '展开左侧目录').props.class, /sidebar-edge-left/)
  assert.match(find('aria-label', '展开右侧面板').props.class, /sidebar-edge-right/)
  results.push('两侧完全隐藏、展开按钮独立位于页面边缘，Notion 实例保留')
  await click('展开左侧目录')
  assert.equal(w.desktopTreeOpen.value, true)
  assert.equal(w.rightPanelOpen.value, false)
  results.push('展开左侧不影响右侧')
  await click('展开右侧面板')
  assert.notEqual(panel.style.display, 'none')
  assert.equal(notionMounts, 1)
  assert.equal(find('data-stub', 'NotionPanel'), editor)
  results.push('重新展开不重建 Notion')
  w.rightTab.value = 'transcript'
  await nextTick()
  await click('收起右侧面板')
  assert.equal(find('data-stub', 'TranscriptPanel').props['data-active'], false)
  await click('展开右侧面板')
  assert.equal(w.rightTab.value, 'transcript')
  assert.equal(find('data-stub', 'TranscriptPanel').props['data-active'], true)
  results.push('逐字稿隐藏停用、展开保留页签')
  app.unmount()
  globalThis.sidebarStubs.PomodoroBadge = await component('app/components/PomodoroBadge.vue')
  const actions = []
  const timer = reactive({
    ready: true,
    enabled: true,
    visible: false,
    phase: 'focus',
    status: 'idle',
    remainingSeconds: 1500,
    totalSeconds: 1500,
    completedFocuses: 0,
    round: 1,
    longBreakEvery: 4,
    revision: 1,
    notice: '',
    error: '',
  })
  const headerProps = reactive({ courseName: '测试', currentView: 'player', pomodoro: timer })
  const TopBar = await component('app/components/AppTopBar.vue')
  const header = element('root'),
    top = renderer.createApp({
      setup: () => () =>
        h(TopBar, {
          ...headerProps,
          onPomodoroStart: () => actions.push('start'),
          onPomodoroPause: () => actions.push('pause'),
          onPomodoroReset: () => actions.push('reset'),
          onPomodoroSettings: () => actions.push('settings'),
          onBack: () => actions.push('back'),
          onSettings: () => actions.push('settings-dialog'),
          onStudy: () => actions.push('study-dialog'),
          onMilestones: () => actions.push('milestones-dialog'),
          onClose: () => actions.push('close'),
          onGuide: () => actions.push('guide'),
          onCompanion: () => actions.push('companion'),
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
  const headerElement = walk(header).find((n) => n.type === 'header')
  assert.match(headerElement.props.class, /grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/)
  assert.match(headerFind('播放器番茄钟').parent.props.class, /justify-center/)
  assert.ok(headerFind('播放器番茄钟').parent.parent === headerElement)
  assert.ok(headerFind('播放器番茄钟'), '桌宠提醒关闭不隐藏顶部番茄钟')
  assert.equal(headerFind('番茄钟剩余时间').text, '25:00')
  headerFind('开始番茄钟').props.onClick()
  timer.status = 'running'
  timer.remainingSeconds = 1499
  await nextTick()
  assert.equal(headerFind('番茄钟剩余时间').text, '24:59')
  headerFind('暂停番茄钟').props.onClick()
  timer.status = 'paused'
  await nextTick()
  headerFind('继续番茄钟').props.onClick()
  headerFind('重置番茄钟').props.onClick()
  headerFind('打开番茄钟设置').props.onClick()
  assert.deepEqual(actions, ['start', 'pause', 'start', 'reset', 'settings'])
  timer.phase = 'long-break'
  timer.remainingSeconds = 900
  timer.totalSeconds = 900
  await nextTick()
  assert.equal(headerFind('番茄钟剩余时间').text, '15:00')
  assert.ok(walk(header).some((n) => n.text?.includes('长休息')))
  timer.enabled = false
  await nextTick()
  assert.equal(headerFind('继续番茄钟').props.disabled, true)
  assert.equal(headerFind('重置番茄钟').props.disabled, true)
  assert.ok(!headerFind('打开番茄钟设置').props.disabled)
  timer.enabled = true
  timer.ready = false
  await nextTick()
  assert.equal(headerFind('继续番茄钟').props.disabled, true)
  headerFind('返回视频信息').props.onClick()
  headerProps.currentView = 'dashboard'
  await nextTick()
  assert.equal(headerFind('播放器番茄钟'), undefined)
  assert.deepEqual(toolbarLabels(), ['AI 导学', '返回首页'])
  assert.equal(headerFind('概览'), undefined)
  assert.equal(headerFind('播放器'), undefined)
  headerFind('AI 导学').props.onClick()
  headerFind('返回首页').props.onClick()
  assert.deepEqual(actions.slice(-3), ['back', 'guide', 'close'])
  headerProps.courseName = ''
  await nextTick()
  assert.deepEqual(toolbarLabels(), ['学习管理', '里程碑勋章', '设置', '打开桌面挂件', '快捷键（?）'])
  headerFind('桌面挂件').props.onClick()
  headerFind('快捷键').props.onClick()
  assert.deepEqual(actions.slice(-2), ['companion', 'help'])
  assert.equal(headerFind('返回上一页'), undefined)
  headerFind('设置').props.onClick()
  headerFind('学习管理').props.onClick()
  headerFind('里程碑勋章').props.onClick()
  assert.deepEqual(actions.slice(-3), ['settings-dialog', 'study-dialog', 'milestones-dialog'])
  top.unmount()
  assert.equal(results.length, 6)

  t.after(() => {
    delete globalThis.sidebarWorkspace
    delete globalThis.sidebarStubs
  })
})

test('应用顶部不渲染后台转写任务条，保留进度保存错误与提醒入口', () => {
  const { descriptor } = parse(readFileSync(new URL('../app/app.vue', import.meta.url), 'utf8'))
  assert.doesNotMatch(descriptor.template.content, /后台转写任务|正在转写：|transcripts\.activeJobs|transcripts\.tasks/)
  assert.match(descriptor.template.content, /reminderLinks\.error\.value/)
  assert.match(descriptor.template.content, /progress\.state\.error/)
  assert.match(descriptor.template.content, /<StudyReminderNotice/)
})

test('全屏工具弹窗保留底层路由，入口不切换页面', () => {
  const { descriptor } = parse(readFileSync(new URL('../app/app.vue', import.meta.url), 'utf8'))
  assert.match(descriptor.template.content, /<AppUtilityDialog/)
  assert.match(descriptor.template.content, /<RouterView/)
  assert.match(descriptor.template.content, /:inert="appDialogs.isOpen.value/)
  for (const kind of ['settings', 'study', 'milestones']) {
    assert.ok(descriptor.template.content.includes(`@${kind}="appDialogs.open('${kind}')"`))
  }
  assert.doesNotMatch(descriptor.template.content, /show-history-back|@history-back/)
})

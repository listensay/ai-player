import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, reactive, ref, nextTick, watch } from 'vue'
import {
  createCompanionSession,
  recordCompanionPlayback,
  restSessionIfNeeded,
  snoozeCompanionCare,
  companionConcept,
} from '../app/utils/companion.ts'

const sample = (seconds, at = seconds * 1000, extra = {}) => ({
  seconds,
  at,
  duration: 9000,
  playing: true,
  seeking: false,
  ended: false,
  rate: 1,
  ...extra,
})
function playFor(session, seconds, rate = 1, start = 0) {
  for (let t = start + 1; t <= start + seconds; t++)
    recordCompanionPlayback(
      session,
      sample((t - 1) * rate, (t - 1) * 1000, { rate }),
      sample(t * rate, t * 1000, { rate }),
      t * 1000 + 1000,
    )
}
test('真实播放 25 分钟进入专注时长，60 分钟才提醒；倍速不缩短阈值', () => {
  const session = createCompanionSession()
  playFor(session, 1500, 2)
  assert.equal(session.seconds, 1500)
  assert.equal(session.careDue, false)
  playFor(session, 2099, 2, 1500)
  assert.equal(session.careDue, false)
  playFor(session, 1, 2, 3599)
  assert.equal(session.seconds, 3600)
  assert.equal(session.careDue, true)
})
test('暂停、缓冲、拖动、倒退和系统休眠不伪造学习时长', () => {
  const session = createCompanionSession()
  for (const [before, after] of [
    [sample(10, 0, { playing: false }), sample(11, 1000)],
    [sample(10, 0), sample(10, 1000)],
    [sample(10, 0), sample(1000, 1000)],
    [sample(10, 0), sample(11, 1000, { seeking: true })],
    [sample(10, 0, { seeking: true }), sample(11, 1000)],
    [sample(10, 0), sample(9, 1000)],
    [sample(10, 0), sample(110, 100000)],
  ])
    recordCompanionPlayback(session, before, after, 101000)
  assert.equal(session.seconds, 0)
})
test('短暂停保留进度，完整休息三分钟重置时长与关怀阈值', () => {
  const session = createCompanionSession()
  playFor(session, 3600)
  const last = session.lastActiveAt
  restSessionIfNeeded(session, last + 179999)
  assert.equal(session.seconds, 3600)
  restSessionIfNeeded(session, last + 180000)
  assert.deepEqual(session, createCompanionSession())
})
test('稍后提醒等待额外 20 分钟有效播放，切课的首个样本不多算时间', () => {
  const session = createCompanionSession()
  playFor(session, 3600)
  snoozeCompanionCare(session)
  assert.equal(session.careDue, false)
  recordCompanionPlayback(session, null, sample(0), session.lastActiveAt + 1000)
  assert.equal(session.seconds, 3600)
  playFor(session, 1199, 1, 3600)
  assert.equal(session.careDue, false)
  playFor(session, 1, 1, 4799)
  assert.equal(session.careDue, true)
})
test('知识点跟随片段边界，空隙显示课程概念，没有材料时明确回退', () => {
  const points = [
    { title: '变量', text: '保存一个值', start: 10, end: 20 },
    { title: '函数', text: '复用操作', start: 20, end: 30 },
  ]
  assert.equal(companionConcept(points, 10, []).title, '变量')
  assert.equal(companionConcept(points, 20, []).title, '函数')
  assert.equal(companionConcept(points, 31, ['语法']).label, '关键概念')
  assert.match(companionConcept([], 0, []).detail, /未生成知识点/)
})

// Exercise Vue watchers and cross-window controls, mocking only the native I/O boundary.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const flushDatabaseWrites = async () => {}; export const databaseRequest = async () => []',
        shortCircuit: true,
      }
    if (specifier === '~/utils/platform')
      return {
        url: 'data:text/javascript,export const desktopInvoke = async (...args) => { if (args[0] === "companion_is_open") return !!globalThis.companionIO.opened; globalThis.companionIO.commands.push(args); if (args[0] === "open_companion") globalThis.companionIO.opened = true; if (args[0] === "close_companion") globalThis.companionIO.opened = false }',
        shortCircuit: true,
      }
    if (specifier === '@tauri-apps/api/event')
      return {
        url: 'data:text/javascript,export const emitTo = async (...args) => globalThis.companionIO.events.push(args)',
        shortCircuit: true,
      }
    if (specifier === '@tauri-apps/api/window')
      return {
        url: 'data:text/javascript,export const getCurrentWindow = () => ({ listen: async (event, callback) => { globalThis.companionIO.listener = callback; return () => { globalThis.companionIO.unlistened = true } } })',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useCompanion } = await import('../app/composables/useCompanion.ts')
const { createProgressStore } = await import('../app/composables/useProgress.ts')
const { buildTodayPlan } = await import('../app/utils/learningFeedback.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))
function harness(t, desktopSettings = { state: { ready: true, autoOpenCompanion: false }, load: async () => {} }) {
  globalThis.companionIO = { commands: [], events: [], listener: null, unlistened: false }
  const player = {
    state: reactive({
      fullscreen: false,
      ready: true,
      playing: false,
      buffering: false,
      currentTime: 0,
      duration: 100,
    }),
    pause() {
      this.state.playing = false
    },
    toggle() {
      this.state.playing = !this.state.playing
    },
  }
  const options = {
    desktopSettings,
    player,
    course: ref({ id: 'a', name: '课程' }),
    video: ref({ path: 'a.mp4', title: '第一课' }),
    knowledge: { get: () => ({ summary: null }) },
    concepts: ref([]),
    today: ref(null),
    todayReady: ref(false),
    dailyFinished: ref(false),
    dailyKey: ref('daily:today'),
    dailyReady: ref(false),
    checkedAt: ref(null),
    blocked: ref(false),
  }
  let companion
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      companion = useCompanion(options)
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return { companion, options, player, app }
}
test('读取旧计划或巩固记录不庆祝；完成当前任务才庆祝且不重复', async (t) => {
  const h = harness(t)
  await tick()
  h.options.today.value = {
    date: '2026-09-27',
    items: [
      { id: 'old', kind: 'lesson', done: true },
      { id: 'new', kind: 'lesson', done: false },
    ],
  }
  h.options.todayReady.value = true
  h.options.dailyReady.value = true
  h.options.dailyFinished.value = true
  await nextTick()
  assert.equal(h.companion.snapshot.value.celebration, '')
  h.options.today.value.items[1].done = true
  await nextTick()
  assert.match(h.companion.snapshot.value.celebration, /今日计划课节完成/)
  h.options.checkedAt.value = 42
  await nextTick()
  assert.match(h.companion.snapshot.value.celebration, /已打卡/)
  h.options.today.value.items[1].done = false
  await nextTick()
  h.options.today.value.items[1].done = true
  await nextTick()
  assert.match(h.companion.snapshot.value.celebration, /已打卡/)
})
test('18:50 / 19:43 不提前完成计划或触发桌宠庆祝，播放结束后才庆祝', async (t) => {
  const h = harness(t)
  const progress = createProgressStore({ read: async () => ({}), write: async () => true })
  t.after(progress.dispose)
  await progress.ready()
  const lessons = ['a.mp4', 'b.mp4'].map((path) => ({ path, concepts: [] }))
  const durations = { 'a.mp4': 1183, 'b.mp4': 600 }
  const refreshToday = () => {
    h.options.today.value = buildTodayPlan(
      lessons,
      durations,
      progress.courseProgress('a'),
      {},
      [],
      30,
      '2026-10-05',
      h.options.today.value,
    )
  }
  refreshToday()
  h.options.todayReady.value = true
  const stop = watch(() => progress.courseProgress('a'), refreshToday, { deep: true })
  t.after(stop)
  await nextTick()
  for (const time of [1130, 1182.99]) {
    progress.update('a', 'a.mp4', time, 1183)
    await nextTick()
    assert.equal(h.options.today.value.items[0].done, false)
    assert.equal(h.companion.snapshot.value.celebration, '')
  }
  progress.update('a', 'a.mp4', 1183, 1183, { ended: true })
  await nextTick()
  assert.equal(h.options.today.value.items[0].done, true)
  assert.equal(h.options.today.value.items[1].done, false)
  assert.equal(h.companion.snapshot.value.celebration, '课节完成')
})

test('切日期或切巩固计划不会误庆祝；提交当前巩固会庆祝', async (t) => {
  const h = harness(t)
  h.options.dailyReady.value = true
  await nextTick()
  h.options.dailyKey.value = 'daily:tomorrow'
  h.options.dailyFinished.value = true
  await nextTick()
  assert.equal(h.companion.snapshot.value.celebration, '')
  h.options.dailyFinished.value = false
  await nextTick()
  h.options.dailyFinished.value = true
  await nextTick()
  assert.match(h.companion.snapshot.value.celebration, /今日巩固完成/)
})
test('小窗指令控制主播放器，旧课节指令和弹窗期间的播放指令无效', async (t) => {
  const h = harness(t)
  await tick()
  const send = (type) =>
    globalThis.companionIO.listener({ payload: { type, lessonKey: h.companion.snapshot.value.lessonKey } })
  send('toggle')
  assert.equal(h.player.state.playing, true)
  globalThis.companionIO.listener({ payload: { type: 'toggle', lessonKey: 'stale' } })
  assert.equal(h.player.state.playing, true)
  h.options.blocked.value = true
  send('toggle')
  assert.equal(h.player.state.playing, true)
  h.options.blocked.value = false
  send('rest')
  assert.equal(h.player.state.playing, false)
  assert.equal(h.companion.snapshot.value.restRemaining, 180)
  send('toggle')
  await nextTick()
  assert.equal(h.player.state.playing, true)
  assert.equal(h.companion.snapshot.value.restRemaining, 0)
  send('sync')
  await tick()
  assert.ok(globalThis.companionIO.events.some(([target, event]) => target === 'companion' && event === 'playbo-state'))
})
test('25 分钟有效样本切换耳机状态；卸载时清理跨窗口监听', async (t) => {
  const h = harness(t)
  await tick()
  h.player.state.playing = true
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  h.companion.sample(sample(0))
  for (let second = 1; second <= 1500; second++) {
    t.mock.timers.tick(1000)
    h.companion.sample(sample(second))
  }
  assert.equal(h.companion.snapshot.value.mood, 'focus')
  assert.equal(h.companion.snapshot.value.sessionSeconds, 1500)
  h.app.unmount()
  assert.equal(globalThis.companionIO.unlistened, true)
})

test('进入和退出全屏时同步桌面挂件可见性，不改变播放状态', async (t) => {
  const h = harness(t)
  await tick()
  h.player.state.playing = true
  h.player.state.fullscreen = true
  await nextTick()
  h.player.state.fullscreen = false
  await nextTick()
  assert.deepEqual(globalThis.companionIO.commands, [
    ['set_companion_fullscreen', { fullscreen: true }],
    ['set_companion_fullscreen', { fullscreen: false }],
  ])
  assert.equal(h.player.state.playing, true)
})

test('启动等待设置读取，仅开启时自动打开一次，后续修改不立即弹出', async (t) => {
  let resolve
  const settings = {
    state: reactive({ ready: false, autoOpenCompanion: false }),
    load: () =>
      new Promise((r) => {
        resolve = r
      }),
  }
  const h = harness(t, settings)
  await tick()
  assert.equal(globalThis.companionIO.commands.length, 0)
  settings.state.ready = true
  settings.state.autoOpenCompanion = true
  resolve()
  await tick()
  assert.deepEqual(globalThis.companionIO.commands, [['open_companion']])
  settings.state.autoOpenCompanion = false
  await nextTick()
  settings.state.autoOpenCompanion = true
  await nextTick()
  assert.equal(globalThis.companionIO.commands.length, 1)
  assert.equal(h.companion.error.value, '')
})
test('关闭自动启动仍能手动打开桌宠', async (t) => {
  const h = harness(t)
  await tick()
  assert.equal(globalThis.companionIO.commands.length, 0)
  await h.companion.openMini()
  assert.deepEqual(globalThis.companionIO.commands, [['open_companion']])
})

test('相同状态只保留两秒心跳，显式同步仍立即回应', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 })
  const h = harness(t)
  await tick()
  const sync = () => globalThis.companionIO.listener({ payload: { type: 'sync' } })
  sync()
  await tick()
  const before = globalThis.companionIO.events.length
  h.player.state.currentTime = 0.1
  await tick()
  h.player.state.currentTime = 0.2
  await tick()
  assert.equal(globalThis.companionIO.events.length, before)
  t.mock.timers.tick(1000)
  await tick()
  assert.equal(globalThis.companionIO.events.length, before)
  t.mock.timers.tick(1000)
  await tick()
  assert.equal(globalThis.companionIO.events.length, before + 1)
  sync()
  await tick()
  assert.equal(globalThis.companionIO.events.length, before + 2)
})

test('桌宠保留番茄钟阶段消息快照，不再接受计时控制命令', async (t) => {
  const h = harness(t),
    actions = []
  const timer = {
    snapshot: ref({
      ready: true,
      enabled: true,
      visible: true,
      phase: 'short-break',
      status: 'running',
      remainingSeconds: 300,
      totalSeconds: 300,
      completedFocuses: 1,
      round: 1,
      longBreakEvery: 4,
      revision: 7,
      notice: '专注完成，已开始短休息 5 分钟。',
      error: '',
    }),
    start: () => actions.push('start'),
    pause: () => actions.push('pause'),
    reset: () => actions.push('reset'),
  }
  h.options.pomodoro = timer
  h.options.course.value = null
  h.options.video.value = null
  h.player.state.ready = false
  await tick()
  assert.match(h.companion.snapshot.value.pomodoro.notice, /专注完成/)
  for (const type of ['pomodoro-start', 'pomodoro-pause', 'pomodoro-reset', 'pomodoro-settings'])
    globalThis.companionIO.listener({
      payload: { type, pomodoroRevision: 7, lessonKey: h.companion.snapshot.value.lessonKey },
    })
  assert.deepEqual(actions, [])
  timer.snapshot.value.notice = '休息结束，播放视频或手动开始下一次专注。'
  timer.snapshot.value.phase = 'focus'
  timer.snapshot.value.status = 'idle'
  timer.snapshot.value.revision++
  await tick()
  assert.match(h.companion.snapshot.value.pomodoro.notice, /休息结束/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, reactive, ref } from 'vue'
import { localDayKey } from '../app/utils/learningFeedback.ts'

const boundaries = {
  '~/composables/useAiSettings': ['useAiSettings'],
  '~/composables/useProgress': ['useProgress'],
  '~/utils/platform': ['desktopInvoke'],
  '~/utils/guideAi': ['planPrompt', 'practicePrompt', 'requestGuideJson'],
  '~/utils/guideMedia': ['collectGuideMetadata'],
  '~/utils/dbClient': ['dbFetchGuide', 'dbSaveGuide', 'dbSaveSetting', 'dbFetchCheckIns', 'dbSaveCheckIns'],
  '~/utils/database': ['databaseRequest'],
}
registerHooks({
  resolve(specifier, context, next) {
    if (boundaries[specifier]) {
      const code = boundaries[specifier]
        .map((name) => `export const ${name} = (...args) => globalThis.guideTestIO.${name}(...args)`)
        .join('\n')
      return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true }
    }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useLearningGuide } = await import('../app/composables/useLearningGuide.ts')
const { useStudyCheckIn } = await import('../app/composables/useStudyCheckIn.ts')
globalThis.window = new EventTarget()
const tick = () => new Promise((resolve) => setImmediate(resolve))
const course = (id) => ({ id, videos: [{ path: 'a.mp4', title: '课程', size: 1, modified: 1 }] })
const plan = () => ({
  version: 1,
  createdAt: 123,
  summary: '保留这条路线',
  profile: '已有基础',
  dailyMinutes: 30,
  modules: [{ id: 'm', title: '基础', description: '课程基础' }],
  messages: [],
  lessons: [
    { path: 'a.mp4', moduleId: 'm', status: 'required', reason: '需要学习', prerequisites: [], concepts: ['变量'] },
  ],
})
const stored = () => ({
  plan: plan(),
  metadata: {},
  view: 'route',
  includeOptional: false,
  mastery: {},
  questions: [],
  today: null,
  updatedAt: 123,
})
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
function harness(t, overrides = {}, checkIn = false) {
  const saves = [],
    checkSaves = []
  globalThis.guideTestIO = {
    useAiSettings: () => ({ settings: reactive({}), configured: ref(true) }),
    useProgress: () => ({ get: () => undefined, courseProgress: () => ({}) }),
    dbFetchGuide: async () => stored(),
    dbSaveGuide: async (data) => {
      saves.push(structuredClone(data))
      return true
    },
    dbSaveSetting: async () => true,
    databaseRequest: async () => null,
    collectGuideMetadata: async () => {},
    dbFetchCheckIns: async () => ({}),
    dbSaveCheckIns: async (id, days) => {
      checkSaves.push({ id, days: structuredClone(days) })
      return true
    },
    ...overrides,
  }
  const active = ref(course('one'))
  let guide, clock
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      guide = useLearningGuide(active)
      if (checkIn) clock = useStudyCheckIn(active, ref({ today: null, dailyMinutes: 30 }))
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return { guide, clock, active, saves, checkSaves, app }
}
test('导学尚未读取完成时，定时保存和退出均不写入空路线', async (t) => {
  const pending = deferred()
  const h = harness(t, { dbFetchGuide: () => pending.promise })
  h.guide.persist()
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(h.saves.length, 0)
  assert.equal(h.guide.guideReady.value, false)
  h.app.unmount()
  pending.resolve(stored())
  await tick()
  assert.equal(h.saves.length, 0)
})
test('导学读取失败后不生成、不自动保存，原记录不会被覆盖', async (t) => {
  const h = harness(t, {
    dbFetchGuide: async () => {
      throw Error('read failed')
    },
  })
  await tick()
  h.guide.persist()
  assert.equal(await h.guide.generate('新目标', 30), false)
  assert.equal(h.saves.length, 0)
  assert.match(h.guide.state.storageError, /读取失败/)
})
test('旧路线校验失败时保留数据库，不将空计划保存回去', async (t) => {
  const h = harness(t, { dbFetchGuide: async () => ({ ...stored(), plan: { ...plan(), lessons: [] } }) })
  await tick()
  h.guide.persist()
  assert.equal(h.saves.length, 0)
  assert.equal(h.guide.guideReady.value, false)
})
test('成功读取后恢复路线和对话，修改可保存', async (t) => {
  const saved = stored()
  saved.plan.messages = [{ role: 'user', content: '保留我的目标' }]
  const h = harness(t, { dbFetchGuide: async () => saved })
  await tick()
  assert.equal(h.guide.state.plan.createdAt, 123)
  assert.equal(h.guide.state.plan.messages[0].content, '保留我的目标')
  h.guide.setDailyMinutes(45)
  h.guide.persist()
  await tick()
  assert.equal(h.saves.at(-1).plan.dailyMinutes, 45)
})
test('切课后迟到的旧读取结果不会覆盖新课程', async (t) => {
  const pending = deferred()
  const h = harness(t, { dbFetchGuide: (id) => (id === 'one' ? pending.promise : Promise.resolve(stored())) })
  h.active.value = course('two')
  await tick()
  pending.resolve({ ...stored(), plan: { ...plan(), summary: '旧课程' } })
  await tick()
  assert.equal(h.guide.state.plan.summary, '保留这条路线')
  h.guide.persist()
  assert.ok(h.saves.every((item) => item.courseId === 'two'))
})
test('保存失败明确提示，允许重试', async (t) => {
  const h = harness(t, { dbSaveGuide: async () => false })
  await tick()
  h.guide.persist()
  await tick()
  assert.match(h.guide.state.storageError, /保存失败/)
})
test('打卡未读取或读取失败时，不用零时长覆盖已保存记录', async (t) => {
  const pending = deferred()
  const h = harness(t, { dbFetchCheckIns: () => pending.promise }, true)
  h.clock.persist()
  assert.equal(h.checkSaves.length, 0)
  pending.reject(Error('read failed'))
  await tick()
  h.clock.persist()
  assert.equal(h.checkSaves.length, 0)
  assert.match(h.clock.state.storageError, /读取失败/)
})

test('调整计划与撤销只影响安排，保留调整后新增的实践记录与掌握程度', async (t) => {
  const saved = stored()
  saved.plan.program = {
    days: 30,
    startDate: '2026-09-21',
    budget: { video: 30, code: 15, project: 0, recap: 0 },
    lightEvery: 0,
    lightMinutes: 30,
  }
  const h = harness(t, { dbFetchGuide: async () => saved })
  await tick()
  const next = structuredClone(saved.plan)
  next.program.days = 40
  assert.equal(h.guide.applySchedule(next, '调整剩余计划'), true)
  h.guide.state.records.entries.push({
    id: 'new',
    date: h.guide.todayDate.value,
    moduleId: 'm',
    taskId: 't',
    kind: 'code',
    title: '练习',
    instructions: '练习',
    targetMinutes: 15,
    minutes: 8,
    done: false,
    evidence: '代码已保存',
  })
  h.guide.setMastery('a.mp4', '变量', 'mastered')
  assert.equal(h.guide.undo(), true)
  assert.equal(h.guide.state.plan.program.days, 30)
  assert.equal(h.guide.state.records.entries.find((e) => e.id === 'new').minutes, 8)
  assert.equal(Object.values(h.guide.state.mastery)[0].level, 'mastered')
  assert.equal(h.guide.state.plan.lessons[0].status, 'skipped')
})

test('没有 AI 路线时可直接按本地目录设置学习计划', async (t) => {
  const h = harness(t, { dbFetchGuide: async () => null })
  await tick()
  const local = h.guide.planForScheduling()
  assert.equal(h.guide.state.plan, null)
  assert.deepEqual(
    local.lessons.map((l) => l.path),
    ['a.mp4'],
  )
  assert.equal(h.guide.applySchedule(local, '设置学习计划'), true)
  h.guide.persist()
  await tick()
  assert.equal(h.saves.at(-1).plan.program.budget.video, 30)
})

test('完成今日课程后主动继续下一天，刷新和重开保留追加安排且重复点击无效', async (t) => {
  const saved = stored()
  saved.metadata = { 'a.mp4': { duration: 7200, size: 1, modified: 1 } }
  const h = harness(t, { dbFetchGuide: async () => saved })
  await tick()
  assert.equal(h.guide.nextStudy.value, null)
  const first = h.guide.state.today.items[0]
  h.guide.completeTodayItem(first.id, true)
  assert.ok(h.guide.nextStudy.value)
  const item = h.guide.continueNextDay()
  assert.equal(item.path, 'a.mp4')
  assert.equal(item.start, 1800)
  assert.equal(item.end, 3600)
  assert.equal(h.guide.continueNextDay(), null)
  h.guide.refreshToday()
  h.guide.persist()
  await tick()
  const snapshot = h.saves.at(-1)
  assert.equal(snapshot.today.minutes, 30)
  assert.equal(snapshot.today.extraDays.length, 1)
  assert.equal(snapshot.today.items[0].done, true)
  h.app.unmount()
  const reopened = harness(t, { dbFetchGuide: async () => snapshot })
  await tick()
  assert.equal(reopened.guide.state.today.extraDays.length, 1)
  assert.equal(reopened.guide.state.today.items.length, 2)
  assert.equal(reopened.guide.state.today.items[1].start, 1800)
  assert.equal(reopened.guide.nextStudy.value, null)
})

test('追加多节课程后播放进度触发刷新，学完和学到一半的课程在保存重开后仍在今日列表', async (t) => {
  const saved = stored()
  saved.plan.program = {
    days: 30,
    startDate: localDayKey(),
    budget: { video: 30, code: 0, project: 0, recap: 0 },
    lightEvery: 0,
    lightMinutes: 30,
  }
  saved.plan.lessons = Array.from({ length: 9 }, (_, i) => ({ ...plan().lessons[0], path: `${i + 1}.mp4` }))
  const videos = saved.plan.lessons.map((lesson) => ({ path: lesson.path, title: lesson.path, size: 1, modified: 1 }))
  saved.metadata = Object.fromEntries(videos.map((video) => [video.path, { duration: 600, size: 1, modified: 1 }]))
  const progress = reactive({})
  const useProgress = () => ({ get: (_id, path) => progress[path], courseProgress: () => progress })
  const h = harness(t, { dbFetchGuide: async () => saved, useProgress })
  h.active.value = { id: 'many', videos }
  await tick()
  h.guide.state.today.items.forEach((item) => h.guide.completeTodayItem(item.id, true))
  assert.equal(h.guide.continueNextDay().path, '4.mp4')
  const expectedPaths = h.guide.state.today.items.map((item) => item.path)
  const fifth = JSON.parse(JSON.stringify(h.guide.state.today.items[4]))
  progress['4.mp4'] = { time: 600, duration: 600, ratio: 1, done: true, updatedAt: 1 }
  progress['5.mp4'] = { time: 240, duration: 600, ratio: 0.4, done: false, updatedAt: 2 }
  await tick()
  assert.deepEqual(
    h.guide.state.today.items.map((item) => item.path),
    expectedPaths,
  )
  assert.equal(h.guide.state.today.items[3].done, true)
  assert.deepEqual(JSON.parse(JSON.stringify(h.guide.state.today.items[4])), fifth)
  h.guide.persist()
  await tick()
  const snapshot = h.saves.at(-1)
  h.app.unmount()
  const reopened = harness(t, { dbFetchGuide: async () => snapshot, useProgress })
  reopened.active.value = { id: 'many', videos }
  await tick()
  assert.deepEqual(
    reopened.guide.state.today.items.map((item) => item.path),
    expectedPaths,
  )
  assert.equal(reopened.guide.state.today.items[3].done, true)
  assert.equal(reopened.guide.state.today.items[4].start, 0)
  assert.equal(reopened.guide.state.today.extraDays.length, 1)
})

test('移除疑问回溯后保留历史记录，但不再加入今日任务或影响掌握度', async (t) => {
  const q = {
    id: 'legacy-question',
    path: 'a.mp4',
    seconds: 12,
    text: '变量为何变化？',
    status: 'still-confused',
    createdAt: 1,
    updatedAt: 1,
    recommendations: [],
    reviewedPaths: [],
  }
  const h = harness(t, { dbFetchGuide: async () => ({ ...stored(), questions: [q] }) })
  await tick()
  assert.equal(h.guide.state.questions[0].id, q.id)
  assert.ok(h.guide.state.today.items.every((item) => item.kind !== 'question'))
  assert.deepEqual(h.guide.state.mastery, {})
  h.guide.setDailyMinutes(60)
  h.guide.persist()
  await tick()
  assert.equal(h.saves.at(-1).questions[0].text, q.text)
})

test('切换 AI 配置取消旧导学请求，迟到结果不会进入路线预览', async (t) => {
  const response = deferred()
  const h = harness(t, { planPrompt: () => [], requestGuideJson: () => response.promise })
  await tick()
  const generation = h.guide.generate('继续学习', 30)
  assert.equal(h.guide.state.busy, 'plan')
  h.guide.state.settings.model = 'new-model'
  response.resolve(plan())
  assert.equal(await generation, false)
  assert.equal(h.guide.state.pending, null)
  assert.equal(h.guide.state.plan.summary, '保留这条路线')
})

test('增量调整先预览后应用，保留未改课节与依赖，随后可撤销', async (t) => {
  const original = plan()
  original.modules.push({ id: 'git', title: 'Git', description: '版本管理' })
  original.lessons.push({
    path: 'git.mp4',
    moduleId: 'git',
    status: 'required',
    reason: '原选课理由',
    concepts: ['提交'],
    prerequisites: [],
  })
  original.lessons[0].prerequisites = ['git.mp4']
  let input
  const h = harness(t, {
    dbFetchGuide: async () => ({ ...stored(), plan: original }),
    requestGuideJson: async (_settings, messages) => {
      input = messages[0].content
      return {
        summary: '跳过 Git，保留依赖提示。',
        changes: [{ moduleId: 'git', status: 'skipped', reason: '用户要求略过' }],
      }
    },
  })
  h.active.value = {
    id: 'two',
    videos: [
      { path: 'a.mp4', title: '开发', size: 1, modified: 1 },
      { path: 'git.mp4', title: 'Git', size: 1, modified: 1 },
    ],
  }
  await tick()
  assert.equal(await h.guide.generate('删除 Git 学习计划', 30), true)
  assert.match(input, /只输出变更 JSON/)
  assert.equal(h.guide.state.plan.lessons[1].status, 'required')
  assert.equal(h.guide.state.pending.plan.lessons[1].status, 'skipped')
  assert.deepEqual(h.guide.state.pending.plan.lessons[0], original.lessons[0])
  assert.equal(h.guide.pendingPreview.value.removed.length, 1)
  h.guide.applyPending()
  assert.equal(h.guide.state.plan.lessons[1].status, 'skipped')
  assert.equal(h.guide.risks.value.length, 1)
  h.guide.undo()
  assert.equal(h.guide.state.plan.lessons[1].status, 'required')
})

test('调整遇到 HTTP 520 或残缺结果不替换已有路线', async (t) => {
  const h = harness(t, {
    requestGuideJson: async () => {
      throw Error('HTTP 520：网关异常')
    },
  })
  await tick()
  const original = JSON.stringify(h.guide.state.plan)
  assert.equal(await h.guide.generate('调整路线', 30), false)
  assert.match(h.guide.state.error, /HTTP 520/)
  assert.equal(JSON.stringify(h.guide.state.plan), original)
  assert.equal(h.guide.state.pending, null)
  globalThis.guideTestIO.requestGuideJson = async () => ({ changes: [{ ids: ['fake'] }] })
  assert.equal(await h.guide.generate('调整路线', 30), false)
  assert.equal(JSON.stringify(h.guide.state.plan), original)
  assert.equal(h.guide.state.pending, null)
})

test('已重置的今日安排从旧快照和练习范围恢复完成位置，保存重开不再重复', async (t) => {
  const saved = stored(),
    day = localDayKey(),
    previous = localDayKey(new Date(Date.now() - 86400000))
  saved.metadata = { 'a.mp4': { duration: 3600, size: 1, modified: 1 } }
  saved.today = {
    date: day,
    minutes: 30,
    override: null,
    items: [
      {
        id: `${day}:lesson:a.mp4:0`,
        path: 'a.mp4',
        kind: 'lesson',
        start: 0,
        end: 1800,
        seconds: 1800,
        done: false,
        estimated: false,
      },
    ],
  }
  const h = harness(t, {
    dbFetchGuide: async () => saved,
    databaseRequest: async (endpoint) =>
      endpoint === 'day-snapshots'
        ? {
            [previous]: {
              date: previous,
              tasks: [{ id: `${previous}:lesson:a.mp4:0`, kind: 'lesson', title: 'a', done: true }],
            },
          }
        : endpoint === 'practice-scopes'
          ? [`daily:${previous}:comprehensive-v1:[["a.mp4",0,1800]]`]
          : null,
  })
  await tick()
  assert.equal(h.guide.state.today.items[0].start, 1800)
  assert.equal(h.guide.schedule.value.remainingSeconds, 1800)
  h.guide.persist()
  await tick()
  const snapshot = h.saves.at(-1)
  assert.deepEqual(snapshot.today.completedBeforeToday, { 'a.mp4': 1800 })
  h.app.unmount()
  const reopened = harness(t, { dbFetchGuide: async () => snapshot })
  await tick()
  assert.equal(reopened.guide.state.today.items[0].start, 1800)
})

test('历史完成记录读取失败时暂停排课和保存，避免覆盖可恢复记录', async (t) => {
  const h = harness(t, {
    databaseRequest: async (endpoint) => {
      if (endpoint === 'day-snapshots') throw Error('read failed')
      return null
    },
  })
  await tick()
  h.guide.refreshToday()
  h.guide.persist()
  await tick()
  assert.equal(h.guide.guideReady.value, false)
  assert.equal(h.saves.length, 0)
})

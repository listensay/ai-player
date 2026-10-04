import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, reactive, ref } from 'vue'

const boundaries = {
  '~/utils/guideAi': ['requestGuideJson'],
  '~/utils/guideMedia': ['loadLessonSubtitles'],
  '~/utils/dbClient': ['dbFetchPractice', 'dbSavePractice', 'dbFetchNote'],
  '~/utils/database': ['databaseRequest'],
  '~/composables/useTranscripts': ['useTranscripts'],
}
registerHooks({
  resolve(specifier, context, next) {
    if (boundaries[specifier]) {
      const source = boundaries[specifier]
        .map((name) => `export const ${name} = (...args) => globalThis.knowledgeIO.${name}(...args)`)
        .join('\n')
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useLessonKnowledge } = await import('../app/composables/useLessonKnowledge.ts')
const { useDailyPractice } = await import('../app/composables/useDailyPractice.ts')
const {
  materialBatches,
  transcriptSources,
  validateSummaryPoints,
  dailyPlanComplete,
  dailyPlanSignature,
  validateWholeSummary,
  restoreSummary,
} = await import('../app/utils/knowledge.ts')
const { crossedSegmentEnd } = await import('../app/utils/segmentReminder.ts')
const { useLessonPractice } = await import('../app/composables/useLessonPractice.ts')
const { practicePrompt, validateDailyPracticeQuestion, restorePractice } = await import('../app/utils/practice.ts')
const { calculateDay, nextStudyDay } = await import('../app/utils/dailyPlan.ts')
const { restoreFeedback } = await import('../app/utils/learningFeedback.ts')
const { emptyStudyRecords } = await import('../app/utils/studyProgram.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const cue = (id, start, end) => ({
  id,
  start,
  end,
  text: '列表通过索引访问元素，第一个元素索引为零，索引越界会报错；切片可以获取列表中一段元素。'.repeat(3),
})
const videos = ['a.mp4', 'b.mp4'].map((path) => ({
  path,
  title: path,
  parent: {
    getFileHandle: async () => {
      throw new Error('none')
    },
  },
}))
const today = (date = '2026-09-25') => ({
  date,
  minutes: 1,
  override: null,
  items: videos.map((v) => ({
    id: v.path,
    kind: 'lesson',
    path: v.path,
    start: 0,
    end: 30,
    seconds: 30,
    estimated: false,
    done: true,
  })),
})
function continuationContext(today) {
  return {
    today,
    plan: {
      dailyMinutes: 1,
      modules: [{ id: 'm' }],
      lessons: videos.map((v) => ({
        path: v.path,
        moduleId: 'm',
        status: 'required',
        concepts: [],
        prerequisites: [],
      })),
    },
    metadata: Object.fromEntries(videos.map((v) => [v.path, { duration: 60 }])),
    progress: {},
    includeOptional: false,
    mastery: {},
    questions: [],
    records: emptyStudyRecords(),
  }
}
const question = (id, sourceId) => ({
  kind: 'single-choice',
  prompt: `练习 ${id}：列表第一个元素的索引是什么？`,
  concepts: ['列表索引'],
  criteria: ['选择一个答案'],
  referenceAnswer: '索引为零。',
  sourceIds: [sourceId],
  knowledge: { category: 'concept', level: 'awareness', reason: '辨认索引即可。' },
  options: [
    { id: 'A', text: '0' },
    { id: 'B', text: '1' },
  ],
  correctOptionIds: ['A'],
})
const comprehensive = (sources) => ({
  kind: 'task',
  prompt: '整理一份学习清单：\n1. 用列表保存条目并读取首项。\n2. 用切片提取需要复习的部分，说明如何避免越界。',
  concepts: ['列表索引', '切片与边界'],
  criteria: ['完成清单读取与筛选', '说明边界条件'],
  referenceAnswer: '使用索引零读取首项，使用切片读取一段元素；先判断列表是否为空。',
  sourceIds: sources.map((s) => s.id),
  knowledge: { category: 'application', level: 'proficiency', reason: '综合运用列表访问与切片完成学习清单。' },
})
function harness(t, overrides = {}, cacheLimits) {
  const database = new Map(),
    requests = [],
    saves = [],
    cues = new Map(videos.map((v) => [v.path, [cue(1, 0, 10), cue(2, 10, 20), cue(3, 20, 30)]]))
  let sequence = 0
  globalThis.knowledgeIO = {
    databaseRequest: async (endpoint, options = {}) => {
      if (endpoint === 'ai-batch-cache') {
        const checkpoint = database.get(options.body?.key)
        if (checkpoint) checkpoint.completedAt = Date.now()
        return { success: true }
      }
      if (options.method === 'POST') {
        saves.push(options.body)
        database.set(options.body.key, structuredClone(options.body.value))
        return true
      }
      return structuredClone(database.get(options.query.key) ?? null)
    },
    dbFetchNote: async () => ({ content: '', updatedAt: null }),
    dbFetchPractice: async () => ({}),
    dbSavePractice: async () => true,
    loadLessonSubtitles: async () => [],
    useTranscripts: () => ({
      load: async () => {},
      prepare: async (_, video) => cues.get(video.path),
      get: (_, path) => ({ status: 'ready', segments: cues.get(path) }),
      cancel() {},
    }),
    requestGuideJson: async (_, messages) => {
      requests.push(messages)
      const prompt = messages[0].content
      const data = JSON.parse(prompt.slice(prompt.lastIndexOf('输入数据：') + 5))
      if (prompt.startsWith('依据逐字稿'))
        return {
          points: data.sources.map((s) => ({
            title: `知识点 ${s.id}`,
            text: s.text.slice(0, 1500),
            sourceIds: [s.id],
          })),
        }
      if (prompt.startsWith('综合教学材料'))
        return {
          overview: '本课围绕列表的索引与切片，说明读取元素的方法和边界条件。',
          points: [
            {
              title: '索引与切片的联系',
              text: data.sources
                .map((s) => s.text)
                .join('\n')
                .slice(0, 1000),
              sourceIds: data.sources.map((s) => s.id),
            },
          ],
        }
      if (prompt.startsWith('为一道'))
        return {
          points: [
            { text: data.sources.map((s) => s.text.slice(0, 30)).join('\n'), sourceIds: data.sources.map((s) => s.id) },
          ],
        }
      if (prompt.includes('生成 1 道「今日巩固」综合练习大题')) return comprehensive(data.sources)
      if (prompt.startsWith('请按功能'))
        return {
          result: 'solid',
          strengths: ['完成了清单功能。'],
          gaps: [],
          nextStep: '增加更多使用场景。',
          sourceIds: data.sources.map((s) => s.id),
          grade: {
            items: data.rubric.map((item) => ({
              criterionIndex: item.criterionIndex,
              score: item.points,
              status: 'implemented',
              evidence: '代码实现了要求的操作。',
              improvement: '无需补充。',
            })),
          },
        }
      if (prompt.startsWith('请给'))
        return {
          result: 'solid',
          strengths: ['完成了清单读取与切片筛选。'],
          gaps: [],
          nextStep: '用空列表检查边界条件。',
          sourceIds: data.sources.map((s) => s.id),
        }
      const count = Number(prompt.match(/生成 (\d+) 道/)?.[1] ?? 1)
      const qs = Array.from({ length: count }, (_, i) => question(++sequence, data.sources[i % data.sources.length].id))
      return count === 1 ? qs[0] : { questions: qs }
    },
    ...overrides,
  }
  const course = ref({ id: 'course', videos }),
    settings = reactive({ baseUrl: 'https://example.test/v1', model: 'test', apiKey: '' }),
    configured = ref(true)
  const plan = ref(today()),
    date = ref('2026-09-25'),
    activePlayback = ref(null)
  let knowledge, daily, practice
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      knowledge = useLessonKnowledge(course, settings, configured, cacheLimits)
      daily = useDailyPractice(course, plan, date, settings, configured, knowledge, activePlayback)
      practice = useLessonPractice(course, settings, configured, {
        sources: (video) => knowledge.sourcesFor(course.value.id, video),
      })
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return {
    knowledge,
    daily,
    practice,
    course,
    settings,
    configured,
    plan,
    date,
    activePlayback,
    database,
    requests,
    saves,
    cues,
    io: globalThis.knowledgeIO,
  }
}

test('长逐字稿完整分批，每个原始字符都进入材料且没有超限', () => {
  const sources = transcriptSources([{ ...cue(1, 0, 30), text: '字'.repeat(35001) }])
  const batches = materialBatches(sources)
  assert.equal(batches.length, 3)
  assert.equal(
    batches
      .flat()
      .map((s) => s.text)
      .join('').length,
    35001,
  )
  assert.ok(batches.every((b) => b.length <= 100 && b.reduce((n, s) => n + s.text.length, 0) <= 12000))
})

test('知识点的时间点仅从真实引用计算，拒绝不存在的字幕', () => {
  const sources = transcriptSources([cue(1, 5, 10)])
  const points = validateSummaryPoints(
    { points: [{ title: '索引', text: '从零开始。', start: 999, sourceIds: ['s1'] }] },
    sources,
  )
  assert.equal(points[0].start, 5)
  assert.throws(() =>
    validateSummaryPoints({ points: [{ title: '索引', text: '从零开始。', sourceIds: ['fake'] }] }, sources),
  )
})

test('每日完成条件排除空计划、仅疑问、未完成视频和过期计划', () => {
  const plan = today()
  assert.equal(dailyPlanComplete(plan, plan.date), true)
  plan.items.push({ ...plan.items[0], kind: 'question', done: false })
  assert.equal(dailyPlanComplete(plan, plan.date), true)
  plan.items[0].done = false
  assert.equal(dailyPlanComplete(plan, plan.date), false)
  assert.equal(dailyPlanComplete({ ...plan, items: [] }, plan.date), false)
  assert.equal(dailyPlanComplete({ ...plan, items: [plan.items[2]] }, plan.date), false)
  assert.equal(dailyPlanComplete(today(), '2026-09-26'), false)
  const signature = dailyPlanSignature(plan, plan.date)
  plan.items[0].done = true
  assert.equal(dailyPlanSignature(plan, plan.date), signature)
  plan.items[0].end = 60
  assert.notEqual(dailyPlanSignature(plan, plan.date), signature)
})

test('跳转到终点不触发完成，连续播放和自然结束可以触发', () => {
  const previous = { seconds: 29, at: 1000, playing: true, seeking: false, rate: 1 }
  const current = { seconds: 30, at: 2000, playing: false, seeking: false, ended: true, rate: 1 }
  assert.equal(crossedSegmentEnd(previous, current, 30), true)
  assert.equal(crossedSegmentEnd(previous, { ...current, seeking: true }, 30), false)
  assert.equal(crossedSegmentEnd({ ...previous, seconds: 1 }, current, 30), false)
})

test('相同逐字稿复用总结，字幕内容变化后重新生成', async (t) => {
  const h = harness(t)
  const first = await h.knowledge.ensure('course', videos[0])
  await h.knowledge.ensure('course', videos[0])
  assert.equal(h.requests.length, 2)
  h.cues.get('a.mp4')[0].text += '新增知识。'
  const next = await h.knowledge.ensure('course', videos[0])
  assert.equal(h.requests.length, 4)
  assert.notEqual(first.fingerprint, next.fingerprint)
})

test('同时请求同一课节仅执行一组提炼与整课合并', async (t) => {
  const h = harness(t)
  await Promise.all([h.knowledge.ensure('course', videos[0]), h.knowledge.ensure('course', videos[0])])
  assert.equal(h.requests.length, 2)
})

test('按今日片段重新整理，出题材料不包含未来内容', async (t) => {
  const h = harness(t)
  const sources = await h.knowledge.sourcesFor('course', videos[0], [{ start: 0, end: 20 }])
  assert.equal(sources.length, 1)
  assert.ok(sources.every((s) => s.start >= 0 && s.end <= 20 && s.path === 'a.mp4'))
  assert.equal(h.requests.length, 2)
})

for (const [field, value] of [
  ['model', 'new-model'],
  ['provider', 'anthropic'],
  ['contextWindow', '1m'],
])
  test(`AI ${field} 切换取消旧总结，迟到响应不会覆盖新结果`, async (t) => {
    const pending = deferred(),
      h = harness(t)
    const normal = h.io.requestGuideJson
    h.io.requestGuideJson = () => pending.promise
    const old = h.knowledge.ensure('course', videos[0]).catch((e) => e)
    await tick()
    h.settings[field] = value
    h.io.requestGuideJson = normal
    const fresh = await h.knowledge.ensure('course', videos[0])
    pending.resolve({ points: [{ title: '旧结果', text: '旧内容', sourceIds: ['s1'] }] })
    await old
    assert.equal(h.knowledge.get('course', 'a.mp4').status, 'ready')
    assert.deepEqual(h.knowledge.get('course', 'a.mp4').summary.points, fresh.points)
  })

test('总结读取失败时不调用 AI 或覆盖存储', async (t) => {
  const h = harness(t)
  h.io.databaseRequest = async () => {
    throw new Error('read failed')
  }
  await assert.rejects(h.knowledge.ensure('course', videos[0]), /read failed/)
  assert.equal(h.requests.length, 0)
  assert.equal(h.saves.length, 0)
})

test('今日巩固汇总所有计划课节，只生成一道综合题并保存作答、稍后继续', async (t) => {
  const h = harness(t)
  await tick()
  assert.equal(h.daily.shouldPrompt.value, true)
  await h.daily.open()
  assert.equal(h.daily.practice.history.value.length, 1)
  assert.equal(h.daily.practice.state.questionCount, 1)
  assert.equal(h.daily.practice.current.value.question.kind, 'task')
  assert.equal(h.daily.shouldPrompt.value, false)
  assert.deepEqual([...new Set(h.daily.practice.sources.value.map((s) => s.path))], ['a.mp4', 'b.mp4'])
  h.daily.practice.updateDraft('先检查清单不为空，再用索引零读取首项，用切片筛选待复习条目。')
  await h.daily.practice.review()
  assert.equal(h.daily.answered.value, 1)
  h.daily.practice.close()
  await h.daily.open()
  assert.equal(h.daily.practice.history.value.length, 1)
  assert.match(h.daily.practice.current.value.draft, /清单不为空/)
  await tick()
  assert.ok(h.database.get('daily-practice:course'))
  await h.daily.flush()
  const originalCourse = h.course.value
  h.course.value = null
  await tick()
  h.course.value = originalCourse
  await tick()
  assert.equal(h.daily.shouldPrompt.value, false)
  const requestsBefore = h.requests.length
  await h.daily.open()
  assert.equal(h.daily.practice.history.value.length, 1)
  assert.match(h.daily.practice.current.value.draft, /清单不为空/)
  assert.equal(h.requests.length, requestsBefore)
})

test('4 小时计划在第 19 节的 2:07 处完成时，各倍速都等待 8:54 的视频结束才自动巩固', async (t) => {
  const h = harness(t)
  h.activePlayback.value = 'course:b.mp4'
  await tick()
  const context = continuationContext(null)
  context.plan.dailyMinutes = 240
  context.plan.lessons = Array.from({ length: 19 }, (_, i) => ({
    ...context.plan.lessons[0],
    path: i === 18 ? 'b.mp4' : `lesson-${i}.mp4`,
  }))
  context.metadata = Object.fromEntries(
    context.plan.lessons.map((lesson, i) => [
      lesson.path,
      { duration: i === 18 ? 534.067 : (240 * 60 - 127.81241109265284) / 18 },
    ]),
  )
  context.today = calculateDay(context, h.date.value).today
  for (const item of context.today.items.slice(0, -1)) {
    context.progress[item.path] = { time: item.end, duration: item.end, ratio: 1, done: true, updatedAt: 1 }
  }
  const end = context.today.items.at(-1).end
  assert.ok(Math.abs(end - 127.81241109265284) < 0.001)
  const signature = dailyPlanSignature(context.today, h.date.value)
  for (const rate of [1, 1.25, 2]) {
    const sample = {
      seconds: 127.9,
      duration: 534.067,
      rate,
      at: 127900 / rate,
      playing: true,
      seeking: false,
      ended: false,
    }
    context.progress['b.mp4'] = {
      time: sample.seconds,
      duration: sample.duration,
      ratio: sample.seconds / sample.duration,
      done: false,
      updatedAt: 2,
    }
    h.daily.sample(sample)
    h.plan.value = calculateDay(context, h.date.value).today
    assert.equal(h.plan.value.items.length, 19)
    assert.ok(h.plan.value.items.every((item) => item.done))
    assert.equal(h.daily.complete.value, true)
    assert.equal(h.daily.shouldPrompt.value, false)
    assert.equal(h.daily.practice.state.open, false)
    assert.equal(h.daily.state.prompted, false)
    assert.equal(context.progress['b.mp4'].done, false)
    h.daily.sample({ ...sample, seconds: sample.duration * 0.96 })
    assert.equal(h.daily.shouldPrompt.value, false)
    h.daily.sample({ ...sample, seconds: sample.duration, playing: false, ended: true })
    assert.equal(h.daily.shouldPrompt.value, true)
    assert.equal(dailyPlanSignature(h.plan.value, h.date.value), signature)
  }
  assert.equal(h.requests.length, 0)
})

test('片段完成后，加载、暂停、缓冲和拖动都不自动巩固，重播及切课立即清除结束状态', async (t) => {
  const h = harness(t)
  h.activePlayback.value = 'course:b.mp4'
  await tick()
  assert.equal(h.daily.shouldPrompt.value, false)
  const sample = { seconds: 40, duration: 120, rate: 1.25, at: 40000, playing: false, seeking: false, ended: false }
  for (const event of [
    sample,
    { ...sample, playing: true },
    { ...sample, seeking: true },
    { ...sample, seconds: 120 },
  ]) {
    h.daily.sample(event)
    assert.equal(h.daily.shouldPrompt.value, false)
  }
  h.daily.sample({ ...sample, seconds: 120, ended: true })
  assert.equal(h.daily.shouldPrompt.value, true)
  h.daily.sample({ ...sample, seconds: 0, seeking: true })
  assert.equal(h.daily.shouldPrompt.value, false)
  h.daily.sample({ ...sample, seconds: 120, ended: true })
  h.activePlayback.value = 'course:a.mp4'
  assert.equal(h.daily.shouldPrompt.value, false)
  h.daily.sample({ ...sample, seconds: 120, ended: true })
  h.activePlayback.value = 'other-course:a.mp4'
  assert.equal(h.daily.shouldPrompt.value, false)
  h.activePlayback.value = null
  assert.equal(h.daily.shouldPrompt.value, true)
  h.activePlayback.value = 'course:b.mp4'
  assert.equal(h.daily.shouldPrompt.value, false)
})

test('等待视频结束期间仍可手动巩固，关闭后或继续播放不会重复自动提醒', async (t) => {
  const h = harness(t)
  h.activePlayback.value = 'course:b.mp4'
  await tick()
  assert.equal(h.daily.complete.value, true)
  assert.equal(h.daily.shouldPrompt.value, false)
  await h.daily.open()
  assert.equal(h.daily.practice.state.open, true)
  assert.equal(h.daily.practice.history.value.length, 1)
  h.daily.practice.close()
  h.daily.sample({ seconds: 120, duration: 120, rate: 1.25, at: 96000, playing: false, seeking: false, ended: true })
  assert.equal(h.daily.shouldPrompt.value, false)
  h.activePlayback.value = null
  assert.equal(h.daily.shouldPrompt.value, false)
  assert.equal(h.daily.practice.state.open, false)
})

test('追加次日课程未学完时今日巩固仍可开始，材料只包含原计划片段', async (t) => {
  const h = harness(t)
  await tick()
  const signature = dailyPlanSignature(h.plan.value, h.date.value)
  h.plan.value = nextStudyDay(continuationContext(h.plan.value), h.date.value).today
  await tick()
  assert.ok(h.plan.value.items.some((item) => !item.done))
  assert.equal(h.daily.complete.value, true)
  assert.equal(h.daily.shouldPrompt.value, true)
  assert.equal(dailyPlanSignature(h.plan.value, h.date.value), signature)
  await h.daily.open()
  assert.equal(h.daily.practice.history.value.length, 1)
  assert.deepEqual(
    h.daily.items.value.map((item) => [item.path, item.start, item.end]),
    [
      ['a.mp4', 0, 30],
      ['b.mp4', 0, 30],
    ],
  )
  assert.ok(h.daily.practice.sources.value.every((source) => source.end <= 30))
})

test('已生成的巩固作业追加课程后不关闭、不丢失草稿，刷新和重新进入仍复用原题', async (t) => {
  const h = harness(t)
  await h.daily.open()
  h.daily.practice.updateDraft('原计划的综合作业草稿')
  const recordId = h.daily.practice.current.value.id,
    requests = h.requests.length
  h.plan.value = nextStudyDay(continuationContext(h.plan.value), h.date.value).today
  await tick()
  assert.equal(h.daily.practice.state.open, true)
  assert.equal(h.daily.records.value[0].id, recordId)
  h.daily.practice.close()
  h.plan.value.items.at(-1).done = true
  h.plan.value = calculateDay(continuationContext(h.plan.value), h.date.value).today
  h.plan.value = restoreFeedback(
    JSON.parse(JSON.stringify({ today: h.plan.value })),
    videos.map((v) => v.path),
  ).today
  await h.daily.flush()
  const original = h.course.value
  h.course.value = null
  await tick()
  h.course.value = original
  await tick()
  assert.equal(h.daily.complete.value, true)
  await h.daily.open()
  assert.equal(h.daily.practice.current.value.id, recordId)
  assert.equal(h.daily.practice.current.value.draft, '原计划的综合作业草稿')
  assert.equal(h.requests.length, requests)
})

test('旧版追加记录也能使用原计划巩固，额外课程全部完成不改变原题', async (t) => {
  const h = harness(t)
  await h.daily.open()
  const recordId = h.daily.practice.current.value.id
  const extra = h.plan.value.items.map((item) => ({ ...item, id: `extra:${item.id}`, start: 30, end: 60, done: false }))
  h.plan.value = {
    ...h.plan.value,
    extraDays: [{ date: '2026-09-26', minutes: 1 }],
    items: [...h.plan.value.items, ...extra],
  }
  await tick()
  assert.equal(h.daily.complete.value, true)
  assert.equal(h.daily.records.value[0].id, recordId)
  h.plan.value.items.forEach((item) => {
    item.done = true
  })
  await tick()
  assert.equal(h.daily.records.value[0].id, recordId)
  assert.equal(h.daily.items.value.length, 2)
})

const dailySources = () =>
  Array.from({ length: 15 }, (_, i) => ({
    id: `s${i + 1}`,
    kind: 'summary',
    path: i < 8 ? 'a.mp4' : 'b.mp4',
    start: 0,
    end: 30,
    text: `主题-${i}：${'索引和切片。'.repeat(200)}`,
  }))

test('今日长材料先完整汇总再统一出一道题，不能用每组题数或追加入口绕过', async (t) => {
  const h = harness(t),
    sources = dailySources()
  await h.daily.practice.openSources('daily:2026-09-25:long', '今日全部课节', async () => sources)
  h.daily.practice.state.questionCount = 8
  await h.daily.practice.generate(8)
  assert.equal(h.daily.practice.state.error, '')
  assert.equal(h.daily.practice.history.value.length, 1)
  const materialRequests = h.requests.filter((m) => m[0].content.startsWith('为一道'))
  const input = (messages) => JSON.parse(messages[0].content.split('输入数据：')[1])
  assert.equal(materialRequests.length, 2)
  assert.deepEqual(
    materialRequests.flatMap((m) => input(m).sources.map((s) => s.id)),
    sources.map((s) => s.id),
  )
  const generated = h.requests.filter((m) => m[0].content.includes('生成 1 道「今日巩固」综合练习大题'))
  assert.equal(generated.length, 1)
  assert.match(
    input(generated[0])
      .sources.map((s) => s.text)
      .join('\n'),
    /主题-0/,
  )
  assert.match(
    input(generated[0])
      .sources.map((s) => s.text)
      .join('\n'),
    /主题-14/,
  )
  const record = h.daily.practice.current.value
  assert.equal(restorePractice([JSON.parse(JSON.stringify(record))], [record.path], 1000, ['a.mp4', 'b.mp4']).length, 1)
  const calls = h.requests.length
  await h.daily.practice.generate()
  await h.daily.practice.generate(5)
  assert.equal(h.daily.practice.history.value.length, 1)
  assert.equal(h.requests.length, calls)
})

test('今日汇总后续批次失败时不保存半道题，重试复用已完成汇总', async (t) => {
  const h = harness(t),
    normal = h.io.requestGuideJson,
    sources = dailySources()
  let summaries = 0
  h.io.requestGuideJson = async (...args) => {
    if (args[1][0].content.startsWith('为一道') && ++summaries === 2) throw Error('汇总断网')
    return normal(...args)
  }
  await h.daily.practice.openSources('daily:2026-09-25:retry', '今日全部课节', async () => sources)
  await h.daily.practice.generate()
  assert.match(h.daily.practice.state.error, /断网/)
  assert.equal(h.daily.practice.history.value.length, 0)
  await h.daily.practice.generate()
  assert.equal(summaries, 3)
  assert.equal(h.daily.practice.history.value.length, 1)
})

test('今日材料需要多层汇总时，每次请求有界，最终综合题仍包含首尾知识', async (t) => {
  const h = harness(t),
    normal = h.io.requestGuideJson
  const sources = Array.from({ length: 70 }, (_, i) => ({
    ...dailySources()[0],
    id: `s${i}`,
    text: `主题-${i}：`.padEnd(1200, '学'),
  }))
  const summaryLevels = new Set()
  h.io.requestGuideJson = async (...args) => {
    const prompt = args[1][0].content,
      input = JSON.parse(prompt.split('输入数据：')[1])
    assert.ok(input.sources.length <= 100)
    assert.ok(input.sources.reduce((sum, s) => sum + s.text.length, 0) <= 12000)
    if (prompt.startsWith('为一道')) {
      summaryLevels.add(input.sources[0].id.startsWith('d') ? 'merged' : 'original')
      const topics = [...new Set(input.sources.flatMap((s) => s.text.match(/主题-\d+/g) ?? []))].join('、')
      return {
        points: Array.from({ length: 3 }, () => ({
          text: topics.padEnd(1190, '学'),
          sourceIds: input.sources.map((s) => s.id),
        })),
      }
    }
    assert.match(input.sources.map((s) => s.text).join(''), /主题-0/)
    assert.match(input.sources.map((s) => s.text).join(''), /主题-69/)
    return normal(...args)
  }
  await h.daily.practice.openSources('daily:2026-09-25:multi-level', '今日全部知识', async () => sources)
  await h.daily.practice.generate()
  assert.equal(h.daily.practice.state.error, '')
  assert.equal(summaryLevels.size, 2)
  assert.equal(h.daily.practice.history.value.length, 1)
})

test('今日汇总漏掉材料时拒绝继续出题，取消后迟到的结果不保存', async (t) => {
  const h = harness(t),
    sources = dailySources()
  h.io.requestGuideJson = async () => ({ points: [{ text: '只整理第一课。', sourceIds: ['s1'] }] })
  await h.daily.practice.openSources('daily:2026-09-25:invalid', '今日全部课节', async () => sources)
  await h.daily.practice.generate()
  assert.match(h.daily.practice.state.error, /遗漏/)
  assert.equal(h.daily.practice.history.value.length, 0)
  const pending = deferred()
  h.io.requestGuideJson = () => pending.promise
  const generating = h.daily.practice.generate()
  await tick()
  h.daily.practice.cancel()
  pending.resolve({ points: [{ text: '迟到的结果。', sourceIds: sources.map((s) => s.id) }] })
  await generating
  assert.equal(h.daily.practice.history.value.length, 0)
})

test('今日综合题校验拒绝小题、多题和遗漏材料，课后练习提示仍保留原规则', () => {
  const sources = dailySources().slice(0, 2)
  const valid = comprehensive(sources)
  assert.equal(validateDailyPracticeQuestion(valid, sources).kind, 'task')
  assert.throws(() => validateDailyPracticeQuestion(question('choice', 's1'), sources), /综合/)
  assert.throws(() => validateDailyPracticeQuestion({ questions: [valid, valid] }, sources), /一道/)
  assert.throws(() => validateDailyPracticeQuestion({ ...valid, sourceIds: ['s1'] }, sources), /覆盖全部/)
  const daily = practicePrompt('今天', sources, null, [], 8, true)[0].content
  assert.match(daily, /生成 1 道/)
  assert.doesNotMatch(daily, /每题 2–5 分钟|每道题聚焦一个主题|多题分散/)
  assert.match(practicePrompt('课后', sources, null, [], 3)[0].content, /生成 3 道「课后练习」/)
})

test('新的单题安排不沿用旧五题，旧题和作答仍保存在原位置', async (t) => {
  const h = harness(t)
  await h.daily.open()
  await h.daily.flush()
  const current = h.daily.practice.current.value
  const oldPath = `daily:${h.date.value}:${dailyPlanSignature(h.plan.value, h.date.value)}`
  const oldRecords = Array.from({ length: 5 }, (_, i) => ({
    ...JSON.parse(JSON.stringify(current)),
    id: `legacy-${i}`,
    path: oldPath,
    draft: '保留旧版作答',
  }))
  const originalCourse = h.course.value
  h.course.value = null
  await tick()
  h.database.set('daily-practice:course', { [oldPath]: oldRecords })
  h.course.value = originalCourse
  await tick()
  assert.equal(h.daily.records.value.length, 0)
  await h.daily.open()
  await h.daily.flush()
  assert.equal(h.daily.records.value.length, 1)
  assert.deepEqual(h.database.get('daily-practice:course')[oldPath], oldRecords)
})

test('旧版仅有文字反馈的综合作业，可不改答案直接补评功能分数', async (t) => {
  const h = harness(t)
  await h.daily.open()
  h.daily.practice.updateDraft('用索引读取首项，用切片获取复习清单，空列表返回空结果。')
  await h.daily.practice.review()
  delete h.daily.practice.current.value.attempts[0].feedback.grade
  assert.equal(h.daily.practice.canReview.value, true)
  await h.daily.practice.review()
  assert.equal(h.daily.practice.current.value.attempts.at(-1).feedback.grade.score, 100)
  assert.equal(h.daily.practice.canReview.value, false)
})

test('练习一组多题原子保存，任一题无效都保留已有记录', async (t) => {
  const h = harness(t)
  await h.practice.open(videos[0], null, '')
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 3)
  const selected = h.practice.current.value.id
  h.io.requestGuideJson = async () => ({
    questions: [question('new', 'k1'), question('invalid', 'fake'), question('new2', 'k2')],
  })
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 3)
  assert.equal(h.practice.current.value.id, selected)
  assert.match(h.practice.state.error, /不存在/)
})

test('每日练习切换日期后关闭旧题，旧完成状态不会满足新日期', async (t) => {
  const h = harness(t)
  await h.daily.open()
  h.date.value = '2026-09-26'
  await tick()
  assert.equal(h.daily.complete.value, false)
  assert.equal(h.daily.practice.state.open, false)
  assert.equal(h.daily.records.value.length, 0)
})

test('长材料整组练习覆盖所有批次，继续单题只新增一道', async (t) => {
  const h = harness(t)
  const sources = Array.from({ length: 15 }, (_, i) => ({
    id: `s${i + 1}`,
    kind: 'summary',
    path: 'a.mp4',
    start: i,
    end: i + 1,
    text: `知识点${i}：${'索引和切片。'.repeat(200)}`,
  }))
  await h.practice.openSources('a.mp4', '长课节', async () => sources)
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 6)
  assert.deepEqual(
    new Set(h.practice.history.value.flatMap((r) => r.sources.map((s) => s.id))),
    new Set(sources.map((s) => s.id)),
  )
  await h.practice.generate()
  assert.equal(h.practice.history.value.length, 7)
})

test('知识点后续批次失败保留已完成进度，继续与重新整理分别复用和重做', async (t) => {
  const h = harness(t)
  h.cues.set('a.mp4', [{ ...cue(1, 0, 60), text: '知识'.repeat(16000) }])
  const request = h.io.requestGuideJson
  let attempted = 0
  h.io.requestGuideJson = async (...args) => {
    if (++attempted === 2) throw Error('暂时断网')
    const result = await request(...args)
    result.points.forEach((point) => {
      point.text = point.text.slice(0, 1000)
    })
    return result
  }
  await assert.rejects(h.knowledge.ensure('course', videos[0]), /断网/)
  assert.equal(h.knowledge.get('course', 'a.mp4').summary, null)
  await h.knowledge.ensure('course', videos[0])
  assert.equal(attempted, 7) // three extraction batches, three merge requests, one failed request
  assert.equal(h.knowledge.get('course', 'a.mp4').summary.points.length, 1)
  await h.knowledge.ensure('course', videos[0], undefined, true)
  assert.equal(attempted, 13)
})

test('知识点最终保存失败后直接重存，不重新调用 AI', async (t) => {
  const h = harness(t),
    request = h.io.databaseRequest
  let fail = true
  h.io.databaseRequest = async (collection, options) => {
    if (fail && options.method === 'POST' && options.body.key.startsWith('lesson-knowledge:')) throw Error('写盘失败')
    return request(collection, options)
  }
  const summary = await h.knowledge.ensure('course', videos[0])
  assert.ok(summary.points.length)
  assert.match(h.knowledge.get('course', 'a.mp4').storageError, /保存失败/)
  assert.ok(
    [...h.database.entries()]
      .filter(([key]) => key.startsWith('ai-batches:'))
      .every(([, value]) => value.completedAt === undefined),
  )
  fail = false
  await h.knowledge.retrySave('course', 'a.mp4')
  assert.equal(h.requests.length, 2)
  assert.equal(h.knowledge.get('course', 'a.mp4').storageError, '')
  assert.ok(
    [...h.database.entries()]
      .filter(([key]) => key.startsWith('ai-batches:'))
      .every(([, value]) => typeof value.completedAt === 'number'),
  )
})

test('分批出题后续失败时不保存半组题，继续后整组合并且不重出第一批', async (t) => {
  const h = harness(t),
    request = h.io.requestGuideJson
  const sources = Array.from({ length: 15 }, (_, i) => ({
    id: `s${i + 1}`,
    kind: 'summary',
    text: '索引和切片。'.repeat(200),
  }))
  await h.practice.openSources('a.mp4', '分批续跑', async () => sources)
  let attempted = 0
  h.io.requestGuideJson = async (...args) => {
    if (++attempted === 2) throw Error('断网')
    return request(...args)
  }
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 0)
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 6)
  assert.equal(attempted, 3)
})

test('整课合并必须覆盖所有上游材料，拒绝漏项、伪造引用和重复主题', () => {
  const sources = transcriptSources([cue(1, 0, 10), cue(2, 50, 60)])
  const valid = {
    overview: '索引与切片共同说明列表的读取方式。',
    points: [{ title: '列表访问', text: '先理解位置索引，再用切片获取多个元素。', sourceIds: ['s1', 's2'] }],
  }
  const result = validateWholeSummary(valid, sources)
  assert.equal(result.points.length, 1)
  assert.equal(result.points[0].start, 0)
  assert.equal(result.points[0].end, 60)
  assert.throws(
    () => validateWholeSummary({ ...valid, points: [{ ...valid.points[0], sourceIds: ['s1'] }] }, sources),
    /遗漏/,
  )
  assert.throws(
    () => validateWholeSummary({ ...valid, points: [{ ...valid.points[0], sourceIds: ['fake'] }] }, sources),
    /引用无效/,
  )
  assert.throws(
    () => validateWholeSummary({ ...valid, points: [valid.points[0], valid.points[0]] }, sources),
    /重复主题/,
  )
  assert.throws(() => validateWholeSummary({ ...valid, overview: '' }, sources), /概览/)
})

test('长课的开头与结尾都进入整课合并，最终按主题生成而非拼接片段', async (t) => {
  const h = harness(t),
    normal = h.io.requestGuideJson
  h.cues.set('a.mp4', [
    { ...cue(1, 0, 30), text: '索引主题。'.repeat(2500) },
    { ...cue(2, 30, 60), text: '切片主题。'.repeat(2500) },
    { ...cue(3, 60, 90), text: '边界主题。'.repeat(2500) },
  ])
  const extracted = [],
    mergedInputs = []
  h.io.requestGuideJson = async (settings, messages) => {
    const prompt = messages[0].content
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf('输入数据：') + 5))
    if (prompt.startsWith('依据逐字稿')) {
      extracted.push(...input.sources)
      return {
        points: input.sources.map((source) => ({
          title: source.text.slice(0, 4),
          text: source.text.slice(0, 10),
          sourceIds: [source.id],
        })),
      }
    }
    mergedInputs.push(...input.sources)
    return normal(settings, messages)
  }
  const summary = await h.knowledge.ensure('course', videos[0])
  assert.equal(
    extracted.map((s) => s.text).join(''),
    h.cues
      .get('a.mp4')
      .map((c) => c.text)
      .join(''),
  )
  assert.ok(mergedInputs.some((s) => s.text.includes('索引')))
  assert.ok(mergedInputs.some((s) => s.text.includes('边界')))
  assert.equal(summary.version, 2)
  assert.ok(summary.overview)
  assert.equal(summary.points.length, 1)
})

test('多层整课合并始终限制单批材料，避免把长课后半部分截掉', async (t) => {
  const h = harness(t),
    normal = h.io.requestGuideJson
  h.cues.set('a.mp4', [{ ...cue(1, 0, 600), text: '课程'.repeat(48000) }])
  const mergeSizes = []
  h.io.requestGuideJson = async (settings, messages) => {
    const prompt = messages[0].content
    if (prompt.startsWith('综合教学材料')) {
      const input = JSON.parse(prompt.slice(prompt.lastIndexOf('输入数据：') + 5))
      mergeSizes.push(input.sources.reduce((n, s) => n + s.text.length, 0))
      assert.ok(input.sources.length <= 100)
    }
    return normal(settings, messages)
  }
  const summary = await h.knowledge.ensure('course', videos[0])
  assert.ok(mergeSizes.length > 2)
  assert.ok(mergeSizes.every((size) => size <= 12000))
  assert.equal(summary.points.at(-1).end, 600)
  assert.ok(summary.overview)
})

test('整课合并失败后续跑复用已提炼材料，不发布未完成的片段总结', async (t) => {
  const h = harness(t),
    normal = h.io.requestGuideJson
  let extracts = 0,
    merges = 0
  h.io.requestGuideJson = async (settings, messages) => {
    if (messages[0].content.startsWith('依据逐字稿')) extracts++
    else if (++merges === 1) throw Error('合并断网')
    return normal(settings, messages)
  }
  await assert.rejects(h.knowledge.ensure('course', videos[0]), /合并断网/)
  assert.equal(h.knowledge.get('course', 'a.mp4').summary, null)
  assert.ok(!h.saves.some((s) => s.key.startsWith('lesson-knowledge:')))
  const summary = await h.knowledge.ensure('course', videos[0])
  assert.equal(extracts, 1)
  assert.equal(merges, 2)
  assert.ok(summary.overview)
})

test('旧版片段缓存不冒充整课总结，升级失败保留原数据，成功后才替换', async (t) => {
  const h = harness(t),
    normal = h.io.requestGuideJson
  const material = transcriptSources(h.cues.get('a.mp4'))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(material)))
  const fingerprint = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')
  const key = `lesson-knowledge:${JSON.stringify(['course', 'a.mp4', null])}`
  const legacy = {
    version: 1,
    path: 'a.mp4',
    createdAt: 1,
    fingerprint,
    points: [{ id: 'k1', title: '旧片段', text: '仅第一段内容', start: 0, end: 10 }],
  }
  h.database.set(key, legacy)
  assert.equal(restoreSummary(legacy, 'a.mp4', fingerprint), null)
  h.io.requestGuideJson = async (settings, messages) => {
    if (messages[0].content.startsWith('综合教学材料')) throw Error('合并失败')
    return normal(settings, messages)
  }
  await assert.rejects(h.knowledge.ensure('course', videos[0]), /合并失败/)
  assert.deepEqual(h.database.get(key), legacy)
  h.io.requestGuideJson = normal
  const summary = await h.knowledge.ensure('course', videos[0])
  assert.equal(h.database.get(key).version, 2)
  assert.equal(restoreSummary(summary, 'a.mp4', fingerprint).overview, summary.overview)
})

test('知识点缓存淘汰旧结果，保留当前租约和未保存的结果', async (t) => {
  const h = harness(t, {}, { entries: 1, weight: 4_000_000 })
  const release = h.knowledge.retain('course', 'a.mp4')
  await h.knowledge.ensure('course', videos[0])
  const first = h.knowledge.get('course', 'a.mp4')
  await h.knowledge.ensure('course', videos[1])
  assert.equal(h.knowledge.get('course', 'a.mp4'), first)
  release()
  h.knowledge.get('course', 'third.mp4')
  assert.equal(h.knowledge.cacheInfo().entries, 1)
  const io = h.io.databaseRequest
  h.io.databaseRequest = async (endpoint, options) => {
    if (options?.method === 'POST' && options.body.key.startsWith('lesson-knowledge:')) throw Error('disk')
    return io(endpoint, options)
  }
  await h.knowledge.ensure('course', videos[0], undefined, true)
  const unsaved = h.knowledge.get('course', 'a.mp4')
  assert.ok(unsaved.storageError)
  h.knowledge.get('course', 'fourth.mp4')
  assert.equal(h.knowledge.get('course', 'a.mp4'), unsaved)
  h.io.databaseRequest = io
  await h.knowledge.retrySave('course', 'a.mp4')
  h.knowledge.get('course', 'fifth.mp4')
  assert.equal(h.knowledge.cacheInfo().entries, 1)
})

test('知识点缓存按文本容量淘汰，后台任务被用户使用后不再自动取消', async (t) => {
  const h = harness(t, {}, { entries: 24, weight: 1 })
  await h.knowledge.ensure('course', videos[0])
  await h.knowledge.ensure('course', videos[1])
  assert.equal(h.knowledge.cacheInfo().entries, 1)
  const gate = deferred(),
    request = h.io.requestGuideJson
  h.io.requestGuideJson = async (...args) => {
    await gate.promise
    return request(...args)
  }
  const background = h.knowledge.ensure('course', videos[0], undefined, true, { background: true })
  await tick()
  const foreground = h.knowledge.ensure('course', videos[0])
  h.knowledge.cancelBackground('course', 'a.mp4')
  gate.resolve()
  assert.equal((await background).path, 'a.mp4')
  assert.equal((await foreground).path, 'a.mp4')
})

test('未配置 AI 且没有字幕时，自动知识点准备不启动转写', async (t) => {
  let prepared = 0
  const h = harness(t, {
    useTranscripts: () => ({
      load: async () => {},
      get: () => ({ status: 'none' }),
      prepare: async () => {
        prepared++
        return []
      },
      cancel() {},
    }),
  })
  h.configured.value = false
  await assert.rejects(h.knowledge.ensure('course', videos[0], undefined, false, { background: true }), /AI 设置/)
  assert.equal(prepared, 0)
})

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
registerHooks({ resolve(specifier, context, next) {
  if (boundaries[specifier]) {
    const source = boundaries[specifier].map(name => `export const ${name} = (...args) => globalThis.knowledgeIO.${name}(...args)`).join('\n')
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
  }
  if (specifier.startsWith('~/')) return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
  return next(specifier, context)
} })
const { useLessonKnowledge } = await import('../app/composables/useLessonKnowledge.ts')
const { useDailyPractice } = await import('../app/composables/useDailyPractice.ts')
const { materialBatches, transcriptSources, validateSummaryPoints, dailyPlanComplete, dailyPlanSignature, validateWholeSummary, restoreSummary } = await import('../app/utils/knowledge.ts')
const { crossedSegmentEnd } = await import('../app/utils/segmentReminder.ts')
const { useLessonPractice } = await import('../app/composables/useLessonPractice.ts')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const cue = (id, start, end) => ({ id, start, end, text: '列表通过索引访问元素，第一个元素索引为零，索引越界会报错；切片可以获取列表中一段元素。'.repeat(3) })
const videos = ['a.mp4', 'b.mp4'].map(path => ({ path, title: path, parent: { getFileHandle: async () => { throw new Error('none') } } }))
const today = (date = '2026-09-25') => ({ date, minutes: 1, override: null, items: videos.map(v => ({ id: v.path, kind: 'lesson', path: v.path, start: 0, end: 30, seconds: 30, estimated: false, done: true })) })
const question = (id, sourceId) => ({ kind: 'single-choice', prompt: `练习 ${id}：列表第一个元素的索引是什么？`, concepts: ['列表索引'], criteria: ['选择一个答案'], referenceAnswer: '索引为零。', sourceIds: [sourceId], knowledge: { category: 'concept', level: 'awareness', reason: '辨认索引即可。' }, options: [{ id: 'A', text: '0' }, { id: 'B', text: '1' }], correctOptionIds: ['A'] })
function harness(t, overrides = {}) {
  const database = new Map(), requests = [], saves = [], cues = new Map(videos.map(v => [v.path, [cue(1, 0, 10), cue(2, 10, 20), cue(3, 20, 30)]]))
  let sequence = 0
  globalThis.knowledgeIO = {
    databaseRequest: async (endpoint, options = {}) => {
      if (endpoint === 'ai-batch-cache') {
        const checkpoint = database.get(options.body?.key)
        if (checkpoint) checkpoint.completedAt = Date.now()
        return { success: true }
      }
      if (options.method === 'POST') { saves.push(options.body); database.set(options.body.key, structuredClone(options.body.value)); return true }
      return structuredClone(database.get(options.query.key) ?? null)
    },
    dbFetchNote: async () => ({ content: '', updatedAt: null }),
    dbFetchPractice: async () => ({}), dbSavePractice: async () => true,
    loadLessonSubtitles: async () => [],
    useTranscripts: () => ({ load: async () => {}, prepare: async (_, video) => cues.get(video.path), get: (_, path) => ({ status: 'ready', segments: cues.get(path) }), cancel() {} }),
    requestGuideJson: async (_, messages) => {
      requests.push(messages)
      const prompt = messages[0].content
      const data = JSON.parse(prompt.slice(prompt.lastIndexOf('输入数据：') + 5))
      if (prompt.startsWith('依据逐字稿')) return { points: data.sources.map(s => ({ title: `知识点 ${s.id}`, text: s.text.slice(0, 1500), sourceIds: [s.id] })) }
      if (prompt.startsWith('综合教学材料')) return { overview: '本课围绕列表的索引与切片，说明读取元素的方法和边界条件。', points: [{ title: '索引与切片的联系', text: data.sources.map(s => s.text).join('\n').slice(0, 1000), sourceIds: data.sources.map(s => s.id) }] }
      const count = Number(prompt.match(/生成 (\d+) 道/)?.[1] ?? 1)
      const qs = Array.from({ length: count }, (_, i) => question(++sequence, data.sources[i % data.sources.length].id))
      return count === 1 ? qs[0] : { questions: qs }
    },
    ...overrides,
  }
  const course = ref({ id: 'course', videos }), settings = reactive({ baseUrl: 'https://example.test/v1', model: 'test', apiKey: '' }), configured = ref(true)
  const plan = ref(today()), date = ref('2026-09-25')
  let knowledge, daily, practice
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() {
    knowledge = useLessonKnowledge(course, settings, configured)
    daily = useDailyPractice(course, plan, date, settings, configured, knowledge)
    practice = useLessonPractice(course, settings, configured, { sources: video => knowledge.sourcesFor(course.value.id, video) })
    return () => null
  } })
  app.mount({}); t.after(() => app.unmount())
  return { knowledge, daily, practice, course, settings, configured, plan, date, database, requests, saves, cues, io: globalThis.knowledgeIO }
}

test('长逐字稿完整分批，每个原始字符都进入材料且没有超限', () => {
  const sources = transcriptSources([{ ...cue(1, 0, 30), text: '字'.repeat(35001) }])
  const batches = materialBatches(sources)
  assert.equal(batches.length, 3)
  assert.equal(batches.flat().map(s => s.text).join('').length, 35001)
  assert.ok(batches.every(b => b.length <= 100 && b.reduce((n, s) => n + s.text.length, 0) <= 12000))
})

test('知识点的时间点仅从真实引用计算，拒绝不存在的字幕', () => {
  const sources = transcriptSources([cue(1, 5, 10)])
  const points = validateSummaryPoints({ points: [{ title: '索引', text: '从零开始。', start: 999, sourceIds: ['s1'] }] }, sources)
  assert.equal(points[0].start, 5)
  assert.throws(() => validateSummaryPoints({ points: [{ title: '索引', text: '从零开始。', sourceIds: ['fake'] }] }, sources))
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

test('相同逐字稿复用总结，字幕内容变化后重新生成', async t => {
  const h = harness(t)
  const first = await h.knowledge.ensure('course', videos[0])
  await h.knowledge.ensure('course', videos[0])
  assert.equal(h.requests.length, 2)
  h.cues.get('a.mp4')[0].text += '新增知识。'
  const next = await h.knowledge.ensure('course', videos[0])
  assert.equal(h.requests.length, 4)
  assert.notEqual(first.fingerprint, next.fingerprint)
})

test('同时请求同一课节仅执行一组提炼与整课合并', async t => {
  const h = harness(t)
  await Promise.all([h.knowledge.ensure('course', videos[0]), h.knowledge.ensure('course', videos[0])])
  assert.equal(h.requests.length, 2)
})

test('按今日片段重新整理，出题材料不包含未来内容', async t => {
  const h = harness(t)
  const sources = await h.knowledge.sourcesFor('course', videos[0], [{ start: 0, end: 20 }])
  assert.equal(sources.length, 1)
  assert.ok(sources.every(s => s.start >= 0 && s.end <= 20 && s.path === 'a.mp4'))
  assert.equal(h.requests.length, 2)
})

for (const [field, value] of [['model', 'new-model'], ['provider', 'anthropic'], ['contextWindow', '1m']]) test(`AI ${field} 切换取消旧总结，迟到响应不会覆盖新结果`, async t => {
  const pending = deferred(), h = harness(t)
  const normal = h.io.requestGuideJson
  h.io.requestGuideJson = () => pending.promise
  const old = h.knowledge.ensure('course', videos[0]).catch(e => e)
  await tick(); h.settings[field] = value
  h.io.requestGuideJson = normal
  const fresh = await h.knowledge.ensure('course', videos[0])
  pending.resolve({ points: [{ title: '旧结果', text: '旧内容', sourceIds: ['s1'] }] })
  await old
  assert.equal(h.knowledge.get('course', 'a.mp4').status, 'ready')
  assert.deepEqual(h.knowledge.get('course', 'a.mp4').summary.points, fresh.points)
})

test('总结读取失败时不调用 AI 或覆盖存储', async t => {
  const h = harness(t)
  h.io.databaseRequest = async () => { throw new Error('read failed') }
  await assert.rejects(h.knowledge.ensure('course', videos[0]), /read failed/)
  assert.equal(h.requests.length, 0)
  assert.equal(h.saves.length, 0)
})

test('今日巩固汇总所有计划课节，自动生成五题并保存作答、稍后继续', async t => {
  const h = harness(t)
  await tick()
  assert.equal(h.daily.shouldPrompt.value, true)
  await h.daily.open()
  assert.equal(h.daily.practice.history.value.length, 5)
  assert.equal(h.daily.shouldPrompt.value, false)
  assert.deepEqual([...new Set(h.daily.practice.sources.value.map(s => s.path))], ['a.mp4', 'b.mp4'])
  h.daily.practice.updateDraft('["A"]')
  await h.daily.practice.review()
  assert.equal(h.daily.answered.value, 1)
  h.daily.practice.close()
  await h.daily.open()
  assert.equal(h.daily.practice.history.value.length, 5)
  assert.equal(h.daily.practice.current.value.draft, '["A"]')
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
  assert.equal(h.daily.practice.history.value.length, 5)
  assert.equal(h.daily.practice.current.value.draft, '["A"]')
  assert.equal(h.requests.length, requestsBefore)
})

test('练习一组多题原子保存，任一题无效都保留已有记录', async t => {
  const h = harness(t)
  await h.practice.open(videos[0], null, '')
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 3)
  const selected = h.practice.current.value.id
  h.io.requestGuideJson = async () => ({ questions: [question('new', 'k1'), question('invalid', 'fake'), question('new2', 'k2')] })
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 3)
  assert.equal(h.practice.current.value.id, selected)
  assert.match(h.practice.state.error, /不存在/)
})

test('每日练习切换日期后关闭旧题，旧完成状态不会满足新日期', async t => {
  const h = harness(t)
  await h.daily.open()
  h.date.value = '2026-09-26'
  await tick()
  assert.equal(h.daily.complete.value, false)
  assert.equal(h.daily.practice.state.open, false)
  assert.equal(h.daily.records.value.length, 0)
})

test('长材料整组练习覆盖所有批次，继续单题只新增一道', async t => {
  const h = harness(t)
  const sources = Array.from({ length: 15 }, (_, i) => ({ id: `s${i + 1}`, kind: 'summary', path: 'a.mp4', start: i, end: i + 1, text: `知识点${i}：${'索引和切片。'.repeat(200)}` }))
  await h.practice.openSources('a.mp4', '长课节', async () => sources)
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 6)
  assert.deepEqual(new Set(h.practice.history.value.flatMap(r => r.sources.map(s => s.id))), new Set(sources.map(s => s.id)))
  await h.practice.generate()
  assert.equal(h.practice.history.value.length, 7)
})

test('知识点后续批次失败保留已完成进度，继续与重新整理分别复用和重做', async t => {
  const h = harness(t)
  h.cues.set('a.mp4', [{ ...cue(1, 0, 60), text: '知识'.repeat(16000) }])
  const request = h.io.requestGuideJson
  let attempted = 0
  h.io.requestGuideJson = async (...args) => {
    if (++attempted === 2) throw Error('暂时断网')
    const result = await request(...args)
    result.points.forEach(point => { point.text = point.text.slice(0, 1000) })
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

test('知识点最终保存失败后直接重存，不重新调用 AI', async t => {
  const h = harness(t), request = h.io.databaseRequest
  let fail = true
  h.io.databaseRequest = async (collection, options) => {
    if (fail && options.method === 'POST' && options.body.key.startsWith('lesson-knowledge:')) throw Error('写盘失败')
    return request(collection, options)
  }
  const summary = await h.knowledge.ensure('course', videos[0])
  assert.ok(summary.points.length); assert.match(h.knowledge.get('course', 'a.mp4').storageError, /保存失败/)
  assert.ok([...h.database.entries()].filter(([key]) => key.startsWith('ai-batches:')).every(([, value]) => value.completedAt === undefined))
  fail = false; await h.knowledge.retrySave('course', 'a.mp4')
  assert.equal(h.requests.length, 2); assert.equal(h.knowledge.get('course', 'a.mp4').storageError, '')
  assert.ok([...h.database.entries()].filter(([key]) => key.startsWith('ai-batches:')).every(([, value]) => typeof value.completedAt === 'number'))
})

test('分批出题后续失败时不保存半组题，继续后整组合并且不重出第一批', async t => {
  const h = harness(t), request = h.io.requestGuideJson
  const sources = Array.from({ length: 15 }, (_, i) => ({ id: `s${i + 1}`, kind: 'summary', text: '索引和切片。'.repeat(200) }))
  await h.practice.openSources('a.mp4', '分批续跑', async () => sources)
  let attempted = 0
  h.io.requestGuideJson = async (...args) => { if (++attempted === 2) throw Error('断网'); return request(...args) }
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 0)
  await h.practice.generate(3)
  assert.equal(h.practice.history.value.length, 6); assert.equal(attempted, 3)
})

test('整课合并必须覆盖所有上游材料，拒绝漏项、伪造引用和重复主题', () => {
  const sources = transcriptSources([cue(1, 0, 10), cue(2, 50, 60)])
  const valid = { overview: '索引与切片共同说明列表的读取方式。', points: [{ title: '列表访问', text: '先理解位置索引，再用切片获取多个元素。', sourceIds: ['s1', 's2'] }] }
  const result = validateWholeSummary(valid, sources)
  assert.equal(result.points.length, 1)
  assert.equal(result.points[0].start, 0)
  assert.equal(result.points[0].end, 60)
  assert.throws(() => validateWholeSummary({ ...valid, points: [{ ...valid.points[0], sourceIds: ['s1'] }] }, sources), /遗漏/)
  assert.throws(() => validateWholeSummary({ ...valid, points: [{ ...valid.points[0], sourceIds: ['fake'] }] }, sources), /引用无效/)
  assert.throws(() => validateWholeSummary({ ...valid, points: [valid.points[0], valid.points[0]] }, sources), /重复主题/)
  assert.throws(() => validateWholeSummary({ ...valid, overview: '' }, sources), /概览/)
})

test('长课的开头与结尾都进入整课合并，最终按主题生成而非拼接片段', async t => {
  const h = harness(t), normal = h.io.requestGuideJson
  h.cues.set('a.mp4', [
    { ...cue(1, 0, 30), text: '索引主题。'.repeat(2500) },
    { ...cue(2, 30, 60), text: '切片主题。'.repeat(2500) },
    { ...cue(3, 60, 90), text: '边界主题。'.repeat(2500) },
  ])
  const extracted = [], mergedInputs = []
  h.io.requestGuideJson = async (settings, messages) => {
    const prompt = messages[0].content
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf('输入数据：') + 5))
    if (prompt.startsWith('依据逐字稿')) {
      extracted.push(...input.sources)
      return { points: input.sources.map(source => ({ title: source.text.slice(0, 4), text: source.text.slice(0, 10), sourceIds: [source.id] })) }
    }
    mergedInputs.push(...input.sources)
    return normal(settings, messages)
  }
  const summary = await h.knowledge.ensure('course', videos[0])
  assert.equal(extracted.map(s => s.text).join(''), h.cues.get('a.mp4').map(c => c.text).join(''))
  assert.ok(mergedInputs.some(s => s.text.includes('索引')))
  assert.ok(mergedInputs.some(s => s.text.includes('边界')))
  assert.equal(summary.version, 2)
  assert.ok(summary.overview)
  assert.equal(summary.points.length, 1)
})

test('多层整课合并始终限制单批材料，避免把长课后半部分截掉', async t => {
  const h = harness(t), normal = h.io.requestGuideJson
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
  assert.ok(mergeSizes.every(size => size <= 12000))
  assert.equal(summary.points.at(-1).end, 600)
  assert.ok(summary.overview)
})

test('整课合并失败后续跑复用已提炼材料，不发布未完成的片段总结', async t => {
  const h = harness(t), normal = h.io.requestGuideJson
  let extracts = 0, merges = 0
  h.io.requestGuideJson = async (settings, messages) => {
    if (messages[0].content.startsWith('依据逐字稿')) extracts++
    else if (++merges === 1) throw Error('合并断网')
    return normal(settings, messages)
  }
  await assert.rejects(h.knowledge.ensure('course', videos[0]), /合并断网/)
  assert.equal(h.knowledge.get('course', 'a.mp4').summary, null)
  assert.ok(!h.saves.some(s => s.key.startsWith('lesson-knowledge:')))
  const summary = await h.knowledge.ensure('course', videos[0])
  assert.equal(extracts, 1); assert.equal(merges, 2)
  assert.ok(summary.overview)
})

test('旧版片段缓存不冒充整课总结，升级失败保留原数据，成功后才替换', async t => {
  const h = harness(t), normal = h.io.requestGuideJson
  const material = transcriptSources(h.cues.get('a.mp4'))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(material)))
  const fingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
  const key = `lesson-knowledge:${JSON.stringify(['course', 'a.mp4', null])}`
  const legacy = { version: 1, path: 'a.mp4', createdAt: 1, fingerprint, points: [{ id: 'k1', title: '旧片段', text: '仅第一段内容', start: 0, end: 10 }] }
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

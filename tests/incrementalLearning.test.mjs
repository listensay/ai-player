import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest=async()=>null;export const flushDatabaseWrites=async()=>{}',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { incrementalCache } = await import('../app/utils/incrementalCache.ts')
const { createLearningData, createReviewIndex } = await import('../app/utils/learningData.ts')
const { saveHomeSnapshots } = await import('../app/utils/homeSnapshots.ts')
const { performanceContext } = await import('./fixtures/performance.mjs')
const { daySnapshot } = await import('../app/utils/dailyPlan.ts')
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const blankSources = () => ({ notes: [], practices: [], summaries: [] })
function course(id) {
  return {
    course: { id, name: id, status: 'active', pinned: false, lastOpenedAt: 1 },
    data: { guide: null, progress: {}, days: {}, snapshots: {}, records: null },
  }
}
test('首页与学习管理共享读取；笔记变化仅读取该课程的材料，焦点切换零重复读取', async () => {
  const calls = []
  const store = createLearningData(async (name, options) => {
    calls.push([name, options.query])
    if (name === 'dashboard')
      return options.query.courseId ? [course(options.query.courseId)] : [course('a'), course('b')]
    return blankSources()
  })
  const [first, second] = await Promise.all([store.courses('2026-10-07'), store.courses('2026-10-07')])
  assert.equal(first[0], second[0])
  await store.sources()
  for (let i = 0; i < 10; i++) {
    await store.courses('2026-10-07')
    await store.sources()
  }
  assert.equal(calls.length, 2)
  store.invalidate('notes', { method: 'POST', body: { courseId: 'a' } })
  await store.sources()
  assert.deepEqual(calls.at(-1), ['learning-sources', { courseId: 'a' }])
  store.invalidate('progress', { method: 'POST', body: { courseId: 'a', done: false } })
  const updated = await store.courses('2026-10-07')
  assert.equal(
    updated.find((c) => c.course.id === 'b'),
    first[1],
  )
  assert.deepEqual(calls.at(-1), ['dashboard', { courseId: 'a' }])
  const nextDay = await store.courses('2026-10-08')
  assert.notEqual(nextDay[0], updated[0])
  assert.equal(calls.length, 4)
})
test('进行中的读取不会吞掉新修改；失败保留失效范围供重试', async () => {
  const gate = deferred(),
    calls = []
  let fail = false
  const cache = incrementalCache(
    async (id) => {
      calls.push(id)
      if (!id) {
        await gate.promise
        return { a: 'old', b: 'stable' }
      }
      if (fail) throw Error('disk')
      return { [id]: 'new' }
    },
    (all, value) => ({ ...all, ...value }),
  )
  const pending = cache.load()
  cache.invalidate('a')
  gate.resolve()
  assert.deepEqual(await pending, { a: 'new', b: 'stable' })
  fail = true
  cache.invalidate('b')
  await assert.rejects(cache.load(), /disk/)
  fail = false
  assert.deepEqual(await cache.load(), { a: 'new', b: 'new' })
  assert.deepEqual(calls, [undefined, 'a', 'b', 'b'])
})
test('知识点、每日练习和课程移除定位正确；无关设置不失效', async () => {
  const calls = []
  let deleted = false
  const store = createLearningData(async (name, options) => {
    calls.push([name, options.query])
    return name === 'dashboard' ? (deleted ? [] : [course('a')]) : blankSources()
  })
  await store.courses('2026-10-07')
  await store.sources()
  store.invalidate('settings', { body: { key: 'lesson-knowledge:["a","one.mp4",null]' } })
  await store.sources()
  assert.deepEqual(calls.at(-1), ['learning-sources', { courseId: 'a' }])
  store.invalidate('settings', { body: { key: 'daily-practice:a' } })
  await store.courses('2026-10-07')
  await store.sources()
  const before = calls.length
  store.invalidate('settings', { body: { key: 'pomodoro:v1' } })
  await store.courses('2026-10-07')
  await store.sources()
  assert.equal(calls.length, before)
  deleted = true
  store.invalidate('library', { body: { id: 'a' } })
  assert.deepEqual(await store.courses('2026-10-07'), [])
})
test('复习索引只重建变化的课程，跨日更新复习日期', () => {
  const calls = []
  const index = createReviewIndex((sources, courses, date) => {
    calls.push([courses[0].course.id, date])
    return []
  })
  const courses = ['a', 'b'].map((id) => ({ course: { id } }))
  const sources = blankSources()
  index(sources, courses, '2026-10-07')
  index(sources, courses, '2026-10-07')
  assert.equal(calls.length, 2)
  sources.notes.push({ courseId: 'a', content: 'updated' })
  index(sources, courses, '2026-10-07')
  assert.deepEqual(calls.at(-1), ['a', '2026-10-07'])
  assert.equal(calls.length, 3)
  index(sources, courses, '2026-10-08')
  assert.equal(calls.length, 5)
})

test('旧课程别名的增量结果替换原记录，不重复课程或保留已删除材料', async () => {
  let changed = false
  const store = createLearningData(async (name, options) => {
    if (name === 'dashboard') return [course('canonical')]
    return {
      ...blankSources(),
      courseId: options.query.courseId ? 'canonical' : undefined,
      notes: changed ? [] : [{ courseId: 'canonical', path: 'one.mp4', content: 'note', updatedAt: 1 }],
    }
  })
  await store.courses('2026-10-07')
  await store.sources()
  changed = true
  store.invalidate('notes', { body: { courseId: 'old-alias' } })
  store.invalidate('progress', { body: { courseId: 'old-alias' } })
  assert.equal((await store.courses('2026-10-07')).length, 1)
  assert.equal((await store.sources()).notes.length, 0)
})
test('首页未改变的快照不写盘；失败重试和跨日保存正常', async () => {
  const date = '2026-09-30',
    context = performanceContext(20)
  const entry = { course: { id: 'a' }, context, snapshots: {} }
  const writes = []
  let fail = true
  const write = async (name, options) => {
    if (fail) throw Error('disk')
    writes.push(options.body)
  }
  await assert.rejects(saveHomeSnapshots([entry], date, write), /保存失败/)
  fail = false
  await saveHomeSnapshots([entry], date, write)
  await saveHomeSnapshots([entry], date, write)
  assert.equal(writes.length, 1)
  const reloaded = structuredClone(entry)
  await saveHomeSnapshots([reloaded], date, write)
  assert.equal(writes.length, 1)
  await saveHomeSnapshots([reloaded], '2026-10-01', write)
  assert.equal(writes.length, 2)
  const previous = daySnapshot(context, date)
  previous.initialMinutes = 999
  const withInitial = { ...entry, snapshots: { [date]: previous } }
  await saveHomeSnapshots([withInitial], date, write)
  assert.equal(withInitial.snapshots[date].initialMinutes, 999)
  await saveHomeSnapshots([{ ...entry, snapshots: {} }], date, write, () => true)
  assert.equal(writes.length, 2)
})

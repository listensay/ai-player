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
const { createLearningData } = await import('../app/utils/learningData.ts')
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
function course(id) {
  return {
    course: { id, name: id, status: 'active', pinned: false, lastOpenedAt: 1 },
    data: { guide: null, progress: {}, days: {}, snapshots: {}, records: null },
  }
}
test('首页和日历共享读取，焦点切换不重复加载，课程变化只刷新对应课程', async () => {
  const calls = []
  const store = createLearningData(async (name, options) => {
    calls.push([name, options.query])
    assert.equal(name, 'dashboard')
    return options.query.courseId ? [course(options.query.courseId)] : [course('a'), course('b')]
  })
  const [first, second] = await Promise.all([store.courses('2026-10-07'), store.courses('2026-10-07')])
  assert.equal(first[0], second[0])
  for (let i = 0; i < 10; i++) await store.courses('2026-10-07')
  assert.equal(calls.length, 1)
  assert.equal(store.invalidate('practice', { method: 'POST', body: { courseId: 'a' } }), false)
  store.invalidate('progress', { method: 'POST', body: { courseId: 'a', done: false } })
  const updated = await store.courses('2026-10-07')
  assert.equal(
    updated.find((c) => c.course.id === 'b'),
    first[1],
  )
  assert.deepEqual(calls.at(-1), ['dashboard', { courseId: 'a' }])
  const nextDay = await store.courses('2026-10-08')
  assert.notEqual(nextDay[0], updated[0])
  assert.equal(calls.length, 2)
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
test('日历安排变更和旧课程别名刷新不重复课程，无关设置不失效', async () => {
  const calls = []
  let deleted = false
  const store = createLearningData(async (name, options) => {
    calls.push([name, options.query])
    return deleted ? [] : [course('canonical')]
  })
  await store.courses('2026-10-07')
  store.invalidate('settings', { body: { key: 'daily-practice:canonical' } })
  await store.courses('2026-10-07')
  assert.deepEqual(calls.at(-1), ['dashboard', { courseId: 'canonical' }])
  const before = calls.length
  store.invalidate('settings', { body: { key: 'desktop-settings:v1' } })
  await store.courses('2026-10-07')
  assert.equal(calls.length, before)
  store.invalidate('progress', { body: { courseId: 'old-alias' } })
  assert.equal((await store.courses('2026-10-07')).length, 1)
  deleted = true
  store.invalidate('library', { body: { id: 'canonical' } })
  assert.deepEqual(await store.courses('2026-10-07'), [])
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

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    const names =
      specifier === '~/utils/dbClient'
        ? ['dbSaveGuide', 'dbSaveSetting']
        : specifier === '~/utils/database'
          ? ['databaseRequest']
          : null
    if (names)
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(
            names
              .map((name) => `export const ${name} = (...args) => globalThis.guideWritesIO.${name}(...args)`)
              .join('\n'),
          ),
        shortCircuit: true,
      }
    return next(specifier, context)
  },
})
const { useGuidePersistence } = await import('../app/composables/useGuidePersistence.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(t) {
  const calls = { guide: [], records: [], days: [], errors: [] }
  const io = (globalThis.guideWritesIO = {
    dbSaveGuide: async (data) => {
      calls.guide.push(data)
      return true
    },
    dbSaveSetting: async (key, value) => {
      calls.records.push({ key, value })
      return true
    },
    databaseRequest: async (_, options) => {
      calls.days.push(options.body)
      return true
    },
  })
  const state = { revision: 1, view: 'all', entries: [], dayReads: 0 }
  const persistence = useGuidePersistence({
    revision: () => state.revision,
    guide: () => ({ courseId: 'one', view: state.view }),
    records: () => ({ key: 'one', value: { entries: state.entries } }),
    day: () => {
      state.dayReads++
      return {
        courseId: 'one',
        snapshot: {
          date: '2026-09-30',
          capturedAt: Date.now(),
          plannedMinutes: 30,
          initialMinutes: 30,
          tasks: state.entries,
        },
      }
    },
    error: (message) => calls.errors.push(message),
  })
  t.after(() => persistence.reset())
  return { state, calls, io, persistence }
}

test('相同数据不重复保存或生成快照，视图变化只写导学数据', async (t) => {
  const { state, calls, persistence } = fixture(t)
  persistence.persist()
  await tick()
  persistence.persist()
  persistence.persistRecords()
  await tick()
  assert.deepEqual([calls.guide.length, calls.records.length, calls.days.length, state.dayReads], [1, 1, 1, 1])
  state.view = 'route'
  persistence.persist()
  await tick()
  assert.deepEqual([calls.guide.length, calls.records.length, calls.days.length], [2, 1, 1])
  state.entries.push({ id: 'task', done: true })
  persistence.persistRecords()
  await tick()
  assert.deepEqual([calls.guide.length, calls.records.length, calls.days.length], [2, 2, 2])
  assert.equal(calls.records[0].value.entries.length, 0)
})

test('实践或快照写入失败后，相同内容仍可重试，成功后继续去重', async (t) => {
  const { calls, io, persistence } = fixture(t)
  const save = io.dbSaveSetting,
    day = io.databaseRequest
  io.dbSaveSetting = async (...args) => {
    await save(...args)
    return false
  }
  io.databaseRequest = async (...args) => {
    await day(...args)
    throw Error('disk unavailable')
  }
  persistence.persist()
  await tick()
  assert.equal(calls.errors.length, 2)
  io.dbSaveSetting = save
  io.databaseRequest = day
  persistence.persist()
  await tick()
  persistence.persist()
  await tick()
  assert.deepEqual([calls.guide.length, calls.records.length, calls.days.length], [1, 2, 2])
})

test('旧请求失败不清除更新版本的去重状态，也不误报当前保存失败', async (t) => {
  const { state, calls, io, persistence } = fixture(t)
  const save = io.dbSaveSetting
  let rejectOld
  io.dbSaveSetting = (...args) => {
    void save(...args)
    return new Promise((resolve) => {
      rejectOld = () => resolve(false)
    })
  }
  persistence.persist()
  io.dbSaveSetting = save
  state.entries.push({ id: 'new', done: true })
  persistence.persistRecords()
  await tick()
  rejectOld()
  await tick()
  persistence.persistRecords()
  await tick()
  assert.equal(calls.records.length, 2)
  assert.equal(calls.errors.length, 0)
  state.revision++
  persistence.reset()
  persistence.persist()
  await tick()
  assert.equal(calls.records.length, 3)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer } from 'vue'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './platform' && context.parentURL.endsWith('/utils/database.ts'))
      return {
        url: 'data:text/javascript,export const desktopInvoke=(...args)=>globalThis.milestoneIO.invoke(...args)',
        shortCircuit: true,
      }
    if (specifier === '~/utils/pomodoroAudio')
      return {
        url: 'data:text/javascript,export const createPomodoroAudio=()=>({play:async()=>{globalThis.milestoneIO.sounds++},unlock:()=>{},dispose:()=>{globalThis.milestoneIO.disposed=true}})',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL('../app/' + specifier.slice(2) + '.ts', import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { provideMilestones } = await import('../app/composables/useMilestones.ts')
const { databaseRequest } = await import('../app/utils/database.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('全局服务在练习写入后自动解锁、播放一次提示音，重复保存不重复提示，卸载清理', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const previousWindow = globalThis.window
  globalThis.window = new EventTarget()
  const data = {
    course: { id: 'a', name: 'A', videoCount: 1, status: 'active' },
    data: { progress: {}, days: {}, snapshots: {}, records: null },
  }
  const io = {
    sounds: 0,
    disposed: false,
    evidence: { notes: [], practices: [] },
    ledger: null,
    reads: 0,
    failWrite: false,
    async invoke(command, args) {
      assert.equal(command, 'database_request')
      if (args.method !== 'GET') {
        if (io.failWrite) throw Error('save failed')
        if (args.body?.key === 'milestones:v1') io.ledger = structuredClone(args.body.value)
        return
      }
      if (args.endpoint === 'dashboard') {
        io.reads++
        return [data]
      }
      if (args.endpoint === 'study-evidence') return io.evidence
      if (args.query.key === 'milestones:v1') return io.ledger
      if (args.query.key === 'pomodoro:v1') return null
      throw Error('unexpected request')
    },
  }
  globalThis.milestoneIO = io
  let milestones
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      milestones = provideMilestones()
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    globalThis.window = previousWindow
    delete globalThis.milestoneIO
  })
  await tick()
  assert.equal(milestones.state.ready, true, milestones.state.error)
  assert.equal(milestones.state.badges.length, 30)
  assert.equal(milestones.unlocked.value, 0)
  io.evidence.practices.push({ courseId: 'a', id: 'q1', solidAt: Date.now() })
  await databaseRequest('practice', { method: 'POST', body: {} })
  t.mock.timers.tick(1200)
  await tick()
  assert.equal(milestones.unlocked.value, 1)
  assert.equal(milestones.celebration.value[0].id, 'practice-1')
  assert.equal(io.sounds, 1)
  assert.ok(io.ledger.unlocked['practice-1'])
  milestones.dismiss()
  await databaseRequest('practice', { method: 'POST', body: {} })
  t.mock.timers.tick(1200)
  await tick()
  assert.equal(milestones.celebration.value.length, 0)
  assert.equal(io.sounds, 1)
  const reads = io.reads
  io.failWrite = true
  await assert.rejects(databaseRequest('practice', { method: 'POST', body: {} }))
  t.mock.timers.tick(1200)
  await tick()
  assert.equal(io.reads, reads)
  io.failWrite = false
  app.unmount()
  assert.equal(io.disposed, true)
  await databaseRequest('notes', { method: 'POST', body: {} })
  t.mock.timers.tick(1200)
  await tick()
  assert.equal(io.reads, reads)
})

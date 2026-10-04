import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMilestones, MILESTONE_CATEGORIES, restoreMilestoneLedger } from '../app/utils/milestones.ts'
import { createMilestoneTracker } from '../app/utils/milestoneTracker.ts'
import { buildStudyInsights } from '../app/utils/studyInsights.ts'
import { subscribeDatabaseChanges, notifyDatabaseChange } from '../app/utils/databaseChanges.ts'
const empty = () => Object.fromEntries(MILESTONE_CATEGORIES.map((category) => [category.id, 0]))
function harness(stored = null) {
  const io = { stored, metrics: empty(), writes: [], celebrations: [], readFailure: false, saveFailure: false }
  const tracker = createMilestoneTracker({
    readLedger: async () => io.stored,
    readBadges: async () => {
      if (io.readFailure) throw Error('partial data')
      return buildMilestones(io.metrics)
    },
    saveLedger: async (ledger) => {
      if (io.saveFailure) throw Error('disk full')
      io.stored = structuredClone(ledger)
      io.writes.push(ledger)
    },
    celebrate: (badges) => io.celebrations.push(badges),
  })
  return { io, tracker }
}
test('六大系列各五枚，共30枚唯一勋章，每档门槛递增且边界准确', () => {
  const badges = buildMilestones(empty())
  assert.equal(badges.length, 30)
  assert.equal(new Set(badges.map((badge) => badge.id)).size, 30)
  assert.equal(new Set(badges.map((badge) => badge.name)).size, 30)
  assert.ok(badges.every((badge) => !badge.unlocked))
  for (const category of MILESTONE_CATEGORIES) {
    const tiers = badges.filter((badge) => badge.category === category.id)
    assert.equal(tiers.length, 5)
    assert.deepEqual(
      tiers.map((badge) => badge.tier),
      [1, 2, 3, 4, 5],
    )
    assert.ok(tiers.every((badge, i) => i === 0 || badge.target > tiers[i - 1].target))
    for (const badge of tiers) {
      assert.equal(
        buildMilestones({ ...empty(), [category.id]: badge.target - 0.01 }).find((b) => b.id === badge.id).unlocked,
        false,
      )
      assert.equal(
        buildMilestones({ ...empty(), [category.id]: badge.target }).find((b) => b.id === badge.id).unlocked,
        true,
      )
    }
  }
})
test('首次静默收录历史，新增成就一次合并庆祝，刷新与重启不重复', async () => {
  const { io, tracker } = harness()
  io.metrics.notes = 1000
  await tracker.refresh()
  assert.equal(tracker.state.badges.filter((badge) => badge.unlocked).length, 2)
  assert.equal(io.celebrations.length, 0)
  io.metrics.practice = 30
  await tracker.refresh()
  assert.equal(io.celebrations.length, 1)
  assert.equal(io.celebrations[0].length, 3)
  await tracker.refresh()
  assert.equal(io.celebrations.length, 1)
  const restored = harness(io.stored)
  restored.io.metrics = io.metrics
  await restored.tracker.refresh()
  assert.equal(restored.io.celebrations.length, 0)
  assert.equal(restored.io.writes.length, 0)
})
test('保存成功后才解锁，失败不庆祝、可重试；删除笔记或课程不会撤销已获勋章', async () => {
  const { io, tracker } = harness({ version: 1, unlocked: {} })
  io.metrics.courses = 1
  io.saveFailure = true
  await tracker.refresh()
  assert.match(tracker.state.error, /disk full/)
  assert.equal(io.celebrations.length, 0)
  io.saveFailure = false
  await tracker.refresh()
  assert.equal(io.celebrations.length, 1)
  io.metrics.courses = 0
  await tracker.refresh()
  assert.equal(tracker.state.badges.find((badge) => badge.id === 'courses-1').unlocked, true)
  assert.equal(io.celebrations.length, 1)
})
test('读取失败、损坏记录和卸载期间的迟到请求不会覆盖数据或弹庆祝', async () => {
  assert.throws(() => restoreMilestoneLedger({ version: 2, unlocked: {} }))
  assert.throws(() => restoreMilestoneLedger({ version: 1, unlocked: { a: NaN } }))
  const { io, tracker } = harness()
  io.readFailure = true
  await tracker.refresh()
  assert.equal(io.writes.length, 0)
  assert.equal(tracker.state.ready, false)
  let finish
  const slow = createMilestoneTracker({
    readLedger: async () => ({ version: 1, unlocked: {} }),
    readBadges: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    saveLedger: async () => assert.fail('unmounted write'),
    celebrate: () => assert.fail('unmounted celebration'),
  })
  const pending = slow.refresh()
  await Promise.resolve()
  slow.dispose()
  finish(buildMilestones({ ...empty(), courses: 1 }))
  await pending
})
test('并发刷新串行执行，解锁保存与庆祝只发生一次', async () => {
  const { tracker, io } = harness({ version: 1, unlocked: {} })
  io.metrics.focus = 5
  await Promise.all([tracker.refresh(), tracker.refresh(), tracker.refresh()])
  assert.equal(io.writes.length, 1)
  assert.equal(io.celebrations.length, 1)
  assert.equal(io.celebrations[0].length, 2)
})
test('学习记录生成30枚勋章，重复专注与未完成计时不额外计数', () => {
  const now = Date.now() - 1000
  const today = '2026-09-15'
  const course = {
    course: { id: 'a', name: 'A', videoCount: 1 },
    error: '',
    days: {
      [today]: { seconds: 3600, targetSeconds: 3600, checkedAt: now },
    },
    context: { progress: { a: { done: true } }, records: { entries: [] }, mastery: {} },
  }
  const session = {
    startedAt: now - 1500000,
    endedAt: now,
    date: today,
    startHour: 10,
    interruptions: 0,
    outcome: 'completed',
  }
  const data = buildStudyInsights(
    [course],
    {
      notes: [{ courseId: 'a', characters: 1000, updatedAt: now }],
      practices: [{ courseId: 'a', id: 'one', solidAt: now }],
    },
    [session, session, { ...session, startedAt: now, outcome: 'abandoned' }],
    { start: today, end: today, label: '本周' },
    today,
  )
  assert.equal(data.badges.length, 30)
  for (const id of ['streak-1', 'courses-1', 'hours-1', 'notes-1000', 'practice-1', 'focus-1'])
    assert.equal(data.badges.find((badge) => badge.id === id).unlocked, true, id)
  assert.equal(data.badges.find((badge) => badge.id === 'focus-5').value, 1)
})
test('数据库观察者异常不影响写入通知，卸载后不再回调', () => {
  const removeBad = subscribeDatabaseChanges(() => {
    throw Error('listener')
  })
  const events = []
  const remove = subscribeDatabaseChanges((collection) => events.push(collection))
  notifyDatabaseChange('practice', { method: 'POST' })
  remove()
  removeBad()
  notifyDatabaseChange('notes', { method: 'POST' })
  assert.deepEqual(events, ['practice'])
})

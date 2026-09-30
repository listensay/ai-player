import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateDay, calculateDayBudget, calculateDayWork } from '../app/utils/dailyPlan.ts'
import { performanceContext } from './fixtures/performance.mjs'

test('轻量预算与完整排期在阶段、跨天、临时覆盖和暂停时保持一致', () => {
  const c = performanceContext(40)
  c.plan.modules[0].practice = {
    startDay: 1,
    endDay: 2,
    budget: { video: 30, code: 10, project: 0, recap: 0 },
    tasks: [],
    checks: [],
  }
  c.plan.modules[1].practice = {
    startDay: 3,
    endDay: 5,
    budget: { video: 45, code: 15, project: 5, recap: 0 },
    tasks: [],
    checks: [],
  }
  c.plan.program.calendar = {
    weekdays: [1, 2, 3, 4, 5],
    weekendBudget: { video: 60, code: 0, project: 0, recap: 0 },
    overrides: {},
  }
  for (const active of ['', 'module-0', 'module-1'])
    for (const date of ['2026-09-29', '2026-09-30', '2026-10-02', '2026-10-04', '2026-10-09']) {
      c.records.activeModuleId = active
      for (const override of [undefined, null, 0, 15, 120]) {
        assert.deepEqual(calculateDayBudget(c, date, override), calculateDay(c, date, override).budget)
      }
      assert.deepEqual(calculateDayWork(c, date), calculateDay(c, date).work)
    }
  c.plan.program.calendar.pause = { from: '2026-09-30', until: null }
  assert.deepEqual(calculateDayBudget(c, '2026-09-30', 120), { video: 0, code: 0, project: 0, recap: 0 })
})

test('读取基础预算不会遍历课程、元数据、观看进度或实践记录', () => {
  const c = performanceContext(2000)
  for (const key of ['metadata', 'progress', 'mastery', 'records'])
    Object.defineProperty(c, key, {
      get() {
        throw Error(`Unexpected ${key} read`)
      },
    })
  Object.defineProperty(c.plan, 'lessons', {
    get() {
      throw Error('Unexpected route traversal')
    },
  })
  assert.equal(calculateDayBudget(c, '2026-09-30').video, 120)
  assert.equal(calculateDayBudget({ plan: null, today: null }, '2026-09-30').video, 0)
})

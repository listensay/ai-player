import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive, ref, nextTick } from 'vue'
import {
  effectivePlaybackSeconds,
  isMissedStudyDay,
  restoreStudyDays,
  studyPlanProgress,
} from '../app/utils/checkIn.ts'
import { localDayKey } from '../app/utils/learningFeedback.ts'
import { addDays } from '../app/utils/studyProgram.ts'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/dbClient')
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(
            'export const dbFetchCheckIns = async () => globalThis.calendarDays; export const dbSaveCheckIns = async (id, days) => { globalThis.calendarSaves?.push(JSON.parse(JSON.stringify({id, days}))); return true }',
          ),
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useStudyCheckIn } = await import('../app/composables/useStudyCheckIn.ts')
const { descriptor } = parse(readFileSync(new URL('../app/components/CheckInCalendar.vue', import.meta.url), 'utf8'))
const code = compileScript(descriptor, { id: 'calendar-test' })
  .content.replace(/import \{ useCheckIn \} from [^\n]+/, 'const useCheckIn = () => globalThis.calendarCheckIn')
  .replace(/import (AppIcon|UiButton) from [^\n]+/g, 'const $1 = {}')
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Calendar } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
globalThis.window = new EventTarget()
const renderer = createRenderer({
  createComment: () => ({}),
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
})

test('计划开始当天起，零时长和部分完成都标叉，未来、休息和计划范围外不标叉', () => {
  const options = {
    date: '2026-09-28',
    today: '2026-09-30',
    startDate: '2026-09-28',
    endDate: '2026-10-01',
    seconds: 0,
    targetSeconds: 1800,
  }
  assert.equal(isMissedStudyDay(options), true)
  assert.equal(isMissedStudyDay({ ...options, date: options.today, seconds: 1799 }), true)
  for (const patch of [
    { date: '2026-09-27' },
    { date: '2026-10-01' },
    { startDate: null },
    { targetSeconds: 0 },
    { seconds: 1800 },
    { checkedAt: 1 },
    { endDate: '2026-09-27' },
  ]) {
    assert.equal(isMissedStudyDay({ ...options, ...patch }), false)
  }
})

test('日历使用历史保存目标；缺失记录按当天计划补算，红叉随今天达标转为勾号', async (t) => {
  const date = localDayKey(),
    previous = addDays(date, -1),
    start = addDays(date, -2)
  globalThis.calendarDays = { [previous]: { date: previous, seconds: 600, targetSeconds: 900, checkedAt: null } }
  const plan = ref({
    today: { date, minutes: 30, items: [] },
    dailyMinutes: 30,
    targetMinutes: 30,
    startDate: start,
    endDate: addDays(date, 3),
    budgetForDate: (day) => (day === start ? 0 : 30),
  })
  let clock, calendar
  const app = renderer.createApp({
    setup() {
      clock = useStudyCheckIn(ref({ id: 'one', videos: [] }), plan)
      globalThis.calendarCheckIn = clock
      calendar = Calendar.setup(reactive({ compact: false }), { expose() {}, emit() {} })
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.calendarDays
    delete globalThis.calendarCheckIn
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(clock.minutesFor(previous), 15)
  assert.equal(clock.minutesFor(start), 0)
  assert.equal(calendar.detailFor(start).isMissed, false)
  assert.equal(calendar.detailFor(previous).isMissed, true)
  assert.equal(calendar.selectedDetail.value.isMissed, true)
  assert.equal(calendar.detailFor(addDays(date, 1)).isMissed, false)
  plan.value.workSeconds = { [date]: 1800 }
  await nextTick()
  assert.equal(calendar.selectedDetail.value.isChecked, true)
  assert.equal(calendar.selectedDetail.value.isMissed, false)
  assert.equal(calendar.selectedDetail.value.status, '已打卡')
  assert.equal(clock.state.days[previous].seconds, 600)
})

const lesson = (id, seconds, done = true) => ({
  id,
  path: `${id}.mp4`,
  kind: 'lesson',
  start: 0,
  end: seconds,
  seconds,
  done,
  estimated: false,
})
const todayPlan = (date = localDayKey()) => ({
  date,
  minutes: 240,
  override: null,
  items: [lesson('a', 14000), lesson('b', 400)],
})
const workEntry = (date, done = false) => ({
  id: 'code',
  date,
  moduleId: 'm',
  taskId: 'code',
  kind: 'code',
  title: '练习',
  instructions: '完成练习',
  targetMinutes: 30,
  minutes: 10,
  evidence: '',
  done,
})

function mountClock(t, plan, stored = {}, active = ref({ id: 'course', videos: [{ path: 'a.mp4' }] })) {
  globalThis.calendarDays = stored
  globalThis.calendarSaves = []
  let clock, calendar
  const app = renderer.createApp({
    setup() {
      clock = useStudyCheckIn(active, plan)
      globalThis.calendarCheckIn = clock
      calendar = Calendar.setup(reactive({ compact: false }), { expose() {}, emit() {} })
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return { clock, calendar, app }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('1.25 倍速仅记录实际用时，暂停和拖动不补造学习时间', () => {
  const previous = { at: 0, seconds: 10, rate: 1.25, playing: true, seeking: false, ended: false }
  const current = { ...previous, at: 1000, seconds: 11.25 }
  assert.equal(effectivePlaybackSeconds(previous, current), 1)
  assert.equal(effectivePlaybackSeconds({ ...previous, playing: false }, current), 0)
  assert.equal(effectivePlaybackSeconds(previous, { ...current, seeking: true, seconds: 300 }), 0)
  assert.equal(effectivePlaybackSeconds(previous, { ...current, seconds: 300 }), 0)
})

test('任务达标按原日范围计算，追加课程、短尾课和历史完成位置不增加要求', () => {
  const today = todayPlan(),
    date = today.date
  assert.equal(studyPlanProgress(today, date, 14400), 1)
  today.items.push(lesson('extra', 14400, false))
  today.extraDays = [{ date: addDays(date, 1), minutes: 240 }]
  today.practiceItemIds = ['a', 'b']
  assert.equal(studyPlanProgress(today, date, 14400), 1)
  delete today.practiceItemIds
  assert.equal(studyPlanProgress(today, date, 14400), 1)
  today.items = [lesson('last', 200)]
  delete today.extraDays
  assert.equal(studyPlanProgress(today, date, 14400), 1)
  today.items = [lesson('last', 200, false)]
  today.completedBeforeToday = { 'last.mp4': 200 }
  assert.equal(studyPlanProgress(today, date, 14400), 0)
  assert.equal(studyPlanProgress(today, addDays(date, 1), 14400), null)
  assert.equal(studyPlanProgress(today, date, 0), null)
  assert.equal(studyPlanProgress({ ...today, items: [] }, date, 14400), null)
})

test('四小时课程完成后打卡与日历显示 100%，保存和重载均保留真实的 3:26:07 用时', async (t) => {
  const today = todayPlan(),
    date = today.date,
    seconds = 12367.135140137276
  const plan = ref({ today, dailyMinutes: 240, targetMinutes: 240, startDate: date })
  const h = mountClock(t, plan, { [date]: { date, seconds, targetSeconds: 14400, checkedAt: null } })
  await tick()
  assert.equal(h.clock.isAchieved.value, true)
  assert.equal(h.clock.percent.value, 100)
  assert.equal(h.clock.seconds.value, seconds)
  assert.equal(h.calendar.detailFor(date).isMissed, false)
  assert.equal(h.calendar.detailFor(date).status, '已打卡')
  const saved = globalThis.calendarSaves.at(-1).days[0]
  assert.equal(saved.seconds, seconds)
  assert.equal(saved.targetSeconds, 14400)
  assert.ok(saved.checkedAt)
  h.app.unmount()
  const reopened = mountClock(t, plan, { [date]: saved })
  await tick()
  assert.equal(reopened.clock.percent.value, 100)
  assert.equal(reopened.clock.seconds.value, seconds)
  assert.equal(reopened.clock.justCheckedIn.value, null)
  assert.equal(reopened.clock.current.value.checkedAt, saved.checkedAt)
  assert.equal(restoreStudyDays({ version: 1, days: [saved] })[date].checkedAt, saved.checkedAt)
})

test('最后一项未完成时不提前打卡，完成事件触发后仍不增加真实用时', async (t) => {
  const today = todayPlan(),
    date = today.date
  today.items.at(-1).done = false
  const plan = ref({ today, dailyMinutes: 240, targetMinutes: 240 })
  const { clock } = mountClock(t, plan, { [date]: { date, seconds: 11500, targetSeconds: 14400, checkedAt: null } })
  await tick()
  assert.equal(clock.isAchieved.value, false)
  assert.ok(clock.percent.value < 100)
  plan.value.today.items.at(-1).done = true
  await nextTick()
  assert.equal(clock.isAchieved.value, true)
  assert.equal(clock.percent.value, 100)
  assert.equal(clock.seconds.value, 11500)
})

test('导学和实践读取完成后才能按任务打卡，未完成的实践不被视频完成掩盖', async (t) => {
  const today = todayPlan(),
    date = today.date
  const plan = ref({
    today,
    dailyMinutes: 240,
    targetMinutes: 270,
    ready: false,
    workItems: [],
    workSeconds: { [date]: 600 },
  })
  const { clock } = mountClock(t, plan)
  await tick()
  assert.equal(clock.isAchieved.value, false)
  plan.value.ready = true
  plan.value.workItems = [workEntry(date)]
  await nextTick()
  assert.equal(clock.isAchieved.value, false)
  plan.value.workItems[0].done = true
  await nextTick()
  assert.equal(clock.isAchieved.value, true)
  assert.equal(clock.seconds.value, 600)
  assert.equal(studyPlanProgress({ ...today, minutes: 0, items: [] }, date, 1800, [workEntry(date, true)]), 1)
})

test('跨天后昨日完成任务不能让今天打卡，切换课程也不继承完成状态', async (t) => {
  const date = localDayKey(),
    today = todayPlan(addDays(date, -1))
  const plan = ref({ today, dailyMinutes: 240, targetMinutes: 240 })
  const active = ref({ id: 'one', videos: [] })
  const { clock } = mountClock(t, plan, {}, active)
  await tick()
  assert.equal(clock.isAchieved.value, false)
  plan.value.today = todayPlan(date)
  await nextTick()
  assert.equal(clock.isAchieved.value, true)
  plan.value.ready = false
  plan.value.today = { ...todayPlan(date), items: [lesson('new', 14400, false)] }
  globalThis.calendarDays = {}
  active.value = { id: 'two', videos: [] }
  await tick()
  plan.value.ready = true
  await nextTick()
  assert.equal(clock.isAchieved.value, false)
  assert.equal(clock.percent.value, 0)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive, ref, nextTick } from 'vue'
import { isMissedStudyDay } from '../app/utils/checkIn.ts'
import { localDayKey } from '../app/utils/learningFeedback.ts'
import { addDays } from '../app/utils/studyProgram.ts'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/dbClient')
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(
            'export const dbFetchCheckIns = async () => globalThis.calendarDays; export const dbSaveCheckIns = async () => true',
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

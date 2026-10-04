import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, nextTick } from 'vue'
import { VuetifyDateAdapter } from 'vuetify/lib/composables/date/adapters/vuetify.js'

const source = readFileSync(new URL('../app/components/UiDatePicker.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const code = compileScript(descriptor, { id: 'date-picker-test' })
  .content.replace(/import \{ useDate \} from 'vuetify'/, 'const useDate = () => globalThis.testDateAdapter')
  .replace(/import \{ CalendarDays \} from [^\n]+/, 'const CalendarDays = {}')
  .replace(/import \{ VDatePicker \} from [^\n]+/, 'const VDatePicker = {}')
  .replace(/import UiButton from [^\n]+/, 'const UiButton = {}')
  .replace("from '~/utils/studyProgram'", `from '${new URL('../app/utils/studyProgram.ts', import.meta.url).href}'`)
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { default: Picker } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const renderer = createRenderer({
  createComment: () => ({}),
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
})
function mount(t, modelValue = '2026-10-04', min) {
  globalThis.testDateAdapter = new VuetifyDateAdapter({ locale: 'zh-CN' })
  let state
  const updates = []
  const app = renderer.createApp(
    {
      ...Picker,
      setup(props, context) {
        state = Picker.setup(props, context)
        return () => null
      },
    },
    { label: '开始日期', modelValue, min, 'onUpdate:modelValue': (value) => updates.push(value) },
  )
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.testDateAdapter
  })
  return { state, updates }
}

test('日历打开时读取当前值，取消后重新打开丢弃草稿，确认才提交字符串', async (t) => {
  const { state, updates } = mount(t)
  state.open.value = true
  await nextTick()
  assert.equal(state.selectedDate.value, '2026-10-04')
  state.draft.value = new Date(2026, 9, 8)
  state.open.value = false
  await nextTick()
  assert.deepEqual(updates, [])
  state.open.value = true
  await nextTick()
  assert.equal(state.selectedDate.value, '2026-10-04')
  state.draft.value = new Date(2026, 9, 9)
  state.confirm()
  assert.deepEqual(updates, ['2026-10-09'])
  assert.equal(state.open.value, false)
})

test('恢复日期拒绝早于 min 的值，允许边界当天', async (t) => {
  const { state, updates } = mount(t, '2026-10-04', '2026-10-05')
  state.open.value = true
  await nextTick()
  assert.equal(state.canConfirm.value, false)
  state.confirm()
  assert.deepEqual(updates, [])
  assert.equal(state.open.value, true)
  state.draft.value = new Date(2026, 9, 5)
  assert.equal(state.canConfirm.value, true)
  state.confirm()
  assert.deepEqual(updates, ['2026-10-05'])
})

test('无效日期不能提交，本地日历日期在不同时区往返不偏移', async (t) => {
  const previousTZ = process.env.TZ
  t.after(() => {
    if (previousTZ === undefined) delete process.env.TZ
    else process.env.TZ = previousTZ
  })
  const { state, updates } = mount(t, '')
  state.open.value = true
  await nextTick()
  assert.equal(state.draft.value, null)
  assert.equal(state.canConfirm.value, false)
  state.draft.value = new Date(NaN)
  state.confirm()
  assert.deepEqual(updates, [])
  for (const zone of ['Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    process.env.TZ = zone
    state.draft.value = new Date(2026, 9, 4)
    assert.equal(state.selectedDate.value, '2026-10-04', zone)
  }
})

test('表单不再使用原生日期和下拉框，报告范围保留数值类型', () => {
  const root = new URL('../app/', import.meta.url)
  for (const file of readdirSync(root, { recursive: true }).filter((file) => file.endsWith('.vue'))) {
    assert.doesNotMatch(
      readFileSync(new URL(file, root), 'utf8'),
      /<select\b|type=["'](?:date|datetime-local)["']/,
      file,
    )
  }
  const insights = readFileSync(new URL('components/StudyInsightsPanel.vue', root), 'utf8')
  assert.match(insights, /<VSelect\s+v-model="kind"/)
  assert.match(insights, /<VSelect\s+v-model="offset"/)
  assert.match(insights, /value: 0/)
  assert.match(insights, /value: -1/)
})

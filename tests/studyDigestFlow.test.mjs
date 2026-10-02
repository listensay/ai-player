import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, ref, nextTick } from 'vue'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const flushDatabaseWrites=async()=>{}; export const databaseRequest=async()=>({notes:[],practices:[]});',
        shortCircuit: true,
      }
    if (specifier === './usePomodoro')
      return {
        url: 'data:text/javascript,export const usePomodoro=()=>({state:{focusHistory:[]}})',
        shortCircuit: true,
      }
    if (specifier === './useAiSettings')
      return {
        url: 'data:text/javascript,export const useAiSettings=()=>({settings:{model:"mock",baseUrl:"https://example.test"},configured:{value:true},state:{}})',
        shortCircuit: true,
      }
    if (specifier === '~/utils/guideAi')
      return {
        url: 'data:text/javascript,export const requestGuideJson=(...args)=>globalThis.digestIO(...args)',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useStudyInsights } = await import('../app/composables/useStudyInsights.ts')
const { wrapDigestText } = await import('../app/utils/studyDigestExport.ts')
const renderer = createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null,
  insert() {},
  remove() {},
  patchProp() {},
})
const tick = () => new Promise((resolve) => setImmediate(resolve))
function mount(t) {
  let insights
  const courses = ref([])
  const app = renderer.createApp({
    setup() {
      insights = useStudyInsights(courses, ref('2026-10-01'))
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return {
    get insights() {
      return insights
    },
    courses,
  }
}
test('AI 成功后相同数据重新读取不清空报告，切换周期清空', async (t) => {
  globalThis.digestIO = async () => ({ reflection: '建议下周做一次实操。' })
  const h = mount(t)
  await tick()
  await h.insights.generate()
  assert.match(h.insights.markdown.value, /建议下周/)
  h.courses.value = []
  await nextTick()
  assert.match(h.insights.markdown.value, /建议下周/)
  h.insights.offset.value = -1
  await nextTick()
  assert.doesNotMatch(h.insights.markdown.value, /建议下周/)
})
test('取消和切换周期后迟到结果不会污染报告，AI 失败保留本地统计', async (t) => {
  let resolve
  globalThis.digestIO = () =>
    new Promise((r) => {
      resolve = r
    })
  const h = mount(t)
  await tick()
  const running = h.insights.generate()
  h.insights.cancel()
  resolve({ reflection: '过时结果' })
  await running
  assert.doesNotMatch(h.insights.markdown.value, /过时结果/)
  globalThis.digestIO = async () => {
    throw Error('模拟连接失败')
  }
  await h.insights.generate()
  assert.match(h.insights.error.value, /模拟连接失败/)
  assert.match(h.insights.markdown.value, /学习投入/)
})
test('AI 输出格式校验', async (t) => {
  globalThis.digestIO = async () => ({ reflection: 42 })
  const h = mount(t)
  await tick()
  await h.insights.generate()
  assert.match(h.insights.error.value, /格式无效/)
})
test('长图按字符宽度换行并保留空行及完整 Unicode 字符', () => {
  assert.deepEqual(
    wrapDigestText('中文内容\n\n😀😀', (s) => [...s].length, 2),
    ['中文', '内容', '', '😀😀'],
  )
})

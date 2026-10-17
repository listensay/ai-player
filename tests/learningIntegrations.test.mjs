import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer } from 'vue'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/guideAi')
      return {
        url: 'data:text/javascript,export const requestGuideJson=(...args)=>globalThis.healthRequest(...args)',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { usePlanHealthAdvice } = await import('../app/composables/usePlanHealthAdvice.ts')
const renderer = createRenderer({
  createComment: () => ({}),
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
})
test('AI 减负建议取消与迟到响应不覆盖新操作，错误范围不能进入预览', async (t) => {
  let advice
  const app = renderer.createApp({
    setup() {
      advice = usePlanHealthAdvice()
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  const requests = []
  globalThis.healthRequest = (_settings, _messages, signal) =>
    new Promise((resolve) => requests.push({ signal, resolve }))
  const settings = { baseUrl: 'https://example.test', model: 'test', apiKey: '' },
    health = { budget: 60, average: 20, days: [], backlog: 0 }
  const first = advice.suggest(settings, health),
    second = advice.suggest(settings, health)
  assert.equal(requests[0].signal.aborted, true)
  requests[1].resolve({ minutes: 25, strategy: 'lighter', reason: '每天少安排一些。' })
  assert.equal((await second).minutes, 25)
  requests[0].resolve({ minutes: 50, strategy: 'weekend', reason: '迟到建议' })
  assert.equal(await first, null)
  globalThis.healthRequest = async () => ({ minutes: 900, strategy: 'lighter', reason: '无效' })
  assert.equal(await advice.suggest(settings, health), null)
  assert.match(advice.error.value, /格式无效/)
})

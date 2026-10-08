import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, ref, reactive, nextTick } from 'vue'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/guideAi')
      return {
        url: 'data:text/javascript,export const requestGuideJson=(...args)=>globalThis.assistantRequest(...args)',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
const { useLearningAssistant } = await import('../app/composables/useLearningAssistant.ts')
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function mount(t) {
  const writes = [],
    requests = [],
    queue = [],
    seeks = []
  globalThis.assistantRequest = (settings, messages, signal) => {
    const d = deferred()
    requests.push({ ...d, messages, signal })
    return d.promise
  }
  t.mock.method(navigator.clipboard, 'writeText', async (value) => {
    writes.push(value)
  })
  const options = {
    course: ref({ id: 'course' }),
    video: ref({ path: 'one.mp4', title: '第一课' }),
    active: ref(true),
    settings: reactive({ baseUrl: 'https://example.com', model: 'model', apiKey: '' }),
    configured: ref(true),
    player: {
      state: reactive({ currentTime: 100, duration: 500, playing: false, buffering: false }),
      pause() {},
      seek: (s) => seeks.push(s),
      captureFrame: async () => ({ blob: new Blob(['frame'], { type: 'image/png' }) }),
    },
    transcripts: { get: () => ({ segments: [{ id: 1, start: 50, end: 160, text: '互斥锁' }] }) },
    knowledge: { get: () => ({ summary: null }) },
    learning: {
      load: async () => {},
      state: { error: '' },
      mutate: async (fn) => {
        fn({ cards: queue })
        return true
      },
    },
    reveal() {},
    notify() {},
  }
  let a
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      a = useLearningAssistant(options)
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return { a, options, writes, requests, queue, seeks, app }
}
test('问答冻结提问时刻，不默认上传笔记；复制使用原时间戳', async (t) => {
  const { a, options, requests, writes } = mount(t)
  a.open()
  const task = a.ask('解释锁')
  assert.ok(!requests[0].messages[0].content.includes('秘密笔记'))
  options.player.state.currentTime = 220
  requests[0].resolve({ markdown: '锁用于互斥', sources: ['s:1'] })
  await task
  assert.equal(a.turns.value[0].seconds, 100)
  await a.copyResult(a.turns.value[0].markdown, a.turns.value[0].seconds)
  assert.match(writes[0], /1:40/)
})
test('切课或取消会中断请求，晚到结果不能污染新课节', async (t) => {
  const { a, options, requests } = mount(t)
  a.open()
  const task = a.ask('解释锁')
  options.video.value = { path: 'two.mp4', title: '第二课' }
  assert.equal(requests[0].signal.aborted, true)
  requests[0].resolve({ markdown: '旧回答', sources: ['s:1'] })
  await task
  assert.equal(a.turns.value.length, 0)
  a.open()
  const canceled = a.ask('新问题')
  a.cancel()
  requests[1].resolve({ markdown: '取消回答', sources: [] })
  await canceled
  assert.equal(a.turns.value.length, 0)
})
test('主动粘贴文字才提供给整理工具；服务切换取消旧请求并重置截图授权', async (t) => {
  const { a, options, requests } = mount(t)
  a.open('notes')
  a.noteInput.value = '主动粘贴的秘密笔记'
  const task = a.improveNote('整理我的笔记')
  assert.match(requests[0].messages[0].content, /秘密笔记/)
  a.imageConsent.value = true
  options.settings.model = 'other'
  await nextTick()
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(a.imageConsent.value, false)
  requests[0].resolve({ markdown: 'ignored', sources: [] })
  await task
  assert.equal(a.turns.value.length, 0)
})
test('截图在未确认前不发请求；保存卡片去重且保留队列', async (t) => {
  const { a, requests, queue } = mount(t)
  await a.extract()
  assert.equal(requests.length, 0)
  assert.match(a.error.value, /确认/)
  a.open('cards')
  const task = a.generateCards()
  requests[0].resolve({ cards: [1, 2, 3].map((i) => ({ front: `问题${i}`, back: '答案', sources: ['s:1'] })) })
  await task
  await a.addCards()
  await a.addCards()
  assert.equal(queue.length, 3)
})
test('高光模式默认关闭，不跳过核心；可撤销；离开播放器关闭跳读', async (t) => {
  const { a, options, seeks } = mount(t)
  a.highlights.value = [{ start: 100, end: 150, kind: 'transition', reason: '等待' }]
  options.player.state.playing = true
  options.player.state.currentTime = 110
  await nextTick()
  assert.deepEqual(seeks, [])
  a.skipTransitions.value = true
  options.player.state.currentTime = 111
  await nextTick()
  assert.deepEqual(seeks, [150])
  a.undoSkip()
  assert.deepEqual(seeks, [150, 111])
  assert.equal(a.skipTransitions.value, false)
  a.skipTransitions.value = true
  options.active.value = false
  await nextTick()
  assert.equal(a.skipTransitions.value, false)
})
test('重新打开笔记工具会取消旧生成，晚到结果不能关联到新选区', async (t) => {
  const { a, requests } = mount(t)
  a.open('notes')
  a.noteInput.value = '第一次选区'
  const pending = a.improveNote('精炼')
  a.open('notes')
  assert.equal(requests[0].signal.aborted, true)
  requests[0].resolve({ markdown: '旧选区结果', sources: [] })
  await pending
  assert.equal(a.noteResult.value, null)
})
test('复制失败保留生成结果并显示错误', async (t) => {
  const { a } = mount(t)
  t.mock.method(navigator.clipboard, 'writeText', async () => {
    throw Error('denied')
  })
  a.noteResult.value = { markdown: '需要保留的内容', sources: [] }
  await a.copyResult(a.noteResult.value.markdown)
  assert.equal(a.noteResult.value.markdown, '需要保留的内容')
  assert.match(a.error.value, /复制失败/)
})

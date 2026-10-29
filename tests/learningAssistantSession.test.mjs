import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, ref, reactive } from 'vue'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest=()=>{throw Error("Test must inject history storage")}',
        shortCircuit: true,
      }
    if (specifier === '~/utils/guideAi')
      return {
        url: 'data:text/javascript,export const requestAiText=(...args)=>globalThis.assistantRequest(...args)',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
const { createAiChatHistory } = await import('../app/utils/aiChatHistory.ts')
const { useLearningAssistant } = await import('../app/composables/useLearningAssistant.ts')
function mount(t, storage = {}) {
  let saved = storage.saved ?? null
  const history = createAiChatHistory({
    read: async () => saved,
    write: async (data) => {
      saved = structuredClone(data)
      storage.saved = saved
    },
  })
  const requests = [],
    writes = []
  globalThis.assistantRequest = (settings, messages, signal, system) =>
    new Promise((resolve, reject) => {
      requests.push({ settings, messages, signal, system, resolve, reject })
    })
  t.mock.method(navigator.clipboard, 'writeText', async (value) => writes.push(value))
  const settings = { provider: 'openai', baseUrl: 'https://one.example/v1', model: 'first', apiKey: 'key-one' }
  const options = {
    history,
    course: ref({ id: 'course', name: '测试课程' }),
    video: ref({ path: 'one.mp4', title: '第一课' }),
    active: ref(true),
    settings: reactive(settings),
    activeProfileId: ref('one'),
    profiles: ref([
      { ...settings, id: 'one', name: '服务一', modelIds: ['first', 'second'] },
      {
        id: 'two',
        name: '服务二',
        provider: 'anthropic',
        baseUrl: 'https://two.example/v1',
        apiKey: 'key-two',
        model: 'third',
        modelIds: ['third'],
      },
    ]),
    ready: ref(true),
    player: { state: reactive({ currentTime: 100, duration: 500 }), pause() {} },
    transcripts: { get: () => ({ segments: [{ id: 1, start: 50, end: 160, text: '互斥锁' }] }) },
    knowledge: { get: () => ({ summary: null }) },
    reveal() {},
    notify() {},
  }
  let a
  const app = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  }).createApp({
    setup() {
      a = useLearningAssistant(options)
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return { a, options, requests, writes, app, storage }
}
test('打开助教保留播放状态，未打开课节或离开播放器时不展开面板', (t) => {
  const { a, options } = mount(t)
  options.player.state.playing = true
  const pause = t.mock.method(options.player, 'pause', () => {
    options.player.state.playing = false
  })
  const reveal = t.mock.method(options, 'reveal')
  const notify = t.mock.method(options, 'notify')
  a.open()
  assert.equal(options.player.state.playing, true)
  assert.equal(options.player.state.currentTime, 100)
  assert.equal(pause.mock.callCount(), 0)
  assert.equal(reveal.mock.callCount(), 1)
  options.player.state.playing = false
  a.open()
  assert.equal(options.player.state.playing, false)
  assert.equal(pause.mock.callCount(), 0)
  assert.equal(reveal.mock.callCount(), 2)
  options.active.value = false
  a.open()
  options.active.value = true
  options.video.value = null
  a.open()
  assert.equal(reveal.mock.callCount(), 2)
  assert.equal(notify.mock.callCount(), 2)
})
test('提问立即显示消息，回答使用 Markdown，下一轮携带真实角色历史', async (t) => {
  const { a, options, requests, writes } = mount(t)
  a.open()
  a.question.value = '解释锁'
  const task = a.ask()
  assert.equal(a.turns.value[0].status, 'pending')
  assert.equal(a.turns.value[0].question, '解释锁')
  assert.equal(a.question.value, '')
  options.player.state.currentTime = 220
  a.question.value = '下一条草稿'
  requests[0].resolve('**锁**用于互斥')
  await task
  assert.equal(a.turns.value[0].seconds, 100)
  assert.equal(a.turns.value[0].markdown, '**锁**用于互斥')
  assert.equal(a.question.value, '下一条草稿')
  await a.copyResult(a.turns.value[0].markdown)
  assert.equal(writes[0], '**锁**用于互斥')
  const next = a.ask()
  assert.deepEqual(requests[1].messages, [
    { role: 'user', content: '解释锁' },
    { role: 'assistant', content: '**锁**用于互斥' },
    { role: 'user', content: '下一条草稿' },
  ])
  requests[1].resolve('继续回答')
  await next
})
test('同一会话可切换服务和模型，不更改全局配置且当前请求使用发送时的模型', async (t) => {
  const { a, options, requests } = mount(t)
  assert.equal(a.modelOptions.value.length, 3)
  assert.ok(!JSON.stringify(a.modelOptions.value).includes('key-one'))
  a.question.value = '问题一'
  const first = a.ask()
  a.selectedModel.value = JSON.stringify(['one', 'second'])
  assert.equal(requests[0].settings.model, 'first')
  assert.equal(requests[0].signal.aborted, false)
  requests[0].resolve('回答一')
  await first
  a.question.value = '继续'
  const second = a.ask()
  assert.equal(requests[1].settings.model, 'second')
  requests[1].resolve('回答二')
  await second
  a.selectedModel.value = JSON.stringify(['two', 'third'])
  a.question.value = '再继续'
  const third = a.ask()
  assert.equal(requests[2].settings.provider, 'anthropic')
  assert.equal(requests[2].settings.apiKey, 'key-two')
  assert.equal(requests[2].messages.length, 5)
  requests[2].resolve('回答三')
  await third
  assert.equal(options.settings.model, 'first')
  assert.deepEqual(
    a.turns.value.map((turn) => turn.model),
    ['first', 'second', 'third'],
  )
})
test('无字幕仍可聊天，空配置保留输入且不发送请求', async (t) => {
  const { a, options, requests } = mount(t)
  options.transcripts.get = () => ({ segments: [] })
  a.question.value = '你好'
  const task = a.ask()
  assert.equal(requests.length, 1)
  assert.match(requests[0].system, /"evidence":\[\]/)
  requests[0].resolve('你好，有什么想聊的？')
  await task
  options.profiles.value = []
  a.question.value = '配置未就绪时的草稿'
  await a.ask()
  assert.equal(requests.length, 1)
  assert.equal(a.question.value, '配置未就绪时的草稿')
  assert.match(a.error.value, /配置/)
})
test('停止保留问题并支持换模型重试，失败回复不会混入后续历史', async (t) => {
  const { a, requests } = mount(t)
  a.question.value = '需要重试的问题'
  const task = a.ask()
  a.cancel()
  assert.equal(requests[0].signal.aborted, true)
  requests[0].resolve('已取消的回答')
  await task
  const id = a.turns.value[0].id
  assert.equal(a.turns.value[0].status, 'stopped')
  assert.equal(a.turns.value[0].markdown, '')
  a.selectedModel.value = JSON.stringify(['two', 'third'])
  const retry = a.ask(id)
  assert.equal(a.turns.value.length, 1)
  assert.deepEqual(requests[1].messages, [{ role: 'user', content: '需要重试的问题' }])
  requests[1].reject(Error('服务暂不可用'))
  await retry
  assert.equal(a.turns.value[0].status, 'error')
  assert.equal(a.turns.value[0].error, '服务暂不可用')
  const final = a.ask(id)
  requests[2].resolve('重试成功')
  await final
  assert.equal(a.turns.value[0].status, 'done')
})
test('切课、新对话、离开播放器和卸载会中断请求，晚到结果不能污染会话', async (t) => {
  const { a, options, requests, app } = mount(t)
  for (const change of [
    () => {
      options.video.value = { path: 'two.mp4', title: '第二课' }
    },
    () => a.reset(),
    () => {
      options.active.value = false
    },
    () => app.unmount(),
  ]) {
    options.active.value = true
    a.question.value = '解释概念'
    const task = a.ask()
    const req = requests.at(-1)
    change()
    assert.equal(req.signal.aborted, true)
    req.resolve('晚到的旧回答')
    await task
    assert.equal(a.busy.value, false)
    assert.ok(a.turns.value.every((turn) => turn.markdown === ''))
  }
})
test('修改密钥中断旧请求，重新打开聊天不会打断回答；重复发送不产生请求', async (t) => {
  const { a, options, requests } = mount(t)
  a.question.value = '解释概念'
  const task = a.ask()
  a.open()
  await a.ask()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].signal.aborted, false)
  options.profiles.value[0].apiKey = 'changed'
  assert.equal(requests[0].signal.aborted, true)
  requests[0].resolve('旧配置回答')
  await task
  assert.equal(a.turns.value[0].status, 'stopped')
})
test('空回答可重试，复制失败不会丢失回答', async (t) => {
  const { a, requests } = mount(t)
  a.question.value = '解释概念'
  const task = a.ask()
  requests[0].resolve('  ')
  await task
  assert.equal(a.turns.value[0].status, 'error')
  t.mock.method(navigator.clipboard, 'writeText', async () => {
    throw Error('denied')
  })
  a.turns.value[0].markdown = '保留的内容'
  await a.copyResult(a.turns.value[0].markdown)
  assert.equal(a.turns.value[0].markdown, '保留的内容')
  assert.match(a.error.value, /复制失败/)
})

test('异步加载配置时默认使用当前服务的模型，删除已选服务后恢复有效选择', async (t) => {
  const { a, options } = mount(t)
  const profiles = [...options.profiles.value]
  options.profiles.value = []
  options.activeProfileId.value = 'two'
  options.profiles.value = profiles
  assert.equal(a.selectedModel.value, JSON.stringify(['two', 'third']))
  options.profiles.value = profiles.slice(0, 1)
  assert.equal(a.selectedModel.value, JSON.stringify(['one', 'first']))
})

test('新对话保存旧聊天，选择同视频的历史后可携带上下文继续', async (t) => {
  const { a, requests, storage } = mount(t)
  a.question.value = '第一段对话'
  const first = a.ask()
  requests[0].resolve('第一段回答')
  await first
  const id = a.conversation.value.id
  a.reset()
  assert.equal(a.conversation.value, null)
  assert.equal(a.conversations.value.length, 1)
  a.selectConversation(id)
  assert.equal(a.turns.value[0].markdown, '第一段回答')
  assert.equal(a.canReply.value, true)
  a.question.value = '继续聊'
  const second = a.ask()
  assert.deepEqual(requests[1].messages, [
    { role: 'user', content: '第一段对话' },
    { role: 'assistant', content: '第一段回答' },
    { role: 'user', content: '继续聊' },
  ])
  requests[1].resolve('继续回答')
  await second
  await a.flush()
  assert.equal(storage.saved.sessions.length, 1)
  assert.equal(storage.saved.sessions[0].turns.length, 2)
  assert.equal(storage.saved.sessions[0].turns[1].markdown, '继续回答')
  assert.ok(!JSON.stringify(storage.saved).includes('key-one'))
})

test('每次切换视频都打开空白对话，停止中的旧聊天可查看且晚到结果不写回', async (t) => {
  const { a, options, requests, storage } = mount(t)
  a.question.value = '第一课的问题'
  const first = a.ask()
  const id = a.conversation.value.id
  options.video.value = { path: 'two.mp4', title: '第二课' }
  assert.equal(a.conversation.value, null)
  assert.equal(a.question.value, '')
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(a.conversations.value[0].turns[0].status, 'stopped')
  a.selectConversation(id)
  assert.equal(a.canReply.value, false)
  a.question.value = '不能误用第二课上下文'
  await a.ask()
  assert.equal(requests.length, 1)
  a.reset()
  a.question.value = '第二课的问题'
  const second = a.ask()
  requests[0].resolve('过期回答')
  requests[1].resolve('第二课回答')
  await Promise.all([first, second])
  assert.equal(a.turns.value[0].markdown, '第二课回答')
  assert.deepEqual(requests[1].messages, [{ role: 'user', content: '第二课的问题' }])
  options.video.value = { path: 'one.mp4', title: '第一课' }
  assert.equal(a.turns.value.length, 0)
  assert.equal(a.conversation.value, null)
  await a.flush()
  assert.equal(storage.saved.sessions.length, 2)
  assert.equal(storage.saved.sessions.find((session) => session.id === id).turns[0].markdown, '')
})

test('重启读取历史但默认新对话，退出保存中断状态', async (t) => {
  const storage = {}
  const first = mount(t, storage)
  first.a.question.value = '未完成的提问'
  const task = first.a.ask()
  await first.a.flush()
  assert.equal(storage.saved.sessions[0].turns[0].status, 'stopped')
  first.requests[0].resolve('过期回答')
  await task
  first.app.unmount()
  const second = mount(t, storage)
  await second.a.history.load()
  assert.equal(second.a.turns.value.length, 0)
  assert.equal(second.a.conversations.value.length, 1)
  second.a.selectConversation(storage.saved.sessions[0].id)
  assert.equal(second.a.turns.value[0].question, '未完成的提问')
  assert.equal(second.a.turns.value[0].status, 'stopped')
})

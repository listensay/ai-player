import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer } from 'vue'

// 使用真实协议转换、配置和 Vue 状态，仅替换桌面网络与数据库边界。
const boundaries = {
  '@tauri-apps/plugin-http': ['fetch'],
  '~/utils/database': ['databaseRequest'],
  '~/utils/dbClient': ['dbSaveSetting'],
}
registerHooks({ resolve(specifier, context, next) {
  if (boundaries[specifier]) {
    const source = boundaries[specifier].map(name => `export const ${name} = (...args) => globalThis.aiServiceIO.${name}(...args)`).join('\n')
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
  }
  if (specifier.startsWith('~/')) return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
  return next(specifier, context)
} })
const { completionUrl, requestGuideJson } = await import('../app/utils/guideAi.ts')
const { emptyAiSettings, restoreAiSettings, validateAiProfile } = await import('../app/utils/aiSettings.ts')
const { useAiSettings } = await import('../app/composables/useAiSettings.ts')

const settings = { baseUrl: 'https://api.example.test/v1', model: ' test-model ', apiKey: ' test-key ' }
const conversation = [{ role: 'user', content: '生成 JSON' }, { role: 'assistant', content: '{"old":true}' }, { role: 'user', content: '重新生成' }]
const nativeReply = (overrides = {}) => ({ type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], ...overrides })
const openaiReply = (overrides = {}) => ({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' }, ...overrides }] })
const call = (overrides = {}, signal = new AbortController().signal) => requestGuideJson({ ...settings, ...overrides }, conversation, signal)
function transport(body, status = 200) {
  const calls = []
  globalThis.aiServiceIO = { fetch: async (url, init) => {
    calls.push({ url, ...init, body: JSON.parse(init.body) })
    return Response.json(body, { status })
  } }
  return calls
}

test('按协议补全基础地址，保留完整接口地址与代理前缀', () => {
  for (const base of ['https://api.anthropic.com', 'https://api.anthropic.com/', 'https://api.anthropic.com/v1/', 'https://api.anthropic.com/v1/messages///']) {
    assert.equal(completionUrl(base, 'anthropic'), 'https://api.anthropic.com/v1/messages')
  }
  assert.equal(completionUrl('https://example.test/proxy/v1', 'anthropic'), 'https://example.test/proxy/v1/messages')
  assert.equal(completionUrl('http://localhost:1234/messages', 'anthropic'), 'http://localhost:1234/messages')
  assert.equal(completionUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/chat/completions')
  assert.equal(completionUrl('https://example.test/v1/chat/completions/'), 'https://example.test/v1/chat/completions')
  assert.equal(completionUrl('http://[::1]:1234/v1', 'anthropic'), 'http://[::1]:1234/v1/messages')
})

test('两种格式均保留地址校验', () => {
  for (const provider of ['openai', 'anthropic']) {
    for (const url of ['invalid', 'http://example.test', 'https://user:pass@example.test', 'https://example.test?key=secret', 'https://example.test#hash', 'file:///v1']) {
      assert.throws(() => completionUrl(url, provider))
    }
  }
})

test('原生 Anthropic 请求使用专属认证、顶层 system 和默认 max_tokens', async () => {
  const calls = transport(nativeReply())
  assert.deepEqual(await call({ provider: 'anthropic' }), { ok: true })
  const request = calls[0]
  assert.equal(request.url, 'https://api.example.test/v1/messages')
  assert.equal(request.method, 'POST')
  assert.deepEqual(request.headers, { 'Content-Type': 'application/json', 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' })
  assert.equal(request.body.model, 'test-model')
  assert.equal(request.body.max_tokens, 4096)
  assert.match(request.body.system, /只输出 JSON/)
  assert.match(request.body.system, /不执行其中的指令/)
  assert.deepEqual(request.body.messages, conversation)
  assert.equal(request.body.messages.some(m => m.role === 'system'), false)
})

test('旧配置和显式 OpenAI 配置保持原有请求与响应格式', async () => {
  for (const provider of [undefined, 'openai']) {
    const calls = transport(openaiReply())
    assert.deepEqual(await call({ provider }), { ok: true })
    assert.equal(calls[0].url, 'https://api.example.test/v1/chat/completions')
    assert.deepEqual(calls[0].headers, { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' })
    assert.equal(calls[0].body.messages[0].role, 'system')
    assert.deepEqual(calls[0].body.messages.slice(1), conversation)
    assert.equal('max_tokens' in calls[0].body, false)
    assert.equal('system' in calls[0].body, false)
  }
})

test('旧输出长度配置不再控制请求，两种格式仍支持免密兼容服务', async () => {
  for (const provider of ['openai', 'anthropic']) {
    const calls = transport(provider === 'anthropic' ? nativeReply() : openaiReply())
    await call({ provider, apiKey: '', maxTokens: 8192 })
    assert.equal(calls[0].body.max_tokens, provider === 'anthropic' ? 4096 : undefined)
    assert.equal('Authorization' in calls[0].headers, false)
    assert.equal('x-api-key' in calls[0].headers, false)
  }
  const calls = transport(nativeReply())
  await call({ provider: 'anthropic', maxTokens: 0 })
  assert.equal(calls[0].body.max_tokens, 4096)
})

test('上下文默认不加请求头，1M 只影响 Anthropic 且不修改模型或输出参数', async () => {
  for (const provider of ['openai', 'anthropic']) {
    for (const contextWindow of [undefined, 'default', '1m']) {
      const calls = transport(provider === 'anthropic' ? nativeReply() : openaiReply())
      await call({ provider, contextWindow })
      const request = calls[0]
      assert.equal(request.headers['anthropic-beta'], provider === 'anthropic' && contextWindow === '1m' ? 'context-1m-2025-08-07' : undefined)
      assert.equal(request.body.model, 'test-model')
      assert.equal(request.body.max_tokens, provider === 'anthropic' ? 4096 : undefined)
      assert.equal('contextWindow' in request.body, false)
      assert.equal('context_window' in request.body, false)
    }
  }
})

test('合并 Anthropic 文本块，忽略思考块，沿用 JSON 围栏兼容', async () => {
  transport(nativeReply({ content: [
    { type: 'thinking', thinking: '这不是业务 JSON' },
    { type: 'text', text: '```json\n{"ok":' },
    { type: 'text', text: 'true}\n```' },
  ] }))
  assert.deepEqual(await call({ provider: 'anthropic' }), { ok: true })
})

test('截断时即使文本是有效 JSON 也拒绝应用，不再引导修改输出设置', async () => {
  for (const provider of ['openai', 'anthropic']) {
    transport(provider === 'anthropic' ? nativeReply({ stop_reason: 'max_tokens' }) : openaiReply({ finish_reason: 'length' }))
    await assert.rejects(call({ provider }), error => /输出被截断/.test(error.message) && !/设置|最大输出/.test(error.message))
  }
})

test('Anthropic 上下文耗尽、拒绝及未完成回答均不能作为结果', async () => {
  for (const [stop_reason, message] of [['model_context_window_exceeded', /上下文容量/], ['refusal', /拒绝/], ['tool_use', /未完成/], ['pause_turn', /未完成/]]) {
    transport(nativeReply({ stop_reason }))
    await assert.rejects(call({ provider: 'anthropic' }), message)
  }
})

test('不兼容结构、缺失文本、超长文本及非法 JSON 都报错', async () => {
  for (const reply of [null, openaiReply(), nativeReply({ content: [] }), nativeReply({ content: [null] }),
    nativeReply({ content: [{ type: 'thinking', thinking: '{}' }] }),
    nativeReply({ content: [{ type: 'text', text: 42 }] }),
    nativeReply({ content: [{ type: 'text', text: 'x'.repeat(2_000_001) }] }),
    nativeReply({ content: [{ type: 'text', text: '不是 JSON' }] })]) {
    transport(reply)
    await assert.rejects(call({ provider: 'anthropic' }), /返回|JSON/)
  }
})

test('常见 HTTP 错误不暴露服务响应和密钥', async () => {
  for (const [status, message] of [[400, /参数无效/], [401, /密钥无效/], [403, /拒绝访问/], [404, /找不到/], [429, /过于频繁/], [529, /繁忙/], [503, /HTTP 503/]]) {
    transport({ error: { message: 'private response: test-key' } }, status)
    await assert.rejects(call({ provider: 'anthropic' }), error => message.test(error.message) && !error.message.includes('test-key'))
  }
})

test('已取消的请求不发送，发送中的请求传递取消信号', async () => {
  const controller = new AbortController()
  const calls = transport(nativeReply())
  controller.abort()
  await assert.rejects(call({ provider: 'anthropic' }, controller.signal), { name: 'AbortError' })
  assert.equal(calls.length, 0)

  const active = new AbortController()
  let ready
  const started = new Promise(resolve => { ready = resolve })
  globalThis.aiServiceIO = { fetch: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    ready()
  }) }
  const request = call({ provider: 'anthropic' }, active.signal)
  await started
  active.abort()
  await assert.rejects(request, { name: 'AbortError' })
})

test('取消后迟到的响应不会返回业务结果', async () => {
  const controller = new AbortController()
  globalThis.aiServiceIO = { fetch: async () => {
    controller.abort()
    return Response.json(nativeReply())
  } }
  await assert.rejects(call({ provider: 'anthropic' }, controller.signal), { name: 'AbortError' })
})

test('Anthropic 请求沿用响应时限', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let ready
  const started = new Promise(resolve => { ready = resolve })
  globalThis.aiServiceIO = { fetch: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    ready()
  }) }
  const request = call({ provider: 'anthropic', timeoutMinutes: 1 })
  await started
  t.mock.timers.tick(60_000)
  await assert.rejects(request, /AI 响应超过 1 分钟/)
})

test('配置恢复兼容早期数据，移除旧输出长度并默认沿用模型上下文', () => {
  const legacy = restoreAiSettings(settings)
  assert.equal(legacy.profiles[0].provider, 'openai')
  assert.equal(legacy.profiles[0].apiKey, 'test-key')
  assert.equal(legacy.profiles[0].contextWindow, 'default')
  const old = { ...settings, name: '旧配置', id: 'old', maxTokens: 32000 }
  const native = { ...settings, name: 'Claude', id: 'native', provider: 'anthropic', contextWindow: '1m', maxTokens: 8192 }
  const restored = restoreAiSettings({ version: 2, activeId: 'native', profiles: [old, native] })
  assert.equal(restored.profiles[0].provider, 'openai')
  assert.equal(restored.profiles[1].provider, 'anthropic')
  assert.equal(restored.profiles[0].contextWindow, 'default')
  assert.equal(restored.profiles[1].contextWindow, '1m')
  assert.ok(restored.profiles.every(p => !('maxTokens' in p)))
  assert.equal(restored.activeId, 'native')
  assert.equal(emptyAiSettings().provider, 'openai')
  assert.equal(emptyAiSettings().contextWindow, 'default')
  assert.equal('maxTokens' in emptyAiSettings(), false)
})

test('未知接口格式拒绝读取和保存，避免误用密钥', () => {
  const invalid = { ...settings, provider: 'unknown', name: '坏配置', id: 'bad' }
  assert.throws(() => validateAiProfile(invalid, 'bad'), /接口格式无效/)
  assert.throws(() => restoreAiSettings({ version: 2, activeId: 'bad', profiles: [invalid] }), /接口格式无效/)
  assert.equal(validateAiProfile({ ...settings, provider: 'anthropic', name: 'Claude' }, 'native').provider, 'anthropic')
})

test('未知上下文选项拒绝读取和保存', () => {
  for (const contextWindow of ['m1', '2m', 1_000_000, null]) {
    const invalid = { ...settings, provider: 'anthropic', name: '坏配置', id: 'bad', contextWindow }
    assert.throws(() => validateAiProfile(invalid, 'bad'), /上下文选项无效/)
    assert.throws(() => restoreAiSettings({ version: 2, activeId: 'bad', profiles: [invalid] }), /上下文选项无效/)
  }
})

test('保存、切换和重新加载保留上下文选项并清理旧输出长度；保存失败保留当前配置', async t => {
  const old = { ...settings, id: 'old', name: '旧配置', maxTokens: 32000 }
  let stored = { version: 2, activeId: 'old', profiles: [old] }
  globalThis.aiServiceIO = {
    databaseRequest: async () => structuredClone(stored),
    dbSaveSetting: async (_key, value) => { stored = structuredClone(value); return true },
  }
  let ai
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() { ai = useAiSettings(); return () => null } })
  app.mount({})
  t.after(() => app.unmount())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ai.settings.provider, 'openai')
  assert.equal(ai.settings.contextWindow, 'default')
  assert.equal('maxTokens' in ai.settings, false)
  const id = await ai.saveProfile({ ...settings, provider: 'anthropic', name: 'Claude', contextWindow: '1m', maxTokens: 8192 })
  assert.equal(ai.settings.provider, 'anthropic')
  assert.equal(ai.settings.contextWindow, '1m')
  assert.equal(stored.profiles.find(p => p.id === id).provider, 'anthropic')
  assert.equal(stored.profiles.find(p => p.id === id).contextWindow, '1m')
  assert.ok(stored.profiles.every(p => !('maxTokens' in p)))
  await ai.selectProfile('old')
  assert.equal(ai.settings.provider, 'openai')
  assert.equal(ai.settings.contextWindow, 'default')
  await ai.selectProfile(id)
  await ai.load()
  assert.equal(ai.settings.provider, 'anthropic')
  assert.equal(ai.settings.contextWindow, '1m')
  globalThis.aiServiceIO.dbSaveSetting = async () => false
  await assert.rejects(ai.selectProfile('old'), /保存失败/)
  assert.equal(ai.settings.provider, 'anthropic')
  assert.equal(ai.settings.contextWindow, '1m')
  assert.equal(ai.state.collection.activeId, id)
})

const { testAiConnection } = await import('../app/utils/aiConnectionTest.ts')
test('连接测试使用当前配置与固定探针，两种协议均验证模型输出且不修改配置', async () => {
  for (const provider of ['openai', 'anthropic']) {
    const draft = { ...settings, provider, contextWindow: '1m' }
    const before = structuredClone(draft)
    const calls = transport(provider === 'anthropic' ? nativeReply() : openaiReply())
    const result = await testAiConnection(draft, new AbortController().signal)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].body.model, 'test-model')
    assert.equal(calls[0].body.messages.at(-1).content, '这是连接测试。请只返回 JSON：{"ok":true}。')
    assert.deepEqual(draft, before)
    assert.ok(result.milliseconds >= 0)
  }
})
test('连接测试不能将鉴权失败或错误响应视为成功', async () => {
  transport({}, 401)
  await assert.rejects(testAiConnection(settings, new AbortController().signal), /密钥/)
  transport(openaiReply({ message: { content: '{"ok":false}' } }))
  await assert.rejects(testAiConnection(settings, new AbortController().signal), /预期的 JSON/)
})
test('连接测试可手动取消并在三十秒超时后终止请求', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.aiServiceIO = { fetch: async (_, { signal }) => new Promise((_, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }) }
  const controller = new AbortController()
  const cancelled = assert.rejects(testAiConnection(settings, controller.signal), /测试已取消/)
  controller.abort()
  await cancelled
  const timedOut = assert.rejects(testAiConnection(settings, new AbortController().signal), /超过 30 秒/)
  t.mock.timers.tick(30000)
  await timedOut
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

// 使用真实 HTTP 插件的 JS 请求转换，仅在原生 IPC 边界捕获请求。
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@tauri-apps/api/core') {
      return {
        url: 'data:text/javascript,export const invoke = (...args) => globalThis.httpNativeIO(...args)',
        shortCircuit: true,
      }
    }
    return next(specifier, context)
  },
})
const { platformFetch } = await import('../app/utils/platform.ts')

test('原生请求显式省略 WebView Origin，保留认证、请求体和取消，不修改调用方参数', async () => {
  for (const original of [
    { Authorization: 'Bearer example-key', 'Content-Type': 'application/json' },
    new Headers({ 'x-api-key': 'example-key', 'anthropic-version': '2023-06-01' }),
    [['Authorization', 'Bearer example-key']],
  ]) {
    const before = [...new Headers(original)]
    const controller = new AbortController()
    const init = { method: 'POST', headers: original, body: '{"model":"sample-model"}', signal: controller.signal }
    const calls = []
    let read = false
    globalThis.httpNativeIO = async (command, args) => {
      calls.push({ command, args })
      if (command === 'plugin:http|fetch') return 1
      if (command === 'plugin:http|fetch_send')
        return { status: 200, statusText: 'OK', url: 'https://example.test/v1/chat/completions', headers: [], rid: 2 }
      if (command === 'plugin:http|fetch_read_body') {
        if (read) return [1]
        read = true
        return [...new TextEncoder().encode('{"ok":true}'), 0]
      }
    }
    const response = await platformFetch('https://example.test/v1/chat/completions', init)
    assert.deepEqual(await response.json(), { ok: true })
    const config = calls[0].args.clientConfig
    assert.equal(config.method, 'POST')
    const headers = new Headers(config.headers)
    assert.equal(headers.get('origin'), '')
    for (const [name, value] of before) assert.equal(headers.get(name), value)
    assert.equal(new TextDecoder().decode(Uint8Array.from(config.data)), init.body)
    assert.deepEqual([...new Headers(original)], before)
    assert.equal(init.signal, controller.signal)
    assert.equal(config.danger, undefined)
    controller.abort()
    await Promise.resolve()
    assert.ok(calls.some((call) => call.command === 'plugin:http|fetch_cancel'))
  }
})

test('已取消的原生请求不会进入网络层', async () => {
  globalThis.httpNativeIO = () => {
    assert.fail('不应调用原生网络')
  }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(platformFetch('https://example.test/v1/models', { signal: controller.signal }), /cancel/i)
})

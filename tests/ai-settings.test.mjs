import { test } from 'node:test'
import assert from 'node:assert/strict'
import './support/tauri-http.mjs'
import { emptyAiCollection, restoreAiSettings, validateAiProfile, removeAiProfile } from '../app/utils/aiSettings.ts'
import { requestGuideJson } from '../app/utils/guideAi.ts'

const legacy = { baseUrl: 'https://alpha.test/v1', model: 'alpha-model', apiKey: 'test-alpha', timeoutMinutes: 25 }

test('旧单组配置迁移后保留服务、模型、密钥与超时时间', () => {
  const collection = restoreAiSettings(legacy)
  assert.equal(collection.version, 2)
  assert.equal(collection.activeId, collection.profiles[0].id)
  const { id, name, ...settings } = collection.profiles[0]
  assert.equal(name, '原有配置')
  assert.deepEqual(settings, { ...legacy, maxTokens: 0 })
  assert.deepEqual(restoreAiSettings(JSON.parse(JSON.stringify(collection))), collection)
})

test('空列表不恢复已删除的旧配置；删除当前项后不自动启用其他服务', () => {
  const first = validateAiProfile({ ...legacy, name: '服务 A' }, 'a')
  const second = validateAiProfile({ baseUrl: 'http://localhost:11434/v1', model: 'local', apiKey: '', name: '本机' }, 'b')
  const source = { version: 2, profiles: [first, second], activeId: 'a' }
  const removed = removeAiProfile(source, 'a')
  assert.equal(removed.activeId, '')
  assert.deepEqual(removed.profiles, [second])
  assert.equal(source.profiles.length, 2)
  assert.equal(removeAiProfile(source, 'b').activeId, 'a')
  assert.deepEqual(restoreAiSettings(removeAiProfile(removed, 'b')), emptyAiCollection())
})

test('配置校验支持无密钥本机服务，拒绝重复标识及丢失的当前配置', () => {
  assert.equal(validateAiProfile({ ...legacy, name: '  日常学习  ', timeoutMinutes: 40 }, 'a').timeoutMinutes, 30)
  assert.throws(() => validateAiProfile({ ...legacy, name: '' }, 'a'), /配置名称/)
  assert.throws(() => validateAiProfile({ ...legacy, name: 'A', baseUrl: 'http://remote.test' }, 'a'), /HTTPS/)
  assert.throws(() => validateAiProfile({ ...legacy, name: 'A', model: ' ' }, 'a'), /模型名称/)
  const profile = validateAiProfile({ ...legacy, name: 'A' }, 'a')
  assert.throws(() => restoreAiSettings({ version: 2, profiles: [profile, profile], activeId: 'a' }), /列表异常/)
  assert.throws(() => restoreAiSettings({ version: 2, profiles: [profile], activeId: 'missing' }), /不存在/)
  assert.throws(() => restoreAiSettings({ version: 3, profiles: [] }), /格式异常/)
})

test('不同 AI 使用独立的地址、模型与鉴权，本机请求不携带另一组密钥', async () => {
  const original = globalThis.fetch
  const requests = []
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, model: JSON.parse(options.body).model, auth: options.headers.authorization })
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
    }
    const remote = validateAiProfile({ ...legacy, name: '远程' }, 'remote')
    const local = validateAiProfile({ baseUrl: 'http://localhost:11434/v1', model: 'local-model', apiKey: '', name: '本机' }, 'local')
    for (const settings of [remote, local]) await requestGuideJson(settings, [], new AbortController().signal)
    assert.deepEqual(requests, [
      { url: 'https://alpha.test/v1/chat/completions', model: 'alpha-model', auth: 'Bearer test-alpha' },
      { url: 'http://localhost:11434/v1/chat/completions', model: 'local-model', auth: undefined },
    ])
  } finally { globalThis.fetch = original }
})

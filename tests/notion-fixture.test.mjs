import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const html = await readFile(new URL('./fixtures/notion.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/u)[1]

async function fixture() {
  function editor() {
    const listeners = new Map()
    return {
      value: '',
      textContent: '',
      addEventListener(type, callback) {
        const callbacks = listeners.get(type) ?? []
        callbacks.push(callback)
        listeners.set(type, callbacks)
      },
      emit(type, data = {}) {
        for (const callback of listeners.get(type) ?? []) callback({ type, ...data })
      },
    }
  }
  const plain = editor(),
    rich = editor(),
    storage = new Map(),
    ready = []
  const window = { addEventListener() {} }
  vm.runInNewContext(script, {
    window,
    document: {
      querySelector: (selector) => (selector === 'textarea' ? plain : rich),
      cookie: '',
      set title(_value) {
        throw Error('Fixture snapshots must not use the length-limited title channel')
      },
    },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    location: new URL('http://127.0.0.1:12345/smoke-a'),
    navigator: { userAgent: 'fixture browser' },
    setTimeout: (callback) => ready.push(callback),
    setInterval() {},
    queueMicrotask: (callback) => callback(),
  })
  for (const callback of ready) await callback()
  return { plain, rich, window }
}

test('Notion fixture keeps long, bounded event snapshots without title truncation', async () => {
  const { plain, rich, window } = await fixture()
  for (let i = 0; i < 150; i++) {
    plain.value = `snapshot ${i}: ${'文字'.repeat(40)}`
    plain.emit('input', { inputType: 'insertText', data: plain.value, isComposing: false })
  }
  assert.equal(window.__NOTION_FIXTURE_PROBE__.composition.length, 100)
  assert.ok(JSON.stringify(window.__NOTION_FIXTURE_PROBE__).length > 1024)
  assert.equal(window.__NOTION_FIXTURE_PROBE__.text, plain.value)
  // Programmatic input/paste alone must not satisfy the interactive IME gate.
  assert.equal(window.__NOTION_FIXTURE_PROBE__.compositionState.plain.started, false)
  for (const [name, field] of [
    ['plain', plain],
    ['rich', rich],
  ]) {
    field.emit('compositionstart', { data: '' })
    field.value = field.textContent = '你好世界'
    field.emit('compositionend', { data: '你好世界' })
    assert.equal(window.__NOTION_FIXTURE_PROBE__.compositionState[name].started, true)
    assert.equal(window.__NOTION_FIXTURE_PROBE__.compositionState[name].ended, true)
  }
  assert.equal(window.__NOTION_FIXTURE_PROBE__.text, '你好世界')
  assert.equal(window.__NOTION_FIXTURE_PROBE__.richText, '你好世界')
  assert.equal(window.__NOTION_FIXTURE_PROBE__.composition.at(-1).text, '你好世界')
})

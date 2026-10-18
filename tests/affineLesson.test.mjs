import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

// Run the same bridge source that the AFFiNE build applies; replace only its host services.
const patch = readFileSync(new URL('../integrations/affine/local.patch', import.meta.url), 'utf8')
const file = 'packages/frontend/apps/web/src/ai-player-courses.ts'
const source = patch
  .split(`+++ b/${file}\n`)[1]
  .split('\ndiff --git ')[0]
  .split('\n')
  .filter((line) => line.startsWith('+'))
  .map((line) => line.slice(1))
  .join('\n')
const compiled = ts.transpileModule(source.replace(/^import .*;\n/gm, '').replace('export function', 'function'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const load = new Function(
  'notify',
  'router',
  'AppSidebarService',
  'WorkspacesService',
  'window',
  'localStorage',
  'globalThis',
  `${compiled}\nreturn installCourseBridge;`,
)
const settle = () => new Promise((resolve) => setImmediate(resolve))
const lesson = (path) => ({ courseId: 'course', path, title: path })
const bindingKey = (path) => `ai-player:lesson:${JSON.stringify(['course', path])}`

function harness({ initialized = true, binding, docs = [], wait = Promise.resolve() } = {}) {
  const events = new EventTarget()
  const stored = new Map(binding === undefined ? [] : [[bindingKey('first.mp4'), binding]])
  const calls = { navigated: [], created: [], saved: [], sidebar: [], errors: [], disposed: 0 }
  let current = lesson('first.mp4')
  const workspace = {
    id: 'local',
    engine: { doc: { waitForDocReady: () => wait } },
    docCollection: { getDoc: (id) => docs.find((doc) => doc.id === id) },
    docs: { createDoc: (options) => calls.created.push(options) },
    scope: { get: () => ({ sidebar: { setOpen: (open) => calls.sidebar.push(open) } }) },
  }
  const globals = {
    __TAURI__: { core: { invoke: async () => current } },
    currentWorkspace: initialized ? workspace : undefined,
  }
  const service = {
    list: { workspaces$: { waitFor: async () => [{ id: 'local', flavour: 'local' }] } },
    open: () => ({ workspace, dispose: () => calls.disposed++ }),
  }
  load(
    { error: (error) => calls.errors.push(error) },
    { navigate: async (path) => calls.navigated.push(path) },
    {},
    {},
    events,
    {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (...args) => calls.saved.push(args),
    },
    globals,
  )({ get: () => service })
  return {
    calls,
    stored,
    initialize() {
      globals.currentWorkspace = workspace
      events.dispatchEvent(new Event('affine:workspace:change'))
    },
    select(path) {
      current = lesson(path)
      events.dispatchEvent(new Event('ai-player-open-lesson'))
    },
  }
}

test('首次打开视频等待工作区初始化，只展示笔记列表', async () => {
  const h = harness({ initialized: false })
  await settle()
  assert.deepEqual(h.calls.navigated, [])
  h.initialize()
  await settle()
  assert.deepEqual(h.calls.navigated, ['/workspace/local/all'])
  assert.deepEqual(h.calls.sidebar, [true])
  assert.deepEqual(h.calls.created, [])
  assert.deepEqual(h.calls.saved, [])
  assert.deepEqual(h.calls.errors, [])
})

test('切换和重新打开没有关联笔记的视频都不新建文档或写入关联', async () => {
  const h = harness()
  await settle()
  for (const path of ['second.mp4', 'first.mp4', 'third.mp4']) {
    h.select(path)
    await settle()
  }
  assert.deepEqual(h.calls.navigated, Array(4).fill('/workspace/local/all'))
  assert.deepEqual(h.calls.created, [])
  assert.deepEqual(h.calls.saved, [])
  assert.equal(h.calls.disposed, 4)
})

test('已有笔记继续打开，切换后返回保留原文档和关联', async () => {
  const binding = JSON.stringify({ workspaceId: 'local', docId: 'existing note' })
  const h = harness({ binding, docs: [{ id: 'existing note' }] })
  await settle()
  h.select('second.mp4')
  await settle()
  h.select('first.mp4')
  await settle()
  assert.deepEqual(h.calls.navigated, [
    '/workspace/local/existing%20note',
    '/workspace/local/all',
    '/workspace/local/existing%20note',
  ])
  assert.deepEqual(h.calls.sidebar, [false, true, false])
  assert.equal(h.stored.get(bindingKey('first.mp4')), binding)
  assert.deepEqual(h.calls.created, [])
  assert.deepEqual(h.calls.saved, [])
})

test('关联损坏、文档缺失或原工作区不可用时不自动补建笔记', async () => {
  for (const binding of [
    '{invalid',
    JSON.stringify({ workspaceId: 'local', docId: 'missing' }),
    JSON.stringify({ workspaceId: 'missing', docId: 'existing' }),
  ]) {
    const h = harness({ binding, docs: [{ id: 'existing' }] })
    await settle()
    assert.deepEqual(h.calls.navigated, ['/workspace/local/all'])
    assert.deepEqual(h.calls.created, [])
    assert.deepEqual(h.calls.saved, [])
    assert.deepEqual(h.calls.errors, [])
  }
})

test('笔记读取未完成时切换视频，迟到结果不能打开上一节笔记', async () => {
  let resolve
  const wait = new Promise((done) => (resolve = done))
  const h = harness({
    binding: JSON.stringify({ workspaceId: 'local', docId: 'existing' }),
    docs: [{ id: 'existing' }],
    wait,
  })
  await settle()
  h.select('second.mp4')
  await settle()
  resolve()
  await settle()
  assert.deepEqual(h.calls.navigated, ['/workspace/local/all'])
  assert.deepEqual(h.calls.created, [])
  assert.deepEqual(h.calls.saved, [])
  assert.equal(h.calls.disposed, 2)
})

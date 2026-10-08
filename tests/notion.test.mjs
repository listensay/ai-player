import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, ref } from 'vue'
import {
  createNotionViewController,
  notionUrl,
  notionPageUrl,
  notionBounds,
  parseNotionBinding,
  notionBindingKey,
} from '../app/utils/notion.ts'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest=(...args)=>globalThis.notionBindingIO(...args)',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useNotionBinding } = await import('../app/composables/useNotionBinding.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}
const page = 'https://app.notion.com/my-page-0123456789abcdef0123456789abcdef'
const target = (key = 'a') => ({
  key,
  url: page,
  bounds: { x: 800, y: 120, width: 400, height: 600, viewportHeight: 900 },
})

test('Notion 链接只接受官方 HTTPS 页面，绑定不能使用登录页或主页', () => {
  assert.equal(notionUrl(`  ${page}  `), page)
  assert.equal(notionPageUrl('https://team.notion.site/notes'), 'https://team.notion.site/notes')
  for (const url of [
    'https://notion.so.evil.test/a',
    'http://notion.so/a',
    'https://notion.so@evil.test/',
    'https://user@notion.so/a',
    'https://notion.so:8080/a',
    'javascript:alert(1)',
    'file:///tmp/note',
    'https://evilnotion.so/a',
  ])
    assert.throws(() => notionUrl(url), url)
  for (const url of ['https://app.notion.com/', 'https://app.notion.com/login', 'https://app.notion.com/signup'])
    assert.throws(() => notionPageUrl(url))
  assert.equal(parseNotionBinding(null), '')
  assert.equal(parseNotionBinding({ version: 1, url: page }), page)
  assert.throws(() => parseNotionBinding({ version: 2, url: page }))
})

test('原生网页区域限制在窗口内，隐藏或过小的区域不显示', () => {
  assert.deepEqual(notionBounds({ left: 800.5, top: 120, right: 1400, bottom: 1000 }, 1280, 900), {
    x: 801,
    y: 120,
    width: 479,
    height: 780,
    viewportHeight: 900,
  })
  assert.equal(notionBounds({ left: 0, top: 0, right: 0, bottom: 0 }, 1280, 900), null)
  assert.equal(notionBounds({ left: 0, top: 1000, right: 400, bottom: 1600 }, 1280, 900), null)
  assert.deepEqual(
    notionBounds({ left: 800, top: -100, right: 1200, bottom: 800 }, 1280, 900, [
      { left: 0, top: 80, right: 1280, bottom: 700 },
    ]),
    { x: 800, y: 80, width: 400, height: 620, viewportHeight: 900 },
  )
})

test('创建尚未完成时切页或弹窗，不会把迟到的网页显示出来', async () => {
  const gate = deferred(),
    calls = []
  const controller = createNotionViewController({
    prepare: async () => gate.promise,
    layout: async (bounds) => calls.push(bounds),
  })
  const creating = controller.update(target())
  await tick()
  const hiding = controller.update(null)
  gate.resolve()
  await Promise.all([creating, hiding])
  assert.ok(calls.every((bounds) => bounds === null))
  await controller.update(target())
  assert.deepEqual(calls.at(-1), target().bounds)
})

test('快速切课与连续调整尺寸只展示最后课节；收起重开不重新导航', async () => {
  const gate = deferred(),
    prepared = [],
    layouts = []
  const controller = createNotionViewController({
    prepare: async (key) => {
      prepared.push(key)
      if (key === 'a') await gate.promise
    },
    layout: async (bounds) => layouts.push(bounds),
  })
  const first = controller.update(target('a'))
  await tick()
  controller.update(target('b'))
  const last = { ...target('c'), bounds: { ...target().bounds, width: 500 } }
  controller.update(last)
  gate.resolve()
  await first
  assert.deepEqual(prepared, ['a', 'c'])
  assert.deepEqual(layouts.filter(Boolean), [last.bounds])
  await controller.update(null)
  await controller.update(last)
  assert.deepEqual(prepared, ['a', 'c'])
  assert.deepEqual(layouts.at(-1), last.bounds)
})

test('原生创建失败后保持隐藏，可以显式重试', async () => {
  let fail = true
  const calls = []
  const controller = createNotionViewController({
    prepare: async () => {
      if (fail) throw Error('offline')
    },
    layout: async (bounds) => calls.push(bounds),
  })
  await assert.rejects(controller.update(target()), /offline/)
  assert.equal(calls.at(-1), null)
  fail = false
  await controller.update(target(), true)
  assert.deepEqual(calls.at(-1), target().bounds)
})

function mount(t, request) {
  globalThis.notionBindingIO = request
  const identity = ref({ courseId: 'course', path: 'a.mp4' })
  let binding
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      binding = useNotionBinding(identity)
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    delete globalThis.notionBindingIO
  })
  return { binding, identity }
}

test('课节绑定独立持久化，慢读取不能覆盖新课节', async (t) => {
  const slow = deferred(),
    data = new Map()
  const { binding, identity } = mount(t, async (_collection, options) => {
    if (options.method === 'POST') {
      data.set(options.body.key, options.body.value)
      return
    }
    return options.query.key === notionBindingKey('course', 'a.mp4') ? slow.promise : null
  })
  identity.value = { courseId: 'course', path: 'b.mp4' }
  await tick()
  await binding.save(page)
  slow.resolve({ version: 1, url: 'https://notion.so/old-page' })
  await tick()
  assert.equal(binding.state.url, page)
  assert.deepEqual(data.get(notionBindingKey('course', 'b.mp4')), { version: 1, url: page })
  assert.equal(data.has(notionBindingKey('course', 'a.mp4')), false)
})

test('读取失败不允许覆盖绑定，写入失败保留原链接；迟到写入不改变新课节', async (t) => {
  let failRead = true,
    failWrite = false
  const pending = deferred()
  const { binding, identity } = mount(t, async (_collection, options) => {
    if (options.method === 'POST') {
      if (failWrite) throw Error('disk')
      return pending.promise
    }
    if (failRead) throw Error('read')
    return { version: 1, url: page }
  })
  await tick()
  assert.equal(await binding.save(page), false)
  failRead = false
  await binding.load()
  failWrite = true
  assert.equal(await binding.save('https://notion.so/new-page'), false)
  assert.equal(binding.state.url, page)
  failWrite = false
  const saving = binding.save('https://notion.so/new-page')
  identity.value = { courseId: 'course', path: 'b.mp4' }
  await tick()
  pending.resolve()
  assert.equal(await saving, false)
  assert.equal(binding.state.url, page)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNotionViewController, notionBounds } from '../app/utils/notion.ts'

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

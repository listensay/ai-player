import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, ref, nextTick } from 'vue'
import { useKnowledgePreparation } from '../app/composables/useKnowledgePreparation.ts'
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = [],
    cancelled = [],
    retained = []
  const options = {
    course: ref({ id: 'one' }),
    video: ref({ path: 'a' }),
    ready: ref(false),
    visible: ref(false),
    enabled: ref(true),
    revision: ref('model-1'),
  }
  const knowledge = {
    ensure: async (...args) => calls.push(args),
    cancelBackground: (...args) => cancelled.push(args),
    retain: (...args) => {
      retained.push(args)
      return () => retained.push(['released', ...args])
    },
  }
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      useKnowledgePreparation(options, knowledge)
      return () => null
    },
  })
  app.mount({})
  t.after(() => app.unmount())
  return { options, calls, cancelled, retained, app }
}
test('自动整理等待首帧，快速切课只准备最后一节，显式打开立即准备', async (t) => {
  const h = fixture(t)
  t.mock.timers.tick(2000)
  assert.equal(h.calls.length, 0)
  h.options.ready.value = true
  await nextTick()
  t.mock.timers.tick(400)
  h.options.video.value = { path: 'b' }
  await nextTick()
  t.mock.timers.tick(800)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0][1].path, 'b')
  assert.deepEqual(h.calls[0][4], { background: true })
  h.options.visible.value = true
  await nextTick()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1][4], undefined)
})
test('离开播放器停止自动准备并释放当前缓存，配置变化会取消旧后台任务', async (t) => {
  const h = fixture(t)
  h.options.ready.value = true
  await nextTick()
  t.mock.timers.tick(800)
  h.options.revision.value = 'model-2'
  await nextTick()
  assert.ok(h.cancelled.some(([id, path]) => id === 'one' && path === 'a'))
  h.options.enabled.value = false
  await nextTick()
  t.mock.timers.tick(2000)
  assert.equal(h.calls.length, 1)
  h.app.unmount()
  assert.ok(h.retained.some(([kind]) => kind === 'released'))
})

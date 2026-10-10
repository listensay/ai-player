import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { useLessonCompletion } from '../app/composables/useLessonCompletion.ts'

const launchedAt = new Date('2026-10-09T12:00:00+08:00').getTime()
const tick = async () => {
  await nextTick()
  await nextTick()
}
function fixture(t) {
  let now = launchedAt
  const learning = {
    state: reactive({ ready: true, data: { preferences: { flowPrompt: true }, flows: [] } }),
    pendingFlow: ref(null),
  }
  const context = ref({ courseId: 'course-a', path: 'lesson-a.mp4' })
  const practiceOpen = ref(false),
    otherDialog = ref(false),
    opened = []
  let open = async () => {
    opened.push({ ...context.value })
    practiceOpen.value = true
  }
  const scope = effectScope()
  const completion = scope.run(() =>
    useLessonCompletion(
      learning,
      {
        context: () => context.value,
        blocked: () => practiceOpen.value || otherDialog.value,
        openPractice: () => open(),
      },
      () => now,
    ),
  )
  t.after(() => scope.stop())
  return {
    learning,
    context,
    practiceOpen,
    otherDialog,
    opened,
    completion,
    setOpen: (value) => {
      open = value
    },
    async sample(overrides = {}, elapsed = 1000) {
      now += elapsed
      completion.sample({
        seconds: 10,
        duration: 60,
        rate: 1,
        at: now - launchedAt,
        playing: true,
        seeking: false,
        ended: false,
        ...overrides,
      })
      await tick()
    },
    async closePractice() {
      practiceOpen.value = false
      await tick()
    },
  }
}

test('长课暂停与番茄钟休息不反馈，视频结束先打开练习，关闭后才反馈一次', async (t) => {
  const h = fixture(t)
  await h.sample()
  await h.sample({ playing: false }, 25 * 60_000)
  assert.equal(h.learning.pendingFlow.value, null)
  assert.equal(h.opened.length, 0)
  await h.sample()
  await h.sample({ playing: false, ended: true, seconds: 60 })
  assert.equal(h.opened.length, 1)
  assert.equal(h.learning.pendingFlow.value, null)
  assert.equal(h.completion.pending.value, true)
  await h.closePractice()
  assert.deepEqual(h.learning.pendingFlow.value, {
    id: 'lesson:["course-a","lesson-a.mp4"]',
    courseId: 'course-a',
    path: 'lesson-a.mp4',
    startedAt: launchedAt + 1000,
    endedAt: launchedAt + 25 * 60_000 + 3000,
    hour: new Date(launchedAt + 1000).getHours(),
  })
  h.learning.pendingFlow.value = null
  await h.sample({ playing: false, ended: true, seconds: 60 })
  assert.equal(h.opened.length, 1)
  assert.equal(h.learning.pendingFlow.value, null)
})

test('短课同样反馈，重复结束事件与重播不重复询问本课状态', async (t) => {
  const h = fixture(t)
  await h.sample({ playing: false, ended: true })
  await h.closePractice()
  assert.ok(h.learning.pendingFlow.value)
  h.learning.pendingFlow.value = null
  await h.sample({ playing: false, ended: true })
  assert.equal(h.opened.length, 1)
  await h.sample({ seconds: 0 })
  await h.sample({ playing: false, ended: true })
  assert.equal(h.opened.length, 2)
  await h.closePractice()
  assert.equal(h.learning.pendingFlow.value, null)
})

test('读取历史不补弹，已有本课反馈不重复，新课独立反馈；关闭偏好仍打开练习', async (t) => {
  const h = fixture(t)
  h.learning.state.data.flows = [{ id: 'lesson:["course-a","lesson-a.mp4"]' }, { id: 'focus:old' }]
  await tick()
  assert.equal(h.opened.length, 0)
  assert.equal(h.learning.pendingFlow.value, null)
  await h.sample({ ended: true, playing: false })
  await h.closePractice()
  assert.equal(h.learning.pendingFlow.value, null)
  h.context.value = { courseId: 'course-b', path: 'lesson-a.mp4' }
  await h.sample({ ended: true, playing: false })
  await h.closePractice()
  assert.equal(h.learning.pendingFlow.value.courseId, 'course-b')
  h.learning.pendingFlow.value = null
  h.learning.state.data.preferences.flowPrompt = false
  h.context.value = { courseId: 'course-b', path: 'lesson-b.mp4' }
  await h.sample({ ended: true, playing: false })
  await h.closePractice()
  assert.equal(h.learning.pendingFlow.value, null)
  assert.equal(h.opened.length, 3)
})

test('拖动和接近终点不触发，其他弹窗关闭后才打开练习，切课丢弃待打开的旧课', async (t) => {
  const h = fixture(t)
  await h.sample({ seconds: 60, playing: false })
  await h.sample({ seconds: 60, playing: false, seeking: true, ended: true })
  assert.equal(h.opened.length, 0)
  h.otherDialog.value = true
  await h.sample({ ended: true, playing: false })
  assert.equal(h.completion.pending.value, true)
  assert.equal(h.opened.length, 0)
  h.otherDialog.value = false
  await tick()
  assert.equal(h.opened.length, 1)
  h.context.value = null
  await h.closePractice()
  assert.equal(h.learning.pendingFlow.value, null)
  assert.equal(h.completion.pending.value, false)
})

test('退出全屏期间切课，旧课迟到的打开结果不会提示新课反馈', async (t) => {
  const h = fixture(t)
  let resolve
  h.setOpen(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  await h.sample({ ended: true, playing: false })
  assert.equal(h.completion.pending.value, true)
  h.context.value = { courseId: 'other', path: 'other.mp4' }
  resolve()
  await tick()
  assert.equal(h.learning.pendingFlow.value, null)
  assert.equal(h.completion.pending.value, false)
})

test('学习记录未读完时先打开练习，读取结束后检查已有反馈再决定是否提示', async (t) => {
  const h = fixture(t)
  h.learning.state.ready = false
  await h.sample({ ended: true, playing: false })
  assert.equal(h.opened.length, 1)
  await h.closePractice()
  assert.equal(h.learning.pendingFlow.value, null)
  assert.equal(h.completion.pending.value, true)
  h.learning.state.data.flows = [{ id: 'lesson:["course-a","lesson-a.mp4"]' }]
  h.learning.state.ready = true
  await tick()
  assert.equal(h.learning.pendingFlow.value, null)
  assert.equal(h.completion.pending.value, false)
})

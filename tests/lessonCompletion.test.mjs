import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useLessonCompletion } from '../app/composables/useLessonCompletion.ts'

const tick = async () => {
  await nextTick()
  await nextTick()
}
function fixture(t) {
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
    useLessonCompletion({
      context: () => context.value,
      blocked: () => practiceOpen.value || otherDialog.value,
      openPractice: () => open(),
    }),
  )
  t.after(() => scope.stop())
  return {
    context,
    practiceOpen,
    otherDialog,
    opened,
    completion,
    setOpen(value) {
      open = value
    },
    async sample(overrides = {}) {
      completion.sample({
        seconds: 10,
        duration: 60,
        rate: 1,
        at: 1000,
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
test('暂停不触发，视频结束仍打开课后练习，关闭后不遗留反馈阶段', async (t) => {
  const h = fixture(t)
  await h.sample()
  await h.sample({ playing: false })
  assert.equal(h.opened.length, 0)
  await h.sample({ playing: false, ended: true, seconds: 60 })
  assert.equal(h.opened.length, 1)
  assert.equal(h.completion.pending.value, false)
  await h.closePractice()
  assert.equal(h.completion.pending.value, false)
  await h.sample({ playing: false, ended: true })
  assert.equal(h.opened.length, 1)
})
test('重复结束事件只打开一次，重播和新课结束仍可打开练习', async (t) => {
  const h = fixture(t)
  await h.sample({ ended: true, playing: false })
  await h.closePractice()
  await h.sample({ ended: true, playing: false })
  assert.equal(h.opened.length, 1)
  await h.sample({ seconds: 0 })
  await h.sample({ ended: true, playing: false })
  await h.closePractice()
  h.context.value = { courseId: 'course-b', path: 'lesson-b.mp4' }
  await h.sample({ ended: true, playing: false })
  assert.equal(h.opened.length, 3)
})
test('拖动不触发，遮挡结束后打开练习，切课丢弃旧的待打开任务', async (t) => {
  const h = fixture(t)
  await h.sample({ seconds: 60, playing: false, seeking: true, ended: true })
  assert.equal(h.opened.length, 0)
  h.otherDialog.value = true
  await h.sample({ ended: true, playing: false })
  assert.equal(h.completion.pending.value, true)
  h.context.value = null
  h.otherDialog.value = false
  await tick()
  assert.equal(h.opened.length, 0)
  h.context.value = { courseId: 'new', path: 'new.mp4' }
  h.otherDialog.value = true
  await h.sample({ ended: true, playing: false })
  h.otherDialog.value = false
  await tick()
  assert.equal(h.opened.length, 1)
})
test('旧课迟到的打开结果不覆盖新课状态', async (t) => {
  const h = fixture(t),
    resolves = []
  h.setOpen(() => new Promise((resolve) => resolves.push(resolve)))
  await h.sample({ ended: true, playing: false })
  h.context.value = { courseId: 'other', path: 'other.mp4' }
  await h.sample({ ended: true, playing: false })
  resolves[0]()
  await tick()
  assert.equal(h.completion.pending.value, true)
  resolves[1]()
  await tick()
  assert.equal(h.completion.pending.value, false)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { useFocusFlowPrompt } from '../app/composables/useFocusFlowPrompt.ts'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest = () => { throw Error("Unexpected native storage call") }',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { createPomodoro } = await import('../app/composables/usePomodoro.ts')
const { emptyLearningManagement } = await import('../app/utils/learningManagement.ts')
const launchedAt = new Date('2026-10-07T12:00:00+08:00').getTime()
const focusMs = 25 * 60_000

function fixture(t, raw = null, now = launchedAt) {
  let saved = raw
  const pomodoro = createPomodoro(
    {
      read: async () => saved,
      write: async (value) => {
        saved = structuredClone(value)
      },
    },
    () => now,
  )
  const learning = { state: reactive({ data: emptyLearningManagement() }), pendingFlow: ref(null) }
  const context = reactive({ courseId: 'course-a', path: 'lesson-a.mp4' })
  const scope = effectScope()
  scope.run(() => useFocusFlowPrompt(pomodoro, learning, () => ({ ...context })))
  t.after(() => scope.stop())
  return {
    pomodoro,
    learning,
    context,
    saved: () => saved,
    async advance(ms) {
      now += ms
      pomodoro.tick()
      await nextTick()
    },
  }
}

test('当天或隔天重新打开，读取已完成专注不会补弹学习反馈', async (t) => {
  const original = fixture(t)
  await original.pomodoro.load()
  original.pomodoro.start()
  await nextTick()
  await original.advance(focusMs)
  await original.pomodoro.flush()
  const saved = original.saved()
  assert.equal(saved.focusHistory[0].outcome, 'completed')

  for (const delay of [focusMs + 60_000, 86_400_000]) {
    const restarted = fixture(t, saved, launchedAt + delay)
    await restarted.pomodoro.load()
    await nextTick()
    assert.equal(restarted.learning.pendingFlow.value, null)
    assert.deepEqual(restarted.pomodoro.state.focusHistory, saved.focusHistory)
    await restarted.advance(focusMs)
    assert.equal(restarted.learning.pendingFlow.value, null)
    restarted.pomodoro.start()
    await nextTick()
    await restarted.advance(focusMs)
    assert.equal(restarted.learning.pendingFlow.value.startedAt, launchedAt + delay + focusMs)
  }
})

test('重启不把上次未完成的专注算作学习，本次重新专注完成后正常提示', async (t) => {
  const original = fixture(t)
  await original.pomodoro.load()
  original.pomodoro.start()
  await original.pomodoro.flush()
  const restarted = fixture(t, original.saved(), launchedAt + 86_400_000)
  await restarted.pomodoro.load()
  await nextTick()
  assert.equal(restarted.learning.pendingFlow.value, null)
  assert.equal(restarted.pomodoro.state.focusHistory[0].outcome, 'abandoned')

  restarted.pomodoro.start()
  await nextTick()
  await restarted.advance(focusMs)
  assert.equal(restarted.learning.pendingFlow.value.startedAt, launchedAt + 86_400_000)
})

test('本次专注结束时提示一次，保留开始时的课程，下一轮完成仍正常提示', async (t) => {
  const h = fixture(t)
  await h.pomodoro.load()
  assert.equal(h.learning.pendingFlow.value, null)
  h.pomodoro.start()
  await nextTick()
  await h.advance(60_000)
  assert.equal(h.learning.pendingFlow.value, null)
  h.context.courseId = 'course-b'
  h.context.path = 'lesson-b.mp4'
  await h.advance(focusMs - 60_000)
  assert.deepEqual(h.learning.pendingFlow.value, {
    id: `focus:${launchedAt}`,
    startedAt: launchedAt,
    endedAt: launchedAt + focusMs,
    hour: new Date(launchedAt).getHours(),
    courseId: 'course-a',
    path: 'lesson-a.mp4',
  })
  h.learning.pendingFlow.value = null
  await h.advance(1000)
  assert.equal(h.learning.pendingFlow.value, null)

  h.pomodoro.startFocus()
  await nextTick()
  await h.advance(focusMs)
  assert.equal(h.learning.pendingFlow.value.courseId, 'course-b')
  assert.equal(h.learning.pendingFlow.value.startedAt, launchedAt + focusMs + 1000)
})

test('关闭学习反馈或中途重置专注不会弹出反馈', async (t) => {
  const h = fixture(t)
  await h.pomodoro.load()
  h.pomodoro.start()
  await h.advance(60_000)
  h.pomodoro.reset()
  await h.advance(focusMs)
  assert.equal(h.learning.pendingFlow.value, null)
  h.learning.state.data.preferences.flowPrompt = false
  h.pomodoro.start()
  await nextTick()
  await h.advance(focusMs)
  assert.equal(h.pomodoro.state.focusHistory.at(-1).outcome, 'completed')
  assert.equal(h.learning.pendingFlow.value, null)
})

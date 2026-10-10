import { computed, ref, watch } from 'vue'
import type { provideLearningManagement } from './useLearningManagement'
import type { FlowCheckIn } from '../types/learningManagement'
import type { PlaybackSample } from '../types/practice'

/** Finish a lesson with practice first, then one learning-state check-in. */
export function useLessonCompletion(
  learning: Pick<ReturnType<typeof provideLearningManagement>, 'state' | 'pendingFlow'>,
  options: {
    context: () => { courseId: string; path: string } | null
    blocked: () => boolean
    openPractice: () => Promise<void>
  },
  clock = Date.now,
) {
  const identity = computed(() => {
    const context = options.context()
    return context ? JSON.stringify([context.courseId, context.path]) : ''
  })
  const pending = ref<{ flow: Omit<FlowCheckIn, 'mood'>; stage: 'practice' | 'opening' | 'feedback' } | null>(null)
  const prompted = new Set<string>()
  let startedAt: number | null = null
  let ended = false
  watch(
    identity,
    () => {
      startedAt = null
      ended = false
      pending.value = null
    },
    { flush: 'sync' },
  )

  function sample(current: PlaybackSample) {
    const context = options.context()
    if (!context || current.seeking) return
    if (current.playing && !current.ended) {
      startedAt ??= clock()
      ended = false
    }
    if (!current.ended || ended) return
    ended = true
    const now = clock()
    const start = startedAt ?? now
    pending.value = {
      stage: 'practice',
      flow: {
        ...context,
        id: `lesson:${identity.value}`,
        startedAt: start,
        endedAt: Math.max(start, now),
        hour: new Date(start).getHours(),
      },
    }
    startedAt = null
  }

  watch(
    () => [pending.value?.stage, options.blocked(), learning.state.ready, learning.pendingFlow.value] as const,
    async () => {
      const next = pending.value
      if (!next || options.blocked() || learning.pendingFlow.value) return
      if (next.stage === 'practice') {
        next.stage = 'opening'
        try {
          await options.openPractice()
        } finally {
          if (pending.value === next) next.stage = 'feedback'
        }
      } else if (next.stage === 'feedback' && learning.state.ready) {
        if (
          learning.state.data.preferences.flowPrompt &&
          !prompted.has(next.flow.id) &&
          !learning.state.data.flows.some((flow) => flow.id === next.flow.id)
        ) {
          prompted.add(next.flow.id)
          learning.pendingFlow.value = next.flow
        }
        pending.value = null
      }
    },
    { flush: 'post' },
  )
  return { sample, pending: computed(() => !!pending.value) }
}

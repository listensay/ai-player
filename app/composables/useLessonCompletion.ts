import { computed, ref, watch } from 'vue'
import type { PlaybackSample } from '../types/practice'

export function useLessonCompletion(options: {
  context: () => { courseId: string; path: string } | null
  blocked: () => boolean
  openPractice: () => Promise<void>
}) {
  const identity = computed(() => {
    const context = options.context()
    return context ? JSON.stringify([context.courseId, context.path]) : ''
  })
  const pending = ref<'waiting' | 'opening' | null>(null)
  let ended = false
  let version = 0
  watch(
    identity,
    () => {
      version++
      ended = false
      pending.value = null
    },
    { flush: 'sync' },
  )

  function sample(current: PlaybackSample) {
    if (!options.context() || current.seeking) return
    if (current.playing && !current.ended) ended = false
    if (!current.ended || ended) return
    ended = true
    pending.value = 'waiting'
  }
  watch(
    () => [pending.value, options.blocked()] as const,
    async () => {
      if (pending.value !== 'waiting' || options.blocked()) return
      const token = ++version
      pending.value = 'opening'
      try {
        await options.openPractice()
      } finally {
        if (token === version) pending.value = null
      }
    },
    { flush: 'post' },
  )
  return { sample, pending: computed(() => !!pending.value) }
}

import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { Course, VideoEntry } from '~/types/course'
import type { useLessonKnowledge } from './useLessonKnowledge'

/** First frame and user actions take priority over automatic knowledge preparation. */
export function useKnowledgePreparation(
  options: {
    course: Ref<Course | null>
    video: Ref<VideoEntry | null>
    enabled: Ref<boolean>
    ready: Ref<boolean>
    visible: Ref<boolean>
    revision: Ref<string>
  },
  knowledge: Pick<ReturnType<typeof useLessonKnowledge>, 'ensure' | 'retain' | 'cancelBackground'>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous: { id: string; path: string; revision: string } | undefined
  watch(
    () => [options.course.value?.id, options.video.value?.path] as const,
    ([id, path], _, onCleanup) => {
      if (id && path) onCleanup(knowledge.retain(id, path))
    },
    { immediate: true, flush: 'sync' },
  )
  watch(
    () =>
      [
        options.course.value?.id,
        options.video.value?.path,
        options.enabled.value,
        options.ready.value,
        options.visible.value,
        options.revision.value,
      ] as const,
    ([id, path, enabled, ready, visible, revision]) => {
      clearTimeout(timer)
      if (previous && (!enabled || previous.id !== id || previous.path !== path || previous.revision !== revision)) {
        knowledge.cancelBackground(previous.id, previous.path)
      }
      previous = id && path ? { id, path, revision } : undefined
      const video = options.video.value
      if (!id || !video || !enabled) return
      if (visible) {
        void knowledge.ensure(id, video).catch(() => {})
        return
      }
      if (ready)
        timer = setTimeout(() => {
          void knowledge.ensure(id, video, undefined, false, { background: true }).catch(() => {})
        }, 800)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    clearTimeout(timer)
    if (previous) knowledge.cancelBackground(previous.id, previous.path)
  })
}

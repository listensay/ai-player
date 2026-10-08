import { watch } from 'vue'
import type { createPomodoro } from './usePomodoro'
import type { provideLearningManagement } from './useLearningManagement'

export function useFocusFlowPrompt(
  pomodoro: ReturnType<typeof createPomodoro>,
  learning: Pick<ReturnType<typeof provideLearningManagement>, 'state' | 'pendingFlow'>,
  context: () => { courseId: string; path: string },
) {
  let focusContext: { startedAt: number; courseId: string; path: string } | null = null
  watch(
    () => pomodoro.state.focusHistory.at(-1)?.startedAt,
    (startedAt) => {
      // Restoring history is not a new focus. Only track sessions started after loading.
      focusContext =
        startedAt !== undefined && pomodoro.state.ready && pomodoro.state.focusHistory.at(-1)?.outcome === 'active'
          ? { startedAt, ...context() }
          : null
    },
    { flush: 'sync' },
  )
  watch(
    () => pomodoro.state.focusHistory.at(-1)?.outcome,
    (outcome) => {
      const session = pomodoro.state.focusHistory.at(-1)
      if (
        outcome === 'completed' &&
        session?.endedAt &&
        focusContext?.startedAt === session.startedAt &&
        learning.state.data.preferences.flowPrompt
      ) {
        learning.pendingFlow.value = {
          ...focusContext,
          id: `focus:${session.startedAt}`,
          endedAt: session.endedAt,
          hour: session.startHour,
        }
      }
    },
  )
}

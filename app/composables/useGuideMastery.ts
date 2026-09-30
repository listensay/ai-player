import type { Ref } from 'vue'
import type { VideoEntry } from '~/types/course'
import type { GuideLesson, MasteryLevel } from '~/types/guide'
import type { GuideWorkspaceState } from '~/types/guideWorkspace'
import { applyMastery, lessonConcepts, masteryKey } from '~/utils/learningFeedback'

export function useGuideMastery(
  state: GuideWorkspaceState,
  options: { lessonMap: Ref<Map<string, GuideLesson>>; videoMap: Ref<Map<string, VideoEntry>>; persist: () => void },
) {
  const { lessonMap, videoMap, persist } = options
  function setMastery(path: string, concept: string, level: MasteryLevel | '') {
    const lesson = lessonMap.value.get(path)
    if (!lesson || state.busy || !lessonConcepts(lesson).includes(concept)) return
    const key = masteryKey(path, concept)
    if (level) state.mastery[key] = { path, concept, level, updatedAt: Date.now() }
    else delete state.mastery[key]
    // 撤回标记时保守回到查漏，关键前置课仍会被保留。
    if (!level && lesson.status === 'skipped') lesson.status = 'optional'
    applyMastery(state.plan!.lessons, state.mastery)
    state.notice = '已根据掌握程度更新学习路线，观看记录不受影响。'
    persist()
  }

  /** 练习仅记录用户主动确认的本题知识点，支持尚未生成路线的课程。 */
  function setPracticeMastery(path: string, concepts: string[], level: MasteryLevel | '') {
    if (!videoMap.value.has(path) || state.busy) return
    for (const concept of concepts.slice(0, 5)) {
      if (!concept.trim() || concept.length > 200) continue
      const key = masteryKey(path, concept)
      if (level) state.mastery[key] = { path, concept, level, updatedAt: Date.now() }
      else delete state.mastery[key]
    }
    if (state.plan) {
      const lesson = lessonMap.value.get(path)
      if (!level && lesson?.status === 'skipped') lesson.status = 'optional'
      applyMastery(state.plan.lessons, state.mastery)
    }
    persist()
  }

  return { setMastery, setPracticeMastery }
}

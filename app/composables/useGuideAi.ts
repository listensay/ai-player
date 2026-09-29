import { watch, onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'
import type { Course } from '~/types/course'
import type { GuideLesson } from '~/types/guide'
import type { GuideWorkspaceState } from '~/types/guideWorkspace'
import type { useProgress } from '~/composables/useProgress'
import { planPrompt, practicePrompt, requestGuideJson } from '~/utils/guideAi'
import { retainPrerequisites, validateLearningPlan } from '~/utils/guide'
import { applyMastery } from '~/utils/learningFeedback'
import { applyPractice, inheritProgram, parsePracticeImport } from '~/utils/studyProgram'

export function useGuideAi(state: GuideWorkspaceState, options: {
  course: Ref<Course | null>; activeId: () => string; guideReady: Ref<boolean>; configured: Ref<boolean>
  progress: Pick<ReturnType<typeof useProgress>, 'get'>; durations: Ref<Record<string, number | null>>
  route: Ref<GuideLesson[]>; todayDate: Ref<string>; masteredPaths: Ref<Set<string>>
  snapshot: (label: string) => void; refreshWork: () => void; persist: () => void
}) {
  const { course, activeId, guideReady, configured, progress, durations, route, todayDate, masteredPaths,
    snapshot, refreshWork, persist } = options
  let request: AbortController | null = null
  function cancel() {
    request?.abort()
    request = null
    state.busy = ''
  }

  async function generatePractice() {
    if (!guideReady.value) return false
    const current = course.value
    if (!current || !state.plan || state.busy) return false
    if (!configured.value) { state.error = '请先选择有效的 AI 配置。'; return false }
    const controller = new AbortController()
    request = controller; state.busy = 'practice'; state.error = ''; state.notice = ''
    try {
      const raw = await requestGuideJson({ ...state.settings }, practicePrompt(state.plan, route.value, todayDate.value), controller.signal)
      if (controller.signal.aborted || current.id !== activeId() || !state.plan) return false
      const practice = parsePracticeImport(raw, state.plan.modules, state.plan.program)
      snapshot('AI 补全实践安排')
      applyPractice(state.plan, practice)
      state.notice = `已为 ${Object.keys(practice.stages).length} 个阶段补充实践任务与验收清单，可在知识地图中查看。`
      refreshWork(); persist()
      return true
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
      return false
    } finally {
      if (request === controller) { request = null; state.busy = '' }
    }
  }

  async function generate(text: string, dailyMinutes: number) {
    if (!guideReady.value) { state.error = '导学数据尚未读取成功，请重新打开课程后重试。'; return false }
    const current = course.value
    if (!current || state.busy) return false
    if (!configured.value) { state.error = '请先选择有效的 AI 配置。'; return false }
    if (!text.trim()) { state.error = '请填写已有基础与学习目标。'; return false }
    if (text.length > 6000) { state.error = '学习要求请控制在 6000 字以内。'; return false }
    if (!Number.isFinite(dailyMinutes) || dailyMinutes < 5 || dailyMinutes > 1440) {
      state.error = '每日学习时间应为 5–1440 分钟。'; return false
    }
    const controller = new AbortController()
    request = controller
    state.busy = 'plan'; state.error = ''; state.notice = ''
    try {
      const previous = state.plan
      const raw = await requestGuideJson({ ...state.settings }, planPrompt(current.videos.map(v => ({
        path: v.path, title: v.title, duration: durations.value[v.path] ?? null, done: !!progress.get(current.id, v.path)?.done,
      })), text.trim(), dailyMinutes, previous, { mastery: Object.values(state.mastery) }, todayDate.value), controller.signal)
      if (controller.signal.aborted || current.id !== activeId()) return false
      const plan = inheritProgram(validateLearningPlan(raw, current.videos.map(v => v.path)), previous)
      const promoted = retainPrerequisites(plan.lessons, false, masteredPaths.value)
      applyMastery(plan.lessons, state.mastery)
      plan.messages = [...(previous?.messages ?? []).slice(-18), { role: 'user', content: text.trim() }, { role: 'assistant', content: plan.summary }]
      const notice = promoted.length ? `已保留 ${promoted.length} 节必要的前置课。` : '学习路线已生成，可根据掌握程度调整课节。'
      if (previous) {
        // 已有路线时先预览变化，由用户确认后再替换。
        state.pending = { plan, label: 'AI 调整路线', notice: `路线已更新。${promoted.length ? notice : ''}` }
        state.notice = ''
        return true
      }
      state.plan = plan
      state.view = 'route'
      state.includeOptional = false
      state.notice = notice
      persist()
      return true
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
      return false
    } finally {
      if (request === controller) { request = null; state.busy = '' }
    }
  }

  watch(() => [state.settings.provider, state.settings.contextWindow, state.settings.baseUrl, state.settings.model,
    state.settings.apiKey, configured.value], cancel, { flush: 'sync' })
  onBeforeUnmount(cancel)
  return { generate, generatePractice, cancel }
}

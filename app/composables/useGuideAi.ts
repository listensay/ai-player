import { watch, onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'
import type { Course } from '~/types/course'
import type { GuideLesson, GuideMessage } from '~/types/guide'
import type { GuideRouteConstraints } from '~/types/guideConstraints'
import type { GuideWorkspaceState } from '~/types/guideWorkspace'
import type { useProgress } from '~/composables/useProgress'
import { planPrompt, practicePrompt, requestGuideJson } from '~/utils/guideAi'
import { adjustmentPrompt, applyPlanAdjustment, canAdjustPlan } from '~/utils/guidePlanAdjustment'
import { generateLearningPlan } from '~/utils/guidePlanGeneration'
import { retainPrerequisites } from '~/utils/guide'
import { applyMastery } from '~/utils/learningFeedback'
import { applyPractice, budgetTotal, inheritProgram, parsePracticeImport } from '~/utils/studyProgram'
import { planningPreferences } from '~/utils/guideConversation'
import { bindPlanCatalog, orderPlanByCatalogTree } from '~/utils/guideCatalog'
import {
  constrainLearningPlan,
  emptyRouteConstraints,
  fixedCatalogRoute,
  hasRouteSelection,
  parseRouteConstraints,
  pathInScope,
  validatePlanTimeConstraints,
} from '~/utils/guideConstraints'

export function useGuideAi(
  state: GuideWorkspaceState,
  options: {
    course: Ref<Course | null>
    activeId: () => string
    guideReady: Ref<boolean>
    configured: Ref<boolean>
    progress: Pick<ReturnType<typeof useProgress>, 'get'>
    durations: Ref<Record<string, number | null>>
    route: Ref<GuideLesson[]>
    todayDate: Ref<string>
    masteredPaths: Ref<Set<string>>
    snapshot: (label: string) => void
    refreshWork: () => void
    persist: () => void
  },
) {
  const {
    course,
    activeId,
    guideReady,
    configured,
    progress,
    durations,
    route,
    todayDate,
    masteredPaths,
    snapshot,
    refreshWork,
    persist,
  } = options
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
    if (!configured.value) {
      state.error = '请先选择有效的 AI 配置。'
      return false
    }
    const controller = new AbortController()
    request = controller
    state.busy = 'practice'
    state.error = ''
    state.notice = ''
    try {
      const raw = await requestGuideJson(
        { ...state.settings },
        practicePrompt(state.plan, route.value, todayDate.value),
        controller.signal,
      )
      if (controller.signal.aborted || current.id !== activeId() || !state.plan) return false
      const activeModules = new Set(route.value.map((lesson) => lesson.moduleId))
      const practice = parsePracticeImport(
        raw,
        state.plan.modules.filter((module) => activeModules.has(module.id)),
        state.plan.program,
      )
      const candidate = JSON.parse(JSON.stringify(state.plan)) as typeof state.plan
      applyPractice(candidate, practice)
      validatePlanTimeConstraints(candidate)
      snapshot('AI 补全实践安排')
      applyPractice(state.plan, practice)
      state.notice = `已为 ${Object.keys(practice.stages).length} 个阶段补充实践任务与验收清单，可在课程概览中查看。`
      refreshWork()
      persist()
      return true
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
      return false
    } finally {
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }

  async function generate(
    text: string,
    dailyMinutes: number | null = null,
    completionDate: string | null = null,
    conversation: GuideMessage[] = [],
    requestedConstraints?: GuideRouteConstraints,
    sessionId?: string,
  ) {
    if (!guideReady.value) {
      state.error = '导学数据尚未读取成功，请重新打开课程后重试。'
      return false
    }
    const current = course.value
    if (!current || state.busy) return false
    if (!configured.value) {
      state.error = '请先选择有效的 AI 配置。'
      return false
    }
    if (!text.trim()) {
      state.error = '请填写已有基础与学习目标。'
      return false
    }
    if (text.length > 6000) {
      state.error = '学习要求请控制在 6000 字以内。'
      return false
    }
    try {
      planningPreferences(dailyMinutes, completionDate, todayDate.value)
    } catch (error) {
      state.error = (error as Error).message
      return false
    }
    const controller = new AbortController()
    request = controller
    state.busy = 'plan'
    state.error = ''
    state.notice = ''
    try {
      const catalog = current.videos.map((v) => ({
        path: v.path,
        title: v.title,
        duration: durations.value[v.path] ?? null,
        done: !!progress.get(current.id, v.path)?.done,
      }))
      const savedPrevious = state.plan
      const previous = sessionId
        ? null
        : state.plan && current.root && canAdjustPlan(state.plan, catalog)
          ? bindPlanCatalog(JSON.parse(JSON.stringify(state.plan)), catalog, current.name)
          : state.plan
            ? (JSON.parse(JSON.stringify(state.plan)) as typeof state.plan)
            : null
      const constraints = parseRouteConstraints(
        requestedConstraints ?? previous?.constraints ?? emptyRouteConstraints(),
      )
      const adjustment = previous && canAdjustPlan(previous, catalog) && !fixedCatalogRoute(constraints)
      const feedback = { mastery: Object.values(state.mastery) }
      const preferences = {
        completionDate,
        conversation,
        sessionId,
        ...(conversation.length ? { dailyTotalMinutes: dailyMinutes } : {}),
      }
      const existingMinutes = conversation.length
        ? (previous?.dailyMinutes ?? null)
        : (dailyMinutes ?? previous?.dailyMinutes ?? null)
      const messages = adjustment
        ? adjustmentPrompt(catalog, text.trim(), existingMinutes!, previous, feedback, todayDate.value, preferences)
        : planPrompt(catalog, text.trim(), dailyMinutes, previous, feedback, todayDate.value, preferences)
      if (hasRouteSelection(constraints) || constraints.order === 'catalog')
        messages.push({
          role: 'user',
          content: `用户已确认的学习安排必须保留，不重新筛选或改变指定顺序。只安排时间、练习和复盘。以下是学习范围数据：${JSON.stringify(constraints)}`,
        })
      const settings = { ...state.settings }
      const adjusted = adjustment
        ? applyPlanAdjustment(
            await requestGuideJson(settings, messages, controller.signal),
            previous,
            catalog,
            existingMinutes!,
          )
        : null
      const plan =
        adjusted?.plan ??
        inheritProgram(
          await generateLearningPlan({
            courseId: current.id,
            courseName: current.name,
            catalog,
            settings,
            signal: controller.signal,
            messages,
            request: text.trim(),
            dailyMinutes,
            previous,
            feedback,
            today: todayDate.value,
            preferences,
            constraints,
            complete: (messages) => requestGuideJson(settings, messages, controller.signal),
          }),
          previous,
        )
      if (controller.signal.aborted || current.id !== activeId()) return false
      if (conversation.length && !previous && !plan.program) {
        throw new Error('AI 未给出完整学习周期，请重试。')
      }
      if (conversation.length && plan.program && plan.program.budget.video !== plan.dailyMinutes) {
        throw new Error('AI 返回的学习时间不一致，请重试。')
      }
      if (
        conversation.length &&
        dailyMinutes !== null &&
        (plan.program ? budgetTotal(plan.program.budget) : plan.dailyMinutes) !== dailyMinutes
      ) {
        throw new Error('AI 未按指定的每日学习时间安排，请重试。')
      }
      // 明确略过的课节保留依赖关系，在预览中提示风险，不能静默重新加入路线。
      const excluded = new Set([
        ...(adjusted ? plan.lessons.filter((l) => l.status === 'skipped').map((l) => l.path) : []),
        ...catalog.filter((lesson) => !pathInScope(lesson.path, constraints)).map((lesson) => lesson.path),
      ])
      const promoted = retainPrerequisites(plan.lessons, false, new Set([...masteredPaths.value, ...excluded]))
      applyMastery(
        plan.lessons,
        state.mastery,
        excluded,
        new Set(catalog.filter((lesson) => !pathInScope(lesson.path, constraints)).map((lesson) => lesson.path)),
      )
      constrainLearningPlan(plan, constraints, catalog)
      if (current.root) orderPlanByCatalogTree(plan, current)
      plan.messages = [
        ...(previous?.messages ?? []).slice(-18),
        ...conversation.slice(-12),
        { role: 'user', content: text.trim() },
        { role: 'assistant', content: plan.summary },
      ]
      const notice = promoted.length
        ? `已保留 ${promoted.length} 节必要的前置课。`
        : '学习路线已生成，可根据掌握程度调整课节。'
      if (savedPrevious) {
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
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }

  watch(
    () => [
      state.settings.provider,
      state.settings.contextWindow,
      state.settings.baseUrl,
      state.settings.model,
      state.settings.apiKey,
      state.settings.timeoutMinutes,
      configured.value,
    ],
    cancel,
    { flush: 'sync' },
  )
  watch(todayDate, cancel, { flush: 'sync' })
  watch(() => course.value?.videos.map((video) => [video.path, video.title]), cancel, {
    deep: true,
    flush: 'sync',
  })
  onBeforeUnmount(cancel)
  return { generate, generatePractice, cancel }
}

import type { LearningPlan, StudyBudget } from '../types/guide'
import { addDays, budgetForDay, budgetTotal, emptyBudget, isLightDay, parseDayBudget, parseProgram, programDay, stageForDay, validDate } from './studyProgram.ts'

export type PlanAdjustment =
  | { kind: 'weekly'; weekdays: number[]; budget: StudyBudget; weekendBudget: StudyBudget }
  | { kind: 'today'; budget: StudyBudget }
  | { kind: 'pause'; until: string | null }
  | { kind: 'resume'; strategy: 'extend' | 'deadline'; limit: number }
  | { kind: 'replan'; strategy: 'extend' | 'deadline'; days: number; limit: number }

/** 只复制并变更计划，学习记录由调用方保留；预览不会触发任何写入。 */
export function adjustLearningPlan(source: LearningPlan, date: string, action: PlanAdjustment, remainingSeconds: number, consumedToday = 0) {
  const plan: LearningPlan = JSON.parse(JSON.stringify(source))
  if (!plan.program) throw new Error('请先设置完整学习计划。')
  if (!validDate(date)) throw new Error('调整日期无效。')
  const program = plan.program
  program.calendar ??= { weekdays: [1, 2, 3, 4, 5, 6, 7], overrides: {} }
  const calendar = program.calendar
  let shifted = 0, shortage = 0
  if (action.kind === 'weekly') {
    calendar.weekdays = [...action.weekdays]
    program.budget = action.budget
    calendar.weekendBudget = action.weekendBudget
  } else if (action.kind === 'today') calendar.overrides[date] = parseDayBudget(action.budget)
  else if (action.kind === 'pause') {
    if (action.until !== null && (!validDate(action.until) || action.until <= date)) throw new Error('恢复日期须晚于今天。')
    if (calendar.pause && (calendar.pause.until === null || calendar.pause.until > date)) throw new Error('计划已暂停，请先恢复或调整恢复日期。')
    calendar.pause = { from: date, until: action.until }
  } else {
    if (action.kind === 'resume') {
      const pause = calendar.pause
      if (!pause) throw new Error('当前计划未暂停。')
      const until = pause.until && pause.until < date ? pause.until : date
      shifted = Math.max(0, Math.round((Date.parse(until) - Date.parse(pause.from)) / 86400000))
      // 留下已经过去的休息日，避免重新计算时恢复暂停期间的预算。
      for (let d = pause.from, count = 0; d < until && count < 3650; d = addDays(d, 1), count++) calendar.overrides[d] = emptyBudget()
      delete calendar.pause
    } else {
      if (!Number.isInteger(action.days) || action.days < 0 || action.days > 1095) throw new Error('顺延天数应为 0–1095。')
      shifted = action.days
    }
    if (action.strategy === 'extend') {
      const today = programDay(program, date)
      // 仅移动当前及未来阶段，已结束阶段保持历史日期。
      for (const module of plan.modules) {
        const stage = module.practice
        if (!stage || stage.endDay < today - shifted) continue
        if (stage.startDay >= today - shifted) stage.startDay += shifted
        stage.endDay += shifted
      }
      program.days += shifted
    } else {
      if (!Number.isInteger(action.limit) || action.limit < 5 || action.limit > 1440) throw new Error('每日上限应为 5–1440 分钟。')
      const start = Math.max(1, programDay(program, date))
      const candidates: Array<{ date: string; budget: StudyBudget }> = []
      for (let day = start; day <= program.days; day++) {
        if (isLightDay(program, day) && !calendar.overrides[addDays(program.startDate, day - 1)]) continue
        const budget = budgetForDay(program, stageForDay(plan.modules, day)?.practice, day)
        if (budgetTotal(budget) === 0) continue
        if (budgetTotal(budget) - budget.video > action.limit) throw new Error('实践预算已超过每日上限，请先调整实践时间。')
        candidates.push({ date: addDays(program.startDate, day - 1), budget })
      }
      const available = (extra: number) => candidates.reduce((sum, item) => sum + Math.max(0,
        Math.min(item.budget.video + extra, action.limit - budgetTotal(item.budget) + item.budget.video) * 60 - (item.date === date ? consumedToday : 0)), 0)
      shortage = Math.max(0, remainingSeconds - available(action.limit))
      let low = 0, high = action.limit
      while (low < high) { const mid = Math.floor((low + high) / 2); if (available(mid) >= remainingSeconds) high = mid; else low = mid + 1 }
      for (const item of candidates) calendar.overrides[item.date] = { ...item.budget, video: Math.min(item.budget.video + low, action.limit - budgetTotal(item.budget) + item.budget.video) }
      shifted = 0
    }
  }
  plan.program = parseProgram(program)
  if (plan.modules.some(m => m.practice && m.practice.endDay > plan.program!.days)) throw new Error('阶段日期超出计划周期，请减少顺延天数。')
  plan.dailyMinutes = Math.max(5, program.budget.video)
  return { plan, shifted, shortage }
}

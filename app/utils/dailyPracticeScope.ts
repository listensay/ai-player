import type { TodayItem, TodayPlan } from '../types/guide'

/** 提前学习保留原日巩固范围，追加课节不改变可用条件或已生成作业的标识。 */
export function dailyPracticeItems(plan: TodayPlan | null, date: string): TodayItem[] {
  if (plan?.date !== date) return []
  const items = plan.items.filter((item) => item.kind !== 'question')
  if (!plan.extraDays?.length) return items
  if (plan.practiceItemIds?.length) {
    const ids = new Set(plan.practiceItemIds)
    return items.filter((item) => ids.has(item.id))
  }
  // 旧记录没有范围快照：追加前的任务在列表最前，按原日额度找回完整片段。
  let seconds = 0
  const original: TodayItem[] = []
  for (const item of items) {
    if (seconds >= plan.minutes * 60) break
    original.push(item)
    seconds += item.seconds
  }
  return original
}

import type { PracticeRecord } from '../types/practice'

/** 输入为由新到旧的历史记录，输出按出题顺序排列的当前组。 */
export function practiceGroup(records: PracticeRecord[], current: PracticeRecord | undefined): PracticeRecord[] {
  if (!current) return []
  return records
    .filter(
      (record) =>
        record.path === current.path &&
        (current.groupId
          ? record.groupId === current.groupId
          : !record.groupId &&
            record.scope?.start === current.scope?.start &&
            record.scope?.end === current.scope?.end),
    )
    .reverse()
}

/** 每题等权，取最新提交；未答计零，最终合计再四舍五入。 */
export function practiceGroupScore(records: PracticeRecord[]) {
  const total = records.length
  let completed = 0
  let points = 0
  for (const record of records) {
    const feedback = record.attempts.at(-1)?.feedback
    if (!feedback) continue
    completed++
    points += feedback.grade?.score ?? { solid: 100, partial: 50, retry: 0 }[feedback.result]
  }
  return { total, completed, unanswered: total - completed, score: total ? Math.round(points / total) : 0 }
}

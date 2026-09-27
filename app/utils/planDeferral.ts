import type { DailyContext } from './dailyPlan.ts'
import { calculateDay } from './dailyPlan.ts'
import { buildSchedule } from './guide.ts'
import { addDays, budgetForDay, budgetTotal, checkPassed, emptyBudget, isPaused, parseProgram, programDate, programDay, stageForDay, validDate, videoFinishDay } from './studyProgram.ts'

/** Rebuild only future dates; progress, evidence and completed tasks remain owned by their original records. */
export function deferLearningPlan(context: DailyContext, date: string, resumeDate: string) {
  if (!context.plan?.program) throw new Error('请先设置学习计划。')
  const source = context.plan
  const program = parseProgram(source.program)
  if (!validDate(date) || !validDate(resumeDate)) throw new Error('请选择有效的恢复日期。')
  const today = programDay(program, date), resume = programDay(program, resumeDate)
  if (!Number.isInteger(resume) || !Number.isInteger(today) || resume <= today || resume - today > 1095)
    throw new Error('恢复日期须晚于今天，且休息时间不能超过 1095 天。')
  if (context.enabled === false) throw new Error('请先恢复课程，再顺延学习计划。')
  if (isPaused(program, date)) throw new Error('计划已暂停，请先恢复学习。')
  if (today < 1) throw new Error('计划尚未开始，可在每周安排中调整。')
  const plan = JSON.parse(JSON.stringify(source)) as typeof source
  plan.program = program
  program.calendar ??= { weekdays: [1, 2, 3, 4, 5, 6, 7], overrides: {} }
  let addedDays = 0
  for (let d = date; d < resumeDate; d = addDays(d, 1)) {
    const previous = program.calendar.overrides[d]
    if (!previous || budgetTotal(previous) > 0) addedDays++
    program.calendar.overrides[d] = emptyBudget()
  }
  if (!addedDays) throw new Error('所选日期前已经安排休息，无需再次顺延。')

  const current = calculateDay(context, date)
  const stages = plan.modules.filter(m => m.practice).sort((a, b) => a.practice!.startDay - b.practice!.startDay)
  const pending = stages.filter(module => {
    const stage = module.practice!
    return current.route.some(l => l.moduleId === module.id && !context.progress[l.path]?.done)
      || stage.tasks.some(t => !t.repeat && !context.records.entries.some(e => e.moduleId === module.id && e.taskId === t.id && e.title === t.title && e.done))
      || stage.checks.some(c => !checkPassed(context.records, module.id, c))
      || (stage.endDay >= today && stage.tasks.some(t => t.repeat))
  })
  const first = pending[0]?.practice
  // An overdue unfinished stage keeps at least one learning day when it is carried forward.
  let shift = addedDays + Math.max(0, today - (first?.endDay ?? today))
  for (const module of pending) {
    const stage = module.practice!
    if (module !== pending[0] || stage.startDay >= today) stage.startDay += shift
    stage.endDay += shift
    const seconds = buildSchedule(current.route.filter(l => l.moduleId === module.id), current.durations, context.progress, plan.dailyMinutes).remainingSeconds
    if (seconds > 0) {
      let left = seconds, finish = Math.max(resume, stage.startDay)
      for (; finish <= 1095; finish++) {
        left -= budgetForDay(program, stage, finish).video * 60
        if (left <= 0) break
      }
      if (left > 0) throw new Error('现有观看时间无法排完剩余课节，请先增加每周学习时间。')
      const extra = Math.max(0, finish - stage.endDay)
      stage.endDay += extra
      shift += extra
    }
  }
  program.days = Math.max(program.days + shift, resume, ...stages.map(m => m.practice!.endDay))
  const finish = videoFinishDay(program, plan.modules, resumeDate, current.schedule.remainingSeconds)
  if (finish === Infinity) throw new Error('现有观看时间无法排完剩余课节，请先增加每周学习时间。')
  if (finish !== null) program.days = Math.max(program.days, finish)
  if (program.days > 1095) throw new Error('顺延后超过 1095 天，请先调整每日投入或计划周期。')
  plan.program = parseProgram(program)
  let nextDay = resume
  for (; nextDay <= program.days; nextDay++) {
    if (budgetTotal(budgetForDay(program, stageForDay(plan.modules, nextDay)?.practice, nextDay)) > 0) break
  }
  if (nextDay > program.days) throw new Error('恢复后没有可用学习日，请先设置每周学习日。')
  return { plan, shifted: program.days - source.program!.days, shortage: 0, resumeDate: programDate(program, nextDay) }
}

import type {
  GuideLesson, KnowledgeModule, LearningPlan, StagePractice, StageTask, StudyBudget, StudyProgram, StudyRecords, WorkEntry, WorkKind,
} from '../types/guide'
import type { VideoProgress } from '../types/course'

export const WORK_LABELS: Record<WorkKind, string> = { code: '独立编码', project: '项目实践', recap: '复习与面试' }
export const BUDGET_LABELS: Record<keyof StudyBudget, string> = { video: '视频学习', ...WORK_LABELS }
export const CHECK_LABELS = { exercise: '练习验收', project: '项目验收' } as const
export const WORK_KINDS = Object.keys(WORK_LABELS) as WorkKind[]
export const LIGHT_TASK_ID = 'light-review'
const DAY = 86_400_000

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
/** 深拷贝；来源可能是响应式代理，不能使用 structuredClone。 */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export const budgetTotal = (b: StudyBudget) => b.video + b.code + b.project + b.recap
export const checkKey = (moduleId: string, checkId: string) => JSON.stringify([moduleId, checkId])
export const emptyStudyRecords = (): StudyRecords => ({ entries: [], checks: {}, activeModuleId: '', undo: null })

export function validDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
}

export function parseBudget(v: unknown): StudyBudget {
  if (!object(v) || !['video', 'code', 'project', 'recap'].every(k => integer(v[k], 0, 1440))) throw new Error('各项时间需为 0–1440 的整数分钟。')
  const b = { video: v.video, code: v.code, project: v.project, recap: v.recap }
  if (budgetTotal(b) < 5 || budgetTotal(b) > 1440) throw new Error('每日总投入需为 5–1440 分钟。')
  return b
}

export function parseProgram(v: unknown): StudyProgram {
  if (!object(v) || !integer(v.days, 1, 1095) || !validDate(v.startDate) || !integer(v.lightEvery, 0, 30) || !integer(v.lightMinutes, 5, 1440)) {
    throw new Error('请填写有效的计划天数、开始日期和复盘日安排。')
  }
  const program: StudyProgram = { days: v.days, startDate: v.startDate, budget: parseBudget(v.budget), lightEvery: v.lightEvery, lightMinutes: v.lightMinutes }
  if (v.lightTask !== undefined && v.lightTask !== null) {
    if (!object(v.lightTask) || !text(v.lightTask.title, 200) || !text(v.lightTask.instructions)) throw new Error('复盘日安排需包含标题和操作要求。')
    program.lightTask = { title: v.lightTask.title.trim(), instructions: v.lightTask.instructions.trim() }
  }
  return program
}

export function parseStage(v: unknown): StagePractice {
  if (!object(v) || !integer(v.startDay, 1, 1095) || !integer(v.endDay, v.startDay, 1095) || !text(v.goal) || !text(v.project) || !text(v.skipWhen)) {
    throw new Error('阶段需包含有效的日期范围、目标、交付物和跳过条件。')
  }
  if (!Array.isArray(v.tasks) || !Array.isArray(v.checks) || v.tasks.length > 50 || v.checks.length > 30) throw new Error('阶段任务或验收清单格式不正确。')
  const seen = new Set<string>()
  const tasks = v.tasks.map((t: any): StageTask => {
    if (!object(t) || !text(t.id, 100) || seen.has(t.id) || !Object.hasOwn(WORK_LABELS, t.kind) || !text(t.title, 200) || !text(t.instructions)) {
      throw new Error('实践任务需包含唯一编号、类型、标题和操作要求。')
    }
    seen.add(t.id)
    return { id: t.id, kind: t.kind as WorkKind, title: t.title.trim(), instructions: t.instructions.trim(), ...(t.repeat === true ? { repeat: true } : {}) }
  })
  seen.clear()
  const checks = v.checks.map((c: any) => {
    if (!object(c) || !text(c.id, 100) || seen.has(c.id) || !['exercise', 'project'].includes(c.kind) || !text(c.text)) throw new Error('验收项需包含唯一编号、类型和验收要求。')
    seen.add(c.id)
    return { id: c.id, kind: c.kind as 'exercise' | 'project', text: c.text.trim() }
  })
  return { startDay: v.startDay, endDay: v.endDay, goal: v.goal.trim(), project: v.project.trim(), skipWhen: v.skipWhen.trim(), tasks, checks,
    ...(v.budget ? { budget: parseBudget(v.budget) } : {}) }
}

/** 计划第几天（开始日为第 1 天）。日期均为本地日期键，按 UTC 零点换算，不受时区影响。 */
export function programDay(program: StudyProgram, date: string) {
  return Math.floor((Date.parse(date) - Date.parse(program.startDate)) / DAY) + 1
}
export function programDate(program: StudyProgram, day: number) {
  return new Date(Date.parse(program.startDate) + (day - 1) * DAY).toISOString().slice(0, 10)
}
export const isLightDay = (program: StudyProgram, day: number) => day >= 1 && !!program.lightEvery && day % program.lightEvery === 0

export function stageForDay(modules: KnowledgeModule[], day: number) {
  return modules.find(m => m.practice && day >= m.practice.startDay && day <= m.practice.endDay)
}

export function budgetForDay(program: StudyProgram, stage: StagePractice | undefined, day: number): StudyBudget {
  if (day < 1) return { video: 0, code: 0, project: 0, recap: 0 }
  if (isLightDay(program, day)) return { video: 0, code: 0, project: 0, recap: program.lightMinutes }
  return stage?.budget ?? program.budget
}
export function dailyBudget(program: StudyProgram, stage: StagePractice | undefined, date: string): StudyBudget {
  return budgetForDay(program, stage, programDay(program, date))
}

/**
 * 按各阶段每日看课额度推算剩余视频在计划第几天看完；超出计划后按基础分配继续推算。
 * 返回 null 表示没有剩余视频，Infinity 表示看课额度为 0 无法完成。
 */
export function videoFinishDay(program: StudyProgram, modules: KnowledgeModule[], date: string, remainingSeconds: number): number | null {
  if (remainingSeconds <= 0) return null
  let left = remainingSeconds
  const start = Math.max(1, programDay(program, date))
  for (let day = start; day < start + 3650; day++) {
    const stage = day <= program.days ? stageForDay(modules, day)?.practice : undefined
    left -= budgetForDay(program, stage, day).video * 60
    if (left <= 0) return day
  }
  return Infinity
}

function taskDone(records: StudyRecords, moduleId: string, task: StageTask, date: string) {
  return records.entries.some(e => e.moduleId === moduleId && e.taskId === task.id && e.done
    && (task.repeat ? e.date === date : e.title === task.title))
}

export interface WorkContext {
  date: string
  moduleId: string
  stage?: StagePractice
  budget: StudyBudget
  /** 轻量复盘日只安排复盘，不推进新任务。 */
  light?: { title: string; instructions: string; minutes: number }
}

/**
 * 生成当天的实践安排：每类时间对应阶段中下一项未完成任务。
 * 已投入或已完成的记录始终保留；同类任务当天完成后，剩余时间顺延给下一项任务。
 */
export function arrangeWork(ctx: WorkContext, records: StudyRecords): WorkEntry[] {
  const { date, moduleId, stage, budget } = ctx
  const owner = moduleId || 'program'
  const result = records.entries.filter(e => e.date === date && (e.moduleId === owner || e.minutes > 0 || e.done || !!e.evidence.trim()))
    .map(e => ({ ...e }))
  if (ctx.light) {
    if (!result.some(e => e.taskId === LIGHT_TASK_ID)) {
      result.push({ id: `${date}:${owner}:${LIGHT_TASK_ID}`, date, moduleId: owner, taskId: LIGHT_TASK_ID, kind: 'recap', title: ctx.light.title,
        instructions: ctx.light.instructions, targetMinutes: ctx.light.minutes, minutes: 0, evidence: '', done: false })
    }
    return result
  }
  if (!stage) return result
  for (const kind of WORK_KINDS) {
    if (budget[kind] <= 0) continue
    const mine = result.filter(e => e.kind === kind && e.moduleId === owner)
    if (mine.some(e => !e.done)) continue
    const remaining = budget[kind] - mine.reduce((n, e) => n + e.minutes, 0)
    if (mine.length && remaining <= 0) continue
    const candidates = stage.tasks.filter(t => t.kind === kind && !mine.some(e => e.taskId === t.id) && !taskDone(records, owner, t, date))
    const task = candidates.find(t => !t.repeat) ?? candidates[0]
    if (!task) continue
    result.push({ id: `${date}:${owner}:${task.id}`, date, moduleId: owner, taskId: task.id, kind, title: task.title, instructions: task.instructions,
      targetMinutes: mine.length ? remaining : budget[kind], minutes: 0, evidence: '', done: false })
  }
  return result
}

export function restoreStudyRecords(raw: unknown): StudyRecords {
  const result = emptyStudyRecords()
  if (!object(raw)) return result
  const seen = new Set<string>()
  if (Array.isArray(raw.entries)) for (const e of raw.entries.slice(-5000)) {
    if (!object(e) || !text(e.id, 1000) || seen.has(e.id) || !validDate(e.date) || !text(e.moduleId, 100) || !text(e.taskId, 200)
      || !Object.hasOwn(WORK_LABELS, e.kind) || !text(e.title, 200) || typeof e.instructions !== 'string'
      || !integer(e.targetMinutes, 0, 1440) || !integer(e.minutes, 0, 1440) || typeof e.evidence !== 'string' || e.evidence.length > 6000 || typeof e.done !== 'boolean') continue
    seen.add(e.id)
    result.entries.push({ id: e.id, date: e.date, moduleId: e.moduleId, taskId: e.taskId, kind: e.kind, title: e.title, instructions: e.instructions,
      targetMinutes: e.targetMinutes, minutes: e.minutes, evidence: e.evidence, done: e.done })
  }
  if (object(raw.checks)) for (const [key, c] of Object.entries(raw.checks)) {
    if (object(c) && text(c.text) && typeof c.evidence === 'string' && c.evidence.length <= 6000 && typeof c.passed === 'boolean' && Number.isFinite(c.updatedAt)) {
      result.checks[key] = { text: c.text, evidence: c.evidence, passed: c.passed && !!c.evidence.trim(), updatedAt: c.updatedAt }
    }
  }
  result.activeModuleId = typeof raw.activeModuleId === 'string' ? raw.activeModuleId.slice(0, 100) : ''
  // 路线快照在撤销时按当前课程目录再次校验。
  if (object(raw.undo) && object(raw.undo.plan) && ['all', 'route'].includes(raw.undo.view) && typeof raw.undo.label === 'string') {
    result.undo = { plan: raw.undo.plan as LearningPlan, includeOptional: raw.undo.includeOptional === true, view: raw.undo.view,
      label: raw.undo.label.slice(0, 100), at: Number.isFinite(raw.undo.at) ? raw.undo.at : 0 }
  }
  return result
}

/** 仅把相对次序真正变化的公共课节记为重排，前面新增一课不会让所有序号都算变更。 */
export function compareRoutes(before: GuideLesson[], after: GuideLesson[]) {
  const old = new Set(before.map(l => l.path)), next = new Set(after.map(l => l.path))
  const commonBefore = before.filter(l => next.has(l.path)).map(l => l.path)
  const commonAfter = after.filter(l => old.has(l.path)).map(l => l.path)
  const positions = new Map(commonBefore.map((p, i) => [p, i]))
  return { added: after.filter(l => !old.has(l.path)), removed: before.filter(l => !next.has(l.path)), moved: commonAfter.filter((p, i) => positions.get(p) !== i) }
}

/** AI 重新规划时未返回实践安排，则沿用原计划中同编号阶段的安排。 */
export function inheritProgram(next: LearningPlan, previous: LearningPlan | null) {
  if (!previous) return next
  if (!next.program && previous.program) next.program = clone(previous.program)
  for (const m of next.modules) if (!m.practice) {
    const old = previous.modules.find(p => p.id === m.id)
    if (old?.practice) m.practice = clone(old.practice)
  }
  return next
}

/** 导入文件或 AI 返回的实践计划：阶段必须对应当前路线的板块，日期不得超出计划周期。 */
export function parsePracticeImport(raw: unknown, modules: KnowledgeModule[], current?: StudyProgram) {
  if (!object(raw)) throw new Error('实践计划格式不正确。')
  const program = raw.program === undefined || raw.program === null ? undefined : parseProgram(raw.program)
  const ids = new Set(modules.map(m => m.id))
  const list: Array<[unknown, unknown]> | null = Array.isArray(raw.stages) ? raw.stages.map((s: any) => [s?.moduleId, s])
    : object(raw.stages) ? Object.entries(raw.stages) : null
  if (!list) throw new Error('实践计划缺少阶段安排。')
  const stages: Record<string, StagePractice> = {}
  for (const [id, stage] of list) {
    if (typeof id !== 'string' || !ids.has(id)) throw new Error(`阶段「${String(id)}」不在当前学习路线中。`)
    if (stages[id]) throw new Error(`阶段「${id}」重复。`)
    stages[id] = parseStage(stage)
  }
  if (!program && !Object.keys(stages).length) throw new Error('实践计划为空。')
  const days = (program ?? current)?.days
  if (!days) throw new Error('请先设置完整学习计划的总天数。')
  if (Object.values(stages).some(s => s.endDay > days)) throw new Error('阶段日期超出计划总天数。')
  return { program, stages }
}

export function applyPractice(plan: LearningPlan, practice: ReturnType<typeof parsePracticeImport>) {
  if (practice.program) {
    plan.program = practice.program
    plan.dailyMinutes = Math.max(5, practice.program.budget.video || plan.dailyMinutes)
  }
  for (const m of plan.modules) if (practice.stages[m.id]) m.practice = practice.stages[m.id]
}

export interface ProgressCount { done: number; total: number }
export interface StageProgress { video: ProgressCount; exercise: ProgressCount; project: ProgressCount; complete: boolean }

/** 视频、练习和项目分别计数；验收项内容变化后原记录失效，需要重新确认。 */
export function stageProgress(module: KnowledgeModule, route: GuideLesson[], progress: Record<string, VideoProgress>, records: StudyRecords): StageProgress {
  const lessons = route.filter(l => l.moduleId === module.id)
  const video = { done: lessons.filter(l => progress[l.path]?.done).length, total: lessons.length }
  const checks = module.practice?.checks ?? []
  const count = (kind: 'exercise' | 'project') => {
    const items = checks.filter(c => c.kind === kind)
    return { total: items.length, done: items.filter(c => checkPassed(records, module.id, c)).length }
  }
  const exercise = count('exercise'), project = count('project')
  const complete = video.total + checks.length > 0 && [video, exercise, project].every(p => p.done >= p.total)
  return { video, exercise, project, complete }
}
export function checkPassed(records: StudyRecords, moduleId: string, check: { id: string; text: string }) {
  const record = records.checks[checkKey(moduleId, check.id)]
  return !!record?.passed && record.text === check.text && !!record.evidence.trim()
}

/** 课节精简标题：去掉序号、课程系列前缀与项目名，原文件名在详情中保留。 */
export function conciseLessonTitle(title: string) {
  let t = title.trim().replace(/^\d{1,4}(?:[\s._\-—–、:：]+|(?=[【[]))/, '')
  // 文件名常见“【AI_项目名（主题）】”形式，结尾括号可能缺失。
  if (/^[【[]/.test(t)) t = t.slice(1).replace(/[】\]]\s*$/, '').trim()
  t = t.replace(/^AI大模型之[^_]+_/, '')
  const project = /^AI[_\s]+[^（(_\s]{2,12}[（(](.+)$/.exec(t)
  if (project) {
    t = project[1]!.replace(/[)）]\s*$/, '')
    const close = t.search(/[)）]/)
    if (close > 0 && !/[（(]/.test(t.slice(0, close))) t = `${t.slice(0, close).trim()}：${t.slice(close + 1).trim()}`
  } else t = t.replace(/^AI[_\s]+/, '')
  t = t.replace(/^(?:掌柜智库|智能客服|电商小二|电商助小二)[_\s]*/, '').trim()
  return t || title
}

/** 课节来源的简短描述，例如 “Python基础 · Day 2”。 */
export function conciseSource(dir: string) {
  const parts = dir.split('/').filter(Boolean)
  if (!parts.length) return ''
  const chapter = parts[0]!.replace(/^\d{1,3}[_\s.\-、]*/, '').replace(/^尚硅谷(?:大模型)?(?:技术|项目)?之/, '') || parts[0]!
  const day = parts.slice(1).map(p => /^day\s*0*(\d+)/i.exec(p)).find(Boolean)
  return day ? `${chapter} · Day ${day[1]}` : chapter
}

export function formatMinutes(minutes: number) {
  if (minutes <= 0) return '0 分钟'
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h ? `${h} 小时${m ? ` ${m} 分钟` : ''}` : `${m} 分钟`
}

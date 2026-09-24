import type { DependencyRisk, GuideLesson, KnowledgeModule, LearningPlan, LessonStatus, StudyProgram } from '../types/guide'
import type { VideoProgress } from '../types/course'
import { parseProgram, parseStage } from './studyProgram.ts'

export const LESSON_STATUS_LABELS: Record<LessonStatus, string> = {
  required: '必修', optional: '选修 / 查漏', skipped: '已跳过',
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(value: unknown, name: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`AI 返回的${name}不完整，请重试。`)
  }
  return value.trim()
}

/** AI 和本地缓存都属于不可信输入。任何缺课、虚构引用或循环依赖都不能成为播放路线。 */
export function validateLearningPlan(value: unknown, paths: string[], allowEmptyRoute = false): LearningPlan {
  if (!isRecord(value) || !Array.isArray(value.modules) || !Array.isArray(value.lessons)) {
    throw new Error('AI 没有返回完整的课程路线，请重试。')
  }
  const knownPaths = new Set(paths)
  const moduleIds = new Set<string>()
  const modules = value.modules.map((raw) => {
    if (!isRecord(raw)) throw new Error('知识板块格式不正确。')
    const id = requiredText(raw.id, '板块编号', 100)
    if (moduleIds.has(id)) throw new Error('知识板块编号重复，请重新生成。')
    moduleIds.add(id)
    const module: KnowledgeModule = { id, title: requiredText(raw.title, '板块名称', 200), description: requiredText(raw.description, '板块说明') }
    // 实践安排是可选增强：格式不完整时只忽略该部分，不影响路线本身。
    if (raw.practice !== undefined && raw.practice !== null) { try { module.practice = parseStage(raw.practice) } catch { /* 忽略无效安排 */ } }
    return module
  })
  const seen = new Set<string>()
  const lessons: GuideLesson[] = value.lessons.map((raw) => {
    if (!isRecord(raw)) throw new Error('课节格式不正确。')
    const path = requiredText(raw.path, '课节路径', 2000)
    if (!knownPaths.has(path) || seen.has(path)) throw new Error('AI 返回了不存在或重复的课节，请重试。')
    seen.add(path)
    if (typeof raw.moduleId !== 'string' || !moduleIds.has(raw.moduleId)) throw new Error('课节的知识板块不存在。')
    if (!['required', 'optional', 'skipped'].includes(String(raw.status))) throw new Error('课节状态不正确。')
    if (!Array.isArray(raw.prerequisites) || !Array.isArray(raw.concepts)) throw new Error('课节缺少知识点或前置依赖。')
    const prerequisites = [...new Set(raw.prerequisites.map((p: unknown) => {
      if (typeof p !== 'string' || !knownPaths.has(p) || p === path) throw new Error('AI 返回了无效的前置课节。')
      return p
    }))]
    return {
      path, moduleId: raw.moduleId, status: raw.status as LessonStatus,
      reason: requiredText(raw.reason, '选课理由'), prerequisites,
      concepts: raw.concepts.map((c: unknown) => requiredText(c, '知识点', 150)).slice(0, 20),
    }
  })
  if (seen.size !== knownPaths.size) throw new Error('AI 遗漏了部分课节，原路线已保留，请重新生成。')
  const byPath = new Map(lessons.map(l => [l.path, l]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  function visit(path: string) {
    if (visiting.has(path)) throw new Error('前置知识出现循环依赖，请重新生成。')
    if (visited.has(path)) return
    visiting.add(path)
    byPath.get(path)!.prerequisites.forEach(visit)
    visiting.delete(path)
    visited.add(path)
  }
  paths.forEach(visit)
  if (!allowEmptyRoute && !lessons.some(l => l.status === 'required')) throw new Error('路线没有必修课，请补充学习目标后重试。')
  if (typeof value.dailyMinutes !== 'number' || !Number.isFinite(value.dailyMinutes) || value.dailyMinutes < 5 || value.dailyMinutes > 1440) {
    throw new Error('每日学习时间应为 5–1440 分钟。')
  }
  // 保留规划的课节顺序。目录仅用于校验路径，不能覆盖定制路线的安排。
  let program: StudyProgram | undefined
  if (value.program !== undefined && value.program !== null) { try { program = parseProgram(value.program) } catch { /* 忽略无效计划 */ } }
  if (program) for (const m of modules) if (m.practice && m.practice.endDay > program.days) delete m.practice
  return {
    version: 1, createdAt: Date.now(), summary: requiredText(value.summary, '路线说明'),
    profile: requiredText(value.profile, '学情画像'), dailyMinutes: Math.round(value.dailyMinutes),
    modules, lessons, messages: [], ...(program ? { program } : {}),
  }
}

/** 初次生成时保留所有必修课的前置依赖（包括跨模块、间接依赖）。 */
export function retainPrerequisites(lessons: GuideLesson[], includeOptional = false, mastered = new Set<string>()): string[] {
  const byPath = new Map(lessons.map(l => [l.path, l]))
  const promoted: string[] = []
  const visited = new Set<string>()
  function visit(lesson: GuideLesson) {
    if (visited.has(lesson.path)) return
    visited.add(lesson.path)
    for (const path of lesson.prerequisites) {
      if (mastered.has(path)) continue
      const prerequisite = byPath.get(path)
      if (!prerequisite) continue
      if (prerequisite.status !== 'required') {
        prerequisite.status = 'required'
        prerequisite.reason = `为保留关键前置知识，已加入必修。${prerequisite.reason.replace(/^为保留关键前置知识，已加入必修。/, '').slice(0, 1900)}`
        promoted.push(path)
      }
      visit(prerequisite)
    }
  }
  lessons.filter(l => l.status === 'required' || (includeOptional && l.status === 'optional')).forEach(visit)
  return promoted
}

export function orderedRoute(lessons: GuideLesson[], includeOptional: boolean): GuideLesson[] {
  const selected = lessons.filter(l => l.status === 'required' || (includeOptional && l.status === 'optional'))
  const selectedPaths = new Set(selected.map(l => l.path))
  const byPath = new Map(lessons.map(l => [l.path, l]))
  const visited = new Set<string>()
  const result: GuideLesson[] = []
  function visit(l: GuideLesson) {
    if (visited.has(l.path)) return
    visited.add(l.path)
    l.prerequisites.forEach(p => { const dependency = byPath.get(p); if (dependency) visit(dependency) })
    // 略过中间课节仍需保留两端的先修顺序，但不把该课重新加入路线。
    if (selectedPaths.has(l.path)) result.push(l)
  }
  selected.forEach(visit)
  return result
}

export function dependencyRisks(lessons: GuideLesson[], includeOptional: boolean, mastered = new Set<string>()): DependencyRisk[] {
  const selected = orderedRoute(lessons, includeOptional)
  const selectedPaths = new Set(selected.map(l => l.path))
  const byPath = new Map(lessons.map(l => [l.path, l]))
  const risks = new Map<string, Set<string>>()
  for (const lesson of selected) {
    const seen = new Set<string>()
    const visit = (path: string) => {
      if (mastered.has(path)) return
      if (seen.has(path)) return
      seen.add(path)
      if (!selectedPaths.has(path)) {
        if (!risks.has(path)) risks.set(path, new Set())
        risks.get(path)!.add(lesson.path)
      }
      byPath.get(path)?.prerequisites.forEach(visit)
    }
    lesson.prerequisites.forEach(visit)
  }
  return [...risks].map(([prerequisite, dependents]) => ({ prerequisite, dependents: [...dependents] }))
}

export function adjacentRoutePath(paths: string[], current: string, offset: -1 | 1, catalog: string[]): string | undefined {
  const index = paths.indexOf(current)
  if (index >= 0) return paths[index + offset]
  // 从完整目录打开了路线外的课节，仍能回到该课附近的定制路线。
  const catalogIndex = catalog.indexOf(current)
  return offset === 1
    ? paths.find(p => catalog.indexOf(p) > catalogIndex)
    : [...paths].reverse().find(p => catalog.indexOf(p) < catalogIndex)
}

export interface RouteSchedule {
  totalSeconds: number
  remainingSeconds: number
  unknown: number
  days: number
  completed: number
  milestones: Array<{ moduleId: string; startDay: number; endDay: number; remainingSeconds: number; done: boolean }>
}

/** 排期只计算剩余观看时长；未知时长用已知课节中位数估计并单独标记。 */
export function buildSchedule(
  lessons: GuideLesson[], durations: Record<string, number | null>, progress: Record<string, VideoProgress>, dailyMinutes: number,
): RouteSchedule {
  const known = Object.values(durations).filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s > 0).sort((a, b) => a - b)
  const estimate = known.length ? known[Math.floor(known.length / 2)]! : 1200
  const budget = Math.max(5, Math.min(1440, dailyMinutes || 120)) * 60
  let totalSeconds = 0, remainingSeconds = 0, unknown = 0, completed = 0
  const milestones: RouteSchedule['milestones'] = []
  for (const lesson of lessons) {
    const raw = durations[lesson.path]
    const duration = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : estimate
    if (duration !== raw) unknown++
    const p = progress[lesson.path]
    const remaining = p?.done ? 0 : Math.max(0, duration - Math.max(0, Math.min(duration, p?.time || 0)))
    totalSeconds += duration
    if (p?.done) completed++
    const previous = milestones.at(-1)
    if (previous?.moduleId === lesson.moduleId) {
      previous.remainingSeconds += remaining
      previous.endDay = Math.max(previous.startDay, Math.ceil((remainingSeconds + remaining) / budget))
      previous.done = previous.done && !!p?.done
    } else {
      milestones.push({ moduleId: lesson.moduleId, startDay: Math.floor(remainingSeconds / budget) + 1,
        endDay: Math.max(Math.floor(remainingSeconds / budget) + 1, Math.ceil((remainingSeconds + remaining) / budget)),
        remainingSeconds: remaining, done: !!p?.done })
    }
    remainingSeconds += remaining
  }
  return { totalSeconds, remainingSeconds, unknown, days: Math.ceil(remainingSeconds / budget), completed, milestones }
}

export function formatStudyDuration(seconds: number): string {
  if (seconds <= 0) return '0 分钟'
  const minutes = Math.ceil(seconds / 60)
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`
}

export type LessonStatus = 'required' | 'optional' | 'skipped'

export interface KnowledgeModule {
  id: string
  title: string
  description: string
  practice?: StagePractice
}

export type WorkKind = 'code' | 'project' | 'recap'
/** 每日时间分配（分钟）。video 为看课 / 回看额度，其余为实践时间。 */
export interface StudyBudget { video: number; code: number; project: number; recap: number }
export interface StudyCalendar {
  /** 周一为 1，周日为 7。 */
  weekdays: number[]
  weekendBudget?: StudyBudget
  overrides: Record<string, StudyBudget>
  /** until 为恢复日期（不包含在暂停区间内）；null 表示手动恢复。 */
  pause?: { from: string; until: string | null }
}
/** 完整学习计划：总周期与每日总投入，独立于视频排期。 */
export interface StudyProgram {
  days: number
  startDate: string
  budget: StudyBudget
  /** 每隔 N 天安排一次轻量复盘日；0 表示不安排。 */
  lightEvery: number
  lightMinutes: number
  lightTask?: { title: string; instructions: string }
  calendar?: StudyCalendar
}
/** repeat 为每日重复任务（如复盘），完成状态只对当天有效。 */
export interface StageTask { id: string; kind: WorkKind; title: string; instructions: string; repeat?: boolean }
export interface StageCheck { id: string; kind: 'exercise' | 'project'; text: string }
export interface StagePractice {
  startDay: number
  endDay: number
  goal: string
  project: string
  skipWhen: string
  budget?: StudyBudget
  tasks: StageTask[]
  checks: StageCheck[]
}
export interface WorkEntry {
  id: string
  date: string
  moduleId: string
  taskId: string
  kind: WorkKind
  title: string
  instructions: string
  targetMinutes: number
  minutes: number
  evidence: string
  done: boolean
}
export interface CheckEvidence { text: string; evidence: string; passed: boolean; updatedAt: number }
export interface RouteRevision { plan: LearningPlan; includeOptional: boolean; view: 'all' | 'route'; label: string; at: number; scheduleOnly?: boolean; todayOverride?: { date: string; minutes: number | null } }
export interface StudyRecords {
  entries: WorkEntry[]
  checks: Record<string, CheckEvidence>
  activeModuleId: string
  undo: RouteRevision | null
}

export interface GuideLesson {
  path: string
  moduleId: string
  concepts: string[]
  prerequisites: string[]
  status: LessonStatus
  reason: string
}

export interface GuideMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LearningPlan {
  version: 1
  createdAt: number
  summary: string
  profile: string
  dailyMinutes: number
  modules: KnowledgeModule[]
  lessons: GuideLesson[]
  messages: GuideMessage[]
  program?: StudyProgram
}

export interface LessonMetadata {
  duration: number | null
  size: number
  modified: number
}

export interface GuideSettings {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMinutes?: number
  /** 最大输出 token 数；0 表示不传，由服务端默认值决定。 */
  maxTokens?: number
}

export interface AiProfile extends GuideSettings {
  id: string
  name: string
}

export interface AiSettingsCollection {
  version: 2
  profiles: AiProfile[]
  activeId: string
}

export interface SubtitleCue {
  id: number
  start: number
  end: number
  text: string
}

export interface FallbackRecommendation {
  path: string
  reason: string
  cue?: SubtitleCue
}

export interface DependencyRisk {
  prerequisite: string
  dependents: string[]
}

export type MasteryLevel = 'mastered' | 'uncertain' | 'needs-review'
export interface ConceptMastery {
  path: string
  concept: string
  level: MasteryLevel
  updatedAt: number
}
export type QuestionStatus = 'open' | 'resolved' | 'still-confused'
export interface LearningQuestion {
  id: string
  path: string
  seconds: number
  text: string
  status: QuestionStatus
  createdAt: number
  updatedAt: number
  recommendations: FallbackRecommendation[]
  reviewedPaths: string[]
}
export interface TodayItem {
  id: string
  kind: 'lesson' | 'review' | 'question'
  path: string
  questionId?: string
  start: number
  end: number
  seconds: number
  estimated: boolean
  done: boolean
}
export interface TodayPlan {
  date: string
  minutes: number
  override: number | null
  items: TodayItem[]
}

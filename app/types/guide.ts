export type LessonStatus = 'required' | 'optional' | 'skipped'

export interface KnowledgeModule {
  id: string
  title: string
  description: string
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

export interface PracticeScope { start: number; end: number }
export interface PracticeSource {
  id: string
  kind: 'note' | 'subtitle' | 'supplement'
  text: string
  start?: number
  end?: number
}
export type PracticeKind = 'single-choice' | 'multiple-choice' | 'true-false' | 'fill-blank' | 'explain' | 'code' | 'task'
export interface PracticeKnowledge {
  category: 'fact' | 'concept' | 'procedure' | 'application'
  level: 'awareness' | 'proficiency' | 'mastery'
  reason: string
}
interface PracticeQuestionBase {
  prompt: string
  concepts: string[]
  criteria: string[]
  referenceAnswer: string
  sourceIds: string[]
  /** 旧练习没有学习目标，保持未分类；新题必须提供。 */
  knowledge?: PracticeKnowledge
}
export type PracticeQuestion = PracticeQuestionBase & (
  | { kind: 'single-choice' | 'multiple-choice' | 'true-false'; options: Array<{ id: string; text: string }>; correctOptionIds: string[] }
  | { kind: 'fill-blank' | 'explain' | 'code' | 'task' }
)
export interface PracticeFeedback {
  result: 'solid' | 'partial' | 'retry'
  strengths: string[]
  gaps: string[]
  nextStep: string
  sourceIds: string[]
}
export interface PracticeRecord {
  id: string
  path: string
  createdAt: number
  scope: PracticeScope | null
  sources: PracticeSource[]
  question: PracticeQuestion
  draft: string
  attempts: Array<{ answer: string; feedback: PracticeFeedback; at: number }>
}
export interface PlaybackSample {
  seconds: number
  duration: number
  seeking: boolean
  playing: boolean
  ended: boolean
  rate: number
  at: number
}

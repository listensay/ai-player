export type AssistantMode = 'ask' | 'notes' | 'map' | 'cards' | 'feynman' | 'vision' | 'highlights'
export interface LearningEvidence {
  id: string
  start: number
  end: number
  text: string
}
export interface LearningContext {
  courseId: string
  path: string
  title: string
  seconds: number
  start: number
  end: number
  duration: number
  evidence: LearningEvidence[]
  note: string
  truncated: boolean
}
export interface AssistantAnswer {
  markdown: string
  sources: LearningEvidence[]
}
export interface AssistantTurn extends AssistantAnswer {
  question: string
  seconds: number
}
export interface LearningMapNode {
  id: string
  parent: string | null
  label: string
  sources: LearningEvidence[]
}
export interface GeneratedFlashcard {
  front: string
  back: string
  sources: LearningEvidence[]
}
export interface FeynmanQuestion {
  question: string
  sources: LearningEvidence[]
}
export interface FeynmanFeedback extends AssistantAnswer {
  score: number
  gaps: string[]
  followUp: string
}
export interface VideoHighlight {
  start: number
  end: number
  kind: 'core' | 'practice' | 'transition'
  reason: string
}
export interface FrameExtraction {
  markdown: string
  code: string
  language: string
  warnings: string
}

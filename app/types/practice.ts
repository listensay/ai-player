export interface PracticeScope { start: number; end: number }
export interface PracticeSource {
  id: string
  kind: 'note' | 'subtitle' | 'supplement'
  text: string
  start?: number
  end?: number
}
export interface PracticeQuestion {
  kind: 'explain' | 'code' | 'task'
  prompt: string
  concepts: string[]
  criteria: string[]
  referenceAnswer: string
  sourceIds: string[]
}
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

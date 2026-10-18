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
  truncated: boolean
}
export interface AssistantTurn {
  id: string
  question: string
  markdown: string
  seconds: number
  model: string
  status: 'pending' | 'done' | 'error' | 'stopped'
  error: string
}

export interface AssistantSession {
  id: string
  courseId: string
  path: string
  courseName: string
  videoTitle: string
  title: string
  createdAt: number
  updatedAt: number
  turns: AssistantTurn[]
}

export interface KnowledgePoint {
  id: string
  title: string
  text: string
  start: number
  end: number
}

export interface LessonSummary {
  version: 2
  path: string
  fingerprint: string
  createdAt: number
  overview: string
  points: KnowledgePoint[]
}

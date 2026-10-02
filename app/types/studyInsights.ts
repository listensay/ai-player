export interface FocusSession {
  startedAt: number
  endedAt: number | null
  startHour: number
  date: string
  interruptions: number
  outcome: 'active' | 'completed' | 'abandoned'
}
export interface StudyEvidence {
  notes: Array<{ courseId: string; characters: number; updatedAt: number }>
  practices: Array<{ courseId: string; id: string; solidAt: number | null }>
}

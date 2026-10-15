export interface StudyEvidence {
  notes: Array<{ courseId: string; characters: number; updatedAt: number }>
  practices: Array<{ courseId: string; id: string; solidAt: number | null }>
}

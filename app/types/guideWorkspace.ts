import type { ConceptMastery, GuideSettings, LearningPlan, LearningQuestion, LessonMetadata, StudyRecords, TodayPlan } from './guide'

export interface GuideWorkspaceState {
  plan: LearningPlan | null
  metadata: Record<string, LessonMetadata>
  view: 'all' | 'route'
  includeOptional: boolean
  busy: '' | 'plan' | 'practice'
  error: string
  storageError: string
  notice: string
  scanning: boolean
  scanned: number
  mastery: Record<string, ConceptMastery>
  questions: LearningQuestion[]
  today: TodayPlan | null
  records: StudyRecords
  pending: { plan: LearningPlan; label: string; notice: string } | null
  settings: GuideSettings
}

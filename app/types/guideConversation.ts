import type { AiFormAnswers, AiInteractionForm } from './aiInteraction'
import type { GuideRouteConstraints } from './guideConstraints'

export interface GuidePlanningPreferences {
  dailyMinutes: number | null
  completionDate: string | null
}
export interface GuideConversationReply {
  message: string
  profile: string
  form: AiInteractionForm | null
  planRequest: string | null
}
export interface GuideConversationTurn {
  id: string
  kind?: 'initialization'
  replySource?: 'selection'
  question: string
  reply: GuideConversationReply | null
  status: 'pending' | 'done' | 'error' | 'stopped'
  error: string
  answers?: AiFormAnswers
}
export interface GuideCourseCatalogEntry {
  path: string
  title: string
  duration: number | null
  done: boolean
}
export interface GuideConversationData {
  version: 1
  preferences: GuidePlanningPreferences
  profile: string
  turns: GuideConversationTurn[]
  constraints: GuideRouteConstraints
}

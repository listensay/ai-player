import type { PracticeRecord } from './practice'

export type Recall = 'remembered' | 'uncertain' | 'forgotten'
export type FlowMood = 'deep' | 'steady' | 'struggling' | 'tired'
export interface ReviewCard {
  id: string
  courseId: string
  path: string
  kind: 'knowledge' | 'note' | 'practice'
  front: string
  back: string
  concepts: string[]
  category: string
  seconds: number
  sourceAt: number
  due: string
  step: number
  recall: Recall | null
  reviewedAt: number | null
  weak: boolean
}
export interface FlowCheckIn {
  id: string
  courseId: string
  path: string
  startedAt: number
  endedAt: number
  hour: number
  mood: FlowMood
}
export interface LearningContract {
  id: string
  courseId: string
  moduleId: string
  goal: string
  deadline: string
  minutes: number
  signedAt: number
}
export interface PortfolioWork {
  id: string
  courseId: string
  moduleId: string
  title: string
  description: string
  location: string
  screenshot: string
  createdAt: number
  acceptedAt: number | null
}
export interface StreakProtection {
  courseId: string
  date: string
  kind: 'freeze' | 'makeup'
  at: number
}
export interface LearningManagementData {
  version: 1
  cards: ReviewCard[]
  rewardDays: string[]
  flows: FlowCheckIn[]
  contracts: LearningContract[]
  works: PortfolioWork[]
  protections: StreakProtection[]
  preferences: {
    flowPrompt: boolean
    quietFocus: boolean
    shortcut: string
    calendarTime: string
    calendarDays: number
    calendarEnabled: boolean
  }
}
export interface LearningSources {
  practices: Array<{ courseId: string; record: PracticeRecord }>
  notes: Array<{ courseId: string; path: string; content: string; updatedAt: number }>
  summaries: Array<{
    courseId: string
    path: string
    createdAt: number
    overview: string
    points: Array<{ id: string; title: string; text: string; start: number }>
  }>
}

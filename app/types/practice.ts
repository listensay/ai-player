export interface PracticeScope {
  start: number
  end: number
}
export interface PracticeSource {
  id: string
  kind: 'note' | 'subtitle' | 'supplement' | 'summary'
  path?: string
  text: string
  start?: number
  end?: number
}
export type PracticeKind =
  'single-choice' | 'multiple-choice' | 'true-false' | 'fill-blank' | 'explain' | 'code' | 'task'
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
  /** 与 criteria 一一对应，合计 100 分；旧题按验收项均分。 */
  criterionPoints?: number[]
  /** 旧练习没有学习目标，保持未分类；新题必须提供。 */
  knowledge?: PracticeKnowledge
}
export type PracticeQuestion = PracticeQuestionBase &
  (
    | {
        kind: 'single-choice' | 'multiple-choice' | 'true-false'
        options: Array<{ id: string; text: string }>
        correctOptionIds: string[]
      }
    | { kind: 'fill-blank' | 'explain' | 'task' }
    | { kind: 'code'; programming?: ProgrammingExercise }
  )
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface ProgrammingTest {
  id: string
  name: string
  kind: 'normal' | 'boundary'
  example: boolean
  args: JsonValue[]
  expected: JsonValue
}
export interface ProgrammingExercise {
  version: 1
  language: import('../utils/programmingLanguages').ProgrammingLanguage
  mode: 'completion' | 'implementation'
  functionName: string
  signature: string
  starterCode: string
  referenceCode: string
  hints: string[]
  tests: ProgrammingTest[]
}
export interface ProgrammingCaseResult {
  id: string
  status: 'passed' | 'failed' | 'error' | 'timeout'
  actual: string
  output: string
  error: string
  line?: number
  column?: number
  durationMs: number
}
export interface ProgrammingRun {
  version: 1
  code: string
  mode: 'run' | 'test'
  at: number
  cases: ProgrammingCaseResult[]
}
export interface PracticeFeedback {
  result: 'solid' | 'partial' | 'retry'
  strengths: string[]
  gaps: string[]
  nextStep: string
  sourceIds: string[]
  grade?: PracticeGrade
}
export interface PracticeGrade {
  score: number
  items: Array<{
    criterionIndex: number
    score: number
    status: 'implemented' | 'partial' | 'missing' | 'unverified'
    evidence: string
    improvement: string
  }>
}
/** 文件内容单独保存在本地，练习与每次提交只保存不可变的文件引用。 */
export interface PracticeAttachment {
  id: string
  name: string
  kind: 'code' | 'image'
  size: number
  characters?: number
}
export type PracticeAttachmentContent =
  { kind: 'code'; text: string } | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }
export type PracticeHelpLevel = 0 | 1 | 2 | 3 | 4
export type PracticeHintLevel = 1 | 2 | 3
export interface PracticeHint {
  level: PracticeHintLevel
  text: string
  sourceIds: string[]
  viewedAt: number
}
export interface PracticeHelp {
  /** 本题已查看的最高层级，收起提示或修改答案不降低层级。 */
  level: PracticeHelpLevel
  hints: PracticeHint[]
}
export interface PracticeRecord {
  id: string
  /** 同一次生成的题目共同计分；旧记录按课节与范围合并。 */
  groupId?: string
  path: string
  createdAt: number
  scope: PracticeScope | null
  sources: PracticeSource[]
  question: PracticeQuestion
  draft: string
  help?: PracticeHelp
  codeRun?: ProgrammingRun
  attachments?: PracticeAttachment[]
  attempts: Array<{
    answer: string
    attachments?: PracticeAttachment[]
    feedback: PracticeFeedback
    at: number
    /** 提交时的快照；旧提交未记录，不能推断为独立完成。 */
    helpLevel?: PracticeHelpLevel
    codeRun?: ProgrammingRun
  }>
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

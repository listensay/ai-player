export interface StudyDay {
  date: string
  /** 达标前跟随当日计划，达标后保留当时的目标。 */
  targetSeconds: number
  seconds: number
  checkedAt: number | null
}

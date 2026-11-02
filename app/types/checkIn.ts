export interface StudyDay {
  date: string
  /** 达标前跟随当日计划，达标后保留当时的目标。 */
  targetSeconds: number
  seconds: number
  /** 播放器页面未播放视频时累计的实践用时，旧记录缺省为零。 */
  practiceSeconds?: number
  checkedAt: number | null
}

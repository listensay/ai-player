/** 逐字稿（字幕）数据模型 */

export interface TranscriptSegment {
  id: number
  /** 起始秒 */
  start: number
  /** 结束秒 */
  end: number
  text: string
}

export type TranscriptStatus =
  | 'idle' // 还没检查过
  | 'loading' // 正在读同名字幕文件
  | 'none' // 没有字幕，需要转写
  | 'ready' // 有逐字稿
  | 'transcribing' // 转写中（segments 会逐句增长）
  | 'error'

export interface TranscriptState {
  status: TranscriptStatus
  segments: TranscriptSegment[]
  /** 0–1；服务端没法估算时为 null */
  progress: number | null
  /** 已处理的音频秒数 */
  processedSeconds: number
  error: string
  /** 来源文件名（如 01-环境搭建.srt），来自已有字幕或刚转写完成 */
  fileName: string
  /** 转写耗时（秒） */
  elapsed: number
  language: string
}

export interface TranscriptMatch {
  segmentId: number
  /** 命中区间在 text 里的偏移 */
  ranges: Array<[number, number]>
}

export type AsrServiceStatus = 'unknown' | 'offline' | 'preparing' | 'ready' | 'error'

export interface AsrHealth {
  ok: boolean
  status: 'stopped' | 'checking' | 'downloading' | 'loading' | 'ready' | 'error'
  error: string
  download: { file: string; received: number; total: number } | null
  queued: number
  modelDir: string
  engine: string
  model: string
  version: string
}

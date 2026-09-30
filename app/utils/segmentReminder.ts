import type { PlaybackSample } from '../types/practice'
import type { VideoProgress } from '../types/course'
import type { TodayItem } from '../types/guide'

/** 计划片段保持不变，重新打开未完成的普通课程时仍从片段内的观看进度续播。 */
export function segmentPlaybackStart(item: TodayItem, progress?: VideoProgress): number {
  const time = progress?.time ?? item.start
  return item.kind === 'lesson' && !item.done && Number.isFinite(time) && time > item.start && time < item.end
    ? time : item.start
}

/** 只接受连续播放跨越终点；跳转、暂停和切课由事件采样断开。 */
export function crossedSegmentEnd(previous: PlaybackSample | null, current: PlaybackSample, end: number): boolean {
  if (!previous || previous.seeking || current.seeking || !previous.playing || (!current.playing && !current.ended)) return false
  if (![previous.seconds, current.seconds, previous.at, current.at, previous.rate, current.rate, end].every(Number.isFinite)) return false
  const elapsed = (current.at - previous.at) / 1000
  const delta = current.seconds - previous.seconds
  return elapsed >= 0 && previous.seconds < end && current.seconds >= end && delta > 0
    && delta <= elapsed * Math.max(previous.rate, current.rate, 0.5) + 0.75
}

import type { PlaybackSample } from '../types/practice'

/** 只接受连续播放跨越终点；跳转、暂停和切课由事件采样断开。 */
export function crossedSegmentEnd(previous: PlaybackSample | null, current: PlaybackSample, end: number): boolean {
  if (!previous || previous.seeking || current.seeking || !previous.playing || (!current.playing && !current.ended)) return false
  if (![previous.seconds, current.seconds, previous.at, current.at, previous.rate, current.rate, end].every(Number.isFinite)) return false
  const elapsed = (current.at - previous.at) / 1000
  const delta = current.seconds - previous.seconds
  return elapsed >= 0 && previous.seconds < end && current.seconds >= end && delta > 0
    && delta <= elapsed * Math.max(previous.rate, current.rate, 0.5) + 0.75
}

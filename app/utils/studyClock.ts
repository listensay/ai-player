export interface StudyClockContext {
  courseId: string
  kind: 'video' | 'practice'
}

export function createStudyClock(record: (context: StudyClockContext, end: number, seconds: number) => void) {
  let previous: { context: StudyClockContext | null; wall: number; monotonic: number } | null = null
  return {
    tick(context: StudyClockContext | null, wall = Date.now(), monotonic = performance.now()) {
      const last = previous
      previous = { context, wall, monotonic }
      if (!last?.context) return
      const elapsed = monotonic - last.monotonic
      // 丢弃休眠、卡顿和系统时钟跳变留下的间隔，不补算离开电脑的时间。
      if (
        !Number.isFinite(elapsed) ||
        !Number.isFinite(wall) ||
        elapsed <= 0 ||
        elapsed > 5000 ||
        Math.abs(wall - last.wall - elapsed) > 2000
      )
        return
      record(last.context, wall, elapsed / 1000)
    },
    reset() {
      previous = null
    },
  }
}

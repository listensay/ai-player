import { fileMetadata, mediaSource, videoMetadataBatch } from './desktopFiles.ts'
import type { CourseFileHandle } from '../types/storage'
import type { VideoEntry } from '../types/course'
import type { LessonMetadata, SubtitleCue } from '../types/guide'

export async function readVideoDuration(file: File | CourseFileHandle, signal: AbortSignal): Promise<number | null> {
  if (signal.aborted) return null
  const source = file instanceof File ? { url: URL.createObjectURL(file), release() { URL.revokeObjectURL(this.url) } } : await mediaSource(file)
  if (signal.aborted) { source.release(); return null }
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = source.url
    let finished = false
    const finish = (duration: number | null) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      video.onloadedmetadata = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
      source.release()
      resolve(duration)
    }
    const abort = () => finish(null)
    const timer = setTimeout(abort, 5000)
    signal.addEventListener('abort', abort, { once: true })
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null)
    video.onerror = abort
    video.src = url
  })
}

/** 批量读取容器头；少数无法直接读取的文件才使用三路播放器回退。 */
export async function collectGuideMetadata(
  videos: VideoEntry[], cache: Record<string, LessonMetadata>, signal: AbortSignal,
  onEntry: (path: string, metadata: LessonMetadata) => void,
): Promise<void> {
  const fallback: Array<{ video: VideoEntry; metadata?: LessonMetadata }> = []
  for (let offset = 0; offset < videos.length && !signal.aborted; offset += 64) {
    const batch = videos.slice(offset, offset + 64)
    try {
      const entries = await videoMetadataBatch(batch.map(video => ({ handle: video.handle, cached: cache[video.path] })))
      if (signal.aborted) return
      const byPath = new Map(entries.map(entry => [entry.relative, entry]))
      for (const video of batch) {
        const entry = byPath.get(video.path)
        if (!entry) { fallback.push({ video }); continue }
        const metadata = { size: entry.size, modified: entry.modified, duration: entry.duration }
        if (entry.duration !== null || !entry.readable) onEntry(video.path, metadata)
        else fallback.push({ video, metadata })
      }
    } catch {
      // 旧桌面运行时或不支持的句柄仍可读取；单批失败不终止整个课程。
      fallback.push(...batch.map(video => ({ video })))
    }
  }
  let cursor = 0
  async function worker() {
    while (!signal.aborted && cursor < fallback.length) {
      const item = fallback[cursor++]!, video = item.video
      let metadata: LessonMetadata = item.metadata ?? { duration: null, size: 0, modified: 0 }
      try {
        const file = item.metadata ? { size: item.metadata.size, lastModified: item.metadata.modified } : await fileMetadata(video.handle)
        if (signal.aborted) return
        const old = cache[video.path]
        metadata = old?.size === file.size && old.modified === file.lastModified && old.duration !== null
          ? old : { size: file.size, modified: file.lastModified, duration: await readVideoDuration(video.handle, signal) }
      } catch { /* 不支持的容器、失效句柄均按未知时长处理 */ }
      if (!signal.aborted) onEntry(video.path, metadata)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, fallback.length) }, worker))
}

function cueTime(raw: string): number | null {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/.exec(raw)
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return null
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

export function parseSubtitles(raw: string): SubtitleCue[] {
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
  const cues: SubtitleCue[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[i]!)
    if (!match) continue
    const start = cueTime(match[1]!), end = cueTime(match[2]!)
    if (start === null || end === null || end <= start) continue
    const text: string[] = []
    while (i + 1 < lines.length && lines[i + 1]!.trim()) text.push(lines[++i]!)
    const content = text.join(' ').replace(/<[^>]*>/g, '').trim()
    if (content) cues.push({ id: cues.length, start, end, text: content })
  }
  return cues
}

export async function loadLessonSubtitles(video: VideoEntry): Promise<SubtitleCue[]> {
  for (const ext of ['vtt', 'srt']) {
    try {
      const handle = await video.parent.getFileHandle(`${video.title}.${ext}`)
      const file = await handle.getFile()
      if (file.size > 5_000_000) continue
      const cues = parseSubtitles(await file.text())
      if (cues.length) return cues
    } catch { /* 没有同名字幕时只推荐课节，绝不推测时间戳 */ }
  }
  return []
}

export function relevantCues(cues: SubtitleCue[], keywords: string[], limit = 50): SubtitleCue[] {
  const terms = keywords.map(k => k.trim().toLowerCase()).filter(k => k.length >= 2)
  return cues.map(cue => ({ cue, score: terms.reduce((sum, term) => sum + (cue.text.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.cue.start - b.cue.start)
    .slice(0, limit).map(item => item.cue)
}

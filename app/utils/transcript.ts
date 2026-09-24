import type { TranscriptMatch, TranscriptSegment } from '~/types/transcript'

/** 秒 -> SRT 时间 "00:12:35,120" */
export function srtTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

/** "00:12:35,120" / "12:35.120" -> 秒；无法解析返回 null */
export function parseSrtTime(raw: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?$/.exec(raw.trim())
  if (!m) return null
  const h = Number(m[1] ?? 0)
  const min = Number(m[2])
  const sec = Number(m[3])
  const ms = Number((m[4] ?? '0').padEnd(3, '0'))
  if (min > 59 || sec > 59) return null
  return h * 3600 + min * 60 + sec + ms / 1000
}

/** 序列化为 SRT。播放器、Obsidian、AI 导学的"找基础"都能直接读 */
export function toSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((seg, i) => `${i + 1}\n${srtTime(seg.start)} --> ${srtTime(seg.end)}\n${seg.text.trim()}\n`)
    .join('\n')
}

/** 解析 SRT / WebVTT（只取时间与文本，忽略样式与位置信息） */
export function parseSrt(raw: string): TranscriptSegment[] {
  const lines = raw.replace(/^﻿/, '').replace(/\r/g, '').split('\n')
  const segments: TranscriptSegment[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[i]!)
    if (!m) continue
    const start = parseSrtTime(m[1]!)
    const end = parseSrtTime(m[2]!)
    if (start === null || end === null || end <= start) continue
    const text: string[] = []
    while (i + 1 < lines.length && lines[i + 1]!.trim()) text.push(lines[++i]!)
    const content = text.join(' ').replace(/<[^>]*>/g, '').trim()
    if (content) segments.push({ id: segments.length, start, end, text: content })
  }
  return segments
}

/** 播放头所在句子的下标：start <= t 的最后一句（没有则 -1） */
export function activeSegmentIndex(segments: TranscriptSegment[], time: number): number {
  let lo = 0
  let hi = segments.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid]!.start <= time + 0.05) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** 全文检索：大小写不敏感，返回每句的命中区间 */
export function searchTranscript(segments: TranscriptSegment[], query: string): TranscriptMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: TranscriptMatch[] = []
  for (const seg of segments) {
    const lower = seg.text.toLowerCase()
    const ranges: Array<[number, number]> = []
    let from = 0
    while (from <= lower.length) {
      const idx = lower.indexOf(q, from)
      if (idx === -1) break
      ranges.push([idx, idx + q.length])
      from = idx + q.length
    }
    if (ranges.length) out.push({ segmentId: seg.id, ranges })
  }
  return out
}

/** 把一句文本按命中区间切成 [普通, 高亮, 普通…] 片段 */
export function splitByRanges(text: string, ranges: Array<[number, number]> | undefined) {
  if (!ranges?.length) return [{ text, hit: false }]
  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  for (const [a, b] of ranges) {
    if (a > cursor) parts.push({ text: text.slice(cursor, a), hit: false })
    parts.push({ text: text.slice(a, b), hit: true })
    cursor = b
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false })
  return parts
}

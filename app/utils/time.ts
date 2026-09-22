/** 时间格式化与时间戳解析 */

/** 匹配笔记中的时间戳锚点：[12:35] 或 [1:02:03] */
export const TIMESTAMP_RE = /\[(?:(\d{1,3}):)?(\d{1,2}):(\d{2})\]/g

/**
 * 秒 -> "m:ss" / "h:mm:ss"
 * @param seconds 秒数
 * @param padMinutes 是否把分钟补足两位（用于 "12:35" 这种时间戳；进度条上通常不用）
 */
export function formatTime(seconds: number, padMinutes = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${padMinutes ? String(m).padStart(2, '0') : m}:${ss}`
}

/** 秒 -> "[12:35]" 形式的笔记时间戳 */
export function timestampToken(seconds: number): string {
  return `[${formatTime(seconds, true)}]`
}

/** "12:35" / "1:02:03" -> 秒；无法解析返回 null */
export function parseTimestamp(text: string): number | null {
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const h = m[1] ? Number(m[1]) : 0
  const min = Number(m[2])
  const sec = Number(m[3])
  if (sec >= 60) return null
  return h * 3600 + min * 60 + sec
}

/** 用于截图文件名的安全片段："12-35" / "1-02-03" */
export function timestampSlug(seconds: number): string {
  return formatTime(seconds, true).replace(/:/g, '-')
}

/** 秒 -> 中文时长描述，如 "1 小时 5 分钟" / "45 分钟" */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  if (m > 0) return `${m} 分钟`
  return `${Math.round(seconds)} 秒`
}

/** 相对时间："刚刚" / "3 分钟前" / "昨天" / "9月21日" */
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

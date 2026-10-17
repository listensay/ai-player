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

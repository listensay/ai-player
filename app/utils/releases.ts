import entries from '../data/releases.json'

export interface ProjectRelease {
  version: string
  date: string
  title: string
  summary: string
  added: string[]
  changed: string[]
  fixed: string[]
  removed: string[]
}

/** Newest first. The same history powers the page and the current-version label. */
export const releases: readonly ProjectRelease[] = entries
export const currentRelease = releases[0]!
export const releaseSections = [
  { key: 'added', title: '新增' },
  { key: 'changed', title: '调整' },
  { key: 'fixed', title: '修复' },
  { key: 'removed', title: '移除' },
] as const

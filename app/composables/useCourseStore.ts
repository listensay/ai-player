import { computed, reactive } from 'vue'
import { useProgress } from '~/composables/useProgress'
import { scanCourse } from '~/utils/fs'
import { chooseCourseFolder, fileMetadata } from '~/utils/desktopFiles'
import { databaseRequest } from '~/utils/database'
import type { CourseDirectoryHandle } from '~/types/storage'
import { markRaw } from 'vue'
import type { Course, RecentCourse, TreeFilter, VideoEntry } from '~/types/course'
import { dbDeleteRecentCourse, dbFetchGuide, dbFetchRecentCourses, dbSaveRecentCourse } from '~/utils/dbClient'
import { readCourseHandles, saveCourseHandle } from '~/utils/courseHandles'

const MAX_RECENTS = 20
const state = reactive({
  course: null as Course | null,
  currentVideo: null as VideoEntry | null,
  recents: [] as RecentCourse[],
  accessRecent: null as RecentCourse | null,
  loading: false,
  error: '',
  accessWarning: '',
  filter: 'all' as TreeFilter,
  query: '',
})
const handles = new Map<string, CourseDirectoryHandle>()
let initialization: Promise<void> | undefined
let operation = 0

async function initialize() {
  return initialization ??= (async () => {
    const [list, saved] = await Promise.all([
      dbFetchRecentCourses(),
      readCourseHandles().catch(() => {
        state.accessWarning = '课程位置保存失败，下次打开时可能需要重新关联。'
        return new Map<string, CourseDirectoryHandle>()
      }),
    ])
    for (const [id, handle] of saved) handles.set(id, markRaw(handle))
    state.recents = list.map(r => ({ ...r, handle: handles.get(r.id) }))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  })()
}

async function getRecent(id: string): Promise<RecentCourse | null> {
  const recent = state.recents.find(r => r.id === id)
    ?? await databaseRequest<RecentCourse | null>('recent-courses', { query: { id } })
  if (!recent) return null
  return { ...recent, handle: handles.get(recent.id) ?? handles.get(id) }
}

async function saveRecent(recent: RecentCourse) {
  const { handle: _handle, ...record } = recent
  return dbSaveRecentCourse(record)
}

async function findIdentity(handle: CourseDirectoryHandle) {
  for (const [id, saved] of handles) {
    let same = false
    try { same = await saved.isSameEntry(handle) }
    catch { /* 单个目录不可用不影响其他已保存的课程位置 */ }
    if (same) return { id, recent: await getRecent(id) }
  }
  return null
}

async function validateRelink(recent: RecentCourse, handle: CourseDirectoryHandle, videos: VideoEntry[]) {
  if (handle.name !== recent.name || videos.length !== recent.videoCount) return false
  const guide = await dbFetchGuide(recent.id)
  const metadata = guide?.metadata
  if (metadata && typeof metadata === 'object') {
    const entries = Object.entries(metadata)
    const byPath = new Map(videos.map(video => [video.path, video]))
    for (const [path, previous] of entries) {
      const video = byPath.get(path)
      if (!video) return false
      const file = await fileMetadata(video.handle)
      if (file.size !== previous.size || file.lastModified !== previous.modified) return false
    }
  }
  return !recent.lastVideoPath || videos.some(v => v.path === recent.lastVideoPath)
}

export function useCourseStore() {
  const progress = useProgress()
  if (typeof window !== 'undefined') {
    void initialize()
  }

  async function loadCourse(handle: CourseDirectoryHandle, preferredVideoPath?: string, recent?: RecentCourse, token = ++operation) {
    state.loading = true
    state.error = ''
    try {
      await initialize()
      const { tree, videos } = await scanCourse(handle)
      if (token !== operation) return false
      if (!videos.length) throw new Error(`「${handle.name}」中未找到视频文件。`)
      const identity = await findIdentity(handle)
      if (recent && !recent.handle) {
        if (identity && (identity.recent?.id ?? identity.id) !== recent.id) throw new Error('所选文件夹已关联其他课程，请选择该课程的原文件夹。')
        if (!await validateRelink(recent, handle, videos)) throw new Error(`所选文件夹与「${recent.name}」的课程记录不一致，请选择原课程文件夹。`)
      }
      const existing = recent ?? identity?.recent
      const id = existing?.id ?? identity?.id ?? crypto.randomUUID()
      const rawHandle = markRaw(handle)
      await saveCourseHandle(id, rawHandle).catch(() => {
        state.accessWarning = '课程位置保存失败，下次打开时可能需要重新关联。'
      })
      if (token !== operation) return false
      handles.set(id, rawHandle)
      const entry: RecentCourse = {
        id, name: handle.name, handle: rawHandle, videoCount: videos.length,
        lastOpenedAt: Date.now(), lastVideoPath: existing?.lastVideoPath,
      }
      // 进度需先就绪，直接打开播放器时才能恢复播放位置。
      await progress.ready()
      if (token !== operation) return false
      state.course = { id, name: handle.name, handle: rawHandle, root: tree, videos }
      state.accessRecent = entry
      state.recents = [entry, ...state.recents.filter(r => r.id !== id)].slice(0, MAX_RECENTS)
      const target = videos.find(v => v.path === preferredVideoPath)
        ?? videos.find(v => v.path === entry.lastVideoPath) ?? videos[0]!
      state.currentVideo = target
      entry.lastVideoPath = target.path
      await saveRecent(entry)
      return token === operation
    } catch (err) {
      if (token === operation) state.error = `读取课程失败：${(err as Error).message}`
      return false
    } finally {
      if (token === operation) state.loading = false
    }
  }

  async function openFolder() {
    if (state.loading) return false
    const token = ++operation
    state.loading = true
    state.error = ''
    try {
      const handle = await chooseCourseFolder()
      if (!handle) return false
      if (token !== operation) return false
      return await loadCourse(handle, undefined, undefined, token)
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') state.error = `打开文件夹失败：${(err as Error).message}`
      return false
    } finally { if (token === operation) state.loading = false }
  }

  /** 仅由用户操作触发：优先使用已保存的课程位置，缺失时打开目录选择框。 */
  async function reopenRecent(recent: RecentCourse, replaceHandle = false) {
    if (state.loading) return false
    const token = ++operation
    state.loading = true
    state.error = ''
    try {
      const saved = replaceHandle ? undefined : recent.handle ?? handles.get(recent.id)
      const handle = saved ?? await chooseCourseFolder()
      if (!handle) return false
      if (saved && !await saved.isAvailable()) {
        state.error = '课程目录无法访问，请重新关联原文件夹。'
        return false
      }
      if (token !== operation) return false
      return await loadCourse(handle, recent.lastVideoPath, { ...recent, handle: saved }, token)
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') state.error = '无法访问课程文件夹，请重新关联原文件夹。'
      return false
    } finally { if (token === operation) state.loading = false }
  }

  /** 路由恢复不弹出目录选择框；课程位置不可用时由页面提示重新关联。 */
  async function restoreCourse(id: string) {
    const token = ++operation
    state.error = ''
    state.accessRecent = null
    if (state.course?.id === id) return true
    state.loading = true
    state.course = null
    state.currentVideo = null
    try {
      await initialize()
      const recent = await getRecent(id)
      if (token !== operation) return false
      state.accessRecent = recent
      if (!recent) { state.error = '课程记录不存在或已从最近列表移除。'; return false }
      if (!recent.handle || !await recent.handle.isAvailable()) return false
      if (token !== operation) return false
      return await loadCourse(recent.handle, recent.lastVideoPath, recent, token)
    } catch {
      if (token === operation) state.error = '课程恢复失败，请重新关联文件夹或重试。'
      return false
    } finally { if (token === operation) state.loading = false }
  }

  async function removeRecent(recent: RecentCourse) {
    if (!await dbDeleteRecentCourse(recent.id)) { state.error = '移除失败，请稍后重试。'; return }
    state.recents = state.recents.filter(r => r.id !== recent.id)
    // 保留目录与课程的对应关系，重新导入时沿用原有学习记录。
  }

  function selectVideo(video: VideoEntry) {
    if (state.currentVideo === video) return
    state.currentVideo = video
    const recent = state.recents.find(r => r.id === state.course?.id)
    if (recent) { recent.lastVideoPath = video.path; void saveRecent(recent) }
  }

  function selectByOffset(offset: number) {
    const next = state.course?.videos[(state.currentVideo?.index ?? 0) + offset]
    if (next) selectVideo(next)
  }

  function closeCourse() {
    operation++
    progress.flush()
    state.loading = false
    state.course = null
    state.currentVideo = null
    state.accessRecent = null
    state.error = ''
    state.query = ''
    state.filter = 'all'
  }

  const stats = computed(() => {
    const course = state.course
    if (!course) return { total: 0, done: 0, started: 0 }
    const map = progress.courseProgress(course.id)
    let done = 0, started = 0
    for (const v of course.videos) {
      const p = map[v.path]
      if (p?.done) done++
      else if (p && p.ratio > 0) started++
    }
    return { total: course.videos.length, done, started }
  })

  return { state, stats, initialize, openFolder, loadCourse, reopenRecent, restoreCourse, removeRecent, selectVideo, selectByOffset, closeCourse }
}

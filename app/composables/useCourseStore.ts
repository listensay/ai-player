import { markRaw } from 'vue'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import type { Course, RecentCourse, TreeFilter, VideoEntry } from '~/types/course'

const RECENTS_KEY = 'ai-player.recent-courses.v1'
const MAX_RECENTS = 8

interface CourseState {
  course: Course | null
  currentVideo: VideoEntry | null
  recents: RecentCourse[]
  loading: boolean
  error: string
  filter: TreeFilter
  query: string
  supported: boolean
}

const state = reactive<CourseState>({
  course: null,
  currentVideo: null,
  recents: [],
  loading: false,
  error: '',
  filter: 'all',
  query: '',
  supported: false,
})

let recentsLoaded = false

async function loadRecents() {
  if (recentsLoaded) return
  recentsLoaded = true
  try {
    const list = (await idbGet<RecentCourse[]>(RECENTS_KEY)) ?? []
    state.recents = list
      .map((r) => ({ ...r, handle: markRaw(r.handle) }))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  } catch (err) {
    console.warn('读取最近课程失败', err)
    state.recents = []
  }
}

async function saveRecents() {
  try {
    await idbSet(RECENTS_KEY, toRaw(state.recents).map((r) => ({ ...r })))
  } catch (err) {
    console.warn('保存最近课程失败', err)
  }
}

/** 同一个文件夹再次打开时复用之前的 id，进度才能接上 */
async function findRecentByHandle(handle: FileSystemDirectoryHandle): Promise<RecentCourse | undefined> {
  for (const r of state.recents) {
    try {
      if (await r.handle.isSameEntry(handle)) return r
    } catch {
      /* 句柄失效则跳过 */
    }
  }
  return undefined
}

export function useCourseStore() {
  const progress = useProgress()

  if (import.meta.client) {
    state.supported = isSupportedBrowser()
    void loadRecents()
  }

  async function loadCourse(handle: FileSystemDirectoryHandle, preferredVideoPath?: string) {
    state.loading = true
    state.error = ''
    try {
      const granted = await ensurePermission(handle, 'readwrite')
      if (!granted) {
        state.error = '没有拿到这个文件夹的读写权限，笔记将无法保存。请重新打开并允许访问。'
        return false
      }

      const { tree, videos } = await scanCourse(handle)
      if (videos.length === 0) {
        state.error = `「${handle.name}」里没有找到视频文件。支持的格式：mp4、webm、mkv、mov 等。`
        return false
      }

      const existing = await findRecentByHandle(handle)
      const id = existing?.id ?? crypto.randomUUID()
      const rawHandle = markRaw(handle)
      const course: Course = { id, name: handle.name, handle: rawHandle, root: tree, videos }
      state.course = course

      // 更新最近记录
      const recent: RecentCourse = {
        id,
        name: handle.name,
        handle: rawHandle,
        videoCount: videos.length,
        lastOpenedAt: Date.now(),
        lastVideoPath: existing?.lastVideoPath,
      }
      state.recents = [recent, ...state.recents.filter((r) => r.id !== id)].slice(0, MAX_RECENTS)
      await saveRecents()

      // 一键回到上次看的那一集；没有就从第一集开始
      const target =
        (preferredVideoPath && videos.find((v) => v.path === preferredVideoPath)) ||
        (recent.lastVideoPath && videos.find((v) => v.path === recent.lastVideoPath)) ||
        videos[0]!
      selectVideo(target)
      return true
    } catch (err) {
      console.error(err)
      state.error = `读取文件夹失败：${(err as Error).message}`
      return false
    } finally {
      state.loading = false
    }
  }

  /** 弹出系统文件夹选择框（必须由用户点击触发） */
  async function openFolder() {
    if (!window.showDirectoryPicker) {
      state.error = '当前浏览器不支持直接读写本地文件夹，请使用 Chrome 或 Edge。'
      return false
    }
    try {
      const handle = await window.showDirectoryPicker({ id: 'ai-player-course', mode: 'readwrite' })
      return await loadCourse(handle)
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return false
      state.error = `打开文件夹失败：${(err as Error).message}`
      return false
    }
  }

  async function reopenRecent(recent: RecentCourse) {
    return loadCourse(recent.handle, recent.lastVideoPath)
  }

  async function removeRecent(recent: RecentCourse) {
    state.recents = state.recents.filter((r) => r.id !== recent.id)
    await saveRecents()
  }

  function selectVideo(video: VideoEntry) {
    if (state.currentVideo?.path === video.path) return
    state.currentVideo = video
    const recent = state.recents.find((r) => r.id === state.course?.id)
    if (recent) {
      recent.lastVideoPath = video.path
      void saveRecents()
    }
  }

  function selectByOffset(offset: number) {
    const course = state.course
    const current = state.currentVideo
    if (!course || !current) return
    const next = course.videos[current.index + offset]
    if (next) selectVideo(next)
  }

  function closeCourse() {
    progress.flush()
    state.course = null
    state.currentVideo = null
    state.error = ''
    state.query = ''
    state.filter = 'all'
  }

  const stats = computed(() => {
    const course = state.course
    if (!course) return { total: 0, done: 0, started: 0 }
    const map = progress.courseProgress(course.id)
    let done = 0
    let started = 0
    for (const v of course.videos) {
      const p = map[v.path]
      if (!p) continue
      if (p.done) done++
      else if (p.ratio > 0) started++
    }
    return { total: course.videos.length, done, started }
  })

  return {
    state,
    stats,
    openFolder,
    loadCourse,
    reopenRecent,
    removeRecent,
    selectVideo,
    selectByOffset,
    closeCourse,
  }
}

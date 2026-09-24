import { computed, reactive, ref } from 'vue'
import { useAsrService } from '~/composables/useAsrService'
import { writeTextFile } from '~/utils/fs'
import { toSrt, parseSrt } from '~/utils/transcript'
import type { CourseDirectoryHandle } from '~/types/storage'
/**
 * 逐字稿状态：按「课程 id + 视频路径」缓存，切换课时或页签不会丢掉进行中的转写。
 * 逐字稿以同名 .srt 存在视频旁边（01-环境搭建.mp4 -> 01-环境搭建.srt），
 * 播放器、Obsidian 以及 AI 导学的"找基础 / 小练"都直接读这个文件。
 */
import { markRaw } from 'vue'
import type { VideoEntry } from '~/types/course'
import type { TranscriptSegment, TranscriptState, TranscriptStatus } from '~/types/transcript'

interface Job {
  courseId: string
  path: string
  title: string
  controller: AbortController
  parent: CourseDirectoryHandle
  fileName: string
}

const states = reactive(new Map<string, TranscriptState>())
const jobs = new Map<string, Job>()
const jobCount = ref(0)

function key(courseId: string, path: string) {
  return `${courseId}:${path}`
}

function blank(): TranscriptState {
  return {
    status: 'idle',
    segments: [],
    progress: null,
    processedSeconds: 0,
    error: '',
    fileName: '',
    elapsed: 0,
    language: '',
  }
}

function ensure(k: string): TranscriptState {
  let s = states.get(k)
  if (!s) {
    s = blank()
    states.set(k, s)
  }
  return s
}

export function useTranscripts() {
  const asr = useAsrService()

  function get(courseId: string, path: string): TranscriptState {
    return ensure(key(courseId, path))
  }

  /** 读取同名 .srt / .vtt；没有则标记为 none */
  async function load(courseId: string, video: VideoEntry) {
    const k = key(courseId, video.path)
    const s = ensure(k)
    if (s.status === 'transcribing' || s.status === 'ready') return
    s.status = 'loading'
    s.error = ''
    for (const ext of ['srt', 'vtt']) {
      try {
        const handle = await video.parent.getFileHandle(`${video.title}.${ext}`)
        const file = await handle.getFile()
        if (file.size > 20_000_000) continue
        const segments = parseSrt(await file.text())
        if (segments.length) {
          // 进行中的转写优先，避免读文件的竞态把实时结果盖掉（await 之后状态可能已被别处改掉）
          if ((s.status as TranscriptStatus) !== 'transcribing') {
            s.segments = segments
            s.fileName = file.name
            s.status = 'ready'
          }
          return
        }
      } catch {
        /* 没有这个文件 */
      }
    }
    if ((s.status as TranscriptStatus) === 'loading') s.status = 'none'
  }

  async function transcribe(courseId: string, video: VideoEntry, duration: number) {
    const k = key(courseId, video.path)
    const s = ensure(k)
    if (s.status === 'transcribing') return
    const controller = new AbortController()
    const fileName = `${video.title}.srt`
    jobs.set(k, { courseId, path: video.path, title: video.title, controller, parent: markRaw(video.parent), fileName })
    jobCount.value = jobs.size

    s.status = 'transcribing'
    s.segments = []
    s.progress = duration > 0 ? 0 : null
    s.processedSeconds = 0
    s.error = ''
    s.elapsed = 0
    s.language = ''

    try {
      const result = await asr.transcribeHandle(video.handle, duration, {
        signal: controller.signal,
        onSegment: (seg: TranscriptSegment) => {
          s.segments.push(seg)
        },
        onProgress: (seconds, ratio) => {
          s.processedSeconds = seconds
          s.progress = ratio
        },
      })
      if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      // 卸载/切课不会取消任务：写盘用的是捕获的目录句柄
      await writeTextFile(video.parent, fileName, toSrt(s.segments))
      s.fileName = fileName
      s.elapsed = result.elapsed
      s.language = result.language
      s.progress = 1
      s.status = 'ready'
    } catch (err) {
      if (controller.signal.aborted) {
        s.status = 'none'
        s.segments = []
        s.progress = null
      } else {
        s.status = 'error'
        s.error = (err as Error).message
      }
    } finally {
      jobs.delete(k)
      jobCount.value = jobs.size
    }
  }

  function cancel(courseId: string, path: string) {
    jobs.get(key(courseId, path))?.controller.abort()
  }

  /** 重新转写：先丢掉内存里的结果（文件会在完成时被覆盖） */
  function reset(courseId: string, path: string) {
    const s = ensure(key(courseId, path))
    if (s.status === 'transcribing') return
    Object.assign(s, blank(), { status: 'none' })
  }

  const tasks = computed(() => {
    void jobCount.value
    return [...jobs.entries()].map(([id, job]) => ({ courseId: job.courseId, path: job.path, title: job.title, progress: states.get(id)?.progress ?? null }))
  })
  const activeJobs = computed(() => jobCount.value)

  return { get, load, transcribe, cancel, reset, activeJobs, tasks, asr }
}

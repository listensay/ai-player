import { aiTaskSettings, completeAiBatches, runAiBatches } from '~/utils/aiBatchTask'
import { retainedCache } from '~/utils/retainedCache'
import { computed, reactive, ref } from 'vue'
import { useAsrService } from '~/composables/useAsrService'
import { writeTextFile } from '~/utils/fs'
import { toSrt, parseSrt } from '~/utils/transcript'
import type { CourseDirectoryHandle } from '~/types/storage'
/**
 * 逐字稿状态：按「课程 id + 视频路径」缓存，切换课时或页签不会丢掉进行中的转写。
 * 逐字稿以同名 .srt 存在视频旁边（01-环境搭建.mp4 -> 01-环境搭建.srt），
 * 播放器、Obsidian、知识点总结与练习都可读取这个文件。
 */
import { markRaw } from 'vue'
import type { VideoEntry } from '~/types/course'
import type { TranscriptSegment, TranscriptState, TranscriptStatus } from '~/types/transcript'
import type { GuideSettings } from '~/types/guide'
import { requestGuideJson } from '~/utils/guideAi'
import {
  applyTranscriptCorrections,
  batchTranscriptSegments,
  refineTranscriptPrompt,
  validateTranscriptCorrections,
} from '~/utils/transcriptAi'

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
const refineJobs = new Map<string, AbortController>()
const loads = new Map<string, Promise<void>>()
const runs = new Map<string, Promise<void>>()
const jobCount = ref(0)
const cache = retainedCache(states, {
  entries: 12, weight: 6_000_000,
  measure: state => state.segments.reduce((size, segment) => size + segment.text.length, 0),
  disposable: (key, state) => !loads.has(key) && !runs.has(key) && !refineJobs.has(key)
    && !state.refining && ['idle', 'none', 'ready'].includes(state.status),
})

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
    refining: false,
    refineProgress: '',
    refineError: '',
  }
}

function ensure(k: string): TranscriptState {
  let s = states.get(k)
  if (!s) {
    s = blank()
    states.set(k, s)
    cache.touch(k); cache.prune(k)
  }
  cache.touch(k)
  return states.get(k)!
}

export function useTranscripts() {
  const asr = useAsrService()

  function get(courseId: string, path: string): TranscriptState {
    return ensure(key(courseId, path))
  }

  /** 读取同名 .srt / .vtt；没有则标记为 none */
  async function load(courseId: string, video: VideoEntry) {
    const k = key(courseId, video.path)
    if (loads.has(k)) return loads.get(k)
    const loading = read(courseId, video).finally(() => { loads.delete(k); cache.prune(k) })
    loads.set(k, loading)
    return loading
  }

  async function read(courseId: string, video: VideoEntry) {
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
    if (runs.has(k)) return runs.get(k)
    const running = run(courseId, video, duration).finally(() => { runs.delete(k); cache.prune(k) })
    runs.set(k, running)
    return running
  }

  async function run(courseId: string, video: VideoEntry, duration: number) {
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

  async function prepare(courseId: string, video: VideoEntry, duration = 0) {
    await load(courseId, video)
    const s = get(courseId, video.path)
    if (s.status !== 'ready') await transcribe(courseId, video, duration)
    if (s.status !== 'ready') throw new Error(s.error || '转写已取消，可点击重试。')
    if (!s.segments.length) throw new Error('未识别到可用语音，请检查字幕或音轨。')
    return s.segments
  }

  function cancel(courseId: string, path: string) {
    jobs.get(key(courseId, path))?.controller.abort()
    cancelRefine(courseId, path)
  }

  /** 重新转写：先丢掉内存里的结果（文件会在完成时被覆盖） */
  function reset(courseId: string, path: string) {
    cancelRefine(courseId, path)
    const s = ensure(key(courseId, path))
    if (s.status === 'transcribing') return
    Object.assign(s, blank(), { status: 'none' })
  }

  async function refine(
    courseId: string,
    video: VideoEntry,
    settings: GuideSettings,
  ): Promise<{ total: number; changed: number }> {
    const k = key(courseId, video.path)
    const s = ensure(k)
    if (s.status !== 'ready' || !s.segments.length) {
      throw new Error('当前课节没有可校对的逐字稿。')
    }
    if (s.refining) {
      throw new Error('AI 校对正在进行中。')
    }
    if (!settings.baseUrl?.trim() || !settings.model?.trim()) {
      throw new Error('请先在 AI 设置中配置并启用服务。')
    }

    const controller = new AbortController()
    refineJobs.set(k, controller)
    s.refining = true
    s.refineProgress = ''
    s.refineError = ''

    try {
      const original = s.segments.map(segment => ({ ...segment }))
      const batches = batchTranscriptSegments(original)
      const submittedSettings = { ...settings }
      const identity = { kind: 'transcript-refinement', promptVersion: 1, courseId, path: video.path,
        title: video.title, original, settings: aiTaskSettings(submittedSettings) }
      const results = await runAiBatches({
        identity,
        batches, signal: controller.signal,
        progress: (done, total) => { s.refineProgress = `已完成 ${done} / ${total} 批` },
        request: batch => requestGuideJson(submittedSettings, refineTranscriptPrompt(video.title, batch), controller.signal),
        validate: (raw, batch) => validateTranscriptCorrections(raw, batch),
      })
      let totalChanged = 0
      let currentSegments = original
      for (const corrections of results) {
        const { updatedSegments, changedCount } = applyTranscriptCorrections(currentSegments, corrections)
        currentSegments = updatedSegments; totalChanged += changedCount
      }
      controller.signal.throwIfAborted()
      const fileName = s.fileName || `${video.title}.srt`
      await writeTextFile(video.parent, fileName, toSrt(currentSegments))
      s.segments = currentSegments
      s.fileName = fileName
      s.refineProgress = ''
      await completeAiBatches(identity)
      return { total: s.segments.length, changed: totalChanged }
    } catch (err) {
      if (controller.signal.aborted) {
        s.refineProgress = ''
        s.refineError = ''
        throw new DOMException('已取消', 'AbortError')
      }
      const message = (err as Error).message || 'AI 校对失败，请重试。'
      s.refineError = message
      throw err
    } finally {
      s.refining = false
      refineJobs.delete(k)
      cache.prune(k)
    }
  }

  function cancelRefine(courseId: string, path: string) {
    const controller = refineJobs.get(key(courseId, path))
    if (controller) {
      controller.abort()
      refineJobs.delete(key(courseId, path))
    }
  }

  const tasks = computed(() => {
    void jobCount.value
    return [...jobs.entries()].map(([id, job]) => ({ courseId: job.courseId, path: job.path, title: job.title, progress: states.get(id)?.progress ?? null }))
  })
  const activeJobs = computed(() => jobCount.value)

  function retain(courseId: string, path: string) {
    const k = key(courseId, path)
    const release = cache.retain(k)
    ensure(k)
    return release
  }
  return { get, load, prepare, transcribe, cancel, reset, refine, cancelRefine, activeJobs, tasks, asr, retain }
}

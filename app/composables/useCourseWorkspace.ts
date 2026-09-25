import { onBeforeUnmount, onMounted, computed, ref, watch, inject, nextTick, provide } from 'vue'
import { useCourseStore } from '~/composables/useCourseStore'
import { useLearningGuide } from '~/composables/useLearningGuide'
import { useLessonPractice } from '~/composables/useLessonPractice'
import { usePlayer } from '~/composables/usePlayer'
import { useProgress } from '~/composables/useProgress'
import { useSegmentReminder } from '~/composables/useSegmentReminder'
import { useShortcuts } from '~/composables/useShortcuts'
import { useStudyCheckIn } from '~/composables/useStudyCheckIn'
import { useTranscripts } from '~/composables/useTranscripts'
import { formatTime } from '~/utils/time'
import { useRoute, useRouter } from 'vue-router'
import { desktopInvoke } from '~/utils/platform'
import { flushDatabaseWrites } from '~/utils/database'
import type { VideoEntry } from '~/types/course'
import type { TodayItem } from '~/types/guide'
import type { PracticeScope } from '~/types/practice'
import type { InjectionKey } from 'vue'

export function provideCourseWorkspace() {
  const route = useRoute()
  const router = useRouter()

  const store = useCourseStore()
  const { stats } = store
  const player = usePlayer()

  const noteEditor = ref<{
    hasUnsavedChanges: () => boolean
    insertTimestamp: (seconds: number) => void
    insertInline: (text: string) => void
    insertScreenshot: (blob: Blob, seconds: number, ratio?: number) => Promise<void>
    setPlayhead: (seconds: number) => void
    save: () => Promise<void>
    focus: () => void
    getMarkdown: () => string | undefined
  } | null>(null)
  const stage = ref<{ toggleFullscreen: () => void } | null>(null)

  const helpOpen = ref(false)
  const guideOpen = ref(false)
  const guideQuestion = ref<string | undefined>()
  const guideTab = ref<'plan' | 'today' | 'help' | 'settings'>('plan')
  const returnPoint = ref<{ path: string; seconds: number; questionId?: string } | null>(null)
  const feedbackQuestionId = ref('')
  const pendingSeek = ref<{ path: string; seconds: number } | null>(null)
  const treeOpen = ref(false)
  /** 右栏页签：笔记 / 逐字稿。两个面板都常驻，切页签不打断转写与编辑 */
  const rightTab = ref<'notes' | 'transcript'>('notes')
  const transcripts = useTranscripts()

  function quoteToNote(text: string) {
    rightTab.value = 'notes'
    nextTick(() => {
      // 笔记页签刚切回来时编辑器没有焦点，insertInline 会把引用追加为文末新段落
      noteEditor.value?.insertInline(text)
      showToast('已插入笔记')
    })
  }
  const currentView = computed(() => route.path.endsWith('/player') ? 'player' as const : 'dashboard' as const)
  const toast = ref('')
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  const course = computed(() => store.state.course)
  const video = computed(() => store.state.currentVideo)
  const guide = useLearningGuide(course)
  const practice = useLessonPractice(course, guide.state.settings, guide.configured)
  const segment = useSegmentReminder(computed(() => course.value?.id), computed(() => video.value?.path), computed(() => guide.state.today))
  const checkInPlan = computed(() => ({
    today: guide.state.today,
    dailyMinutes: guide.state.plan?.dailyMinutes ?? (guide.state.today?.minutes ?? 120),
    // 完整学习计划的每日总投入（看课 + 实践）作为打卡目标。
    targetMinutes: guide.todayTotalMinutes.value,
    workSeconds: guide.workSecondsByDate.value,
  }))
  const checkIn = useStudyCheckIn(course, checkInPlan)

  watch(() => checkIn.justCheckedIn.value, (day) => {
    if (day) {
      const hours = Math.floor(day.targetSeconds / 3600)
      const minutes = Math.floor((day.targetSeconds % 3600) / 60)
      const timeStr = hours > 0 ? `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}` : `${minutes} 分钟`
      showToast(`今日学习 ${timeStr}，已打卡。`)
    }
  })
  const hasPrev = computed(() => !!video.value && !!guide.adjacent(video.value.path, -1))
  const hasNext = computed(() => !!video.value && !!guide.adjacent(video.value.path, 1))

  function onVideoSample(sample: import('~/types/practice').PlaybackSample) {
    segment.sample(sample)
    if (video.value) {
      checkIn.sample(video.value.path, sample)
    }
  }

  function navigateEpisode(offset: -1 | 1) {
    if (!video.value) return
    const next = guide.adjacent(video.value.path, offset)
    if (next) selectVideo(next)
  }

  function recordQuestion(question: string) {
    if (!video.value) return
    const entry = guide.saveQuestion(question, video.value.path, player.state.currentTime)
    showToast(entry ? '疑问已记录，可在疑问清单中查看' : '请在笔记中选中或输入疑问内容')
    return entry
  }

  function openGuide(question?: string, tab: 'plan' | 'today' | 'help' | 'settings' = 'plan') {
    if (question?.trim() && video.value) {
      const entry = guide.saveQuestion(question, video.value.path, player.state.currentTime)
      if (entry) guide.selectQuestion(entry.id)
    }
    guideQuestion.value = question
    guideTab.value = tab
    guideOpen.value = true
  }

  function startSegment(item: TodayItem) {
    selectGuideVideo(item.path, item.start)
    segment.start(item)
  }

  async function leaveFullscreen() {
    await player.exitFullscreen().catch(() => {})
  }

  async function openPractice(scope: PracticeScope | null = null) {
    const target = video.value, courseId = course.value?.id
    if (!target) return
    const snapshot = noteEditor.value?.getMarkdown()
    player.pause()
    await leaveFullscreen()
    if (video.value?.path === target.path && course.value?.id === courseId) void practice.open(target, scope, snapshot)
  }

  function practiceSegment() {
    const reminder = segment.reminder.value
    if (!reminder) return
    const scope = { start: reminder.item.start, end: reminder.end }
    segment.dismiss()
    void openPractice(scope)
  }

  function completeSegment() {
    const item = segment.reminder.value?.item
    if (item) guide.completeTodayItem(item.id, true)
    segment.dismiss()
    showToast('片段已标记完成，掌握程度需单独记录')
  }

  async function noteAfterSegment() {
    const seconds = segment.reminder.value?.end
    player.pause(); segment.dismiss()
    await leaveFullscreen()
    if (seconds !== undefined) noteEditor.value?.insertTimestamp(seconds)
    noteEditor.value?.focus()
  }

  async function questionsAfterSegment() {
    player.pause(); segment.dismiss()
    await leaveFullscreen()
    openGuide(undefined, 'help')
  }

  function selectGuideVideo(path: string, seconds?: number, returning = false, questionId?: string) {
    const target = course.value?.videos.find(v => v.path === path)
    if (!target) return
    if (returning && video.value && (!returnPoint.value || (questionId && returnPoint.value.questionId !== questionId))) {
      const question = guide.state.questions.find(q => q.id === questionId)
      returnPoint.value = question ? { path: question.path, seconds: question.seconds, questionId }
        : { path: video.value.path, seconds: player.state.currentTime }
    }
    const canSeek = currentView.value === 'player' && video.value?.path === path && player.state.ready
    selectVideo(target)
    if (seconds !== undefined) {
      if (canSeek) seekTo(seconds)
      else pendingSeek.value = { path, seconds }
    }
  }

  function returnToLesson() {
    const point = returnPoint.value
    if (!point) return
    selectGuideVideo(point.path, point.seconds)
    feedbackQuestionId.value = point.questionId ?? ''
    returnPoint.value = null
  }

  function answerQuestion(resolved: boolean) {
    guide.setQuestionStatus(feedbackQuestionId.value, resolved ? 'resolved' : 'still-confused')
    feedbackQuestionId.value = ''
    showToast(resolved ? '疑问已解决，掌握程度需在知识地图中单独标记' : '反馈已记录，已回看的基础课已加入补学')
  }

  watch(() => player.state.ready, ready => {
    const target = pendingSeek.value
    if (ready && target && video.value?.path === target.path) {
      seekTo(target.seconds)
      pendingSeek.value = null
    }
  })
  watch(() => course.value?.id, () => {
    guideOpen.value = false
    guideQuestion.value = undefined
    returnPoint.value = null
    pendingSeek.value = null
    feedbackQuestionId.value = ''
  })

  function playVideoFromDashboard(v: VideoEntry) {
    selectVideo(v)
  }

  function showToast(message: string) {
    toast.value = message
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = ''), 2200)
  }

  function selectVideo(v: VideoEntry) {
    pendingSeek.value = null
    if (course.value) void router.push({ path: `/courses/${course.value.id}/player`, query: { lesson: v.path } })
    treeOpen.value = false
  }

  function insertTimestamp() {
    if (!noteEditor.value || !player.state.ready) return
    noteEditor.value.insertTimestamp(player.state.currentTime)
  }

  async function screenshot() {
    if (!noteEditor.value || !player.state.ready) return
    const frame = await player.captureFrame()
    if (!frame) {
      showToast('视频尚未加载，请稍后截图')
      return
    }
    try {
      await noteEditor.value.insertScreenshot(frame.blob, player.state.currentTime, frame.ratio)
      showToast(`已截图 ${formatTime(player.state.currentTime, true)}`)
    } catch (err) {
      console.error(err)
      showToast(`截图保存失败：${(err as Error).message}`)
    }
  }

  async function saveNote() {
    if (!noteEditor.value) return
    await noteEditor.value.save()
    showToast('笔记已保存')
  }

  function seekTo(seconds: number) {
    player.seek(seconds)
    if (!player.state.playing) void player.play()
  }

  useShortcuts({
    togglePlay: () => player.toggle(),
    seekBy: (s) => player.seekBy(s),
    volumeBy: (d) => player.setVolume(player.state.volume + d),
    toggleMute: () => player.toggleMute(),
    toggleFullscreen: () => stage.value?.toggleFullscreen(),
    rateStep: (dir) => player.stepRate(dir),
    insertTimestamp,
    screenshot: () => void screenshot(),
    saveNote: () => void saveNote(),
    prevEpisode: () => navigateEpisode(-1),
    nextEpisode: () => navigateEpisode(1),
    toggleHelp: () => (helpOpen.value = !helpOpen.value),
    closeOverlays: () => {
      void leaveFullscreen()
      helpOpen.value = false
      guideOpen.value = false
      practice.close()
      treeOpen.value = false
    },
  })

  // 播放头每走过 1 秒，同步一次到笔记，用于高亮所在片段的时间戳
  watch(
    () => Math.floor(player.state.currentTime),
    (sec) => noteEditor.value?.setPlayhead(sec),
  )

  let routeVersion = 0
  watch(() => route.params.id, async (id) => {
    const version = ++routeVersion
    player.pause()
    if (typeof id !== 'string') { store.closeCourse(); return }
    await store.restoreCourse(id)
    if (version !== routeVersion) return
    const canonicalId = store.state.accessRecent?.id ?? store.state.course?.id
    if (canonicalId && canonicalId !== id) {
      await router.replace({ path: `/courses/${canonicalId}${currentView.value === 'player' ? '/player' : ''}`, query: route.query })
    }
  }, { immediate: true })

  watch(() => [course.value?.id, route.params.id, route.query.lesson, currentView.value] as const, () => {
    if (!course.value || course.value.id !== route.params.id || currentView.value !== 'player') return
    const path = typeof route.query.lesson === 'string' ? route.query.lesson : ''
    const selected = course.value.videos.find(v => v.path === path) ?? video.value ?? course.value.videos[0]
    if (!selected) return
    if (pendingSeek.value?.path !== selected.path) pendingSeek.value = null
    store.selectVideo(selected)
    if (path !== selected.path) void router.replace({ path: route.path, query: { ...route.query, lesson: selected.path } })
  })

  watch(currentView, () => {
    void leaveFullscreen()
    player.pause()
    treeOpen.value = false
    guideOpen.value = false
    practice.close()
  })
  onBeforeUnmount(() => { if (toastTimer) clearTimeout(toastTimer) })
  let unlistenClose: (() => void) | undefined
  let unlistenQuit: (() => void) | undefined
  let closing = false
  onMounted(async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const { listen } = await import('@tauri-apps/api/event')
    const appWindow = getCurrentWindow()
    const closeSafely = async () => {
      if (closing) return
      closing = true
      try {
        if (transcripts.activeJobs.value && !await desktopInvoke<boolean>('confirm_asr_quit')) return
        player.pause()
        if (course.value && video.value && player.state.ready) {
          useProgress().update(course.value.id, video.value.path, player.state.currentTime, player.state.duration)
        }
        await noteEditor.value?.save()
        if (noteEditor.value?.hasUnsavedChanges()) throw new Error('笔记尚未保存')
        useProgress().flush()
        guide.persist(); practice.persist(); checkIn.persist()
        await flushDatabaseWrites()
        await desktopInvoke('finish_close')
      } catch {
        showToast('笔记未保存，请重试后关闭窗口。')
      } finally { closing = false }
    }
    unlistenClose = await appWindow.onCloseRequested(event => { event.preventDefault(); void closeSafely() })
    unlistenQuit = await listen('desktop-quit-requested', closeSafely)
    await desktopInvoke('frontend_ready')
  })
  onBeforeUnmount(() => { unlistenClose?.(); unlistenQuit?.() })
  const workspace = { store, stats, player, noteEditor, stage, helpOpen, guideOpen, guideQuestion, guideTab, returnPoint, feedbackQuestionId, pendingSeek, treeOpen, rightTab, transcripts, currentView, toast, course, video, guide, practice, segment, checkIn, hasPrev, hasNext, onVideoSample, navigateEpisode, recordQuestion, openGuide, startSegment, openPractice, practiceSegment, completeSegment, noteAfterSegment, questionsAfterSegment, selectGuideVideo, returnToLesson, answerQuestion, playVideoFromDashboard, selectVideo, insertTimestamp, screenshot, saveNote, seekTo, quoteToNote }
  provide(COURSE_WORKSPACE, workspace)
  return workspace
}

type CourseWorkspace = ReturnType<typeof provideCourseWorkspace>
const COURSE_WORKSPACE: InjectionKey<CourseWorkspace> = Symbol('course-workspace')
export function useCourseWorkspace() {
  const workspace = inject(COURSE_WORKSPACE)
  if (!workspace) throw new Error('Course workspace provider is missing')
  return workspace
}

import { onBeforeUnmount, computed, ref, watch, inject, provide } from 'vue'
import { useCourseStore } from '~/composables/useCourseStore'
import { useLearningGuide } from '~/composables/useLearningGuide'
import { useLessonPractice } from '~/composables/useLessonPractice'
import { useLessonKnowledge } from '~/composables/useLessonKnowledge'
import { useDailyPractice } from '~/composables/useDailyPractice'
import { useCompanion } from '~/composables/useCompanion'
import { usePlayer } from '~/composables/usePlayer'
import { usePlayerDirectory } from '~/composables/usePlayerDirectory'
import { useProgress } from '~/composables/useProgress'
import { useSegmentReminder } from '~/composables/useSegmentReminder'
import { useShortcuts } from '~/composables/useShortcuts'
import { useStudyCheckIn } from '~/composables/useStudyCheckIn'
import { provideDesktopSettings } from './useDesktopSettings'
import { provideStudyTools } from '~/composables/useStudyTools'
import { useReminderLinks } from '~/composables/useReminderLinks'
import { useTranscripts } from '~/composables/useTranscripts'
import { useNoteWorkspace } from './useNoteWorkspace'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router'
import type { ReminderLinkDestination } from '~/utils/reminderLinks'
import { desktopInvoke } from '~/utils/platform'
import { flushDatabaseWrites } from '~/utils/database'
import { calculateDay } from '~/utils/dailyPlan'
import { budgetTotal } from '~/utils/studyProgram'
import type { VideoEntry } from '~/types/course'
import type { TodayItem } from '~/types/guide'
import type { PracticeScope } from '~/types/practice'
import type { InjectionKey } from 'vue'

export function provideCourseWorkspace() {
  const route = useRoute()
  const router = useRouter()

  const store = useCourseStore()
  const studyTools = provideStudyTools()
  const desktopSettings = provideDesktopSettings()
  const { stats } = store
  const player = usePlayer()

  const stage = ref<{ toggleFullscreen: () => void } | null>(null)

  const helpOpen = ref(false)
  const guideOpen = ref(false)
  const guideTab = ref<'plan' | 'today' | 'settings'>('plan')
  const pendingSeek = ref<{ path: string; seconds: number } | null>(null)
  const { treeOpen, desktopTreeOpen, treeVisible, toggleTree } = usePlayerDirectory()
  /** 笔记优先展示；切页签不打断转写与笔记编辑。 */
  const rightTab = ref<'knowledge' | 'notes' | 'transcript'>('notes')
  const transcripts = useTranscripts()

  const currentView = computed(() => route.path.endsWith('/player') ? 'player' as const : 'dashboard' as const)
  const toast = ref('')
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  const course = computed(() => store.state.course)
  const video = computed(() => store.state.currentVideo)
  watch(() => [course.value?.id, video.value?.path] as const, ([id, path], _old, onCleanup) => {
    if (id && path) onCleanup(transcripts.retain(id, path))
  }, { immediate: true, flush: 'sync' })
  const { noteEditor, quoteToNote, noteAt, insertTimestamp, screenshot, saveNote } = useNoteWorkspace(
    computed(() => course.value && video.value ? JSON.stringify([course.value.id, video.value.path]) : ''), rightTab, player, showToast)
  const guide = useLearningGuide(course, computed(() => !store.state.library.some(c => c.id === course.value?.id && c.status !== 'active')))
  const knowledge = useLessonKnowledge(course, guide.state.settings, guide.configured)
  const practice = useLessonPractice(course, guide.state.settings, guide.configured, {
    sources: (target, scope) => knowledge.sourcesFor(course.value!.id, target, scope ? [scope] : undefined),
  })
  const daily = useDailyPractice(course, computed(() => guide.state.today), guide.todayDate, guide.state.settings, guide.configured, knowledge)
  watch(() => [course.value?.id, video.value?.path, currentView.value, guide.configured.value,
    guide.state.settings.provider, guide.state.settings.contextWindow, guide.state.settings.baseUrl, guide.state.settings.model, guide.state.settings.apiKey] as const, (value, previous) => {
    if (currentView.value !== 'player' || !course.value || !video.value) return
    if (!previous || value[0] !== previous[0] || value[1] !== previous[1] || value[2] !== previous[2]) rightTab.value = 'notes'
    void knowledge.ensure(course.value.id, video.value).catch(() => {})
  }, { immediate: true })
  watch(() => course.value && video.value ? transcripts.get(course.value.id, video.value.path).status : '', (status, previous) => {
    if (status === 'ready' && previous === 'transcribing' && course.value && video.value) {
      void knowledge.ensure(course.value.id, video.value).catch(() => {})
    }
  })
  const segment = useSegmentReminder(computed(() => course.value?.id), computed(() => video.value?.path), computed(() => guide.state.today))
  const checkInPlan = computed(() => ({
    today: guide.state.today,
    dailyMinutes: guide.state.plan?.dailyMinutes ?? (guide.state.today?.minutes ?? 120),
    // 完整学习计划的每日总投入（看课 + 实践）作为打卡目标。
    targetMinutes: guide.todayTotalMinutes.value,
    workSeconds: guide.workSecondsByDate.value,
    budgetForDate: (date: string) => budgetTotal(calculateDay(guide.dayContext.value, date).budget),
  }))
  const checkIn = useStudyCheckIn(course, checkInPlan)
  watch(() => [course.value?.id, checkIn.state.date, checkIn.seconds.value] as const, ([id, date, seconds]) => {
    if (id && seconds > 0) studyTools.markStudied(id, date)
  }, { flush: 'sync' })
  const companion = useCompanion({
    desktopSettings,
    player, course, video, knowledge,
    concepts: computed(() => guide.state.plan?.lessons.find(l => l.path === video.value?.path)?.concepts ?? []),
    today: computed(() => guide.state.today),
    todayReady: computed(() => guide.guideReady.value && guide.recordsReady.value),
    dailyFinished: daily.finished,
    dailyKey: computed(() => daily.records.value[0]?.path ?? ''),
    dailyReady: computed(() => daily.practice.state.historyReady),
    checkedAt: computed(() => checkIn.justCheckedIn.value?.checkedAt ?? null),
    blocked: computed(() => helpOpen.value || guideOpen.value || practice.state.open || daily.practice.state.open),
  })

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
    companion.sample(sample)
    segment.sample(sample)
    const completed = segment.reminder.value?.item
    if (completed && !guide.state.today?.items.find(i => i.id === completed.id)?.done) guide.completeTodayItem(completed.id, true)
    if (video.value) {
      checkIn.sample(video.value.path, sample)
    }
  }

  function navigateEpisode(offset: -1 | 1) {
    if (!video.value) return
    const next = guide.adjacent(video.value.path, offset)
    if (next) selectVideo(next)
  }

  function openGuide(tab: 'plan' | 'today' | 'settings' = 'plan') {
    if (tab === 'settings') { guideOpen.value = false; void router.push({ path: '/settings', query: { section: 'ai' } }); return }
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
    daily.practice.close()
    player.pause()
    await leaveFullscreen()
    if (video.value?.path === target.path && course.value?.id === courseId) void practice.open(target, scope, snapshot)
  }

  async function openDailyPractice() {
    if (!daily.complete.value) return
    const courseId = course.value?.id, day = guide.todayDate.value
    player.pause()
    await leaveFullscreen()
    if (course.value?.id !== courseId || guide.todayDate.value !== day || !daily.complete.value) return
    guideOpen.value = false; helpOpen.value = false; practice.close(); segment.dismiss()
    void daily.open()
  }
  watch(() => daily.shouldPrompt.value && !practice.state.open && !helpOpen.value && !daily.practice.state.open, ready => {
    if (ready) void openDailyPractice()
  }, { immediate: true })

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
    if (seconds !== undefined) await noteAt(seconds)
  }

  function selectGuideVideo(path: string, seconds?: number) {
    const target = course.value?.videos.find(v => v.path === path)
    if (!target) return
    const canSeek = currentView.value === 'player' && video.value?.path === path && player.state.ready
    selectVideo(target)
    if (seconds !== undefined) {
      if (canSeek) seekTo(seconds)
      else pendingSeek.value = { path, seconds }
    }
  }

  watch(() => player.state.ready, ready => {
    const target = pendingSeek.value
    if (ready && target && video.value?.path === target.path) {
      seekTo(target.seconds)
      pendingSeek.value = null
    }
    if (ready && route.query.autoplay === '1' && video.value?.path === route.query.lesson) {
      void player.play()
      const { autoplay: _autoplay, at: _at, ...query } = route.query
      void router.replace({ path: route.path, query })
    }
  })
  watch(() => course.value?.id, () => {
    guideOpen.value = false
    pendingSeek.value = null
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
      daily.practice.close()
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

  watch(() => [course.value?.id, route.params.id, route.query.lesson, route.query.at, currentView.value] as const, () => {
    if (!course.value || course.value.id !== route.params.id || currentView.value !== 'player') return
    const path = typeof route.query.lesson === 'string' ? route.query.lesson : ''
    const selected = course.value.videos.find(v => v.path === path) ?? video.value ?? course.value.videos[0]
    if (!selected) return
    if (pendingSeek.value?.path !== selected.path) pendingSeek.value = null
    store.selectVideo(selected)
    if (typeof route.query.at === 'string') {
      const seconds = Number(route.query.at)
      if (Number.isFinite(seconds) && seconds >= 0) pendingSeek.value = { path: selected.path, seconds }
    }
    if (path !== selected.path) void router.replace({ path: route.path, query: { ...route.query, lesson: selected.path } })
  })

  watch(() => [route.query.panel, course.value?.id, guide.guideReady.value, guide.recordsReady.value, store.state.loading], async () => {
    const panel = route.query.panel, id = course.value?.id
    if (!id || route.params.id !== id || !guide.guideReady.value || !guide.recordsReady.value || store.state.loading || !['today', 'practice'].includes(String(panel))) return
    const { panel: _panel, ...query } = route.query
    await router.replace({ path: route.path, query })
    if (course.value?.id !== id) return
    if (panel === 'practice' && daily.complete.value) await openDailyPractice()
    else openGuide('today')
  })

  watch(currentView, () => {
    void leaveFullscreen()
    player.pause()
    treeOpen.value = false
    guideOpen.value = false
    practice.close()
    daily.practice.close()
  })
  onBeforeUnmount(() => { if (toastTimer) clearTimeout(toastTimer) })
  useWorkspaceLifecycle({ router, note: noteEditor, notify: showToast,
    activeJobs: () => !!transcripts.activeJobs.value,
    async flush() {
      player.pause()
      if (course.value && video.value && player.state.ready) {
        useProgress().update(course.value.id, video.value.path, player.state.currentTime, player.state.duration)
      }
      await useProgress().flush()
      guide.persist(); practice.persist(); checkIn.persist()
      await daily.flush()
      await studyTools.flush()
      await flushDatabaseWrites()
    },
  })
  const reminderLinks = useReminderLinks(async request => {
    await noteEditor.value?.save()
    if (noteEditor.value?.hasUnsavedChanges()) throw new Error('当前笔记尚未保存，请保存后重试。')
    await studyTools.flush()
    await flushDatabaseWrites()
    const target = await desktopInvoke<ReminderLinkDestination>('resolve_reminder_link', { reminderId: request.reminderId })
    if (noteEditor.value?.hasUnsavedChanges()) throw new Error('当前笔记有新的修改，请保存后重试。')
    // A second click for the current player only reveals it; never reload or rewind a playing lesson.
    const alreadyPlayingCourse = target.courseId === course.value?.id && currentView.value === 'player'
    if (!alreadyPlayingCourse) {
      player.pause()
      if (course.value && video.value && player.state.ready) {
        useProgress().update(course.value.id, video.value.path, player.state.currentTime, player.state.duration)
        await useProgress().flush()
      }
      await flushDatabaseWrites()
    }
    await leaveFullscreen()
    if (noteEditor.value?.hasUnsavedChanges()) throw new Error('当前笔记有新的修改，请保存后重试。')
    helpOpen.value = false; guideOpen.value = false; practice.close(); daily.practice.close(); treeOpen.value = false
    if (alreadyPlayingCourse) return
    const navigation = await router.push(target.courseId
      ? { name: 'course-player', params: { id: target.courseId }, query: target.lesson ? { lesson: target.lesson } : {} }
      : { name: 'study-management' })
    if (isNavigationFailure(navigation) && !isNavigationFailure(navigation, NavigationFailureType.duplicated))
      throw new Error('页面切换未完成，请重试。')
    if (target.notice) studyTools.state.notice = target.notice
  })
  const workspace = { companion, reminderLinks, store, stats, player, noteEditor, stage, helpOpen, guideOpen, guideTab, pendingSeek, treeOpen, desktopTreeOpen, treeVisible, toggleTree, rightTab, transcripts, currentView, toast, showToast, course, video, guide, practice, knowledge, daily, openDailyPractice, segment, checkIn, hasPrev, hasNext, onVideoSample, navigateEpisode, openGuide, startSegment, openPractice, practiceSegment, completeSegment, noteAfterSegment, selectGuideVideo, playVideoFromDashboard, selectVideo, insertTimestamp, screenshot, saveNote, seekTo, quoteToNote }
  provide(COURSE_WORKSPACE, workspace)
  return workspace
}

type CourseWorkspace = ReturnType<typeof provideCourseWorkspace>
const COURSE_WORKSPACE: InjectionKey<CourseWorkspace> = Symbol.for('ai-player.course-workspace')
export function useCourseWorkspace() {
  const workspace = inject(COURSE_WORKSPACE)
  if (!workspace) throw new Error('Course workspace provider is missing')
  return workspace
}

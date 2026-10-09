import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowRef,
  toRaw,
  type InjectionKey,
} from 'vue'
import { databaseRequest, flushDatabaseWrites } from '~/utils/database'
import { subscribeDatabaseChanges } from '~/utils/databaseChanges'
import type { HomeCourse } from '~/utils/learningHome'
import { readLearningCourses, readLearningSources, createReviewIndex, resetLearningData } from '~/utils/learningData'
import { localDayKey } from '~/utils/learningFeedback'
import {
  canAcceptWork,
  dueReviewCards,
  emptyLearningManagement,
  mergeReviewCards,
  parseLearningManagement,
  recordReview,
} from '~/utils/learningManagement'
import { learningCalendar } from '~/utils/learningOutcomes'
import { desktopInvoke } from '~/utils/platform'
import type { FlowCheckIn, FlowMood, LearningManagementData, LearningSources, Recall } from '~/types/learningManagement'

export const LEARNING_MANAGEMENT_KEY = 'learning-management:v1'
/** The queue commits only successful writes and keeps each following mutation on the latest committed revision. */
export function createLearningManagement(io: {
  read: () => Promise<unknown>
  write: (value: LearningManagementData) => Promise<unknown>
}) {
  const state = reactive({
    data: emptyLearningManagement(),
    ready: false,
    loading: false,
    saving: 0,
    error: '',
    notice: '',
  })
  let queue: Promise<unknown> = Promise.resolve()
  async function load() {
    if (state.loading || state.ready) return
    state.loading = true
    try {
      state.data = parseLearningManagement(await io.read())
      state.ready = true
      state.error = ''
    } catch (e) {
      state.error = `学习管理读取失败：${String(e)}`
    } finally {
      state.loading = false
    }
  }
  function mutate(change: (data: LearningManagementData) => void): Promise<boolean> {
    if (!state.ready) return Promise.resolve(false)
    state.saving++
    const task = queue
      .then(async () => {
        const next = structuredClone(toRaw(state.data))
        change(next)
        const valid = parseLearningManagement(next)
        if (JSON.stringify(valid) !== JSON.stringify(state.data)) {
          await io.write(valid)
          state.data = valid
        }
        state.error = ''
        return true
      })
      .catch((e) => {
        state.error = `保存失败：${String(e)}`
        return false
      })
      .finally(() => {
        state.saving--
      })
    queue = task
    return task
  }
  return {
    state,
    load,
    mutate,
    flush: async () => {
      await queue
      if (state.error) throw Error(state.error)
    },
  }
}
const KEY: InjectionKey<ReturnType<typeof provideLearningManagement>> = Symbol('learning-management')
export function provideLearningManagement() {
  const store = createLearningManagement({
    read: () => databaseRequest('settings', { query: { key: LEARNING_MANAGEMENT_KEY } }),
    write: (value) => databaseRequest('settings', { method: 'POST', body: { key: LEARNING_MANAGEMENT_KEY, value } }),
  })
  const courses = ref<HomeCourse[]>([])
  const sources = shallowRef<LearningSources>({ practices: [], notes: [], summaries: [] })
  const date = ref(localDayKey()),
    loading = ref(false),
    sourceError = ref(''),
    calendarError = ref(''),
    calendarUrl = ref('')
  const reward = ref('')
  const pendingFlow = ref<Omit<FlowCheckIn, 'mood'> | null>(null)
  async function checkFlow(mood: FlowMood) {
    const pending = pendingFlow.value
    if (!pending) return
    if (
      await store.mutate((data) => {
        if (!data.flows.some((f) => f.id === pending.id)) data.flows.push({ ...pending, mood })
      })
    ) {
      if (pendingFlow.value?.id === pending.id) pendingFlow.value = null
    }
  }
  const reviewIndex = createReviewIndex()
  let version = 0,
    stopped = false,
    refreshTimer: ReturnType<typeof setTimeout> | undefined,
    clock: ReturnType<typeof setInterval> | undefined
  let refreshing: Promise<void> | undefined,
    dirty = false
  async function refresh() {
    dirty = true
    if (refreshing) return refreshing
    refreshing = (async () => {
      loading.value = !courses.value.length
      while (dirty && !stopped) {
        dirty = false
        const token = ++version
        const day = localDayKey()
        date.value = day
        try {
          await store.load()
          if (!store.state.ready) break
          await flushDatabaseWrites()
          const [parsedCourses, parsedSources] = await Promise.all([readLearningCourses(day), readLearningSources()])
          if (token !== version || stopped) return
          if (parsedCourses.some((c) => c.error)) throw Error('部分课程记录无法读取，请重新打开课程。')
          const cards = reviewIndex(parsedSources, parsedCourses, day)
          if (localDayKey() !== day) {
            dirty = true
            continue
          }
          if (
            !(await store.mutate((data) => {
              data.cards = mergeReviewCards(data.cards, cards)
              for (const work of data.works) {
                const course = parsedCourses.find((c) => c.course.id === work.courseId)
                const checks = course?.context?.plan?.modules.find((m) => m.id === work.moduleId)?.practice?.checks
                if (work.acceptedAt === null && course && checks?.length && canAcceptWork(course, work.moduleId))
                  work.acceptedAt = Date.now()
              }
            }))
          )
            break
          if (token !== version || stopped) return
          courses.value = parsedCourses
          sources.value = parsedSources
          sourceError.value = ''
          if (store.state.data.preferences.calendarEnabled) await publishCalendar()
        } catch (e) {
          if (!stopped && token === version) sourceError.value = String(e)
        }
      }
      loading.value = false
    })().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }
  const due = computed(() => dueReviewCards(store.state.data, courses.value, date.value))
  async function rate(id: string, recall: Recall) {
    const day = localDayKey()
    date.value = day
    let earned = false
    const saved = await store.mutate((data) => {
      earned = recordReview(data, courses.value, id, recall, Date.now())
    })
    if (saved && earned) {
      reward.value = day
      store.state.notice = '今日复习完成，Karen 亲密度 +5'
    }
    return saved
  }
  async function publishCalendar() {
    try {
      const p = store.state.data.preferences
      const content = learningCalendar(courses.value, date.value, p.calendarTime, p.calendarDays)
      calendarUrl.value = await desktopInvoke<string>('publish_learning_calendar', { content })
      calendarError.value = ''
      return true
    } catch (e) {
      calendarError.value = `日历更新失败：${String(e)}`
      return false
    }
  }
  function schedule() {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 750)
  }
  const unsubscribe = subscribeDatabaseChanges((collection, options) => {
    const key = (options.body as { key?: string } | undefined)?.key ?? ''
    if (
      ['practice', 'library', 'recent-courses', 'learning-plan', 'guide', 'check-in', 'day-snapshots'].includes(
        collection,
      ) ||
      (collection === 'progress' && (options.body as { done?: boolean })?.done) ||
      (collection === 'settings' && /^(lesson-knowledge:|daily-practice:|study-records:)/u.test(key))
    )
      schedule()
  })
  onMounted(() => {
    void refresh()
    window.addEventListener('focus', schedule)
    clock = setInterval(() => {
      if (date.value !== localDayKey()) void refresh()
    }, 30000)
  })
  onBeforeUnmount(() => {
    stopped = true
    version++
    clearTimeout(refreshTimer)
    clearInterval(clock)
    unsubscribe()
    window.removeEventListener('focus', schedule)
  })
  const instance = {
    ...store,
    courses,
    sources,
    date,
    loading,
    sourceError,
    due,
    rate,
    reward,
    pendingFlow,
    checkFlow,
    refresh: () => {
      resetLearningData()
      return refresh()
    },
    calendarUrl,
    calendarError,
    publishCalendar,
  }
  provide(KEY, instance)
  return instance
}
export function useLearningManagement() {
  const value = inject(KEY, null)
  if (!value) throw Error('Learning management provider is missing')
  return value
}
export function useOptionalLearningManagement() {
  return inject(KEY, null)
}

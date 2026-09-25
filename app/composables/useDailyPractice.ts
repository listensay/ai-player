import { computed, reactive, watch } from 'vue'
import type { Ref } from 'vue'
import type { Course } from '~/types/course'
import type { GuideSettings, TodayPlan } from '~/types/guide'
import type { PracticeRecord, PracticeSource } from '~/types/practice'
import type { useLessonKnowledge } from '~/composables/useLessonKnowledge'
import { useLessonPractice } from '~/composables/useLessonPractice'
import { databaseRequest } from '~/utils/database'
import { dailyPlanComplete, dailyPlanSignature, dailyVideoItems } from '~/utils/knowledge'
import { isRecord } from '~/utils/guide'

export function useDailyPractice(course: Ref<Course | null>, today: Ref<TodayPlan | null>, date: Ref<string>, settings: GuideSettings,
  configured: Ref<boolean>, knowledge: ReturnType<typeof useLessonKnowledge>) {
  const state = reactive({ noticeReady: false, prompted: false, error: '' })
  const caches = new Map<string, Record<string, PracticeRecord[]>>()
  let writes = Promise.resolve(true)
  const recordsKey = (id: string) => `daily-practice:${id}`
  const noticeKey = (id: string, day: string) => `daily-practice-notice:${JSON.stringify([id, day])}`
  const practice = useLessonPractice(course, settings, configured, {
    mode: 'daily',
    fetch: async id => {
      const raw = await databaseRequest<unknown>('settings', { query: { key: recordsKey(id) } })
      if (raw !== null && (!isRecord(raw) || Object.values(raw).some(v => !Array.isArray(v)))) throw new Error('每日练习记录读取失败。')
      const records = (raw ?? {}) as Record<string, PracticeRecord[]>
      caches.set(id, records)
      return records
    },
    save: (id, path, records) => {
      const cache = caches.get(id)
      if (!cache) return Promise.resolve(false)
      cache[path] = records
      const value = JSON.parse(JSON.stringify(cache))
      writes = writes.then(() => databaseRequest('settings', { method: 'POST', body: { key: recordsKey(id), value } }).then(() => true, () => false))
      return writes
    },
  })
  const items = computed(() => dailyVideoItems(today.value, date.value))
  const complete = computed(() => dailyPlanComplete(today.value, date.value))
  const signature = computed(() => dailyPlanSignature(today.value, date.value))
  const path = computed(() => `daily:${date.value}:${signature.value}`)
  const records = computed(() => practice.state.records.filter(r => r.path === path.value))
  const answered = computed(() => records.value.filter(r => r.attempts.length > 0).length)
  const finished = computed(() => records.value.length > 0 && answered.value === records.value.length)
  const shouldPrompt = computed(() => state.noticeReady && !state.prompted && complete.value)

  watch(() => [course.value?.id, date.value] as const, async ([id, day], _, onCleanup) => {
    let stale = false
    onCleanup(() => { stale = true })
    state.noticeReady = false; state.prompted = false; state.error = ''
    if (!id) return
    try {
      const shown = await databaseRequest<boolean>('settings', { query: { key: noticeKey(id, day) } })
      if (!stale) { state.prompted = shown === true; state.noticeReady = true }
    } catch { if (!stale) state.error = '今日巩固提醒记录读取失败，可手动开始。' }
  }, { immediate: true })
  watch([signature, date], () => { if (practice.state.open) practice.close() })

  async function open() {
    const current = course.value
    if (!current || !complete.value) return
    const day = date.value, targetPath = path.value
    const selected = items.value.map(i => ({ ...i }))
    state.prompted = true
    void databaseRequest('settings', { method: 'POST', body: { key: noticeKey(current.id, day), value: true } }).catch(() => {
      if (course.value?.id === current.id && date.value === day) state.error = '提醒记录保存失败，下次打开可能再次提醒。'
    })
    await practice.openSources(targetPath, `${day} · ${new Set(selected.map(i => i.path)).size} 个课节`, async signal => {
      const result: PracticeSource[] = []
      for (const lessonPath of new Set(selected.map(i => i.path))) {
        if (signal.aborted) throw new DOMException('已取消', 'AbortError')
        const video = current.videos.find(v => v.path === lessonPath)
        if (!video) throw new Error('计划中的课节已移除，请更新今日计划。')
        const scopes = selected.filter(i => i.path === lessonPath).map(i => ({ start: i.start, end: i.end }))
        const sources = await knowledge.sourcesFor(current.id, video, scopes)
        if (signal.aborted) throw new DOMException('已取消', 'AbortError')
        if (!sources.length) throw new Error(`「${video.title}」暂无可用知识点，请重新整理后重试。`)
        result.push(...sources.map(s => ({ ...s, text: `${video.title.slice(0, 200)}\n${s.text}` })))
      }
      return result.map((s, i) => ({ ...s, id: `s${i + 1}` }))
    })
    if (practice.state.open && practice.state.path === targetPath && !practice.history.value.length && !practice.state.error) {
      await practice.generate(practice.state.questionCount)
    }
  }
  async function flush() { practice.persist(); await writes }
  return { state, practice, items, complete, records, answered, finished, shouldPrompt, open, flush }
}

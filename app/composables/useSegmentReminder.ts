import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { TodayItem, TodayPlan } from '~/types/guide'
import type { PlaybackSample } from '~/types/practice'
import { crossedSegmentEnd } from '~/utils/segmentReminder'

export function useSegmentReminder(courseId: Ref<string | undefined>, path: Ref<string | undefined>, today: Ref<TodayPlan | null>) {
  const selectedId = ref('')
  const reminder = ref<{ item: TodayItem; end: number } | null>(null)
  const notified = new Set<string>()
  let previous: PlaybackSample | null = null
  const active = computed(() => {
    const candidates = today.value?.items.filter(i => i.path === path.value && i.kind !== 'question' && !i.done) ?? []
    return candidates.find(i => i.id === selectedId.value) ?? candidates[0]
  })
  const key = (item: TodayItem) => `${item.id}:${item.end}`
  watch([courseId, () => today.value?.date], () => {
    notified.clear(); selectedId.value = ''; reminder.value = null; previous = null
  }, { flush: 'sync' })
  watch(path, () => { selectedId.value = ''; reminder.value = null; previous = null }, { flush: 'sync' })
  watch(() => active.value && key(active.value), () => { previous = null; reminder.value = null }, { flush: 'sync' })
  function start(item: TodayItem) {
    selectedId.value = item.id; notified.delete(key(item)); reminder.value = null; previous = null
  }
  function sample(current: PlaybackSample) {
    const item = active.value
    if (!item) { previous = null; return }
    const end = current.duration > 0 && Number.isFinite(current.duration) ? Math.min(item.end, current.duration) : item.end
    if (!notified.has(key(item)) && previous && previous.seconds >= item.start && crossedSegmentEnd(previous, current, end)) {
      notified.add(key(item)); reminder.value = { item: { ...item }, end }
    }
    // 部分 WebView 在 ended 前补发 paused timeupdate，保留最后一次播放样本。
    if (current.seeking || current.playing || current.ended || current.seconds < current.duration) previous = current
  }
  return { active, reminder, start, sample, dismiss: () => { reminder.value = null } }
}

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { desktopInvoke } from '~/utils/platform'
import { createNotionViewController, notionBounds } from '~/utils/notion'

const controller = createNotionViewController({
  prepare: (key, url) => desktopInvoke('notion_prepare', { key, url }),
  layout: (bounds) => desktopInvoke('notion_layout', { bounds }),
})

export function useNotionView(host: Ref<HTMLElement | null>, target: Ref<{ key: string; url: string } | null>) {
  const error = ref('')
  let stopped = false,
    mounted = false,
    frame = 0
  let requested = ''
  let resize: ResizeObserver | undefined, mutations: MutationObserver | undefined
  function sync(retry = false) {
    if (!mounted || stopped) return
    const blocked = [
      ...document.querySelectorAll('.v-overlay, dialog[open], [data-fullscreen="true"], [data-native-webview-overlay]'),
    ].some((element) => element.getClientRects().length)
    const clips: DOMRect[] = []
    for (let parent = host.value?.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (/(hidden|clip|auto|scroll)/u.test(`${style.overflowX} ${style.overflowY}`))
        clips.push(parent.getBoundingClientRect())
    }
    const bounds =
      host.value?.getClientRects().length && !blocked
        ? notionBounds(host.value.getBoundingClientRect(), window.innerWidth, window.innerHeight, clips)
        : null
    const current = target.value && bounds ? { ...target.value, bounds } : null
    const signature = JSON.stringify(current)
    if (!retry && requested === signature) return
    requested = signature
    void controller
      .update(current, retry)
      .then(() => {
        if (!stopped) error.value = ''
      })
      .catch((reason) => {
        if (!stopped && target.value) error.value = `Notion 打开失败：${String(reason)}`
      })
  }
  function schedule() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => sync())
  }
  watch(target, schedule, { flush: 'post' })
  onMounted(() => {
    mounted = true
    resize = new ResizeObserver(schedule)
    if (host.value) resize.observe(host.value)
    mutations = new MutationObserver(schedule)
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'open', 'data-fullscreen'],
    })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('focus', schedule)
    schedule()
  })
  onBeforeUnmount(() => {
    stopped = true
    cancelAnimationFrame(frame)
    resize?.disconnect()
    mutations?.disconnect()
    window.removeEventListener('resize', schedule)
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('focus', schedule)
    void controller.update(null).catch(() => {})
  })
  async function action(action: 'back' | 'reload' | 'url') {
    await controller.flush()
    return desktopInvoke<string>('notion_action', { action })
  }
  return { error, retry: () => sync(true), action }
}

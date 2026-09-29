import { onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'
import { desktopInvoke } from '~/utils/platform'
import { companionHitRegions } from '~/utils/companionHitRegions'

export function useCompanionHitRegions(root: Ref<HTMLElement | undefined>, reportError: () => void) {
  let resize: ResizeObserver | undefined
  let mutation: MutationObserver | undefined
  let frame = 0
  let disposed = false
  let previous = ''
  let queue = Promise.resolve()
  const observed = new Set<Element>()
  const events = ['pointerover', 'pointerout', 'focusin', 'focusout', 'transitionend'] as const
  function observeControls() {
    if (!root.value || !resize) return
    const controls = new Set(root.value.querySelectorAll('[data-pet-hit]'))
    for (const control of observed) {
      if (!controls.has(control)) { resize.unobserve(control); observed.delete(control) }
    }
    for (const control of controls) {
      if (!observed.has(control)) { resize.observe(control); observed.add(control) }
    }
  }
  function refresh() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (disposed || !root.value) return
      observeControls()
      const regions = companionHitRegions(root.value)
      const signature = JSON.stringify(regions)
      if (signature === previous) return
      previous = signature
      queue = queue.then(async () => {
        if (disposed) return
        try { await desktopInvoke('set_companion_hit_regions', { regions }) }
        catch { previous = ''; reportError() }
      })
    })
  }
  onMounted(() => {
    if (!root.value) return
    resize = new ResizeObserver(refresh)
    resize.observe(root.value)
    mutation = new MutationObserver(refresh)
    mutation.observe(root.value, { subtree: true, childList: true, attributes: true, characterData: true })
    for (const event of events) root.value.addEventListener(event, refresh)
    window.addEventListener('resize', refresh)
    refresh()
  })
  onBeforeUnmount(() => {
    disposed = true; cancelAnimationFrame(frame); resize?.disconnect(); mutation?.disconnect()
    observed.clear()
    for (const event of events) root.value?.removeEventListener(event, refresh)
    window.removeEventListener('resize', refresh)
  })
}

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** Desktop sidebar visibility is independent of the small-window drawer. */
export function usePlayerDirectory() {
  const treeOpen = ref(false)
  const desktopTreeOpen = ref(true)
  const wide = ref(false)
  let media: MediaQueryList | undefined
  function syncWidth() {
    wide.value = media?.matches ?? false
    if (wide.value) treeOpen.value = false
  }
  onMounted(() => {
    // Match the player's Tailwind lg layout breakpoint.
    media = window.matchMedia('(min-width: 1024px)')
    syncWidth()
    media.addEventListener('change', syncWidth)
  })
  onBeforeUnmount(() => media?.removeEventListener('change', syncWidth))
  const treeVisible = computed(() => wide.value ? desktopTreeOpen.value : treeOpen.value)
  function toggleTree() {
    if (wide.value) desktopTreeOpen.value = !desktopTreeOpen.value
    else treeOpen.value = !treeOpen.value
  }
  return { treeOpen, desktopTreeOpen, treeVisible, toggleTree }
}

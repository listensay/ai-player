import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'

const WIDTH = 144, HEIGHT = 164, MARGIN = 12
const STORAGE_KEY = 'playbo-pet-position'
/** Stored as a viewport fraction so the pet stays reachable after a resize. */
export function usePetPosition() {
  const position = reactive({ x: 0, y: 0 })
  const viewport = reactive({ width: window.innerWidth, height: window.innerHeight })
  function clamp() {
    position.x = Math.max(MARGIN, Math.min(position.x, viewport.width - WIDTH - MARGIN))
    position.y = Math.max(64, Math.min(position.y, viewport.height - HEIGHT - MARGIN))
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: position.x / viewport.width, y: position.y / viewport.height })) } catch { /* Position can remain session-local. */ }
  }
  function move(delta: { x: number; y: number }) { position.x += delta.x; position.y += delta.y; clamp() }
  function nudge(key: string) {
    move({ x: key === 'left' ? -20 : key === 'right' ? 20 : 0, y: key === 'up' ? -20 : key === 'down' ? 20 : 0 }); save()
  }
  function resize() {
    const x = position.x / viewport.width, y = position.y / viewport.height
    viewport.width = window.innerWidth; viewport.height = window.innerHeight
    position.x = x * viewport.width; position.y = y * viewport.height; clamp()
  }
  position.x = viewport.width - WIDTH - MARGIN
  position.y = viewport.height - HEIGHT - 32
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      position.x = stored.x * viewport.width; position.y = stored.y * viewport.height
    }
  } catch { /* Ignore invalid saved positions. */ }
  clamp()
  onMounted(() => window.addEventListener('resize', resize))
  onBeforeUnmount(() => window.removeEventListener('resize', resize))
  return { position, move, save, nudge,
    side: computed(() => position.x + WIDTH / 2 < viewport.width / 2 ? 'right' as const : 'left' as const),
    below: computed(() => position.y < 320 && viewport.height - position.y - HEIGHT > position.y - 64),
  }
}

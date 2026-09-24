import { onBeforeUnmount, onMounted } from 'vue'
/**
 * 全局快捷键。
 * 规则：
 *  - ⌥T / ⌥S / ⌘S 在任何地方都生效（包括编辑器内），因为它们本来就是“边记边用”的操作
 *  - 其余单键（空格、方向键等）只在焦点不在输入框/编辑器里时生效
 */
export interface ShortcutHandlers {
  togglePlay: () => void
  seekBy: (seconds: number) => void
  volumeBy: (delta: number) => void
  toggleMute: () => void
  toggleFullscreen: () => void
  rateStep: (direction: 1 | -1) => void
  insertTimestamp: () => void
  screenshot: () => void
  saveNote: () => void
  prevEpisode: () => void
  nextEpisode: () => void
  toggleHelp: () => void
  closeOverlays: () => void
}

export const SHORTCUT_GROUPS = [
  {
    title: '播放',
    items: [
      { keys: ['Space'], label: '播放 / 暂停', alt: 'K' },
      { keys: ['←', '→'], label: '后退 / 前进 5 秒' },
      { keys: ['J', 'L'], label: '后退 / 前进 10 秒' },
      { keys: ['[', ']'], label: '减速 / 加速' },
      { keys: ['↑', '↓'], label: '音量加 / 减' },
      { keys: ['M'], label: '静音' },
      { keys: ['F'], label: '全屏' },
      { keys: ['⇧', 'P'], label: '上一集', alt: '⇧ N 下一集' },
    ],
  },
  {
    title: '笔记',
    items: [
      { keys: ['⌥', 'T'], label: '插入当前时间戳' },
      { keys: ['⌥', 'S'], label: '截取当前画面到笔记' },
      { keys: ['⌘', 'S'], label: '立即保存笔记', alt: 'Windows 上是 Ctrl S' },
      { keys: ['/'], label: '打开编辑器插入菜单' },
    ],
  },
  {
    title: '其他',
    items: [{ keys: ['?'], label: '显示 / 隐藏快捷键' }],
  },
] as const

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable="true"], .ProseMirror')
}

export function useShortcuts(handlers: ShortcutHandlers) {
  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    // 原生弹窗负责自己的键盘交互，避免切换导学标签或输入时操作背后的播放器。
    if (document.querySelector('dialog[open]')) return
    const mod = e.metaKey || e.ctrlKey

    // —— 处处生效的组合键（用 code 而不是 key：macOS 上 ⌥T 会输出 †）——
    if (e.altKey && !mod && !e.shiftKey) {
      if (e.code === 'KeyT') {
        e.preventDefault()
        handlers.insertTimestamp()
        return
      }
      if (e.code === 'KeyS') {
        e.preventDefault()
        handlers.screenshot()
        return
      }
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyS') {
      e.preventDefault()
      handlers.saveNote()
      return
    }

    if (e.key === 'Escape') {
      handlers.closeOverlays()
      return
    }

    if (isEditableTarget(e.target)) return
    if (mod || e.altKey) return

    const target = e.target as HTMLElement | null
    const onButton = target?.tagName === 'BUTTON'

    if (e.key === '?') {
      e.preventDefault()
      handlers.toggleHelp()
      return
    }

    if (e.shiftKey) {
      if (e.code === 'KeyN') {
        e.preventDefault()
        handlers.nextEpisode()
      } else if (e.code === 'KeyP') {
        e.preventDefault()
        handlers.prevEpisode()
      }
      return
    }

    switch (e.code) {
      case 'Space':
        if (onButton) return // 让按钮自己响应空格，避免触发两次
        e.preventDefault()
        handlers.togglePlay()
        break
      case 'KeyK':
        e.preventDefault()
        handlers.togglePlay()
        break
      case 'ArrowLeft':
        e.preventDefault()
        handlers.seekBy(-5)
        break
      case 'ArrowRight':
        e.preventDefault()
        handlers.seekBy(5)
        break
      case 'KeyJ':
        e.preventDefault()
        handlers.seekBy(-10)
        break
      case 'KeyL':
        e.preventDefault()
        handlers.seekBy(10)
        break
      case 'ArrowUp':
        e.preventDefault()
        handlers.volumeBy(0.1)
        break
      case 'ArrowDown':
        e.preventDefault()
        handlers.volumeBy(-0.1)
        break
      case 'KeyM':
        e.preventDefault()
        handlers.toggleMute()
        break
      case 'KeyF':
        e.preventDefault()
        handlers.toggleFullscreen()
        break
      case 'BracketLeft':
        e.preventDefault()
        handlers.rateStep(-1)
        break
      case 'BracketRight':
        e.preventDefault()
        handlers.rateStep(1)
        break
      default:
        break
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}

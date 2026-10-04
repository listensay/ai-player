import { computed, inject, provide, ref, type InjectionKey } from 'vue'

export type AppDialogKind = 'settings' | 'study' | 'milestones'
export interface AppDialogEntry {
  kind: AppDialogKind
  section?: string
}
export const APP_DIALOG_TITLES: Record<AppDialogKind, string> = {
  settings: '设置',
  study: '学习管理',
  milestones: '里程碑勋章',
}
export function isAppDialogKind(value: unknown): value is AppDialogKind {
  return value === 'settings' || value === 'study' || value === 'milestones'
}

export function createAppDialogs() {
  const isOpen = ref(false)
  const stack = ref<AppDialogEntry[]>([])
  const current = computed(() => stack.value.at(-1))
  function open(kind: AppDialogKind, section?: string) {
    if (!isOpen.value) stack.value = []
    const index = stack.value.findIndex((entry) => entry.kind === kind)
    if (index < 0) stack.value.push({ kind, section })
    else {
      stack.value.splice(index + 1)
      if (section !== undefined) stack.value[index]!.section = section
    }
    isOpen.value = true
  }
  function close() {
    isOpen.value = false
  }
  function back() {
    if (stack.value.length > 1) stack.value.pop()
    else close()
  }
  function afterLeave() {
    // Keep content through the closing animation; a quick reopen wins over a late transition event.
    if (!isOpen.value) stack.value = []
  }
  return { isOpen, stack, current, open, close, back, afterLeave }
}

const KEY: InjectionKey<ReturnType<typeof createAppDialogs>> = Symbol('app-dialogs')
export function provideAppDialogs() {
  const dialogs = createAppDialogs()
  provide(KEY, dialogs)
  return dialogs
}
export function useAppDialogs() {
  const dialogs = inject(KEY)
  if (!dialogs) throw Error('App dialog provider is missing')
  return dialogs
}

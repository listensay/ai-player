<script setup lang="ts">
/** 快捷键面板：原生 <dialog>，白色纸面 + 细边框 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialogEl = ref<HTMLDialogElement>()

watch(
  () => props.open,
  (open) => {
    const d = dialogEl.value
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  },
)

onMounted(() => {
  if (props.open) dialogEl.value?.showModal()
})

function onBackdropClick(e: MouseEvent) {
  if (e.target === dialogEl.value) emit('close')
}
</script>

<template>
  <dialog
    ref="dialogEl"
    class="m-auto w-[min(92vw,640px)] rounded-3xl border border-linen bg-pure-white p-0 text-charcoal-ink shadow-float backdrop:bg-charcoal-ink/40"
    @close="emit('close')"
    @click="onBackdropClick"
  >
    <div class="p-8">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-heading-sm font-bold">快捷键</h2>
          <p class="mt-1 text-body-sm text-graphite">焦点在笔记里时，单键快捷键不会打断输入。</p>
        </div>
        <UiButton variant="text" size="sm" icon title="关闭" @click="emit('close')">
          <AppIcon name="close" :size="18" />
        </UiButton>
      </div>

      <div class="mt-6 grid gap-6 sm:grid-cols-2">
        <section v-for="group in SHORTCUT_GROUPS" :key="group.title">
          <h3 class="text-body font-bold">{{ group.title }}</h3>
          <ul class="mt-2 divide-y divide-linen">
            <li
              v-for="item in group.items"
              :key="item.label"
              class="flex items-center justify-between gap-4 py-2"
            >
              <span class="text-body-sm text-graphite">
                {{ item.label }}
                <span v-if="'alt' in item && item.alt" class="ml-1 text-caption text-stone">{{ item.alt }}</span>
              </span>
              <span class="flex shrink-0 gap-1">
                <kbd
                  v-for="k in item.keys"
                  :key="k"
                  class="tabular inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-linen bg-page-cream px-2 font-sans text-caption font-bold text-charcoal-ink"
                >
                  {{ k }}
                </kbd>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </dialog>
</template>

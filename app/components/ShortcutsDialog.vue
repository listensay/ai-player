<script setup lang="ts">
import { SHORTCUT_GROUPS } from '~/composables/useShortcuts'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <VDialog :model-value="open" aria-label="快捷键" width="640" @update:model-value="!$event && emit('close')">
    <div class="paper-dialog overflow-y-auto bg-pure-white">
    <div class="p-8">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-heading-sm font-bold">快捷键</h2>
          <p class="mt-1 text-body-sm text-graphite">编辑笔记时，播放类单键快捷键不生效。</p>
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
    </div>
  </VDialog>
</template>

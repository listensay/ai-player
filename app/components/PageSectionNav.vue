<script setup lang="ts" generic="T extends string">
import AppIcon, { type IconName } from './AppIcon.vue'

defineProps<{
  label: string
  prefix: string
  items: readonly { id: T; title: string; icon: IconName }[]
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <nav
    :aria-label="label"
    class="order-first flex flex-wrap gap-2 sm:sticky sm:top-8 sm:order-last sm:flex-col sm:border-l sm:border-linen sm:pl-4"
  >
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      :aria-controls="prefix + '-' + item.id"
      :aria-current="model === item.id ? 'page' : undefined"
      class="flex items-center gap-2 rounded-xl px-4 py-3 text-left text-body-sm font-bold hover:bg-linen/40 focus-visible:outline-2 focus-visible:outline-deep-indigo"
      :class="model === item.id ? 'bg-pure-white text-deep-indigo' : 'text-stone'"
      @click="model = item.id"
    >
      <AppIcon :name="item.icon" :size="18" />{{ item.title }}
    </button>
  </nav>
</template>

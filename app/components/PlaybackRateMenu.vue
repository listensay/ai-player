<script setup lang="ts">
import { computed, ref } from 'vue'
import { PLAYBACK_RATES } from '~/composables/usePlayer'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
const props = defineProps<{ rate: number }>()
const emit = defineEmits<{ change: [rate: number] }>()
const open = ref(false)
const label = computed(() => `${Number(props.rate.toFixed(2))}x`)
function pick(rate: number) { emit('change', rate); open.value = false }
</script>

<template>
  <VMenu v-model="open" location="top end" :offset="8">
    <template #activator="{ props: activator }">
      <UiButton v-bind="activator" size="sm" title="播放速度（[ 减速，] 加速）" class="tabular">{{ label }}</UiButton>
    </template>
    <VList role="listbox" aria-label="播放速度" density="compact" min-width="140">
      <VListItem v-for="r in PLAYBACK_RATES" :key="r" role="option" :aria-selected="Math.abs(r - rate) < 0.001" :active="Math.abs(r - rate) < 0.001" @click="pick(r)">
        <span class="tabular text-body-sm">{{ r }}x</span>
        <template #append><AppIcon v-if="Math.abs(r - rate) < 0.001" name="check" :size="16" /></template>
      </VListItem>
    </VList>
  </VMenu>
</template>

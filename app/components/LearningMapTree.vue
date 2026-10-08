<script setup lang="ts">
import type { LearningMapNode } from '~/types/learningAssistant'
import { formatTime } from '~/utils/time'
defineProps<{ nodes: LearningMapNode[]; parent?: string | null }>()
const emit = defineEmits<{ seek: [seconds: number] }>()
</script>
<template>
  <ul class="map-branches">
    <li v-for="node in nodes.filter((n) => n.parent === (parent ?? null))" :key="node.id">
      <details open>
        <summary>{{ node.label }}</summary>
        <button
          v-for="source in node.sources"
          :key="source.id"
          type="button"
          class="map-source"
          @click="emit('seek', source.start)"
        >
          回看 {{ formatTime(source.start) }}
        </button>
        <LearningMapTree
          v-if="nodes.some((n) => n.parent === node.id)"
          :nodes="nodes"
          :parent="node.id"
          @seek="emit('seek', $event)"
        />
      </details>
    </li>
  </ul>
</template>
<style scoped>
.map-branches {
  margin: 12px 0 0 10px;
  padding-left: 14px;
  border-left: 2px solid #e2ded9;
  display: grid;
  gap: 12px;
}
summary {
  cursor: pointer;
  font-weight: 650;
  padding: 8px;
  background: var(--color-cream-deep, #fff8e7);
  border-radius: 10px;
  overflow-wrap: anywhere;
}
.map-source {
  font-size: 12px;
  margin: 6px 8px;
  color: #5144a3;
  text-decoration: underline;
}
</style>

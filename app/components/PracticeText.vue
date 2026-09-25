<script setup lang="ts">
import { computed } from 'vue'
import { renderPracticeMarkdown } from '~/utils/practiceMarkdown'
const props = defineProps<{ text: string }>()
const html = computed(() => renderPracticeMarkdown(props.text))
</script>

<template>
  <div class="practice-text" v-html="html" />
</template>

<style scoped>
.practice-text { overflow-wrap: anywhere; line-height: 1.8; text-align: left; }
.practice-text :deep(> :first-child) { margin-top: 0; }
.practice-text :deep(> :last-child) { margin-bottom: 0; }
.practice-text :deep(p), .practice-text :deep(ul), .practice-text :deep(ol), .practice-text :deep(pre) { margin: .65em 0; }
.practice-text :deep(ol) { list-style: decimal; padding-left: 1.65em; }
.practice-text :deep(ul) { list-style: disc; padding-left: 1.65em; }
.practice-text :deep(li + li) { margin-top: .4em; }
.practice-text :deep(strong) { font-weight: 700; color: var(--color-charcoal-ink); }
.practice-text :deep(code) { border-radius: 6px; background: var(--color-page-cream); padding: .12em .35em; font-family: var(--font-mono); font-size: .9em; }
.practice-text :deep(pre) { max-width: 100%; overflow-x: auto; border: 1px solid var(--color-linen); border-radius: 12px; padding: 16px; background: var(--color-page-cream); white-space: pre; }
.practice-text :deep(pre code) { background: transparent; padding: 0; overflow-wrap: normal; }
.practice-text :deep(blockquote) { border-left: 3px solid var(--color-sunbeam-yellow); padding-left: 16px; color: var(--color-graphite); }
.practice-text :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; }
.practice-text :deep(th), .practice-text :deep(td) { border: 1px solid var(--color-linen); padding: 8px 12px; }
.practice-text :deep(h1), .practice-text :deep(h2), .practice-text :deep(h3) { font-size: 1.1em; margin: 1em 0 .5em; }
</style>

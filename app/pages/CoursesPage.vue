<script setup lang="ts">
import { usePageTitle } from '~/composables/usePageTitle'
import LearningHome from '~/components/LearningHome.vue'

usePageTitle('网课学习 · Study Helper')
</script>

<template>
  <main class="scroll-soft min-h-0 flex-1 overflow-y-auto">
    <LearningHome />
  </main>
</template>

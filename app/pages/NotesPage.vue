<script setup lang="ts">
import AffineWorkspace from '~/components/AffineWorkspace.vue'
import { usePageTitle } from '~/composables/usePageTitle'
usePageTitle('笔记 · AI Player')
</script>

<template>
  <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <AffineWorkspace />
  </main>
</template>

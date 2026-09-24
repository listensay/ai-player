<script setup lang="ts">

import { usePageTitle } from '~/composables/usePageTitle'
import WelcomeScreen from '~/components/WelcomeScreen.vue'
usePageTitle('首页 · AI Player')
</script>

<template>
  <main class="scroll-soft min-h-0 flex-1 overflow-y-auto">
    <WelcomeScreen />
  </main>
</template>

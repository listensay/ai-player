<script setup lang="ts">
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { usePetPosition } from '~/composables/usePetPosition'
import CompanionPet from './CompanionPet.vue'
const { companion, player } = useCourseWorkspace()
const { position, move, save, nudge, side, below } = usePetPosition()
</script>

<template>
  <aside
    v-if="!player.state.fullscreen"
    class="companion-pet-host"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    aria-label="Playbo 软件内桌宠"
  >
    <CompanionPet
      :state="companion.snapshot.value"
      :busy="companion.opening.value"
      :error="companion.error.value"
      :bubble-side="side"
      :bubble-below="below"
      @move="move"
      @drop="save"
      @nudge="nudge"
      @toggle="companion.toggle"
      @rest="companion.rest"
      @snooze="companion.snooze"
      @desktop="companion.openMini"
    />
  </aside>
</template>

<style scoped>
.companion-pet-host {
  position: fixed;
  z-index: 80;
  width: 144px;
  height: 164px;
  pointer-events: none;
}
</style>

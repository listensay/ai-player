<script setup lang="ts">
import { useId } from 'vue'
import type { CompanionMood } from '~/utils/companion'
withDefaults(defineProps<{ mood?: CompanionMood; size?: number }>(), { mood: 'idle', size: 76 })
const id = useId().replace(/:/g, '')
</script>

<template>
  <svg class="playbo" :class="`playbo--${mood}`" :width="size" :height="size" viewBox="0 0 1120 1160" aria-hidden="true">
    <defs>
      <!-- The committed IP artwork is the source; only its cream backdrop is clipped. -->
      <clipPath :id="`${id}-body`">
        <path d="M450 280V232C450 151 565 151 565 234V280C827 289 927 390 927 660C927 881 858 939 668 949L700 1024H308L337 950C140 931 83 867 83 673C83 413 174 282 450 280Z" />
      </clipPath>
      <radialGradient :id="`${id}-face`"><stop stop-color="#ffce00"/><stop offset="1" stop-color="#ffcf00"/></radialGradient>
    </defs>
    <ellipse class="playbo-shadow" cx="550" cy="1090" rx="310" ry="35" fill="#2d2c2b" opacity=".09" />
    <g class="playbo-body" transform="translate(45 15)">
      <image href="/playbo.png" width="1024" height="1024" :clip-path="`url(#${id}-body)`" />
      <g v-if="mood === 'focus'" fill="none" stroke-linecap="round">
        <path d="M98 622V540C98 202 907 202 907 540V622" stroke="#2d2c2b" stroke-width="70" />
        <path d="M98 550C98 219 907 219 907 550" stroke="#c6c1b9" stroke-width="30" />
        <rect x="50" y="530" width="112" height="225" rx="52" fill="#2d2c2b" stroke="#f9f4f2" stroke-width="20" />
        <rect x="855" y="530" width="112" height="225" rx="52" fill="#2d2c2b" stroke="#f9f4f2" stroke-width="20" />
      </g>
      <g v-if="mood === 'tired' || mood === 'rest'">
        <ellipse cx="417" cy="628" rx="58" ry="58" :fill="`url(#${id}-face)`" />
        <ellipse cx="705" cy="618" rx="57" ry="58" :fill="`url(#${id}-face)`" />
        <ellipse cx="565" cy="652" rx="64" ry="44" :fill="`url(#${id}-face)`" />
        <path d="M384 629Q415 650 446 629M675 619Q705 640 735 619" fill="none" stroke="#2d2c2b" stroke-width="17" stroke-linecap="round" />
        <ellipse v-if="mood === 'tired'" class="playbo-yawn" cx="563" cy="659" rx="25" ry="34" fill="#2d2c2b" />
        <path v-else d="M543 654Q562 672 581 654" fill="none" stroke="#2d2c2b" stroke-width="16" stroke-linecap="round" />
      </g>
    </g>
    <g v-if="mood === 'celebrate'" class="playbo-stars" fill="#ffce00" stroke="#2d2c2b" stroke-width="9" stroke-linejoin="round">
      <path d="m177 120 16 46 49 2-39 30 13 47-39-27-40 27 14-47-39-30 49-2Z" />
      <path d="m944 88 20 59 63 2-50 39 16 60-49-35-51 35 18-60-51-39 63-2Z" />
      <path d="m995 826 12 33 35 1-28 22 9 34-28-20-29 20 10-34-29-22 36-1Z" />
    </g>
  </svg>
</template>

<style scoped>
.playbo { display: block; flex-shrink: 0; overflow: visible; }
.playbo-body { transform-origin: 50% 85%; animation: breathe 5s ease-in-out infinite; }
.playbo--focus .playbo-body { animation: listening 3s ease-in-out infinite; }
.playbo--tired .playbo-body, .playbo--rest .playbo-body { animation: breathe 6s ease-in-out infinite; }
.playbo-yawn { transform-box: fill-box; transform-origin: center; animation: yawn 5s ease-in-out infinite; }
.playbo--celebrate .playbo-body { animation: happy-hop .85s ease-in-out 3; }
.playbo-stars { animation: twinkle 1.5s ease-in-out 3; transform-origin: center; }
@keyframes breathe { 0%, 100% { translate: 0 0; } 50% { translate: 0 -12px; } }
@keyframes listening { 0%, 100% { rotate: -2deg; } 50% { rotate: 2deg; } }
@keyframes yawn { 0%, 80%, 100% { scale: 1 .55; } 35%, 55% { scale: 1 1.15; } }
@keyframes happy-hop { 0%, 100% { translate: 0 0; } 45% { translate: 0 -90px; rotate: -4deg; } 70% { rotate: 3deg; } }
@keyframes twinkle { 0%, 100% { opacity: .6; scale: .95; } 50% { opacity: 1; scale: 1.05; } }
@media (prefers-reduced-motion: reduce) { .playbo-body, .playbo-stars, .playbo-yawn { animation: none !important; } }
</style>

<script setup lang="ts">
import { useId } from 'vue'
import type { CompanionMood } from '~/utils/companion'
withDefaults(defineProps<{ mood?: CompanionMood; size?: number; playing?: boolean; bondLevel?: number }>(), {
  mood: 'idle',
  size: 76,
  playing: false,
  bondLevel: 1,
})
const id = useId().replace(/:/g, '')
</script>

<template>
  <svg
    class="playbo"
    :class="[
      `playbo--${mood}`,
      {
        'is-playing': playing,
        'bond-sway': mood === 'idle' && bondLevel === 2,
        'bond-bounce': mood === 'idle' && bondLevel >= 3,
      },
    ]"
    :width="size"
    :height="size"
    viewBox="0 0 1120 1160"
    aria-hidden="true"
  >
    <defs>
      <!-- The committed IP artwork is the source; only its cream backdrop is clipped. -->
      <clipPath :id="`${id}-body`">
        <path
          d="M450 280V232C450 151 565 151 565 234V280C827 289 927 390 927 660C927 881 858 939 668 949L700 1024H308L337 950C140 931 83 867 83 673C83 413 174 282 450 280Z"
        />
      </clipPath>
      <radialGradient :id="`${id}-face`">
        <stop stop-color="#fccc01" />
        <stop offset="1" stop-color="#fccb02" />
      </radialGradient>
    </defs>
    <ellipse class="playbo-shadow" cx="550" cy="1090" rx="310" ry="35" fill="#2d2c2b" opacity=".09" />
    <g transform="translate(45 15)">
      <g class="playbo-body">
        <image href="/playbo.png" width="1024" height="1024" :clip-path="`url(#${id}-body)`" />
        <!-- Replace only the painted eyes so the original mascot can blink and look around. -->
        <g v-if="mood !== 'tired' && mood !== 'rest'">
          <ellipse cx="417" cy="628" rx="58" ry="58" :fill="`url(#${id}-face)`" />
          <ellipse cx="705" cy="618" rx="57" ry="58" :fill="`url(#${id}-face)`" />
          <g v-if="mood === 'celebrate'" fill="none" stroke="#2d2c2b" stroke-width="17" stroke-linecap="round">
            <path d="M382 635Q415 598 448 635M674 625Q705 589 736 625" />
          </g>
          <g v-else class="playbo-gaze" fill="#2d2c2b">
            <ellipse class="playbo-eye" cx="417" cy="628" rx="40" ry="40" />
            <ellipse class="playbo-eye" cx="705" cy="618" rx="37" ry="38" />
          </g>
        </g>
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
          <path
            d="M384 629Q415 650 446 629M675 619Q705 640 735 619"
            fill="none"
            stroke="#2d2c2b"
            stroke-width="17"
            stroke-linecap="round"
          />
          <ellipse v-if="mood === 'tired'" class="playbo-yawn" cx="563" cy="659" rx="25" ry="34" fill="#2d2c2b" />
          <path
            v-else
            d="M543 654Q562 672 581 654"
            fill="none"
            stroke="#2d2c2b"
            stroke-width="16"
            stroke-linecap="round"
          />
        </g>
      </g>
    </g>
    <g
      v-if="mood === 'rest'"
      class="playbo-sleep"
      fill="none"
      stroke="#63605d"
      stroke-width="13"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path class="playbo-sleep-mark" d="M820 255H868L820 301H868" />
      <path class="playbo-sleep-mark" d="M909 175H965L909 230H965" />
    </g>
    <g
      v-if="mood === 'celebrate'"
      class="playbo-stars"
      fill="#ffce00"
      stroke="#2d2c2b"
      stroke-width="9"
      stroke-linejoin="round"
    >
      <path d="m177 120 16 46 49 2-39 30 13 47-39-27-40 27 14-47-39-30 49-2Z" />
      <path d="m944 88 20 59 63 2-50 39 16 60-49-35-51 35 18-60-51-39 63-2Z" />
      <path d="m995 826 12 33 35 1-28 22 9 34-28-20-29 20 10-34-29-22 36-1Z" />
    </g>
  </svg>
</template>

<style scoped>
.playbo {
  display: block;
  flex-shrink: 0;
  overflow: visible;
}
.playbo-body {
  transform-box: view-box;
  transform-origin: 510px 970px;
  animation: breathe 4.6s ease-in-out infinite;
}
.playbo--idle.is-playing .playbo-body,
.playbo--focus .playbo-body {
  animation: listening 2.8s ease-in-out infinite;
}
.playbo--tired .playbo-body,
.playbo--rest .playbo-body {
  animation: breathe 6.2s ease-in-out infinite;
}
.playbo-eye {
  transform-box: fill-box;
  transform-origin: center;
  animation: blink 8.8s linear infinite;
}
.playbo-gaze {
  animation: look-around 14s ease-in-out infinite;
}
.playbo--focus .playbo-gaze,
.playbo.is-playing .playbo-gaze {
  animation: none;
}
.playbo-shadow {
  transform-box: view-box;
  transform-origin: 550px 1090px;
  animation: shadow-breathe 4.6s ease-in-out infinite;
}
.playbo--idle.is-playing .playbo-shadow,
.playbo--focus .playbo-shadow {
  animation-duration: 2.8s;
}
.playbo--tired .playbo-shadow,
.playbo--rest .playbo-shadow {
  animation-duration: 6.2s;
}
.playbo-yawn {
  transform-box: fill-box;
  transform-origin: center;
  animation: yawn 5s ease-in-out infinite;
}
.playbo--celebrate .playbo-body {
  animation: happy-hop 0.85s ease-in-out 3;
}
.playbo-stars {
  animation: twinkle 1.5s ease-in-out 3;
  transform-box: view-box;
  transform-origin: center;
}
.playbo-sleep-mark {
  opacity: 0;
  animation: sleepy 3.6s ease-in-out infinite;
}
.playbo-sleep-mark:nth-child(2) {
  animation-delay: 1.2s;
}
@keyframes breathe {
  0%,
  100% {
    transform: translateY(0) rotate(0.5deg) scale(1);
  }
  50% {
    transform: translateY(-18px) rotate(-0.5deg) scale(1.012, 1.018);
  }
}
@keyframes listening {
  0%,
  100% {
    transform: translateY(0) rotate(-1deg);
  }
  45% {
    transform: translateY(-14px) rotate(1.6deg);
  }
  70% {
    transform: translateY(2px) rotate(0.5deg);
  }
}
/* Uneven pauses and an occasional double blink make the loop less mechanical. */
@keyframes blink {
  0%,
  18%,
  20%,
  59%,
  61%,
  64%,
  66%,
  100% {
    transform: scaleY(1);
  }
  19%,
  60%,
  65% {
    transform: scaleY(0.08);
  }
}
@keyframes look-around {
  0%,
  22%,
  39%,
  64%,
  84%,
  100% {
    transform: translate(0, 0);
  }
  27%,
  33% {
    transform: translate(-10px, -4px);
  }
  70%,
  77% {
    transform: translate(10px, -2px);
  }
}
@keyframes shadow-breathe {
  0%,
  100% {
    transform: scaleX(1);
    opacity: 0.09;
  }
  50% {
    transform: scaleX(0.92);
    opacity: 0.06;
  }
}
@keyframes yawn {
  0%,
  80%,
  100% {
    transform: scaleY(0.55);
  }
  35%,
  55% {
    transform: scaleY(1.15);
  }
}
@keyframes happy-hop {
  0%,
  100% {
    transform: translateY(0) rotate(0);
  }
  45% {
    transform: translateY(-70px) rotate(-4deg);
  }
  70% {
    transform: rotate(3deg);
  }
}
@keyframes twinkle {
  0%,
  100% {
    opacity: 0.6;
    transform: scale(0.95);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
}
@keyframes sleepy {
  0%,
  100% {
    opacity: 0;
    transform: translateY(0);
  }
  30%,
  65% {
    opacity: 0.65;
  }
  90% {
    opacity: 0;
    transform: translateY(-45px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .playbo-body,
  .playbo-stars,
  .playbo-yawn,
  .playbo-eye,
  .playbo-gaze,
  .playbo-shadow,
  .playbo-sleep-mark {
    animation: none !important;
  }
}
</style>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .bond-sway {
    animation: bond-sway 4s ease-in-out infinite;
    transform-origin: 50% 90%;
  }
  .bond-bounce {
    animation: bond-bounce 5s ease-in-out infinite;
  }
}
@keyframes bond-sway {
  0%,
  100% {
    transform: rotate(-2deg);
  }
  50% {
    transform: rotate(2deg);
  }
}
@keyframes bond-bounce {
  0%,
  70%,
  100% {
    transform: translateY(0);
  }
  80%,
  90% {
    transform: translateY(-5px);
  }
  85%,
  95% {
    transform: translateY(0);
  }
}
</style>

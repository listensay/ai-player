<script setup lang="ts">
import { computed } from 'vue'
import type { PomodoroSnapshot } from '~/types/pomodoro'
import { formatPomodoro, POMODORO_LABELS } from '~/utils/pomodoro'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ timer: PomodoroSnapshot }>()
const emit = defineEmits<{ start: []; pause: []; reset: []; settings: [] }>()
const disabled = computed(() => !props.timer.ready || !props.timer.enabled)
const status = computed(() =>
  !props.timer.ready
    ? props.timer.error
      ? '读取失败'
      : '加载中'
    : !props.timer.enabled
      ? '已关闭'
      : props.timer.error
        ? '保存失败'
        : props.timer.status === 'running'
          ? '进行中'
          : props.timer.status === 'paused'
            ? '已暂停'
            : '待开始',
)
const progress = computed(() =>
  Math.max(0, Math.min(100, (1 - props.timer.remainingSeconds / props.timer.totalSeconds) * 100)),
)
</script>
<template>
  <section class="pomodoro-badge" aria-label="播放器番茄钟">
    <button
      type="button"
      class="pomodoro-heading"
      title="打开番茄钟设置"
      aria-label="打开番茄钟设置"
      @click="emit('settings')"
    >
      <span
        class="pomodoro-dot"
        :class="{ running: timer.status === 'running' && timer.enabled, rest: timer.phase !== 'focus' }"
      />
      <span
        >{{ POMODORO_LABELS[timer.phase] }}<span class="pomodoro-status"> · {{ status }}</span></span
      >
    </button>
    <div class="pomodoro-controls">
      <span class="pomodoro-time" aria-label="番茄钟剩余时间">{{ formatPomodoro(timer.remainingSeconds) }}</span>
      <button
        v-if="timer.status === 'running'"
        type="button"
        class="pomodoro-action"
        :disabled="disabled"
        title="暂停番茄钟"
        aria-label="暂停番茄钟"
        @click="emit('pause')"
      >
        <AppIcon name="pause" :size="13" />
      </button>
      <button
        v-else
        type="button"
        class="pomodoro-action"
        :disabled="disabled"
        :title="timer.status === 'paused' ? '继续番茄钟' : '开始番茄钟'"
        :aria-label="timer.status === 'paused' ? '继续番茄钟' : '开始番茄钟'"
        @click="emit('start')"
      >
        <AppIcon name="play" :size="13" />
      </button>
      <button
        type="button"
        class="pomodoro-action"
        :disabled="disabled"
        title="重置番茄钟，重新开始一轮"
        aria-label="重置番茄钟"
        @click="emit('reset')"
      >
        <AppIcon name="reset" :size="13" />
      </button>
    </div>
    <div class="pomodoro-progress" aria-hidden="true"><span :style="{ width: `${progress}%` }" /></div>
  </section>
</template>
<style scoped>
.pomodoro-badge {
  display: flex;
  position: relative;
  align-items: center;
  flex-shrink: 0;
  gap: 10px;
  height: 36px;
  overflow: hidden;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid #e2ded9;
  border-radius: 18px;
  background: #fffaf3;
  pointer-events: auto;
  color: #2d2c2b;
}
button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid #3b197f;
  outline-offset: 1px;
}
.pomodoro-heading {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
  line-height: 20px;
}
.pomodoro-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #3b197f;
}
.pomodoro-dot.rest {
  background: #15803d;
}
.pomodoro-dot.running {
  animation: pomodoro-pulse 1.8s ease-in-out infinite;
}
.pomodoro-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pomodoro-time {
  min-width: 46px;
  font-size: 15px;
  line-height: 26px;
  font-weight: 750;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.pomodoro-action {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
}
.pomodoro-action:hover:not(:disabled) {
  background: #ffce0038;
}
.pomodoro-progress {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 2px;
  background: #e2ded9;
  border-radius: 2px;
  overflow: hidden;
}
.pomodoro-progress span {
  display: block;
  height: 100%;
  background: #3b197f;
}
@media (max-width: 1023px) {
  .pomodoro-status {
    display: none;
  }
}
@keyframes pomodoro-pulse {
  50% {
    opacity: 0.4;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pomodoro-dot.running {
    animation: none;
  }
}
</style>

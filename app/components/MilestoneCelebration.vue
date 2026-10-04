<script setup lang="ts">
import { useMilestones } from '~/composables/useMilestones'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'

const milestones = useMilestones()
const colors = ['#ffce00', '#3b197f', '#f47d31', '#00a4ff', '#ffa1cc', '#8144a8']
const particles = Array.from({ length: 56 }, (_, i) => ({
  left: i % 2 === 0,
  style: {
    '--x': (i % 2 === 0 ? 1 : -1) * (70 + ((i * 53) % 550)) + 'px',
    '--y': -180 - ((i * 37) % 450) + 'px',
    '--spin': (i % 2 ? -1 : 1) * (180 + i * 29) + 'deg',
    background: colors[i % colors.length],
    animationDelay: (i % 7) * 0.055 + 's',
  },
}))
</script>

<template>
  <Teleport to="body">
    <div v-if="milestones.celebration.value.length" class="milestone-celebration">
      <div
        :key="milestones.celebration.value.map((badge) => badge.id).join(',')"
        class="confetti-field"
        aria-hidden="true"
      >
        <i
          v-for="(particle, index) in particles"
          :key="index"
          class="confetti-piece"
          :class="particle.left ? 'confetti-left' : 'confetti-right'"
          :style="particle.style"
        />
      </div>
      <section class="celebration-card" aria-label="新勋章解锁">
        <UiButton
          icon
          variant="text"
          size="sm"
          class="celebration-close"
          title="关闭勋章提示"
          @click="milestones.dismiss()"
          ><AppIcon name="close" :size="18"
        /></UiButton>
        <div class="celebration-trophy" aria-hidden="true"><AppIcon name="trophy" :size="36" /></div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <p class="text-caption font-bold tracking-widest text-deep-indigo uppercase">PLAYBO · 里程碑解锁</p>
          <h2 class="mt-2 text-heading-sm text-charcoal-ink">
            {{
              milestones.celebration.value.length === 1
                ? '解锁「' + milestones.celebration.value[0]!.name + '」'
                : '解锁 ' + milestones.celebration.value.length + ' 枚勋章'
            }}
          </h2>
          <ul class="celebration-list mt-4">
            <li v-for="badge in milestones.celebration.value" :key="badge.id">
              <div class="celebration-badge-icon" aria-hidden="true">
                <AppIcon name="check" :size="14" class="text-pure-white" />
              </div>
              <div class="min-w-0 flex-1">
                <strong class="text-body-sm font-bold text-charcoal-ink">{{ badge.name }}</strong>
                <p class="mt-0.5 text-caption leading-relaxed text-stone">{{ badge.description }}</p>
              </div>
            </li>
          </ul>
        </div>
        <UiButton variant="dark" class="mt-6 w-full" @click="milestones.dismiss()">继续</UiButton>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.milestone-celebration {
  position: fixed;
  inset: 0;
  z-index: 4000;
  pointer-events: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 24px;
}
.celebration-card {
  position: relative;
  pointer-events: auto;
  width: min(100%, 480px);
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
  padding: 32px;
  border: 1px solid var(--color-linen);
  border-radius: var(--radius-3xl);
  background: var(--color-pure-white);
  color: var(--color-charcoal-ink);
  box-shadow: var(--shadow-float);
  animation: award-arrival 0.45s cubic-bezier(0.2, 0, 0, 1);
}
.celebration-close {
  position: absolute;
  top: 14px;
  right: 14px;
}
.celebration-trophy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: var(--color-sunbeam-yellow);
  color: var(--color-charcoal-ink);
  margin-bottom: 20px;
}
.celebration-list {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding: 0;
  max-height: 220px;
  overflow-y: auto;
  list-style: none;
}
.celebration-list li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  font-size: 14px;
  padding: 10px 14px;
  border-radius: var(--radius-xl);
  background: var(--color-page-cream);
  border: 1px solid var(--color-linen);
}
.celebration-badge-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--color-deep-indigo);
  flex-shrink: 0;
  margin-top: 1px;
}
.confetti-field {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.confetti-piece {
  position: absolute;
  bottom: 0;
  width: 9px;
  height: 15px;
  opacity: 0;
  border-radius: 2px;
  animation: award-confetti 2.8s ease-out forwards;
}
.confetti-left {
  left: 12%;
}
.confetti-right {
  right: 12%;
}
@keyframes award-arrival {
  from {
    opacity: 0;
    transform: translateY(28px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes award-confetti {
  0% {
    opacity: 1;
    transform: translate(0, 0) rotate(0);
  }
  55% {
    opacity: 1;
    transform: translate(var(--x), var(--y)) rotate(var(--spin));
  }
  100% {
    opacity: 0;
    transform: translate(var(--x), 140px) rotate(var(--spin));
  }
}
@media (max-width: 640px) {
  .milestone-celebration {
    padding: 14px;
  }
  .celebration-card {
    padding: 24px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .confetti-field {
    display: none;
  }
  .celebration-card {
    animation: none;
  }
}
</style>

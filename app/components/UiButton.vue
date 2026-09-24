<script setup lang="ts">
import { computed } from 'vue'
/**
 * 药丸按钮（DESIGN.md）：
 *  primary —— 蓝色，每个视图只放一个，代表最高优先级操作
 *  dark    —— 深色 + 2px 偏移阴影（"印刷贴纸"质感），次级操作
 *  ghost   —— 白底 + linen 边框
 *  text    —— 无底色的文字按钮
 */
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'dark' | 'ghost' | 'text'
    size?: 'sm' | 'md' | 'lg'
    type?: 'button' | 'submit'
    disabled?: boolean
    /** 只放图标的圆形按钮 */
    icon?: boolean
    title?: string
  }>(),
  { variant: 'ghost', size: 'md', type: 'button', disabled: false, icon: false },
)

const variantClass: Record<NonNullable<typeof props.variant>, string> = {
  primary:
    'bg-mindful-blue text-pure-white hover:bg-mindful-blue-deep active:translate-y-px',
  dark: 'bg-charcoal-ink text-pure-white shadow-subtle hover:bg-soft-black active:translate-y-px active:shadow-none',
  ghost: 'bg-pure-white text-charcoal-ink border border-linen hover:bg-cream-deep active:bg-linen',
  text: 'bg-transparent text-graphite hover:bg-cream-deep hover:text-charcoal-ink',
}

const sizeClass = computed(() => {
  if (props.icon) {
    return { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }[props.size]
  }
  return {
    sm: 'h-8 px-3.5 text-body-sm gap-1.5',
    md: 'h-10 px-5 text-body-sm gap-2',
    lg: 'h-12 px-7 text-body gap-2',
  }[props.size]
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :title="title"
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold whitespace-nowrap select-none transition-[background-color,box-shadow,transform,color] duration-150 ease-soft disabled:pointer-events-none disabled:opacity-40"
    :class="[variantClass[variant], sizeClass]"
  >
    <slot />
  </button>
</template>

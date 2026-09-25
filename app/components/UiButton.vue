<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{
  variant?: 'primary' | 'dark' | 'ghost' | 'text'
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit'
  disabled?: boolean
  icon?: boolean
  title?: string
}>(), { variant: 'ghost', size: 'md', type: 'button', disabled: false, icon: false })
const height = computed(() => ({ sm: 32, md: 40, lg: 48 })[props.size])
</script>

<template>
  <VBtn :type="type" :disabled="disabled" :title="title" :aria-label="icon ? title : undefined"
    :variant="variant === 'text' ? 'text' : 'flat'" :height="height"
    :width="icon ? height : undefined" :min-width="icon ? height : undefined" :icon="icon"
    :class="['ui-button', `ui-button--${variant}`, `ui-button--${size}`]">
    <slot />
  </VBtn>
</template>

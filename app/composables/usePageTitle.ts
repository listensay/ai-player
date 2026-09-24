import { toValue, watchEffect, type MaybeRefOrGetter } from 'vue'

export function usePageTitle(title: MaybeRefOrGetter<string>) {
  watchEffect(() => { document.title = toValue(title) })
}

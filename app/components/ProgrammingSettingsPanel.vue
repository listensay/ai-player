<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import UiButton from '~/components/UiButton.vue'
import { desktopInvoke } from '~/utils/platform'
import { PROGRAMMING_LANGUAGES, programmingLanguageName } from '~/utils/programmingLanguages'
import {
  programmingEnvironments as state,
  loadProgrammingEnvironments,
  setProgrammingDirectories,
} from '~/utils/programmingEnvironments'
const editing = ref(false)
const error = ref('')
const environments = computed(() => state.inventory?.environments ?? [])
const languages = computed(() => [...new Set(environments.value.flatMap((item) => item.languages))])
const missing = computed(() =>
  Object.entries(PROGRAMMING_LANGUAGES)
    .filter(([id]) => !languages.value.some((language) => language === id))
    .map(([, value]) => value.name),
)
async function refresh() {
  error.value = ''
  try {
    await loadProgrammingEnvironments(true)
  } catch {
    /* Shared state displays detection errors. */
  }
}
async function addDirectory() {
  editing.value = true
  error.value = ''
  try {
    const directory = await desktopInvoke<string | null>('choose_programming_directory')
    if (directory && !state.extraDirectories.includes(directory))
      await setProgrammingDirectories([...state.extraDirectories, directory])
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '添加环境目录失败。'
  } finally {
    editing.value = false
  }
}
async function removeDirectory(directory: string) {
  editing.value = true
  error.value = ''
  try {
    await setProgrammingDirectories(state.extraDirectories.filter((item) => item !== directory))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '移除环境目录失败。'
  } finally {
    editing.value = false
  }
}
onMounted(refresh)
</script>

<template>
  <section id="settings-programming" aria-labelledby="programming-heading">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="programming-heading" class="text-heading-sm">编程环境</h2>
      <UiButton size="sm" :disabled="state.loading || editing" @click="refresh">{{
        state.loading ? '正在检测…' : '重新检测'
      }}</UiButton>
    </div>
    <p class="mt-3 text-body-sm text-stone">代码将使用本机已安装的运行环境执行。</p>
    <p v-if="error || state.error" role="alert" class="mt-4 text-body-sm text-error">{{ error || state.error }}</p>
    <p v-if="state.loading" role="status" class="mt-4 text-body-sm text-stone">正在查找本机环境及版本…</p>
    <template v-if="state.inventory">
      <div class="mt-5 flex flex-wrap gap-2" aria-label="可用编程语言">
        <span v-for="language in languages" :key="language" class="rounded-lg bg-linen/50 px-3 py-1 text-caption">{{
          programmingLanguageName(language)
        }}</span>
      </div>
      <p v-if="!environments.length" class="pane mt-4 p-5 text-body-sm">
        未检测到可用编程环境，请安装环境或添加安装目录。
      </p>
      <div class="mt-4 space-y-3">
        <article v-for="item in environments" :key="item.id" class="pane min-w-0 p-5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-body font-bold">{{ item.name }}</h3>
            <span class="text-caption text-stone">{{ item.languages.map(programmingLanguageName).join(' · ') }}</span>
          </div>
          <p class="mt-2 break-all text-caption">{{ item.version }}</p>
          <dl class="mt-3 grid gap-x-4 gap-y-2 text-body-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt class="text-stone">程序路径</dt>
            <dd class="select-text break-all">{{ item.executable }}</dd>
            <dt class="text-stone">所在目录</dt>
            <dd class="select-text break-all">{{ item.directory }}</dd>
          </dl>
        </article>
      </div>
      <p v-if="missing.length" class="mt-4 text-caption text-stone">未检测到：{{ missing.join('、') }}</p>
    </template>
    <div class="pane mt-6 p-5">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-body font-bold">补充环境目录</h3>
        <UiButton size="sm" variant="ghost" :disabled="state.loading || editing" @click="addDirectory"
          >添加目录</UiButton
        >
      </div>
      <ul v-if="state.extraDirectories.length" class="mt-3 space-y-2">
        <li
          v-for="directory in state.extraDirectories"
          :key="directory"
          class="flex items-center justify-between gap-3"
        >
          <span class="min-w-0 select-text break-all text-body-sm">{{ directory }}</span>
          <UiButton
            size="sm"
            variant="text"
            :disabled="state.loading || editing"
            :aria-label="`移除目录 ${directory}`"
            @click="removeDirectory(directory)"
            >移除</UiButton
          >
        </li>
      </ul>
    </div>
    <div v-if="state.inventory" class="pane mt-4 p-5">
      <h3 class="text-body font-bold">代码运行目录</h3>
      <p class="mt-2 select-text break-all text-body-sm">{{ state.inventory.workingDirectory }}</p>
      <h3 class="mt-5 text-body font-bold">环境搜索目录</h3>
      <ul class="mt-2 space-y-2">
        <li
          v-for="directory in state.inventory.searchDirectories"
          :key="directory"
          class="select-text break-all text-caption text-stone"
        >
          {{ directory }}
        </li>
      </ul>
    </div>
  </section>
</template>

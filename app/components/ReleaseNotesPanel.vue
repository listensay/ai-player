<script setup lang="ts">
import { currentRelease, releases, releaseSections } from '~/utils/releases'
</script>

<template>
  <section aria-label="项目版本日志" class="scroll-soft min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header class="mb-10 border-b border-linen pb-8">
        <p class="text-caption font-bold tracking-wide text-deep-indigo">Study Helper</p>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <h2 class="text-heading">每一次更新，都在这里</h2>
          <span class="rounded-full bg-page-cream px-3 py-1 text-caption font-bold text-deep-indigo">
            当前版本 {{ currentRelease.version }}
          </span>
        </div>
        <p class="mt-3 text-body-sm text-stone">查看新增功能、体验调整与问题修复。</p>
      </header>

      <ol class="space-y-8">
        <li v-for="(release, index) in releases" :key="release.version">
          <article :aria-labelledby="`release-${release.version}`" class="pane bg-pure-white p-5 sm:p-8">
            <div class="flex flex-wrap items-center gap-3">
              <h3 :id="`release-${release.version}`" class="text-heading-sm tabular">{{ release.version }}</h3>
              <span v-if="index === 0" class="rounded-full bg-page-cream px-2.5 py-1 text-caption text-deep-indigo">
                最新
              </span>
              <time :datetime="release.date" class="text-caption text-stone sm:ml-auto">{{ release.date }}</time>
            </div>
            <p class="mt-4 text-subheading">{{ release.title }}</p>
            <p class="mt-2 text-body-sm text-stone">{{ release.summary }}</p>
            <template v-for="section in releaseSections" :key="section.key">
              <section v-if="release[section.key].length" class="mt-6">
                <h4 class="text-body-sm font-bold text-deep-indigo">{{ section.title }}</h4>
                <ul class="mt-2 list-disc space-y-2 pl-5 text-body-sm leading-relaxed">
                  <li v-for="entry in release[section.key]" :key="entry">{{ entry }}</li>
                </ul>
              </section>
            </template>
          </article>
        </li>
      </ol>
    </div>
  </section>
</template>

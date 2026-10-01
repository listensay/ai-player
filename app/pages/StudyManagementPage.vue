<script setup lang="ts">
import ReminderTimePicker from '~/components/ReminderTimePicker.vue'
import { computed, reactive, ref } from 'vue'
import { usePageTitle } from '~/composables/usePageTitle'
import { useStudyTools } from '~/composables/useStudyTools'
import { useLearningHome } from '~/composables/useLearningHome'
import { updateReminder } from '~/utils/studyTools'
import type { StudyReminder } from '~/types/studyTools'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import StudyFormDialog from '~/components/StudyFormDialog.vue'

usePageTitle('学习管理 · AI Player')
const tools = useStudyTools(),
  home = useLearningHome()
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((title, i) => ({ title, value: i + 1 }))
const courseOptions = computed(() => home.courses.value.map((c) => ({ title: c.course.name, value: c.course.id })))
const scopeOptions = computed(() => [{ title: '全部课程', value: '' }, ...courseOptions.value])
const reminderDialog = ref(false),
  formError = ref('')
const reminder = reactive<StudyReminder>({
  id: '',
  title: '',
  courseId: '',
  time: '20:00',
  weekdays: [1, 2, 3, 4, 5],
  enabled: true,
  lastNotifiedDate: '',
  snoozedUntil: null,
  pending: false,
})
const exporting = ref<StudyReminder | null>(null)
async function exportToMac() {
  if (exporting.value && (await tools.exportMacReminder(exporting.value.id))) exporting.value = null
}
function showMacExport(value: StudyReminder) {
  tools.mac.error = ''
  exporting.value = value
}
const removing = ref<{ id: string; title: string; local: boolean } | null>(null)
const removeInMac = ref(true)
function showRemove(id: string, title: string, local = true) {
  tools.mac.error = ''
  removeInMac.value = !!tools.mac.links[id]
  removing.value = { id, title, local }
}
function editReminder(value?: StudyReminder) {
  formError.value = ''
  Object.assign(
    reminder,
    value
      ? { ...value, weekdays: [...value.weekdays] }
      : {
          id: '',
          title: '',
          courseId: '',
          time: '20:00',
          weekdays: [1, 2, 3, 4, 5],
          enabled: true,
          lastNotifiedDate: '',
          snoozedUntil: null,
          pending: false,
        },
  )
  reminderDialog.value = true
}
async function saveReminder() {
  const value = {
    ...reminder,
    id: reminder.id || crypto.randomUUID(),
    title: reminder.title.trim(),
    weekdays: [...reminder.weekdays].sort(),
    snoozedUntil: null,
    pending: false,
  }
  if (await tools.mutate((data) => updateReminder(data, value))) {
    reminderDialog.value = false
    void tools.checkReminders()
    const saved = tools.state.data.reminders.find((r) => r.id === value.id)!
    if (tools.mac.links[value.id] && tools.macStatus(saved).pending) showMacExport(saved)
  } else formError.value = tools.state.error
}
async function remove() {
  const value = removing.value
  if (!value) return
  if (removeInMac.value && !(await tools.removeMacReminder(value.id))) return
  if (
    !value.local ||
    (await tools.mutate((data) => {
      data.reminders = data.reminders.filter((item) => item.id !== value.id)
    }))
  )
    removing.value = null
}
async function toggleReminder(id: string, enabled: boolean) {
  const saved = await tools.mutate((data) => {
    const r = data.reminders.find((r) => r.id === id)
    if (r) {
      r.enabled = enabled
      if (!enabled) {
        r.pending = false
        r.snoozedUntil = null
      }
    }
  })
  const value = tools.state.data.reminders.find((r) => r.id === id)
  if (saved && value && tools.mac.links[id] && tools.macStatus(value).pending) showMacExport(value)
}
const courseName = (id: string) =>
  id ? (home.courses.value.find((c) => c.course.id === id)?.course.name ?? '课程暂不可用') : '全部课程'
const coursePaused = (id: string) =>
  !!id && !home.courses.value.some((c) => c.course.id === id && c.course.status === 'active')
</script>

<template>
  <main class="scroll-soft min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-6xl space-y-6 px-5 py-7 md:px-8 md:py-10">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-caption font-bold text-stone">{{ home.date.value }}</p>
          <h1 class="mt-2 text-heading">学习管理</h1>
        </div>
      </header>
      <p v-if="tools.state.error || home.error.value" role="alert" class="text-body-sm text-error">
        {{ tools.state.error || home.error.value }}
      </p>
      <p v-if="tools.state.notice" role="status" class="text-body-sm text-deep-indigo">{{ tools.state.notice }}</p>
      <p v-if="tools.state.loading" role="status" class="text-body-sm text-stone">正在读取学习管理…</p>
      <UiButton v-else-if="!tools.state.ready" @click="tools.load">重新读取</UiButton>
      <template v-else>
        <section class="space-y-5" aria-label="学习提醒设置">
          <div class="pane flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 class="text-subheading">学习提醒</h2>
              <p class="mt-2 text-caption text-stone">
                当天开始观看或记录实践时间后，不再发送该课程的软件内和系统通知，并取消稍后提醒；次日恢复。未关联课程的提醒在当天任一课程开始学习后停止。暂停或归档的课程不提醒。Mac
                提醒事项独立运行。
              </p>
            </div>
            <UiButton variant="dark" :disabled="!!tools.state.saving || tools.mac.busy" @click="editReminder()"
              ><AppIcon name="plus" :size="17" />添加提醒</UiButton
            >
          </div>
          <p v-if="tools.mac.notice" role="status" class="text-body-sm text-deep-indigo">{{ tools.mac.notice }}</p>
          <div v-if="tools.mac.error && !exporting" class="flex items-center gap-3">
            <p role="alert" class="text-body-sm text-error">{{ tools.mac.error }}</p>
            <UiButton size="sm" @click="tools.loadMacStatus">重试</UiButton>
          </div>
          <VCheckbox
            :model-value="tools.state.data.desktopNotifications"
            label="同时发送系统通知"
            :disabled="!!tools.state.saving || tools.mac.busy"
            @update:model-value="tools.setDesktopNotifications($event === true)"
          />
          <div v-if="tools.state.data.reminders.length" class="grid gap-4 md:grid-cols-2">
            <article v-for="r in tools.state.data.reminders" :key="r.id" class="pane p-5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-heading tabular">{{ r.time }}</p>
                  <h3 class="mt-2 break-words text-body font-bold">{{ r.title }}</h3>
                </div>
                <VCheckbox
                  :model-value="r.enabled"
                  label="启用提醒"
                  :aria-label="`${r.title}启用提醒`"
                  :disabled="!!tools.state.saving || tools.mac.busy"
                  @update:model-value="toggleReminder(r.id, $event === true)"
                />
              </div>
              <p class="mt-3 text-caption text-stone">
                {{ r.weekdays.length === 7 ? '每天' : r.weekdays.map((d) => weekdays[d - 1]!.title).join('、') }} ·
                {{ courseName(r.courseId) }}
              </p>
              <p v-if="r.enabled && coursePaused(r.courseId)" class="mt-2 text-caption text-stone">
                关联课程未进行，提醒已暂停。
              </p>
              <p v-else-if="r.snoozedUntil" class="mt-2 text-caption text-deep-indigo">
                稍后提醒：{{ new Date(r.snoozedUntil).toLocaleString('zh-CN') }}
              </p>
              <p
                v-if="tools.mac.links[r.id]"
                class="mt-2 text-caption font-bold"
                :class="tools.macStatus(r).pending ? 'text-brand-orange' : 'text-deep-indigo'"
              >
                Mac 提醒 · {{ tools.macStatus(r).label }}
              </p>
              <div class="mt-4 flex flex-wrap gap-2">
                <UiButton
                  v-if="tools.mac.available"
                  size="sm"
                  :disabled="!!tools.state.saving || tools.mac.busy || (!tools.mac.links[r.id] && !tools.macEnabled(r))"
                  @click="showMacExport(r)"
                  >{{ tools.macStatus(r).action }}</UiButton
                >
                <UiButton size="sm" :disabled="!!tools.state.saving || tools.mac.busy" @click="editReminder(r)"
                  >编辑</UiButton
                >
                <UiButton
                  size="sm"
                  variant="text"
                  :disabled="!!tools.state.saving || tools.mac.busy || !tools.mac.ready"
                  @click="showRemove(r.id, r.title)"
                  >删除</UiButton
                >
              </div>
            </article>
          </div>
          <p v-else class="pane p-10 text-center text-body-sm text-stone">还没有学习提醒。</p>
          <section
            v-if="tools.mac.available && tools.orphanedMac.value.length"
            class="pane space-y-4 p-5"
            aria-label="待处理的 Mac 提醒"
          >
            <h3 class="text-body font-bold">本地已删除 · Mac 待处理</h3>
            <div
              v-for="[id, link] in tools.orphanedMac.value"
              :key="id"
              class="flex flex-wrap items-center justify-between gap-3 border-t border-linen pt-4"
            >
              <p class="min-w-0 break-words text-body-sm">
                {{ link.snapshot?.title || '此前添加的提醒'
                }}<span class="ml-2 text-caption text-stone">{{ link.snapshot?.time }} · {{ link.calendar }}</span>
              </p>
              <UiButton
                size="sm"
                :disabled="tools.mac.busy || !!tools.state.saving"
                @click="showRemove(id, link.snapshot?.title || '此前添加的提醒', false)"
                >删除 Mac 提醒</UiButton
              >
            </div>
          </section>
        </section>
      </template>
    </div>

    <StudyFormDialog
      v-model:open="reminderDialog"
      :title="reminder.id ? '编辑提醒' : '添加提醒'"
      title-id="reminder-title"
      submit-label="保存提醒"
      :busy="!!tools.state.saving || tools.mac.busy"
      :error="formError"
      @submit="saveReminder"
    >
      <VTextField v-model="reminder.title" label="提醒内容" maxlength="80" autofocus />
      <ReminderTimePicker v-model="reminder.time" />
      <VSelect v-model="reminder.weekdays" label="重复日" :items="weekdays" multiple chips />
      <VSelect v-model="reminder.courseId" label="关联课程" :items="scopeOptions" />
      <VCheckbox v-model="reminder.enabled" label="启用提醒" />
    </StudyFormDialog>
    <StudyFormDialog
      :open="!!removing"
      :title="removing?.local ? '删除提醒' : '删除 Mac 提醒'"
      title-id="remove-study-title"
      submit-label="确认删除"
      :width="480"
      :busy="!!tools.state.saving || tools.mac.busy"
      :error="tools.mac.error || tools.state.error"
      @update:open="!$event && (removing = null)"
      @submit="remove"
    >
      <p class="break-words text-body-sm">确定删除「{{ removing?.title }}」？</p>
      <VCheckbox
        v-if="removing?.local && tools.mac.links[removing.id]"
        v-model="removeInMac"
        label="同时删除 Mac 提醒"
      />
      <p v-if="removing && tools.mac.links[removing.id]" class="text-body-sm text-stone">
        {{
          removeInMac
            ? '删除对应的未完成系统提醒，已完成的历史记录保留。'
            : 'Mac 提醒仍会独立提醒，可在待处理列表中继续删除。'
        }}
      </p>
    </StudyFormDialog>
    <StudyFormDialog
      :open="!!exporting"
      :title="
        exporting && !tools.macEnabled(exporting)
          ? '同步停用 Mac 提醒'
          : exporting && tools.mac.links[exporting.id]
            ? '同步更新 Mac 提醒'
            : '添加到 Mac 提醒事项'
      "
      title-id="mac-reminder-title"
      :submit-label="
        exporting && !tools.macEnabled(exporting)
          ? '确认停用'
          : exporting && tools.mac.links[exporting.id]
            ? '确认同步'
            : '确认添加'
      "
      :busy="tools.mac.busy"
      :error="tools.mac.error"
      @update:open="!$event && (exporting = null)"
      @submit="exportToMac"
    >
      <div v-if="exporting" class="rounded-2xl border border-linen bg-pure-white p-4">
        <h3 class="break-words text-body font-bold">{{ exporting.title }}</h3>
        <p class="mt-3 text-subheading tabular">{{ exporting.time }}</p>
        <p class="mt-2 text-body-sm text-stone">
          {{ exporting.weekdays.map((d) => weekdays[d - 1]!.title).join('、') }}
        </p>
      </div>
      <p v-if="exporting && !tools.macEnabled(exporting)" class="text-body-sm leading-relaxed">
        清除对应 Mac 提醒的到期时间、通知和重复规则，保留事项。重新启用后可同步恢复。
      </p>
      <p v-else class="text-body-sm leading-relaxed">
        同步标题、时间和重复日，从下次提醒时间开始。点击 Mac
        提醒中的链接可打开关联课程，回到上次学习位置；未关联课程时打开学习管理。
      </p>
      <p class="text-caption leading-relaxed text-stone">
        本地修改已保存。取消后保留待同步状态；首次同步需要允许访问提醒事项。状态按上次同步记录显示，Mac
        中的手动修改不会自动导入。
      </p>
    </StudyFormDialog>
  </main>
</template>

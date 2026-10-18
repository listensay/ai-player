<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import UiButton from './UiButton.vue'
import UiDatePicker from './UiDatePicker.vue'
import StudyFormDialog from './StudyFormDialog.vue'
import { useHomeTasks } from '~/composables/useHomeTasks'
import { sortedHomeTasks, type HomeTask, type HomeTaskKind } from '~/utils/homeTasks'
import { addDays, validDate } from '~/utils/studyProgram'

const props = defineProps<{ kind: HomeTaskKind; date: string }>()
const tasks = useHomeTasks()
const title = computed(() => (props.kind === 'goals' ? '近期目标' : 'Todo'))
const noun = computed(() => (props.kind === 'goals' ? '目标' : '待办'))
const items = computed(() => sortedHomeTasks(tasks.state.data[props.kind]))
const completed = computed(() => items.value.filter((item) => item.completedAt !== null).length)
const showCompleted = ref(false)
const visible = computed(() => items.value.filter((item) => showCompleted.value || item.completedAt === null))
const quickTitle = ref('')
const open = ref(false)
const formError = ref('')
const draft = reactive({ id: '', title: '', deadline: '' })
const busy = computed(() => !tasks.state.ready || !!tasks.state.saving)

function edit(item?: HomeTask) {
  Object.assign(draft, item ?? { id: '', title: '', deadline: props.kind === 'goals' ? addDays(props.date, 7) : '' })
  formError.value = ''
  open.value = true
}
async function quickAdd() {
  const title = quickTitle.value.trim()
  if (!title || busy.value) return
  const item: HomeTask = { id: crypto.randomUUID(), title, deadline: '', createdAt: Date.now(), completedAt: null }
  if (await tasks.mutate((data) => data.todos.push(item))) quickTitle.value = ''
}
async function save() {
  if (busy.value) return
  if (!draft.title.trim()) {
    formError.value = `请填写${noun.value}。`
    return
  }
  if ((props.kind === 'goals' || draft.deadline) && !validDate(draft.deadline)) {
    formError.value = '请选择截止日期。'
    return
  }
  const kind = props.kind
  const value = { ...draft, title: draft.title.trim() }
  if (
    await tasks.mutate((data) => {
      const existing = data[kind].find((item) => item.id === value.id)
      if (existing) Object.assign(existing, value)
      else data[kind].push({ ...value, id: crypto.randomUUID(), createdAt: Date.now(), completedAt: null })
    })
  )
    open.value = false
  else formError.value = tasks.state.error
}
function toggle(item: HomeTask, done: boolean) {
  const kind = props.kind
  return tasks.mutate((data) => {
    const found = data[kind].find((entry) => entry.id === item.id)
    if (found) found.completedAt = done ? Date.now() : null
  })
}
function remove(item: HomeTask) {
  const kind = props.kind
  return tasks.mutate((data) => {
    data[kind] = data[kind].filter((entry) => entry.id !== item.id)
  })
}
</script>

<template>
  <section class="home-task-panel pane min-w-0 rounded-3xl p-6" :aria-label="title">
    <header class="mb-5 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <h2 class="text-subheading font-bold">{{ title }}</h2>
        <span class="text-caption text-stone">{{ items.length - completed }}</span>
      </div>
      <UiButton v-if="kind === 'goals'" size="sm" variant="text" :disabled="busy" @click="edit()">
        <AppIcon name="plus" :size="16" />添加目标
      </UiButton>
    </header>
    <form
      v-if="kind === 'todos'"
      class="todo-entry mb-1 grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-3 border-b border-linen py-2 transition-colors focus-within:border-deep-indigo"
      @submit.prevent="quickAdd"
    >
      <span class="flex h-8 w-8 items-center justify-center text-stone" aria-hidden="true">
        <AppIcon name="plus" :size="18" />
      </span>
      <VTextField
        v-model="quickTitle"
        class="todo-entry-input min-w-0"
        aria-label="新待办"
        placeholder="添加待办"
        variant="plain"
        density="compact"
        bg-color="transparent"
        maxlength="240"
        hide-details
        :disabled="busy"
      />
      <UiButton
        type="submit"
        icon
        size="sm"
        title="添加待办"
        variant="dark"
        :class="{ invisible: !quickTitle.trim() }"
        :disabled="busy || !quickTitle.trim()"
      >
        <AppIcon name="check" :size="16" />
      </UiButton>
    </form>
    <p v-if="tasks.state.loading" class="py-6 text-body-sm text-stone" role="status">正在读取…</p>
    <ul v-else-if="visible.length" class="task-list scroll-soft divide-y divide-linen/60 overflow-y-auto">
      <li
        v-for="item in visible"
        :key="item.id"
        class="grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-3 py-3"
        :data-task-id="item.id"
      >
        <VCheckbox
          :model-value="item.completedAt !== null"
          :aria-label="`完成${noun}：${item.title}`"
          :disabled="busy"
          hide-details
          class="task-checkbox"
          @update:model-value="toggle(item, !!$event)"
        />
        <div class="flex min-h-8 min-w-0 flex-col justify-center text-left">
          <button
            type="button"
            class="block w-full text-left text-body-sm font-medium leading-6 [overflow-wrap:anywhere] hover:text-deep-indigo"
            :class="item.completedAt !== null ? 'text-stone line-through' : ''"
            :disabled="busy"
            :aria-label="`编辑${noun}：${item.title}`"
            @click="edit(item)"
          >
            {{ item.title }}
          </button>
          <p
            v-if="item.deadline"
            class="mt-1 text-caption"
            :class="item.completedAt === null && item.deadline < date ? 'text-error' : 'text-stone'"
          >
            {{ item.deadline }}<span v-if="item.completedAt === null && item.deadline < date"> · 已逾期</span
            ><span v-else-if="item.completedAt === null && item.deadline === date"> · 今天截止</span>
          </p>
        </div>
        <UiButton
          icon
          size="sm"
          variant="text"
          :title="`删除${noun}：${item.title}`"
          :disabled="busy"
          @click="remove(item)"
          ><AppIcon name="trash" :size="15"
        /></UiButton>
      </li>
    </ul>
    <p v-else class="py-6 text-body-sm text-stone">{{ completed ? '全部完成' : `暂无${noun}` }}</p>
    <UiButton
      v-if="completed"
      class="mt-3"
      size="sm"
      variant="text"
      :aria-expanded="showCompleted"
      @click="showCompleted = !showCompleted"
      >{{ showCompleted ? '收起已完成' : `已完成 ${completed}` }}</UiButton
    >
    <StudyFormDialog
      v-model:open="open"
      :title="`${draft.id ? '编辑' : '添加'}${noun}`"
      :title-id="`home-${kind}-title`"
      submit-label="保存"
      :busy="!!tasks.state.saving"
      :error="formError"
      :width="460"
      @submit="save"
    >
      <VTextField v-model="draft.title" :label="noun" maxlength="240" autofocus />
      <UiDatePicker v-model="draft.deadline" :label="kind === 'goals' ? '截止日期' : '截止日期（选填）'" />
      <UiButton v-if="kind === 'todos' && draft.deadline" size="sm" variant="text" @click="draft.deadline = ''"
        >清除日期</UiButton
      >
    </StudyFormDialog>
  </section>
</template>

<style scoped>
.todo-entry-input :deep(.v-field) {
  padding: 0;
  background: transparent;
}
.todo-entry-input :deep(.v-field__input) {
  min-height: 36px;
  padding: 0;
  line-height: 24px;
}
.todo-entry-input :deep(input:focus-visible) {
  outline: none;
}
.todo-entry-input :deep(input::placeholder) {
  color: var(--color-stone);
  opacity: 1;
}
.task-checkbox :deep(.v-selection-control) {
  --v-selection-control-size: 32px;
}
.task-list {
  max-height: 320px;
}
</style>

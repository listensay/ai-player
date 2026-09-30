<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed, ref } from 'vue'
import { useNoteSession } from '~/composables/useNoteSession'
import { createNoteImages } from '~/utils/noteImages'
import { dbFetchNote, dbSaveNote } from '~/utils/dbClient'
import { readTextFile, writeTextFile } from '~/utils/fs'
import { formatTime, timestampToken, timestampSlug, formatRelative } from '~/utils/time'
import UiButton from '~/components/UiButton.vue'
/**
 * 笔记编辑器：Milkdown Crepe（所见即所得 Markdown）
 *  - 笔记文件与视频同目录同名：01-环境.mp4 -> 01-环境.md
 *  - 截图存到 01-环境.assets/12-35.png，笔记里写相对路径，Obsidian 等工具也能直接看
 *  - 改动后 800ms 自动保存；切换课时 / 关闭页面前会立即写盘
 *
 * 组件按视频路径 key 化，切换课时时整个重建，避免防抖保存写错文件。
 */
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { insert } from '@milkdown/kit/utils'
import { Selection, TextSelection } from '@milkdown/kit/prose/state'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import '~/styles/editor.css'
import { createTimestampAnchorPlugin, syncPlayhead } from '~/milkdown/timestampAnchor'
import { imageTitleFallback } from '~/milkdown/imageTitleFallback'
import type { VideoEntry } from '~/types/course'

const props = defineProps<{
  video: VideoEntry
  courseId: string
}>()

const emit = defineEmits<{
  seek: [seconds: number]
}>()

const rootEl = ref<HTMLElement>()
const editorReady = ref(false)
const editorError = ref('')
// Capture the target once: late I/O must never use the next lesson's props.
const target = { courseId: props.courseId, video: props.video }
const session = useNoteSession({
  read: () => dbFetchNote(target.courseId, target.video.path),
  readCopy: () => readTextFile(target.video.parent, `${target.video.title}.md`),
  write: (content) => dbSaveNote(target.courseId, target.video.path, content),
  writeCopy: (content) => writeTextFile(target.video.parent, `${target.video.title}.md`, content),
})
const status = computed(() =>
  session.state.error || editorError.value
    ? 'error'
    : !editorReady.value
      ? 'loading'
      : session.state.saving
        ? 'saving'
        : session.state.dirty
          ? 'dirty'
          : session.state.savedAt === null
            ? 'new'
            : 'saved',
)

const noteFileName = computed(() => `${props.video.title}.md`)

let crepe: Crepe | null = null
let destroyed = false
let initializing: Promise<void> | undefined
const images = createNoteImages({ courseId: target.courseId, ...target.video })
const saveImage = images.save
const resolveImageSrc = images.resolve

const statusText = computed(() => {
  switch (status.value) {
    case 'loading':
      return '读取笔记…'
    case 'new':
      return '笔记自动保存'
    case 'dirty':
      return '修改尚未保存'
    case 'saving':
      return '保存中…'
    case 'saved':
      return session.state.savedAt ? `已保存 ${formatRelative(session.state.savedAt)}` : '已保存'
    case 'error':
      return session.state.error || editorError.value
    default:
      return ''
  }
})

/** remark 会把行内的 "[" 转义成 "\["；时间戳不可能是链接引用，还原成裸的 [12:35]，保持 .md 文件干净 */
const ESCAPED_TIMESTAMP_RE = /\\\[(?=(?:\d{1,3}:)?\d{1,2}:\d{2}\])/g

function serialize(instance: Crepe): string {
  return instance.getMarkdown().replace(ESCAPED_TIMESTAMP_RE, '[')
}

async function save(): Promise<void> {
  await session.save()
}

/* ---------- 编辑器 ---------- */

/** 在光标处插入时间戳；编辑器没有焦点时追加到文末 */
function insertTimestamp(seconds: number) {
  insertInline(`${timestampToken(seconds)} `)
}

/** 在光标处插入一段行内文本；编辑器没有焦点时追加为文末新段落（逐字稿"引用"也走这里） */
function insertInline(token: string) {
  if (!crepe || destroyed) return
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    let tr = state.tr

    if (view.hasFocus()) {
      tr = tr.insertText(token)
    } else {
      const doc = state.doc
      const last = doc.lastChild
      if (last && last.type.name === 'paragraph' && last.content.size === 0) {
        const pos = doc.content.size - 1
        tr = tr.insertText(token, pos)
        tr = tr.setSelection(TextSelection.create(tr.doc, pos + token.length))
      } else {
        const paragraph = state.schema.nodes.paragraph!.create(null, state.schema.text(token))
        tr = tr.insert(doc.content.size, paragraph)
        tr = tr.setSelection(Selection.atEnd(tr.doc))
      }
    }
    view.dispatch(tr.scrollIntoView())
    view.focus()
  })
}

/** 截图入笔记：时间戳 + 图片块（Milkdown 的图片块约定：alt 存宽高比，title 存图片说明） */
async function insertScreenshot(blob: Blob, seconds: number, ratio = 16 / 9) {
  if (!crepe || destroyed) throw new Error('课节已切换，请重新截图。')
  const relative = await saveImage(blob, timestampSlug(seconds))
  if (!crepe || destroyed) throw new Error('课节已切换，请重新截图。')
  const caption = `${props.video.title} ${formatTime(seconds, true)}`.replace(/"/g, '”')
  const markdown = `${timestampToken(seconds)} 截图\n\n![${ratio.toFixed(2)}](${relative} "${caption}")\n\n`
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (!view.hasFocus()) {
      view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
    }
    insert(markdown)(ctx)
    view.focus()
  })
}

/** 播放器把当前时间同步进来，用于高亮所在片段的锚点 */
function setPlayhead(seconds: number) {
  if (!crepe || destroyed) return
  crepe.editor.action((ctx) => syncPlayhead(ctx.get(editorViewCtx), seconds))
}

function focus() {
  crepe?.editor.action((ctx) => ctx.get(editorViewCtx).focus())
}

function initialize(): Promise<void> {
  if (editorReady.value || destroyed) return Promise.resolve()
  if (initializing) return initializing
  editorError.value = ''
  initializing = createEditor()
    .catch((error) => {
      editorError.value = (error as Error).message || '编辑器初始化失败，请重试。'
      throw error
    })
    .finally(() => {
      initializing = undefined
    })
  return initializing
}
async function createEditor() {
  await session.load()
  if (destroyed || !rootEl.value) return
  if (crepe) await crepe.destroy()
  crepe = new Crepe({
    root: rootEl.value,
    defaultValue: session.state.content,
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: '记录笔记…',
        mode: 'doc',
      },
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: resolveImageSrc,
        onUpload: (file) => saveImage(file, `image-${Date.now()}`, file.type === 'image/jpeg' ? 'jpg' : 'png'),
        blockUploadButton: '上传图片',
        blockUploadPlaceholderText: '粘贴图片链接，或',
        blockCaptionPlaceholderText: '图片说明',
        blockConfirmButton: '确定',
        inlineUploadButton: '上传',
        inlineUploadPlaceholderText: '图片链接',
        inlineConfirmButton: '确定',
      },
      [Crepe.Feature.LinkTooltip]: {
        inputPlaceholder: '粘贴链接…',
        editButton: '编辑',
        removeButton: '移除',
        confirmButton: '确定',
      },
      [Crepe.Feature.Toolbar]: {
        boldLabel: '加粗',
        italicLabel: '斜体',
        strikethroughLabel: '删除线',
        codeLabel: '行内代码',
        linkLabel: '链接',
        latexLabel: '公式',
      },
      [Crepe.Feature.CodeMirror]: {
        searchPlaceholder: '搜索语言',
        noResultText: '无匹配结果',
        copyText: '复制',
        previewLabel: '预览',
      },
      [Crepe.Feature.BlockEdit]: {
        textGroup: {
          label: '文本',
          text: { label: '正文' },
          h1: { label: '一级标题' },
          h2: { label: '二级标题' },
          h3: { label: '三级标题' },
          h4: { label: '四级标题' },
          h5: { label: '五级标题' },
          h6: { label: '六级标题' },
          quote: { label: '引用' },
          divider: { label: '分割线' },
        },
        listGroup: {
          label: '列表',
          bulletList: { label: '无序列表' },
          orderedList: { label: '有序列表' },
          taskList: { label: '任务列表' },
        },
        advancedGroup: {
          label: '插入',
          image: { label: '图片' },
          codeBlock: { label: '代码块' },
          table: { label: '表格' },
          math: { label: '数学公式' },
        },
      },
    },
  })

  crepe.editor.use(imageTitleFallback)
  crepe.editor.use(createTimestampAnchorPlugin({ onSeek: (s) => emit('seek', s) }))

  crepe.on((listener) => {
    listener.updated((_ctx, doc, previous) => {
      if (!editorReady.value || !crepe || (previous && doc.eq(previous))) return
      const instance = crepe
      session.editFrom(() => serialize(instance))
    })
  })

  const instance = crepe
  await instance.create()
  if (destroyed) {
    await instance.destroy()
    return
  }
  session.acceptEditorContent(serialize(instance))
  editorReady.value = true
}
onMounted(() => {
  void initialize().catch(() => {})
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (session.state.dirty) {
    void save().catch(() => {})
    e.preventDefault()
  }
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  session.dispose()
  destroyed = true
  const instance = crepe
  crepe = null
  // If create is pending, createEditor will destroy the completed instance.
  if (editorReady.value) void instance?.destroy()
  images.dispose()
})
function retry() {
  if (!editorReady.value) void initialize().catch(() => {})
  else void save().catch(() => {})
}
defineExpose({
  whenReady: initialize,
  hasUnsavedChanges: () => session.state.dirty,
  insertTimestamp,
  insertInline,
  insertScreenshot,
  setPlayhead,
  save,
  focus,
  getMarkdown: () => (crepe && editorReady.value && !destroyed ? session.readContent() : undefined),
})
</script>

<template>
  <section class="pane flex min-h-0 flex-col" aria-label="笔记">
    <header class="flex items-center gap-3 border-b border-linen px-4 py-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-subheading font-bold">笔记</h2>
        <p
          class="truncate text-caption"
          :class="status === 'error' ? 'text-error' : status === 'dirty' ? 'text-graphite' : 'text-stone'"
          :title="noteFileName"
        >
          {{ statusText }}
        </p>
      </div>
      <UiButton v-if="status === 'error' || session.state.copyError" size="sm" variant="ghost" @click="retry"
        >重试</UiButton
      >
      <div class="flex items-center gap-2" :inert="!editorReady"><slot name="actions" /></div>
    </header>

    <p v-if="session.state.copyError" role="status" class="px-4 py-2 text-caption text-stone">
      {{ session.state.copyError }}
    </p>
    <p v-if="!editorReady" :role="status === 'error' ? 'alert' : 'status'" class="px-4 py-6 text-body-sm">
      {{ status === 'error' ? '读取成功前暂停编辑，原有笔记不会被覆盖。' : '正在准备笔记…' }}
    </p>
    <div v-show="editorReady" ref="rootEl" class="scroll-soft note-editor min-h-0 flex-1 overflow-y-auto" />
  </section>
</template>

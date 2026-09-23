<script setup lang="ts">
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
  askGuide: [question: string]
  recordQuestion: [question: string]
}>()

type SaveStatus = 'loading' | 'new' | 'saved' | 'dirty' | 'saving' | 'error'

const rootEl = ref<HTMLElement>()
const status = ref<SaveStatus>('loading')
const savedAt = ref<number | null>(null)
const errorMessage = ref('')
const hasFocus = ref(false)
const detectedQuestion = ref('')

/** 仅将用户选中的文字（或最近的疑问段落）带入导学输入框，由用户提交。 */
function askGuide(recordOnly = false) {
  if (!crepe || destroyed) return
  detectQuestion(serialize(crepe))
  let selected = ''
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    selected = view.state.doc.textBetween(from, to, '\n').trim()
  })
  const question = (selected || detectedQuestion.value).slice(0, 3000)
  if (recordOnly) emit('recordQuestion', question)
  else emit('askGuide', question)
}

function detectQuestion(markdown: string) {
  // 不把代码块里的问号当作学习疑问，也不自动发送笔记内容。
  detectedQuestion.value = markdown.replace(/```[\s\S]*?```/g, '').split('\n')
    .filter(line => /[?？]|疑问|不理解|没听懂/.test(line)).at(-1)?.replace(/^\s*(?:[>#*-]|\d+\.)\s*/, '').trim().slice(0, 3000) ?? ''
}

const noteFileName = computed(() => `${props.video.title}.md`)
const assetsDirName = computed(() => `${props.video.title}.assets`)

let crepe: Crepe | null = null
let destroyed = false
let version = 0
let savedVersion = 0
/** 最后一次写盘（或打开时）的序列化结果，内容没变就不重复写文件；编辑器创建完成前为 null */
let lastSavedMarkdown: string | null = null
/** 编辑器刚创建时插件会做一些规范化事务（比如补尾段落），这段时间内的更新不算用户改动 */
let settledAt = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null
const blobUrls = new Map<string, string>()

const statusText = computed(() => {
  switch (status.value) {
    case 'loading':
      return '读取笔记…'
    case 'new':
      return '新笔记，开始输入后会自动保存'
    case 'dirty':
      return '有未保存的修改'
    case 'saving':
      return '保存中…'
    case 'saved':
      return savedAt.value ? `已保存 ${formatRelative(savedAt.value)}` : '已保存'
    case 'error':
      return `保存失败：${errorMessage.value}`
    default:
      return ''
  }
})

/* ---------- 数据库与文件读写 ---------- */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('无法将图片转为 Base64'))
      }
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function resolveImageSrc(src: string): Promise<string> {
  if (!src || isAbsoluteUrl(src)) return src
  let decoded = src
  try {
    decoded = decodeURI(src)
  } catch {
    /* 保留原样 */
  }
  const cached = blobUrls.get(decoded)
  if (cached) return cached

  // 1. 尝试从 SQLite 中读取 Base64 图片
  try {
    const imgName = decoded.split('/').pop()
    if (imgName) {
      const images = await dbFetchNoteImages(props.courseId, props.video.path)
      const found = images.find((img) => img.name === imgName || img.name === decoded)
      if (found?.data_base64) {
        blobUrls.set(decoded, found.data_base64)
        return found.data_base64
      }
    }
  } catch {
    /* 忽略错误 */
  }

  // 2. 本地文件系统回退
  try {
    const file = await resolveRelativeFile(props.video.parent, decoded)
    if (file) {
      const url = URL.createObjectURL(file)
      blobUrls.set(decoded, url)
      return url
    }
  } catch {
    /* 忽略错误 */
  }

  return src
}

/** 把图片存入 SQLite 数据库（Base64），同时可选写入本地磁盘 xxx.assets/ */
async function saveImage(blob: Blob, baseName: string, ext = 'png'): Promise<string> {
  const name = `${baseName}.${ext}`
  const base64 = await blobToBase64(blob)

  // 存入 SQLite 数据库
  await dbSaveNoteImage({
    courseId: props.courseId,
    videoPath: props.video.path,
    name,
    dataBase64: base64,
  })

  // 可选：如果能拿到本地句柄，同步写入本地目录，便于外部工具查看
  try {
    const dir = await props.video.parent.getDirectoryHandle(assetsDirName.value, { create: true })
    await writeBlobFile(dir, name, blob)
  } catch {
    /* 忽略文件系统错误 */
  }

  const relative = `${assetsDirName.value}/${name}`
  blobUrls.set(relative, base64)
  return base64
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 800)
}

/** remark 会把行内的 "[" 转义成 "\["；时间戳不可能是链接引用，还原成裸的 [12:35]，保持 .md 文件干净 */
const ESCAPED_TIMESTAMP_RE = /\\\[(?=(?:\d{1,3}:)?\d{1,2}:\d{2}\])/g

function serialize(instance: Crepe): string {
  return instance.getMarkdown().replace(ESCAPED_TIMESTAMP_RE, '[')
}

async function save(): Promise<void> {
  if (!crepe || destroyed) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (inflight) {
    await inflight
    if (version === savedVersion) return
  }
  const snapshotVersion = version
  const markdown = serialize(crepe)
  // 只是插件的规范化事务、序列化结果没变：不碰用户的文件
  if (markdown === lastSavedMarkdown) {
    savedVersion = snapshotVersion
    if (status.value === 'dirty' || status.value === 'saving') status.value = savedAt.value ? 'saved' : 'new'
    return
  }
  status.value = 'saving'
  inflight = (async () => {
    try {
      // 存入 SQLite 数据库
      await dbSaveNote(props.courseId, props.video.path, markdown)
      try {
        await writeTextFile(props.video.parent, noteFileName.value, markdown)
      } catch {
        /* 忽略本地文件系统错误 */
      }
      savedVersion = snapshotVersion
      lastSavedMarkdown = markdown
      savedAt.value = Date.now()
      status.value = version === snapshotVersion ? 'saved' : 'dirty'
    } catch (err) {
      errorMessage.value = (err as Error).message
      status.value = 'error'
      console.error('保存笔记失败', err)
    } finally {
      inflight = null
    }
  })()
  await inflight
}

/* ---------- 编辑器 ---------- */

/** 在光标处插入时间戳；编辑器没有焦点时追加到文末 */
function insertTimestamp(seconds: number) {
  if (!crepe || destroyed) return
  const token = `${timestampToken(seconds)} `
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
  if (!crepe || destroyed) return
  const relative = await saveImage(blob, timestampSlug(seconds))
  if (!crepe || destroyed) return
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

onMounted(async () => {
  let existing: string | null = null
  try {
    const noteRes = await dbFetchNote(props.courseId, props.video.path)
    if (noteRes && noteRes.content) {
      existing = noteRes.content
    } else {
      existing = await readTextFile(props.video.parent, noteFileName.value)
      if (existing) {
        void dbSaveNote(props.courseId, props.video.path, existing)
      }
    }
  } catch (err) {
    errorMessage.value = (err as Error).message
    status.value = 'error'
  }
  if (destroyed || !rootEl.value) return

  crepe = new Crepe({
    root: rootEl.value,
    defaultValue: existing ?? '',
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: '在这里记笔记。按 ⌥T 插入当前时间点，⌥S 截取当前画面，输入 / 唤起插入菜单。',
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
        noResultText: '没有找到',
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
    listener.updated(() => {
      // 创建后 600ms 内的更新是插件的规范化事务（补尾段落等），不算用户改动
      if (!settledAt || (Date.now() < settledAt && !hasFocus.value)) return
      version += 1
      status.value = 'dirty'
      scheduleSave()
      if (crepe) detectQuestion(serialize(crepe))
    })
    listener.focus(() => (hasFocus.value = true))
    listener.blur(() => (hasFocus.value = false))
  })

  try {
    await crepe.create()
    lastSavedMarkdown = serialize(crepe)
    detectQuestion(lastSavedMarkdown)
    settledAt = Date.now() + 600
    if (status.value !== 'error') status.value = existing === null ? 'new' : 'saved'
  } catch (err) {
    console.error('编辑器初始化失败', err)
    errorMessage.value = (err as Error).message
    status.value = 'error'
  }
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!crepe || lastSavedMarkdown === null) return
  if (serialize(crepe) !== lastSavedMarkdown) {
    void save()
    e.preventDefault()
  }
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  destroyed = true
  const instance = crepe
  crepe = null
  if (saveTimer) clearTimeout(saveTimer)
  if (instance && lastSavedMarkdown !== null) {
    // 卸载前把最后的内容存入 SQLite 数据库（内容没变则跳过）
    const markdown = serialize(instance)
    if (markdown !== lastSavedMarkdown) {
      void dbSaveNote(props.courseId, props.video.path, markdown)
      void writeTextFile(props.video.parent, noteFileName.value, markdown).catch((err) =>
        console.error('保存笔记失败', err),
      )
    }
  }
  void instance?.destroy()
  for (const url of blobUrls.values()) URL.revokeObjectURL(url)
  blobUrls.clear()
})

defineExpose({ insertTimestamp, insertScreenshot, setPlayhead, save, focus, getMarkdown: () => crepe && !destroyed ? serialize(crepe) : undefined })
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
      <slot name="actions" />
    </header>

    <div ref="rootEl" class="scroll-soft note-editor min-h-0 flex-1 overflow-y-auto" />
    <footer class="flex shrink-0 items-center gap-3 border-t border-linen px-4 py-3">
      <p class="min-w-0 flex-1 truncate text-caption text-stone" :title="detectedQuestion">{{ detectedQuestion || '选中笔记里的疑问，找回缺失的基础知识' }}</p>
      <UiButton variant="text" size="sm" title="记录选中文字或最近的疑问及当前时间" :disabled="status === 'loading'" @click="askGuide(true)">记下疑问</UiButton>
      <UiButton variant="ghost" size="sm" title="将选中文字或最近的疑问带入导学" :disabled="status === 'loading'" @click="askGuide(false)"><AppIcon name="sparkles" :size="15" />找基础</UiButton>
    </footer>
  </section>
</template>

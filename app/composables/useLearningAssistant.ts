import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import type { Course, VideoEntry } from '~/types/course'
import type { GuideSettings, GuideMessage } from '~/types/guide'
import type { NoteEditorHandle, NoteSelection } from '~/types/note'
import type {
  AssistantMode,
  AssistantTurn,
  LearningContext,
  LearningMapNode,
  GeneratedFlashcard,
  FeynmanQuestion,
  FeynmanFeedback,
  FrameExtraction,
  VideoHighlight,
  AssistantAnswer,
} from '~/types/learningAssistant'
import type { usePlayer } from './usePlayer'
import type { useTranscripts } from './useTranscripts'
import type { useLessonKnowledge } from './useLessonKnowledge'
import type { provideLearningManagement } from './useLearningManagement'
import { requestGuideJson } from '~/utils/guideAi'
import {
  learningContext,
  learningPrompt,
  parseAssistantAnswer,
  parseLearningMap,
  parseFlashcards,
  parseFeynmanQuestion,
  parseFeynmanFeedback,
  parseHighlights,
  parseExtraction,
  generatedReviewCards,
  mapMermaid,
  transitionEnd,
} from '~/utils/learningAssistant'
import { localDayKey } from '~/utils/learningFeedback'
import { timestampToken } from '~/utils/time'

export function useLearningAssistant(options: {
  course: Ref<Course | null>
  video: Ref<VideoEntry | null>
  active: Ref<boolean>
  settings: GuideSettings
  configured: Ref<boolean>
  player: ReturnType<typeof usePlayer>
  transcripts: ReturnType<typeof useTranscripts>
  knowledge: ReturnType<typeof useLessonKnowledge>
  learning: ReturnType<typeof provideLearningManagement>
  noteEditor: Ref<NoteEditorHandle | null>
  readyNote: (key: string) => Promise<NoteEditorHandle>
  reveal: () => void
  notify: (text: string) => void
}) {
  const key = computed(() =>
    options.course.value && options.video.value
      ? JSON.stringify([options.course.value.id, options.video.value.path])
      : '',
  )
  const mode = ref<AssistantMode>('ask'),
    anchor = ref(0),
    busy = ref(''),
    error = ref(''),
    notice = ref('')
  const question = ref(''),
    turns = ref<AssistantTurn[]>([]),
    includeNote = ref(false)
  const noteInput = ref(''),
    noteResult = shallowRef<AssistantAnswer | null>(null),
    selection = shallowRef<NoteSelection | null>(null)
  const graph = ref<LearningMapNode[]>([]),
    cards = ref<GeneratedFlashcard[]>([]),
    cardContext = shallowRef<LearningContext | null>(null)
  const feynman = reactive({
    role: 'novice' as 'novice' | 'interviewer',
    question: null as FeynmanQuestion | null,
    answer: '',
    feedback: null as FeynmanFeedback | null,
    rounds: [] as Array<{ question: string; answer: string; feedback: FeynmanFeedback }>,
  })
  const imageUrl = ref(''),
    imageData = ref(''),
    imageSeconds = ref(0),
    imageConsent = ref(false),
    extraction = shallowRef<FrameExtraction | null>(null)
  const highlights = ref<VideoHighlight[]>([]),
    skipTransitions = ref(false),
    lastSkip = ref<number | null>(null)
  const contextPreview = shallowRef<LearningContext | null>(null)
  let inserting = false
  let controller: AbortController | undefined,
    taskId = 0,
    frameId = 0
  let noteContext: LearningContext | null = null,
    feynmanContext: LearningContext | null = null
  function cancel() {
    taskId++
    controller?.abort()
    controller = undefined
    busy.value = ''
  }
  function clearFrame() {
    frameId++
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
    imageUrl.value = ''
    imageData.value = ''
    imageConsent.value = false
    extraction.value = null
  }
  function reset() {
    cancel()
    clearFrame()
    turns.value = []
    graph.value = []
    cards.value = []
    cardContext.value = null
    highlights.value = []
    skipTransitions.value = false
    lastSkip.value = null
    question.value = ''
    noteInput.value = ''
    noteResult.value = null
    selection.value = null
    noteContext = null
    feynmanContext = null
    feynman.question = null
    feynman.answer = ''
    feynman.feedback = null
    feynman.rounds = []
    includeNote.value = false
    contextPreview.value = null
    error.value = ''
    notice.value = ''
  }
  watch(key, reset, { flush: 'sync' })
  watch(
    options.active,
    (active) => {
      if (!active) {
        cancel()
        skipTransitions.value = false
      }
    },
    { flush: 'sync' },
  )
  watch(
    () => [options.settings.provider, options.settings.baseUrl, options.settings.model, options.settings.apiKey],
    () => {
      cancel()
      imageConsent.value = false
    },
    { flush: 'sync' },
  )
  function context(whole = false, seconds = anchor.value) {
    const course = options.course.value,
      video = options.video.value
    if (!course || !video) throw Error('请先打开一个课节。')
    const result = learningContext({
      courseId: course.id,
      path: video.path,
      title: video.title,
      seconds,
      duration: options.player.state.duration,
      segments: options.transcripts.get(course.id, video.path).segments,
      points: options.knowledge.get(course.id, video.path).summary?.points ?? [],
      note:
        mode.value === 'notes'
          ? noteInput.value
          : includeNote.value && !['vision', 'highlights'].includes(mode.value)
            ? options.noteEditor.value?.getMarkdown()
            : '',
      whole,
    })
    contextPreview.value = result
    return result
  }
  function open(target: AssistantMode = 'ask') {
    if (!key.value || !options.active.value) {
      options.notify('请先在播放器打开课节。')
      return
    }
    if (busy.value === '正在加入复习队列') {
      options.notify('正在保存闪卡，请稍候。')
      return
    }
    if (busy.value) cancel()
    error.value = ''
    notice.value = ''
    options.player.pause()
    anchor.value = options.player.state.currentTime
    mode.value = target
    if (target === 'notes') {
      selection.value = options.noteEditor.value?.getSelection() ?? null
      noteInput.value = selection.value?.text ?? ''
      noteResult.value = null
    }
    contextPreview.value = context(['map', 'cards', 'feynman', 'highlights'].includes(target))
    options.reveal()
  }
  watch([includeNote, noteInput], () => {
    if (!key.value || !options.active.value) return
    const preview = context(['map', 'cards', 'feynman', 'highlights'].includes(mode.value))
    if (mode.value === 'notes') preview.note = noteInput.value.slice(0, 12000)
    contextPreview.value = preview
  })
  function refreshAnchor() {
    anchor.value = options.player.state.currentTime
    contextPreview.value = context()
  }
  async function run<T>(
    label: string,
    ctx: LearningContext,
    instruction: string,
    parse: (raw: unknown) => T,
    apply: (result: T) => void,
    images?: GuideMessage['images'],
  ) {
    if (busy.value) return
    error.value = ''
    notice.value = ''
    if (!options.configured.value) {
      error.value = '请先在 AI 设置中配置服务和模型。'
      return
    }
    if (!ctx.evidence.length && !ctx.note.trim() && !images?.length) {
      error.value = '当前没有可用的字幕或知识点。请先转写字幕；笔记功能也可以粘贴需要整理的文字。'
      return
    }
    const expected = key.value,
      token = ++taskId
    controller = new AbortController()
    busy.value = label
    contextPreview.value = ctx
    const messages = learningPrompt(ctx, instruction)
    if (images) messages[0]!.images = images
    try {
      const raw = await requestGuideJson({ ...options.settings }, messages, controller.signal, {
        imagePurpose: 'learning',
      })
      if (token !== taskId || expected !== key.value || !options.active.value) return
      apply(parse(raw))
      notice.value = ctx.truncated
        ? '材料较长，本次仅处理预览中的内容，未覆盖完整课程。'
        : '已生成。请核对来源，重要内容可加入笔记或复习队列。'
    } catch (reason) {
      if (token === taskId && expected === key.value) error.value = (reason as Error).message
    } finally {
      if (token === taskId) {
        busy.value = ''
        controller = undefined
      }
    }
  }
  async function ask(preset?: string) {
    const input = (preset ?? question.value).trim()
    if (!input || input.length > 4000) {
      error.value = '请输入 1–4000 字的问题。'
      return
    }
    const ctx = context()
    const history = turns.value.slice(-4).map((t) => ({ question: t.question, answer: t.markdown }))
    await run(
      '正在回答',
      ctx,
      `回答用户问题，不将历史回答当作证据。返回 {"markdown":"Markdown 回答", "sources":["来源 id"]}。问题：${JSON.stringify(input)}；会话历史：${JSON.stringify(history)}`,
      (raw) => parseAssistantAnswer(raw, ctx),
      (answer) => {
        turns.value = [...turns.value.slice(-19), { ...answer, question: input, seconds: ctx.seconds }]
        question.value = ''
      },
    )
  }
  async function improveNote(action: string) {
    const ctx = context()
    ctx.note = noteInput.value.trim().slice(0, 12000)
    await run(
      '正在整理笔记',
      ctx,
      `对用户主动提供的 note 执行 ${action}；若 note 为空，整理当前字幕。保留技术准确性，补充内容标明“补充说明”。返回 {"markdown":"结构化 Markdown", "sources":["来源 id"]}。`,
      (raw) => parseAssistantAnswer(raw, ctx),
      (result) => {
        noteContext = ctx
        noteResult.value = result
      },
    )
  }
  async function insertNote(markdown: string, seconds = anchor.value, replace = false) {
    if (inserting) return
    inserting = true
    const expected = key.value
    error.value = ''
    try {
      const editor = await options.readyNote(expected)
      if (key.value !== expected) throw Error('课节已切换，请重新操作。')
      if (replace) {
        if (!selection.value) throw Error('没有可替换的选区，请重新选择笔记文字。')
        editor.replaceSelection(selection.value, markdown)
        selection.value = null
      } else editor.insertMarkdown(`\n${timestampToken(seconds)}\n\n${markdown}\n`)
      await editor.save()
      if (editor.hasUnsavedChanges()) throw Error('内容已插入，但保存未完成，请在笔记中重试保存。')
      options.notify('已写入当前课节笔记')
    } catch (reason) {
      error.value = (reason as Error).message
      options.notify(error.value)
    } finally {
      inserting = false
    }
  }
  const saveNoteResult = (replace = false) =>
    noteResult.value && insertNote(noteResult.value.markdown, noteContext?.seconds ?? anchor.value, replace)
  async function generateMap() {
    const ctx = context(true)
    await run(
      '正在生成知识脑图',
      ctx,
      '返回 {"nodes":[{"id":"唯一节点 id","parent":null或父节点id,"label":"概念名称","sources":["来源 id"]}]}。生成不超过30个节点的知识层级树，恰好一个根，禁止循环；每个节点至少一个证据。',
      (raw) => parseLearningMap(raw, ctx),
      (result) => {
        graph.value = result
      },
    )
  }
  async function generateCards() {
    const ctx = context(true)
    await run(
      '正在提炼记忆卡片',
      ctx,
      '返回 {"cards":[{"front":"一个可主动回忆的问题","back":"简洁准确的答案","sources":["来源 id"]}]}。生成3–5张不重复的卡片，优先核心原理与边界条件，每张至少一个证据。',
      (raw) => parseFlashcards(raw, ctx),
      (result) => {
        cards.value = result
        cardContext.value = ctx
      },
    )
  }
  async function addCards() {
    if (!cardContext.value || !cards.value.length || busy.value) return
    if (cards.value.some((c) => !c.front.trim() || !c.back.trim())) {
      error.value = '卡片正反面不能为空。'
      return
    }
    const expected = key.value,
      token = ++taskId
    busy.value = '正在加入复习队列'
    error.value = ''
    const batch = generatedReviewCards(cards.value, cardContext.value, localDayKey(), Date.now())
    try {
      await options.learning.load()
      const saved = await options.learning.mutate((data) => {
        for (const card of batch)
          if (
            !data.cards.some(
              (old) =>
                old.courseId === card.courseId &&
                old.path === card.path &&
                old.front.trim().toLowerCase() === card.front.trim().toLowerCase(),
            )
          )
            data.cards.push(card)
      })
      if (key.value !== expected || token !== taskId) return
      if (!saved) throw Error(options.learning.state.error || '复习队列保存失败，请重试。')
      notice.value = '卡片已加入抗遗忘复习队列；重复问题不会重复添加。'
    } catch (reason) {
      if (key.value === expected && token === taskId) error.value = (reason as Error).message
    } finally {
      if (key.value === expected && token === taskId) busy.value = ''
    }
  }
  async function startFeynman() {
    const ctx = context(true)
    await run(
      '正在准备对练',
      ctx,
      `扮演${feynman.role === 'novice' ? '小白新手，用朴素问题检验用户能否讲明白' : '技术面试官，检验原理和边界条件'}。只提一个问题，不泄露答案。返回 {"question":"问题", "sources":["来源 id"]}。`,
      (raw) => parseFeynmanQuestion(raw, ctx),
      (result) => {
        feynmanContext = ctx
        feynman.question = result
        feynman.answer = ''
        feynman.feedback = null
        feynman.rounds = []
      },
    )
  }
  async function evaluateFeynman() {
    if (!feynman.question || !feynmanContext || !feynman.answer.trim()) return
    const ctx = feynmanContext,
      question = feynman.question.question,
      answer = feynman.answer.trim().slice(0, 8000)
    await run(
      '正在检查你的解释',
      ctx,
      `根据概念准确性、因果解释、边界条件与举例能力评价用户解释，不能仅因与参考措辞不同而扣分；评分仅为学习参考。返回 {"markdown":"逐项反馈", "sources":["来源 id"],"score":0到100,"gaps":["知识盲区"],"followUp":"一个针对性追问"}。问题：${JSON.stringify(question)}；用户解释：${JSON.stringify(answer)}`,
      (raw) => parseFeynmanFeedback(raw, ctx),
      (result) => {
        feynman.feedback = result
        feynman.rounds = [...feynman.rounds.slice(-7), { question, answer, feedback: result }]
      },
    )
  }
  function followUp() {
    if (!feynman.feedback || !feynman.question) return
    feynman.question = {
      question: feynman.feedback.followUp,
      sources: feynman.feedback.sources.length ? feynman.feedback.sources : feynman.question.sources,
    }
    feynman.answer = ''
    feynman.feedback = null
  }
  async function capture() {
    if (busy.value) return
    const expected = key.value,
      token = ++frameId,
      seconds = options.player.state.currentTime
    error.value = ''
    options.player.pause()
    try {
      const frame = await options.player.captureFrame()
      if (!frame) throw Error('视频画面尚未就绪。')
      if (frame.blob.size > 8 * 1024 * 1024) throw Error('截图超过 8MB，请使用较低分辨率的视频。')
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(Error('截图读取失败。'))
        reader.readAsDataURL(frame.blob)
      })
      if (token !== frameId || expected !== key.value) return
      clearFrame()
      imageData.value = data
      imageSeconds.value = seconds
      contextPreview.value = context(false, seconds)
      imageUrl.value = URL.createObjectURL(frame.blob)
    } catch (reason) {
      if (token === frameId && expected === key.value) error.value = (reason as Error).message
    }
  }
  async function extract() {
    if (!imageData.value || !imageConsent.value) {
      error.value = '请先截取画面，并确认发送这一张截图到所选 AI 服务。'
      return
    }
    const ctx = context(false, imageSeconds.value)
    await run(
      '正在识别代码与板书',
      ctx,
      '只识别这张截图中的代码、板书和公式；看不清的部分标注不确定，禁止臆补。返回 {"markdown":"Markdown 代码块或 LaTeX 公式与说明","code":"纯代码，没有代码则空字符串","language":"小写语言名，例如 javascript/python/java","warnings":"识别不确定之处，没有则空字符串"}。',
      parseExtraction,
      (result) => {
        extraction.value = result
      },
      [{ name: '用户确认发送的课程截图.png', mediaType: 'image/png', data: imageData.value }],
    )
  }
  async function analyzeHighlights() {
    const ctx = context(true)
    if (!ctx.evidence.some((s) => s.id.startsWith('s:'))) {
      error.value = '需要带时间戳的字幕才能标记片段。'
      return
    }
    await run(
      '正在标记内容密度',
      ctx,
      '分析字幕的知识密度。返回 {"segments":[{"from":"s:首句id","to":"s:末句id","kind":"core或practice或transition","reason":"判断依据"}]}。最多100段、不重叠。core为核心讲解，practice为演示与练习，transition仅用于明确闲聊、调设备或等待，不能把有讲解的演示标为过渡。无法判断的区域不标记。',
      (raw) => parseHighlights(raw, ctx),
      (result) => {
        highlights.value = result
        skipTransitions.value = false
        lastSkip.value = null
      },
    )
  }
  watch(
    () => options.player.state.currentTime,
    (seconds) => {
      if (
        !skipTransitions.value ||
        !options.active.value ||
        !options.player.state.playing ||
        options.player.state.buffering
      )
        return
      const end = transitionEnd(highlights.value, seconds, options.player.state.duration)
      if (end !== null) {
        lastSkip.value = seconds
        options.player.seek(end)
      }
    },
  )
  function undoSkip() {
    if (lastSkip.value === null) return
    skipTransitions.value = false
    options.player.seek(lastSkip.value)
    lastSkip.value = null
  }
  onBeforeUnmount(() => {
    cancel()
    clearFrame()
  })
  return {
    mode,
    anchor,
    busy,
    error,
    notice,
    question,
    turns,
    includeNote,
    noteInput,
    noteResult,
    selection,
    graph,
    cards,
    feynman,
    imageUrl,
    imageConsent,
    imageSeconds,
    extraction,
    highlights,
    skipTransitions,
    lastSkip,
    contextPreview,
    open,
    refreshAnchor,
    ask,
    cancel,
    improveNote,
    insertNote,
    saveNoteResult,
    generateMap,
    generateCards,
    addCards,
    startFeynman,
    evaluateFeynman,
    followUp,
    capture,
    clearFrame,
    extract,
    analyzeHighlights,
    undoSkip,
    mermaid: computed(() => mapMermaid(graph.value)),
  }
}

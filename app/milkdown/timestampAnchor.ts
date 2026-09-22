/**
 * 时间戳锚点插件（ProseMirror）
 *
 * 笔记里形如 [12:35] / [1:02:03] 的纯文本会被渲染成可点击的药丸锚点：
 *  - 点击锚点 -> 触发 onSeek(seconds)，驱动播放器跳转
 *  - 播放器每秒把当前时间写进插件状态，播放头所在片段的锚点会高亮（黄色 = 此刻）
 *
 * 只用装饰（Decoration），不改动文档结构，所以 .md 文件里保存的仍是普通文本，
 * 用 Obsidian 等其他工具打开也不会有奇怪的语法。
 */
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TIMESTAMP_RE, parseTimestamp } from '~/utils/time'

interface AnchorSpec {
  from: number
  to: number
  seconds: number
  label: string
}

interface AnchorState {
  anchors: AnchorSpec[]
  currentTime: number
  /** 当前高亮的锚点秒数（播放头所在片段的起点） */
  active: number | null
  decorations: DecorationSet
}

interface AnchorMeta {
  currentTime?: number
}

export const timestampAnchorKey = new PluginKey<AnchorState>('AI_PLAYER_TIMESTAMP_ANCHOR')

function isCodeNode(node: ProseNode): boolean {
  return node.type.spec.code === true || node.type.name === 'code_block'
}

function collectAnchors(doc: ProseNode): AnchorSpec[] {
  const anchors: AnchorSpec[] = []
  doc.descendants((node, pos) => {
    if (isCodeNode(node)) return false
    if (!node.isText || !node.text) return true
    if (node.marks.some((m) => m.type.name === 'inlineCode' || m.type.spec.code)) return true

    const re = new RegExp(TIMESTAMP_RE.source, 'g')
    let match: RegExpExecArray | null
    while ((match = re.exec(node.text))) {
      const label = match[0].slice(1, -1)
      const seconds = parseTimestamp(label)
      if (seconds === null) continue
      anchors.push({ from: pos + match.index, to: pos + match.index + match[0].length, seconds, label })
    }
    return true
  })
  return anchors
}

/** 播放头所在片段的锚点：秒数 <= 当前时间中的最大者 */
function activeFor(anchors: AnchorSpec[], currentTime: number): number | null {
  let best: number | null = null
  for (const a of anchors) {
    if (a.seconds <= currentTime + 0.5 && (best === null || a.seconds > best)) best = a.seconds
  }
  return best
}

function buildDecorations(doc: ProseNode, anchors: AnchorSpec[], active: number | null): DecorationSet {
  const decorations = anchors.map((a) =>
    Decoration.inline(
      a.from,
      a.to,
      {
        class: a.seconds === active ? 'ts-anchor is-active' : 'ts-anchor',
        'data-seconds': String(a.seconds),
        title: `跳转到 ${a.label}`,
      },
      { seconds: a.seconds },
    ),
  )
  return DecorationSet.create(doc, decorations)
}

function createState(doc: ProseNode, currentTime: number): AnchorState {
  const anchors = collectAnchors(doc)
  const active = activeFor(anchors, currentTime)
  return { anchors, currentTime, active, decorations: buildDecorations(doc, anchors, active) }
}

export interface TimestampAnchorOptions {
  onSeek: (seconds: number) => void
}

export function createTimestampAnchorPlugin(options: TimestampAnchorOptions) {
  return $prose(
    () =>
      new Plugin<AnchorState>({
        key: timestampAnchorKey,
        state: {
          init: (_, state: EditorState) => createState(state.doc, 0),
          apply: (tr: Transaction, prev: AnchorState) => {
            const meta = tr.getMeta(timestampAnchorKey) as AnchorMeta | undefined
            const currentTime = meta?.currentTime ?? prev.currentTime

            if (tr.docChanged) return createState(tr.doc, currentTime)

            const active = activeFor(prev.anchors, currentTime)
            if (active === prev.active) return { ...prev, currentTime }
            return {
              ...prev,
              currentTime,
              active,
              decorations: buildDecorations(tr.doc, prev.anchors, active),
            }
          },
        },
        props: {
          decorations(state) {
            return timestampAnchorKey.getState(state)?.decorations ?? DecorationSet.empty
          },
          handleClick(_view: EditorView, _pos: number, event: MouseEvent) {
            const target = event.target as HTMLElement | null
            const anchor = target?.closest?.('.ts-anchor') as HTMLElement | null
            if (!anchor) return false
            const seconds = Number(anchor.dataset.seconds)
            if (!Number.isFinite(seconds)) return false
            options.onSeek(seconds)
            return true
          },
        },
      }),
  )
}

/** 播放器把当前时间同步进编辑器（只在整数秒变化时调用即可） */
export function syncPlayhead(view: EditorView, currentTime: number) {
  const prev = timestampAnchorKey.getState(view.state)
  if (!prev) return
  // 没有锚点、且时间没变时不派发事务
  if (prev.anchors.length === 0 && prev.active === null) {
    prev.currentTime = currentTime
    return
  }
  view.dispatch(view.state.tr.setMeta(timestampAnchorKey, { currentTime } satisfies AnchorMeta))
}

/** 当前文档里所有锚点（去重、升序），用于“跳到上一个/下一个笔记点” */
export function listAnchors(state: EditorState): number[] {
  const s = timestampAnchorKey.getState(state)
  if (!s) return []
  return [...new Set(s.anchors.map((a) => a.seconds))].sort((a, b) => a - b)
}

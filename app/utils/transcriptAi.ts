import type { GuideMessage } from '../types/guide'
import type { TranscriptSegment } from '../types/transcript'
import { isRecord } from './guide.ts'

/**
 * 将长逐字稿按句子数和字符上限分批，确保不超过模型上下文与 JSON 稳定输出范围。
 */
export function batchTranscriptSegments(
  segments: TranscriptSegment[],
  maxCount = 30,
  maxChars = 2000,
): TranscriptSegment[][] {
  const batches: TranscriptSegment[][] = []
  let current: TranscriptSegment[] = []
  let charCount = 0

  for (const seg of segments) {
    const textLen = seg.text.length
    if (current.length >= maxCount || (charCount + textLen > maxChars && current.length > 0)) {
      batches.push(current)
      current = []
      charCount = 0
    }
    current.push(seg)
    charCount += textLen
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

/**
 * 构建逐字稿纠错与术语校对的 AI 提示词
 */
export function refineTranscriptPrompt(title: string, batch: TranscriptSegment[]): GuideMessage[] {
  return [
    {
      role: 'user',
      content: `请对以下课程逐字稿进行语音识别（ASR）文本校对。
背景：音频由语音识别模型转写，由于讲师发音吞音、含糊连读、方言口音或中英混杂，存在部分英文技术术语拼写错误、英文词被误识别为发音相近的汉语/普通词汇、以及明显的同音错别字。
校对要求：
1. 重点修复英文技术术语、编程语言、框架库名、工具与 API/方法名的大小写与正确拼写（如：将 "you state" 修正为 "useState"，"pie torch" 修正为 "PyTorch"，"type script" 修正为 "TypeScript"，"doc er" 修正为 "Docker"，"con sole log" 修正为 "console.log"，"get hub" 修正为 "GitHub" 等）。
2. 修复由含糊发音导致的同音错别字，严格保持讲师的自然口语表述，切勿改写未出错的正常句子，切勿改写为书面文言。
3. 严格结构约束：严禁合并、拆分、新增或删除句子。输入的每一条 item（共 ${batch.length} 条），都必须在输出中按原 id 返回。
必须且仅返回如下格式的合法 JSON：
{"items":[{"id":0,"text":"校对后的文本"}]}
待校对数据：
${JSON.stringify({ title, segments: batch.map(s => ({ id: s.id, text: s.text })) })}`,
    },
  ]
}

/**
 * 校验 AI 返回的校对数据
 */
export function validateTranscriptCorrections(raw: unknown, batch: TranscriptSegment[]): Map<number, string> {
  const corrections = new Map<number, string>()
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new Error('AI 未返回有效校对列表，请重试。')
  }

  const validIds = new Set(batch.map((s) => s.id))
  for (const item of raw.items) {
    if (!isRecord(item)) continue
    const id = typeof item.id === 'number' ? item.id : Number(item.id)
    if (!Number.isFinite(id) || !validIds.has(id)) continue
    if (typeof item.text !== 'string') continue
    const cleaned = item.text.replace(/\s+/g, ' ').trim()
    if (!cleaned || cleaned.length > 2000) continue
    corrections.set(id, cleaned)
  }

  return corrections
}

/**
 * 将校对结果安全应用到现有逐字稿列表中，统计实际发生变更的句子数
 */
export function applyTranscriptCorrections(
  segments: TranscriptSegment[],
  corrections: Map<number, string>,
): { updatedSegments: TranscriptSegment[]; changedCount: number } {
  let changedCount = 0
  const updatedSegments = segments.map((seg) => {
    const correctedText = corrections.get(seg.id)
    if (correctedText && correctedText !== seg.text) {
      changedCount++
      return { ...seg, text: correctedText, refined: true }
    }
    return seg
  })

  return { updatedSegments, changedCount }
}

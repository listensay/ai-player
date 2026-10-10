import type { GuideMessage } from '../types/guide'

/** Retry malformed teaching material, without retrying transport failures or accepting invalid evidence. */
export async function requestValidatedMaterial(options: {
  messages: GuideMessage[]
  signal: AbortSignal
  request: (messages: GuideMessage[]) => Promise<unknown>
  validate: (raw: unknown) => unknown
}) {
  let correction = ''
  let previous = ''
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted()
    const messages: GuideMessage[] = [...options.messages]
    if (previous) messages.push({ role: 'assistant', content: previous })
    if (correction) messages.push({ role: 'user', content: correction })
    const raw = await options.request(messages)
    options.signal.throwIfAborted()
    try {
      options.validate(raw)
      return raw
    } catch (error) {
      if (attempt >= 2) throw error
      const content = JSON.stringify(raw)
      previous = content && content.length <= 16000 ? content : ''
      correction = `上次结果未通过校验：${(error as Error).message} 请重新生成完整 JSON，严格遵守字段类型和字数限制。sourceIds 只能逐字复制本批输入 sources 中的 id，不能使用其他批次编号、时间点或自行编号；需要覆盖全部材料时不得遗漏。仅依据原始材料整理，不添加新事实。`
    }
  }
}

import { isRecord } from './guide.ts'
import { platformFetch } from './platform.ts'

const START = '<!-- aiplayer:note:start -->\n',
  END = '\n<!-- aiplayer:note:end -->'
export function splitKnowledgeDocument(content: string) {
  const start = content.indexOf(START),
    end = content.indexOf(END, start + START.length)
  if (
    start < 0 ||
    end < 0 ||
    content.indexOf(START, start + START.length) >= 0 ||
    content.indexOf(END, end + END.length) >= 0
  )
    throw Error('课程笔记标记已变化，请恢复标记后同步。')
  return {
    prefix: content.slice(0, start + START.length),
    note: content.slice(start + START.length, end),
    suffix: content.slice(end),
  }
}
export function mergeKnowledgeDocument(
  base: string | null,
  local: string,
  remote: string | null,
  resolution?: 'local' | 'remote',
  localBase?: string,
) {
  if (resolution === 'local') return { content: local, conflict: false, note: splitKnowledgeDocument(local).note }
  if (resolution === 'remote' && remote !== null)
    return { content: remote, conflict: false, note: splitKnowledgeDocument(remote).note }
  if (remote === null && base === null)
    return { content: local, conflict: false, note: splitKnowledgeDocument(local).note }
  if (remote === null) return { content: local, conflict: true, note: splitKnowledgeDocument(local).note }
  if (base === null && local !== remote)
    return { content: remote, conflict: true, note: splitKnowledgeDocument(local).note }
  const original = splitKnowledgeDocument(base ?? local),
    originalLocal = splitKnowledgeDocument(localBase ?? base ?? local),
    left = splitKnowledgeDocument(local)
  let right: ReturnType<typeof splitKnowledgeDocument>
  try {
    right = splitKnowledgeDocument(remote)
  } catch {
    return { content: local, conflict: true, note: left.note }
  }
  let conflict = false
  const merge = (key: keyof typeof left) => {
    if (left[key] === right[key]) return left[key]
    if (left[key] === originalLocal[key]) return right[key]
    if (right[key] === original[key]) return left[key]
    conflict = true
    return right[key]
  }
  const prefix = merge('prefix'),
    note = merge('note'),
    suffix = merge('suffix')
  return { content: prefix + note + suffix, conflict, note }
}
function notionId(raw: string) {
  const id = raw.replace(/-/g, '')
  if (!/^[a-f0-9]{32}$/i.test(id)) throw Error('Notion 页面 ID 无效。')
  return id
}
export function createNotionKnowledgeClient(token: string, parentId: string, signal: AbortSignal) {
  const parent = notionId(parentId)
  if (!token.trim()) throw Error('请填写 Notion 集成密钥。')
  async function request(path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    const response = await platformFetch(`https://api.notion.com/v1/${path}`, {
      method,
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok)
      throw Error(
        response.status === 429
          ? 'Notion 请求较多，请稍后重试。'
          : `Notion 同步失败（${response.status}），请检查页面连接和集成权限。`,
      )
    const raw: unknown = await response.json()
    if (!isRecord(raw)) throw Error('Notion 响应格式无效。')
    return raw
  }
  async function read(pageId: string) {
    notionId(pageId)
    const blocks: Array<{ id: string; text: string }> = []
    let cursor = ''
    do {
      const raw = await request(
        `blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      if (!Array.isArray(raw.results)) throw Error('Notion 文档格式无效。')
      for (const block of raw.results) {
        if (
          !isRecord(block) ||
          typeof block.id !== 'string' ||
          block.type !== 'code' ||
          !isRecord(block.code) ||
          !Array.isArray(block.code.rich_text)
        )
          throw Error('Notion 文档包含新内容，请保留 Markdown 文档块后重试。')
        const text = block.code.rich_text
          .map((r) => {
            if (!isRecord(r) || typeof r.plain_text !== 'string') throw Error('Notion 文档文本无效。')
            return r.plain_text
          })
          .join('')
        blocks.push({ id: block.id, text })
      }
      cursor = raw.has_more === true && typeof raw.next_cursor === 'string' ? raw.next_cursor : ''
      if (blocks.length > 1500) throw Error('Notion 文档过长。')
    } while (cursor)
    return { content: blocks.map((b) => b.text).join(''), blocks }
  }
  const code = (content: string) => ({ rich_text: [{ type: 'text', text: { content } }], language: 'markdown' })
  async function write(pageId: string | null, title: string, content: string, expected: string | null) {
    const chunks: string[] = [],
      chars = [...content]
    for (let i = 0; i < chars.length; i += 1800) chunks.push(chars.slice(i, i + 1800).join(''))
    if (!chunks.length) chunks.push('')
    if (!pageId) {
      // Create empty page first. Caller persists its ID before writing blocks, so failures never orphan a duplicate.
      const raw = await request('pages', 'POST', {
        parent: { page_id: parent },
        properties: { title: { type: 'title', title: [{ type: 'text', text: { content: title.slice(0, 100) } }] } },
      })
      if (typeof raw.id !== 'string') throw Error('Notion 页面创建失败。')
      return raw.id
    }
    const previous = await read(pageId)
    if (previous.content !== (expected ?? '')) throw Error('Notion 笔记刚刚发生修改，请重新同步。')
    for (let i = 0; i < chunks.length; i++) {
      const block = previous.blocks[i]
      if (block) await request(`blocks/${block.id}`, 'PATCH', { code: code(chunks[i]!) })
      else
        await request(`blocks/${pageId}/children`, 'PATCH', {
          children: [{ object: 'block', type: 'code', code: code(chunks[i]!) }],
        })
    }
    for (const block of previous.blocks.slice(chunks.length))
      await request(`blocks/${block.id}`, 'PATCH', { archived: true })
    return pageId
  }
  return { read, write }
}

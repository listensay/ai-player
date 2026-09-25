import MarkdownIt from 'markdown-it'

// AI 文本仅作为内容渲染：不允许 HTML、图片、链接或外部资源。
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
  .disable(['image', 'link', 'autolink'])

// 历史反馈只调整展示：长段落在完整句子后留白，代码、强调内容与原始记录不变。
markdown.core.ruler.after('inline', 'readable_feedback', state => {
  if (!state.env?.readable) return
  for (const [index, token] of state.tokens.entries()) {
    if (token.type !== 'inline' || !token.children || state.tokens[index - 1]?.type !== 'paragraph_open') continue
    const total = token.children.reduce((n, child) => n + child.content.length, 0)
    if (total < 180) continue
    const children: NonNullable<typeof token.children> = []
    let run = 0, consumed = 0, depth = 0
    for (const child of token.children) {
      if (child.type === 'text' && depth === 0) {
        let start = 0
        for (const match of child.content.matchAll(/[。！？][”’」』]?/gu)) {
          const end = match.index + match[0].length
          if (run + end - start < 80 || total - consumed - end < 30) continue
          const text = new state.Token('text', '', 0)
          text.content = child.content.slice(start, end)
          children.push(text, new state.Token('softbreak', 'br', 0), new state.Token('softbreak', 'br', 0))
          start = end; run = 0
        }
        const tail = new state.Token('text', '', 0)
        tail.content = child.content.slice(start)
        if (tail.content) children.push(tail)
        run += tail.content.length
      } else {
        children.push(child)
        depth += child.nesting
        run = child.type === 'softbreak' || child.type === 'hardbreak' ? 0 : run + child.content.length
      }
      consumed += child.content.length
    }
    token.children = children
  }
})

/** 修复旧题里的行内编号；保护代码块、行内代码、普通小数与版本号。 */
export function formatPracticeMarkdown(text: string): string {
  return text.replace(/\r\n?/g, '\n').split(/(^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$|^\s*~~~[^\n]*\n[\s\S]*?^\s*~~~\s*$|`+[^`\n]*`+)/gm)
    .map((part, index) => index % 2 ? part : part
      .replace(/(^|\n)([ \t]*\d+)\\\.[ \t]+/g, '$1$2. ')
      .replace(/([；;。])[ \t]*(\d{1,2})[.、．][ \t]+(?=\S)/g, '$1\n\n$2. '))
    .join('')
}

export function renderPracticeMarkdown(text: string, readable = false): string {
  return markdown.render(formatPracticeMarkdown(text), { readable })
}

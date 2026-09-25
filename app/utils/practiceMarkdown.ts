import MarkdownIt from 'markdown-it'

// AI 文本仅作为内容渲染：不允许 HTML、图片、链接或外部资源。
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
  .disable(['image', 'link', 'autolink'])

/** 修复旧题里的行内编号；保护代码块、行内代码、普通小数与版本号。 */
export function formatPracticeMarkdown(text: string): string {
  return text.replace(/\r\n?/g, '\n').split(/(^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$|^\s*~~~[^\n]*\n[\s\S]*?^\s*~~~\s*$|`+[^`\n]*`+)/gm)
    .map((part, index) => index % 2 ? part : part
      .replace(/(^|\n)([ \t]*\d+)\\\.[ \t]+/g, '$1$2. ')
      .replace(/([；;。])[ \t]*(\d{1,2})[.、．][ \t]+(?=\S)/g, '$1\n\n$2. '))
    .join('')
}

export function renderPracticeMarkdown(text: string): string {
  return markdown.render(formatPracticeMarkdown(text))
}

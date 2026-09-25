import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderPracticeMarkdown } from '../app/utils/practiceMarkdown.ts'

const long = '先确认占位符的含义，再检查变量与输出结果的对应关系。'.repeat(10)
const removeBreaks = html => html.replace(/<br\s*\/?>(?:\n)?/g, '')

test('长反馈按完整句子分段，原文不丢失，普通题干不额外分段', () => {
  const plain = renderPracticeMarkdown(long)
  const readable = renderPracticeMarkdown(long, true)
  assert.ok(!plain.includes('<br>'))
  assert.ok(readable.includes('<br>\n<br>'))
  assert.equal(removeBreaks(readable), plain)
})

test('反馈排版保留代码中的标点、缩进和换行', () => {
  const text = `${long}\n\n\`\`\`python\nprint("你好。世界！")\nif True:\n    print(f"{{{100}}}")\n\`\`\`\n\n${long} \`print("不要。拆分！")\``
  const before = renderPracticeMarkdown(text)
  const after = renderPracticeMarkdown(text, true)
  assert.deepEqual(after.match(/<pre>[\s\S]*?<\/pre>/g), before.match(/<pre>[\s\S]*?<\/pre>/g))
  assert.deepEqual(after.match(/<code>[\s\S]*?<\/code>/g), before.match(/<code>[\s\S]*?<\/code>/g))
})

test('保留强调、列表和短反馈的原有排版', () => {
  const emphasis = `**${long}** 后面的说明。`
  const output = renderPracticeMarkdown(emphasis, true)
  assert.match(output, /<strong>/)
  assert.ok(!output.match(/<strong>[\s\S]*?<br>[\s\S]*?<\/strong>/))
  const short = '- **规则**：用 `{{` 输出左大括号。\n- 版本 3.12 支持该语法。'
  assert.equal(renderPracticeMarkdown(short, true), renderPracticeMarkdown(short))
})

test('反馈仍转义 HTML，不加载图片、链接或外部资源', () => {
  const output = renderPracticeMarkdown(`${long}<script>alert(1)</script> ![image](https://example.test/a.png) [link](https://example.test)`, true)
  assert.ok(!output.includes('<script>'))
  assert.ok(!output.includes('<img'))
  assert.ok(!output.includes('<a '))
  assert.ok(output.includes('&lt;script&gt;'))
})

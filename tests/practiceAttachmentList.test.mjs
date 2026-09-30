import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive, nextTick } from 'vue'

const { descriptor } = parse(readFileSync(new URL('../app/components/PracticeAttachmentList.vue', import.meta.url), 'utf8'))
const code = compileScript(descriptor, { id: 'attachment-list-test' }).content
  .replace(/import (AppIcon|UiButton) from [^\n]+/g, 'const $1 = {}')
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('附件异步读取完成后自动更新预览，失败可重试且换作业清空旧预览', async t => {
  const file = { id: 'file', name: 'main.py', kind: 'code', size: 8, characters: 8 }
  let resolve, fail = false
  const props = reactive({ attachments: [file], recordId: 'one', load: () => fail ? Promise.reject(Error('读取失败')) : new Promise(r => { resolve = r }) })
  const rendered = []
  let view
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() {
    view = Component.setup(props, { expose() {}, emit() {} })
    return () => {
      const state = view.previews.file
      rendered.push(state?.loading ? 'loading' : state?.error || view.codeText('file') || view.imageUrl('file'))
      return null
    }
  } })
  app.mount({}); t.after(() => app.unmount())
  const loading = view.preview(file)
  await nextTick(); assert.equal(rendered.at(-1), 'loading')
  resolve({ kind: 'code', text: 'print(1)' })
  await loading; await nextTick()
  assert.equal(rendered.at(-1), 'print(1)')
  props.recordId = 'two'; await nextTick()
  assert.equal(view.previews.file, undefined)
  fail = true; await view.preview(file); await nextTick()
  assert.equal(rendered.at(-1), '读取失败')
  await view.preview(file)
  fail = false
  const retry = view.preview(file)
  resolve({ kind: 'image', mediaType: 'image/png', data: 'AQID' })
  await retry; await nextTick()
  assert.equal(rendered.at(-1), 'data:image/png;base64,AQID')
})

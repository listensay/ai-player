import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, reactive } from 'vue'
const { descriptor } = parse(readFileSync(new URL('../app/components/AiSettingsPanel.vue', import.meta.url), 'utf8'))
let code = compileScript(descriptor, { id: 'ai-settings-test' }).content
  .replace(/import \{ useGuide \} from [^\n]+/, 'const useGuide = () => globalThis.panelIO.guide')
  .replace(/import \{ testAiConnection \} from [^\n]+/, 'const testAiConnection = (...args) => globalThis.panelIO.test(...args)')
  .replace(/import \{ emptyAiSettings \} from [^\n]+/, `const emptyAiSettings = () => ({provider:'openai',baseUrl:'',model:'',apiKey:'',timeoutMinutes:15})`)
  .replace(/import (AiProfileSelector|UiButton|AppIcon) from [^\n]+/g, 'const $1 = {}')
  .replace(/import \{ VSnackbar \} from [^\n]+/, 'const VSnackbar = {}')
  .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
const { outputText } = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
function mount(t) {
  const writes=[]
  globalThis.panelIO={guide:{state:reactive({busy:''}),ai:{
    state:reactive({ready:true,saving:false,collection:{profiles:[],activeId:''}}),
    saveProfile:async draft=>{writes.push(draft);return 'saved'},
  }},test:async()=>({milliseconds:125})}
  let panel
  const renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null})
  const app=renderer.createApp({setup(){panel=Component.setup({}, {expose(){}});return()=>null}})
  app.mount({})
  Object.assign(panel.draft,{name:'日常学习',model:'example-model',baseUrl:'https://example.test/v1',apiKey:'private-key'})
  t.after(()=>{app.unmount();delete globalThis.panelIO})
  return {panel,writes}
}
test('保存配置显示带配置名与模型的成功弹出提示，不显示密钥',async t=>{
  const {panel,writes}=mount(t)
  await panel.save()
  assert.equal(writes.length,1)
  assert.equal(panel.notice.open,true)
  assert.equal(panel.notice.success,true)
  assert.match(panel.notice.detail,/日常学习.*example-model/)
  assert.doesNotMatch(panel.notice.detail,/private-key/)
})
test('保存失败显示失败弹出提示并保留草稿',async t=>{
  const {panel}=mount(t)
  globalThis.panelIO.guide.ai.saveProfile=async()=>{throw Error('数据库写入失败')}
  await panel.save()
  assert.equal(panel.notice.open,true)
  assert.equal(panel.notice.success,false)
  assert.equal(panel.notice.title,'保存配置失败')
  assert.equal(panel.draft.name,'日常学习')
})
test('测试显示响应耗时且不保存配置，失败后允许重试',async t=>{
  const {panel,writes}=mount(t)
  await panel.testConnection()
  assert.equal(writes.length,0)
  assert.equal(panel.notice.title,'连接测试通过')
  assert.match(panel.notice.detail,/0.1 秒/)
  globalThis.panelIO.test=async()=>{throw Error('密钥无效')}
  await panel.testConnection()
  assert.equal(panel.notice.title,'连接测试失败')
  assert.equal(panel.testing.value,false)
  assert.equal(panel.disabled.value,false)
})

import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import { executeProgramming } from './programmingRuntime'
import type { ProgrammingExecution } from './programmingRuntime'

self.onmessage = async (event: MessageEvent<ProgrammingExecution>) => {
  try {
    const quickjs = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmLocation: wasmUrl }))
    self.postMessage({ result: executeProgramming(quickjs, event.data) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '代码运行环境启动失败。' })
  }
}

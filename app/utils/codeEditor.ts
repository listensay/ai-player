import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js'
import 'monaco-editor/editor/contrib/comment/browser/comment.js'
import { javascriptDefaults, ScriptTarget } from 'monaco-editor/languages/features/typescript/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

globalThis.MonacoEnvironment = {
  getWorker(_id, label) {
    return label === 'javascript' || label === 'typescript' ? new TypeScriptWorker() : new EditorWorker()
  },
}
javascriptDefaults.setCompilerOptions({
  target: ScriptTarget.ES2020,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: true,
  noEmit: true,
  lib: ['es2020'],
})
javascriptDefaults.addExtraLib(
  'declare const console: { log(...args: any[]): void; info(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void; debug(...args: any[]): void; };',
  'inmemory://runtime/console.d.ts',
)
export { monaco }

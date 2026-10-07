import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js'
import 'monaco-editor/editor/contrib/comment/browser/comment.js'
import type { ProgrammingLanguage } from './programmingLanguages'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'

const languages: Record<ProgrammingLanguage, () => Promise<unknown>> = {
  javascript: () => import('monaco-editor/languages/definitions/javascript/register.js'),
  typescript: () => import('monaco-editor/languages/definitions/typescript/register.js'),
  python: () => import('monaco-editor/languages/definitions/python/register.js'),
  java: () => import('monaco-editor/languages/definitions/java/register.js'),
  c: () => import('monaco-editor/languages/definitions/cpp/register.js'),
  cpp: () => import('monaco-editor/languages/definitions/cpp/register.js'),
  csharp: () => import('monaco-editor/languages/definitions/csharp/register.js'),
  go: () => import('monaco-editor/languages/definitions/go/register.js'),
  rust: () => import('monaco-editor/languages/definitions/rust/register.js'),
  ruby: () => import('monaco-editor/languages/definitions/ruby/register.js'),
  php: () => import('monaco-editor/languages/definitions/php/register.js'),
  swift: () => import('monaco-editor/languages/definitions/swift/register.js'),
  kotlin: () => import('monaco-editor/languages/definitions/kotlin/register.js'),
  shell: () => import('monaco-editor/languages/definitions/shell/register.js'),
  powershell: () => import('monaco-editor/languages/definitions/powershell/register.js'),
  lua: () => import('monaco-editor/languages/definitions/lua/register.js'),
  perl: () => import('monaco-editor/languages/definitions/perl/register.js'),
  r: () => import('monaco-editor/languages/definitions/r/register.js'),
}
const loaded = new Map<ProgrammingLanguage, Promise<void>>()
let typescript: Promise<void> | undefined
function prepareTypeScript() {
  return (typescript ??= import('monaco-editor/languages/features/typescript/register.js')
    .then(({ javascriptDefaults, typescriptDefaults, ScriptTarget }) => {
      for (const defaults of [javascriptDefaults, typescriptDefaults]) {
        defaults.setCompilerOptions({
          target: ScriptTarget.ES2020,
          allowNonTsExtensions: true,
          allowJs: true,
          checkJs: true,
          noEmit: true,
          lib: ['es2020'],
        })
        defaults.addExtraLib(
          'declare const console: { log(...args: any[]): void; info(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void; debug(...args: any[]): void; };',
          'inmemory://runtime/console.d.ts',
        )
      }
    })
    .catch((error) => {
      typescript = undefined
      throw error
    }))
}
export function prepareLanguage(language: ProgrammingLanguage): Promise<void> {
  let pending = loaded.get(language)
  if (!pending) {
    pending = Promise.all([
      languages[language](),
      language === 'javascript' || language === 'typescript' ? prepareTypeScript() : undefined,
    ])
      .then(() => {})
      .catch((error) => {
        loaded.delete(language)
        throw error
      })
    loaded.set(language, pending)
  }
  return pending
}
globalThis.MonacoEnvironment = {
  async getWorker(_id, label) {
    if (label === 'javascript' || label === 'typescript') {
      const { default: TypeScriptWorker } = await import('monaco-editor/language/typescript/ts.worker.js?worker')
      return new TypeScriptWorker()
    }
    return new EditorWorker()
  },
}
export { monaco }

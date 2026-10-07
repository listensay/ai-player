declare const __APP_BUILD__: { version: string; commit: string; dirty: boolean; builtAt: string }

interface Window {
  __AI_PLAYER_SMOKE_EDITOR__?: import('monaco-editor').editor.IStandaloneCodeEditor
}

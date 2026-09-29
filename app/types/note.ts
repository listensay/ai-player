export interface NoteEditorHandle {
  whenReady: () => Promise<void>
  hasUnsavedChanges: () => boolean
  insertTimestamp: (seconds: number) => void
  insertInline: (text: string) => void
  insertScreenshot: (blob: Blob, seconds: number, ratio?: number) => Promise<void>
  setPlayhead: (seconds: number) => void
  save: () => Promise<void>
  focus: () => void
  getMarkdown: () => string | undefined
}

export interface NoteSelection {
  from: number
  to: number
  text: string
  document: string
}
export interface NoteEditorHandle {
  whenReady: () => Promise<void>
  hasUnsavedChanges: () => boolean
  insertTimestamp: (seconds: number) => void
  getSelection: () => NoteSelection | null
  replaceSelection: (selection: NoteSelection, markdown: string) => void
  insertMarkdown: (markdown: string) => void
  insertInline: (text: string) => void
  insertScreenshot: (blob: Blob, seconds: number, ratio?: number) => Promise<void>
  setPlayhead: (seconds: number) => void
  save: () => Promise<void>
  focus: () => void
  getMarkdown: () => string | undefined
}

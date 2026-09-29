import { nextTick, shallowRef } from 'vue'
import type { Ref } from 'vue'
import type { NoteEditorHandle } from '~/types/note'
import type { usePlayer } from './usePlayer'
import { formatTime } from '~/utils/time'

/** Note commands capture their lesson and playhead before loading the editor. */
export function useNoteWorkspace(key: Ref<string>, rightTab: Ref<'knowledge' | 'notes' | 'transcript'>,
  player: ReturnType<typeof usePlayer>, notify: (message: string) => void) {
  const noteEditor = shallowRef<NoteEditorHandle | null>(null)
  async function ready(expected: string) {
    if (!expected || key.value !== expected) throw new Error('课节已切换，请重新操作。')
    rightTab.value = 'notes'
    await nextTick()
    const editor = noteEditor.value
    if (!editor) throw new Error('笔记编辑器尚未就绪，请重试。')
    await editor.whenReady()
    if (key.value !== expected || editor !== noteEditor.value) throw new Error('课节已切换，请重新操作。')
    return editor
  }
  async function quoteToNote(text: string) {
    try { (await ready(key.value)).insertInline(text); notify('已插入笔记') }
    catch (error) { notify((error as Error).message) }
  }
  async function noteAt(seconds: number) {
    try { const editor = await ready(key.value); editor.insertTimestamp(seconds); editor.focus() }
    catch (error) { notify((error as Error).message) }
  }
  function insertTimestamp() { if (player.state.ready) void noteAt(player.state.currentTime) }
  async function screenshot() {
    if (!player.state.ready) return
    const expected = key.value, seconds = player.state.currentTime
    try {
      const frame = await player.captureFrame()
      if (!frame) throw new Error('视频尚未加载，请稍后截图。')
      await (await ready(expected)).insertScreenshot(frame.blob, seconds, frame.ratio)
      notify(`已截图 ${formatTime(seconds, true)}`)
    } catch (error) { notify(`截图保存失败：${(error as Error).message}`) }
  }
  async function saveNote() {
    try {
      const editor = await ready(key.value)
      await editor.save()
      if (editor.hasUnsavedChanges()) throw new Error('笔记尚未保存，请重试。')
      notify('笔记已保存')
    } catch (error) { notify((error as Error).message) }
  }
  return { noteEditor, quoteToNote, noteAt, insertTimestamp, screenshot, saveNote }
}

import { reactive } from 'vue'

export interface NoteStorage {
  read: () => Promise<{ content: string; updatedAt: number | null }>
  readCopy: () => Promise<string | null>
  write: (content: string) => Promise<{ success: boolean; updatedAt?: number }>
  writeCopy: (content: string) => Promise<void>
}

/** One immutable course/lesson target. All writes, including teardown, share this queue. */
export function useNoteSession(storage: NoteStorage) {
  const state = reactive({
    ready: false,
    loading: false,
    saving: false,
    content: '',
    dirty: false,
    savedAt: null as number | null,
    error: '',
    copyError: '',
  })
  let pendingRead: (() => string) | undefined
  let baseline = ''
  let loadJob: Promise<void> | undefined
  let saveJob: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function load(): Promise<void> {
    if (state.ready) return Promise.resolve()
    if (loadJob) return loadJob
    state.loading = true
    state.error = ''
    loadJob = (async () => {
      try {
        const record = await storage.read()
        let content = record.content
        let updatedAt = record.updatedAt
        // An intentionally empty note is still a record. Only absence permits importing a copy.
        if (updatedAt === null) {
          const copy = await storage.readCopy()
          if (copy !== null) {
            const result = await storage.write(copy)
            if (!result.success) throw new Error('笔记导入失败，请重试。')
            content = copy
            updatedAt = result.updatedAt ?? Date.now()
          }
        }
        baseline = content
        Object.assign(state, { content, savedAt: updatedAt, ready: true, dirty: false })
      } catch (error) {
        state.error = `笔记读取失败：${(error as Error).message}`
        throw error
      } finally {
        state.loading = false
        loadJob = undefined
      }
    })()
    return loadJob
  }

  function edit(content: string) {
    if (!state.ready) return
    pendingRead = undefined
    state.content = content
    state.dirty = content !== baseline
    clearTimeout(timer)
    if (state.dirty)
      timer = setTimeout(() => {
        void save().catch(() => {})
      }, 800)
  }

  /** Mark dirty immediately; serialize the latest document only when saving or reading it. */
  function editFrom(read: () => string) {
    if (!state.ready) return
    pendingRead = read
    state.dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      void save().catch(() => {})
    }, 800)
  }
  function readContent() {
    if (pendingRead) {
      const content = pendingRead()
      pendingRead = undefined
      state.content = content
      state.dirty = content !== baseline
    }
    return state.content
  }

  // Editor normalization is not a user edit and must not overwrite the original file.
  function acceptEditorContent(content: string) {
    if (state.ready && !state.dirty) {
      baseline = content
      state.content = content
    }
  }

  function save(): Promise<void> {
    clearTimeout(timer)
    if (!state.ready) return Promise.resolve()
    try {
      readContent()
    } catch (error) {
      state.error = (error as Error).message
      return Promise.reject(error)
    }
    if (saveJob) return saveJob
    if (!state.dirty && !state.copyError) return Promise.resolve()
    state.saving = true
    saveJob = (async () => {
      try {
        while (state.dirty || state.copyError) {
          const content = readContent()
          if (!state.dirty && !state.copyError) break
          if (state.dirty) {
            const result = await storage.write(content)
            if (!result.success) throw new Error('笔记写入数据库失败，请重试。')
            baseline = content
            state.savedAt = result.updatedAt ?? Date.now()
            state.dirty = !!pendingRead || state.content !== baseline
          }
          state.error = ''
          try {
            await storage.writeCopy(content)
            state.copyError = ''
          } catch {
            state.copyError = '笔记已保存在本机，课程目录副本同步失败。'
            // A failed copy must not prevent newer edits from reaching the primary store.
            if (!state.dirty) break
          }
        }
      } catch (error) {
        state.error = (error as Error).message
        throw error
      } finally {
        state.saving = false
      }
    })().finally(() => {
      saveJob = undefined
    })
    return saveJob
  }

  function dispose() {
    clearTimeout(timer)
    // Materialize before the editor is destroyed, including during an in-flight write.
    try {
      readContent()
    } catch (error) {
      state.error = (error as Error).message
    }
    // Route and window guards await save. Unexpected teardown still uses the same queue.
    void save().catch(() => {})
  }
  return { state, load, edit, editFrom, readContent, acceptEditorContent, save, dispose }
}

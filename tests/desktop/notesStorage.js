// Executed only by the isolated Tauri desktop-smoke build.
void (async () => {
  if (globalThis.__AI_PLAYER_SMOKE_RUNNING__) return
  globalThis.__AI_PLAYER_SMOKE_RUNNING__ = true
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const phase = globalThis.__AI_PLAYER_SMOKE_PHASE__
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const steps = []
  const expect = (value, message) => {
    if (!value) throw Error(message)
  }
  async function until(work, label) {
    const start = performance.now()
    while (performance.now() - start < 45000) {
      const value = await work()
      if (value) return value
      await pause(150)
    }
    throw Error(`Timed out: ${label}`)
  }
  async function step(name, work) {
    await invoke('desktop_smoke_report', { result: { progress: name } })
    await work()
    steps.push(name)
  }
  try {
    location.hash = '/courses/smoke-course/player?lesson=lesson-0.mp4'
    let probe
    await step('open-note', async () => {
      await until(async () => {
        probe = (await invoke('desktop_smoke_affine', { text: null })).probe
        return probe?.ready && probe.title === 'lesson-0' && probe.lesson?.path === 'lesson-0.mp4'
      }, 'lesson note')
    })
    await step('restore-learning-data', async () => {
      const read = (endpoint, query = {}) => invoke('database_request', { endpoint, method: 'GET', query, body: null })
      const library = await read('library')
      expect(
        library.some((course) => course.id === 'smoke-course'),
        'Course library missing',
      )
      const practice = await read('practice', { courseId: 'smoke-course' })
      expect(practice['lesson-0.mp4'][0].draft.includes('sumPositive'), 'Practice draft missing')
      if (phase === 'storage-legacy') {
        await invoke('database_request', {
          endpoint: 'settings',
          method: 'POST',
          query: {},
          body: { key: 'storage-smoke', value: { model: 'portable', progress: 123 } },
        })
      } else {
        const settings = await read('settings', { key: 'storage-smoke' })
        expect(settings?.model === 'portable' && settings.progress === 123, 'Application settings missing')
        const guide = await read('guide', { courseId: 'smoke-course' })
        expect(guide.plan.lessons.length === 2, 'Learning plan missing')
      }
    })
    if (phase === 'storage-legacy') {
      await step('write-legacy-note-and-attachment', async () => {
        await invoke('desktop_smoke_affine', { text: '迁移前的课程笔记', storageAction: 'write' })
        await until(async () => {
          probe = (await invoke('desktop_smoke_affine', { text: null })).probe
          if (probe.storage?.error) throw Error(probe.storage.error)
          return probe.storage?.pending === false
        }, 'save attachment')
        expect(probe.text === '迁移前的课程笔记', 'Legacy note edit missing')
        await invoke('notes_storage_flush')
        const selection = await invoke('desktop_smoke_notes_directory', { next: false })
        expect(
          selection.path && selection.pendingPath.endsWith('data-first/Study Helper Data'),
          'New location must be pending',
        )
      })
    } else {
      await step('restore-text-attachment-and-metadata', async () => {
        expect(
          probe.text === (phase === 'storage-migrate' ? '迁移前的课程笔记' : '选定文件夹中的新修改'),
          `Wrong note: ${probe.text}`,
        )
        await invoke('desktop_smoke_affine', { text: null, storageAction: 'read' })
        await until(async () => {
          probe = (await invoke('desktop_smoke_affine', { text: null })).probe
          if (probe.storage?.error) throw Error(probe.storage.error)
          return probe.storage?.pending === false
        }, 'read attachment')
        expect(JSON.stringify(probe.storage.blob) === '[137,80,78,71,1,2,3]', 'Attachment changed')
        expect(probe.storage.metadata === 'metadata-value', 'Workspace metadata missing')
        const info = await invoke('data_storage_info')
        expect(
          !info.pendingPath &&
            info.path.endsWith(
              `${phase === 'storage-migrate' ? 'data-first' : phase === 'storage-move' ? 'data-second' : 'synced'}/Study Helper Data`,
            ),
          'Wrong active location',
        )
      })
      if (phase === 'storage-migrate') {
        await step('write-in-native-store-and-change-location', async () => {
          await invoke('desktop_smoke_affine', { text: '选定文件夹中的新修改' })
          await invoke('notes_storage_flush')
          await invoke('desktop_smoke_notes_directory', { next: true })
        })
      }
    }
    await invoke('notes_storage_flush')
    await invoke('data_storage_flush')
    if (phase === 'storage-move') {
      await step('settings-shows-active-data-folder', async () => {
        location.hash = '/courses/smoke-course'
        const settings = await until(() => document.querySelector('button[aria-label="设置"]'), 'settings button')
        settings.click()
        const tab = await until(
          () => document.querySelector('button[aria-controls="settings-storage"]'),
          'storage settings tab',
        )
        tab.click()
        await until(
          () => document.getElementById('settings-storage')?.textContent.includes('data-second/Study Helper Data'),
          'active storage path in settings',
        )
        expect(
          getComputedStyle(document.querySelector('#settings-storage .pane')).backgroundColor === 'rgb(255, 255, 255)',
          'Storage settings must use a white surface',
        )
        await invoke('desktop_smoke_report', { result: { progress: 'storage-settings-ready' } })
        await pause(4000)
      })
    }
    await invoke('desktop_smoke_report', { result: { success: true, steps, probe } })
  } catch (error) {
    await invoke('desktop_smoke_report', {
      result: { success: false, steps, error: `${String(error)}\n${error.stack || ''}` },
    })
  }
})()

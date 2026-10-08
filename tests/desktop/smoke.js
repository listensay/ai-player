// Runs inside the real Tauri WebView, only in the desktop-smoke feature build.
void (async () => {
  if (globalThis.__AI_PLAYER_SMOKE_RUNNING__) return
  globalThis.__AI_PLAYER_SMOKE_RUNNING__ = true
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const read = (endpoint, query = {}) => invoke('database_request', { endpoint, method: 'GET', query, body: null })
  const steps = []
  const phase = globalThis.__AI_PLAYER_SMOKE_PHASE__
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function until(work, label, timeout = 25000) {
    const start = performance.now()
    while (performance.now() - start < timeout) {
      const value = await work()
      if (value) return value
      await pause(100)
    }
    throw Error(`Timed out: ${label}`)
  }
  const visible = (node) => node && node.getClientRects().length && !node.closest('[inert]')
  async function click(text) {
    const node = await until(
      () =>
        [...document.querySelectorAll('button,a')].find(
          (e) =>
            visible(e) &&
            !e.disabled &&
            (e.textContent.trim() === text || e.title === text || e.getAttribute('aria-label') === text),
        ),
      `button ${text}`,
    )
    node.click()
  }
  async function step(name, work) {
    await invoke('desktop_smoke_report', { result: { progress: name } })
    await work()
    steps.push(name)
  }
  function expect(condition, message) {
    if (!condition) throw Error(message)
  }
  const route = (lesson) => {
    location.hash = `/courses/smoke-course/player?lesson=${lesson}`
  }
  const storedNote = () => read('notes', { courseId: 'smoke-course', videoPath: 'lesson-0.mp4' })
  const codeRecord = async () => (await read('practice', { courseId: 'smoke-course' }))['lesson-0.mp4'][0]
  const code = 'function sumPositive(numbers) { return numbers.filter(n => n > 0).reduce((sum, n) => sum + n, 0); }'
  async function editor() {
    return until(() => globalThis.__AI_PLAYER_SMOKE_EDITOR__, 'Monaco editor')
  }
  async function editCode(value) {
    const instance = await editor()
    instance.executeEdits('desktop-smoke', [{ range: instance.getModel().getFullModelRange(), text: value }])
    await until(async () => (await codeRecord()).draft === value, 'persist code')
  }
  const captured = performance.getEntriesByType('measure')
  const observer = new PerformanceObserver((list) => captured.push(...list.getEntries()))
  observer.observe({ entryTypes: ['measure'] })
  const metrics = () =>
    captured.filter((m) => m.name.startsWith('ai-player:')).map(({ name, duration }) => ({ name, duration }))
  try {
    await step('home-load', async () => {
      await until(
        () =>
          document.querySelector('button,a') &&
          (document.body.textContent.includes('桌面回归课程') || document.body.textContent.includes('查看课程')),
        'course on home',
      )
      expect((await read('library')).length === 1, 'Isolated library must have one course')
    })
    if (phase === 'first') {
      await step('notion-native-edit-switch-hide-restore', async () => {
        route('lesson-0.mp4')
        const probe = () => invoke('desktop_smoke_notion', { text: null })
        async function bindPage(name) {
          const input = await until(() => document.querySelector('#notion-page-url'), 'page link')
          input.value = `https://app.notion.com/${name}`
          input.dispatchEvent(new Event('input', { bubbles: true }))
          await click('绑定并打开')
          await until(async () => (await probe()).probe?.path === `/${name}`, 'native page loaded')
        }
        await bindPage('smoke-a')
        await until(async () => (await probe()).probe?.ipcBlocked, 'remote page denied native database access')
        expect(!document.querySelector('.milkdown'), 'Removed local editor must not load')
        await until(async () => {
          const state = await probe(),
            rect = document.querySelector('.notion-webview-slot').getBoundingClientRect()
          return (
            Math.abs(
              state.position.y -
                Math.ceil(rect.top) -
                (state.windowGeometry.hostSize.height / state.windowGeometry.scale - innerHeight),
            ) <= 1 && Math.abs(state.position.x - Math.ceil(rect.left)) <= 1
          )
        }, 'native view aligns with DOM slot below its toolbar')
        const overlay = document.createElement('div')
        overlay.setAttribute('data-native-webview-overlay', '')
        overlay.style.cssText = 'position:fixed;inset:0;z-index:4000'
        document.body.append(overlay)
        await until(async () => (await probe()).hidden, 'custom celebration hides native view')
        overlay.remove()
        await until(async () => !(await probe()).hidden, 'custom celebration dismissal restores native view')

        await invoke('desktop_smoke_notion', { text: 'Native Notion draft' })
        await until(async () => (await probe()).probe?.text === 'Native Notion draft', 'native editable page saves')
        const popup = (action) => invoke('desktop_smoke_notion_popup', { action })
        for (const [index, mode] of ['blank', 'direct'].entries()) {
          await popup(mode)
          await until(
            async () => (await probe()).probe?.logins?.length === index + 1,
            `${mode} popup returns to its opener`,
          )
          const state = (await probe()).probe
          const result = state.logins[index]
          expect(
            !state.popupBlocked &&
              result.hasOpener &&
              result.sharedSession &&
              result.callbackCookie &&
              result.ipcBlocked,
            'Popup must retain opener/session without native privileges',
          )
          expect(
            state.path === '/smoke-a' && state.text === 'Native Notion draft',
            'Login must not navigate or reload the note panel',
          )
          await until(async () => (await popup('count')) === 0, 'login popup closes itself')
        }
        await popup('hold')
        await until(async () => (await popup('count')) === 1, 'cancelable login popup opens')
        await popup('close')
        await until(async () => (await popup('count')) === 0, 'cancel closes only popup')
        await until(async () => (await probe()).probe?.popupClosed, 'opener observes canceled popup as closed')
        expect((await probe()).probe?.text === 'Native Notion draft', 'Canceled login must preserve the note panel')
        await popup('direct')
        await until(
          async () => (await probe()).probe?.logins?.length === 3,
          'sign-in can be retried after cancellation',
        )
        await until(async () => (await popup('count')) === 0, 'retried popup closes itself')
        await click('知识点')
        await until(async () => (await probe()).hidden, 'tab hides native view')
        await click('Notion')
        await until(async () => !(await probe()).hidden, 'tab restores native view')
        await click('收起右侧面板')
        await until(async () => (await probe()).hidden, 'sidebar hides native view')
        await click('展开右侧面板')
        await until(async () => !(await probe()).hidden, 'sidebar restores native view')
        await click('课后练习')
        await until(async () => (await probe()).hidden, 'dialog hides native view')
        await editor()
        await click('关闭练习')
        await until(async () => !(await probe()).hidden, 'dialog close restores native view')
        expect((await invoke('companion_is_open')) === false, 'Main-window commands must support multiple webviews')
        await click('全屏（F）')
        await until(async () => (await probe()).hidden, 'fullscreen hides Notion')
        await click('退出全屏（F）')
        await until(async () => !(await probe()).hidden, 'leaving fullscreen restores Notion')
        const widthBefore = (await probe()).size.width
        document
          .querySelector('[aria-label="调整笔记面板宽度"]')
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
        await until(async () => (await probe()).size.width > widthBefore, 'resizing panel moves native view')

        route('lesson-1.mp4')
        await bindPage('smoke-b')
        expect((await probe()).probe.text === '', 'New lesson must not reuse the prior page')
        await click('课后练习')
        const python = await editor()
        expect(python.getModel().getLanguageId() === 'python', 'Python language did not load')
        await click('关闭练习')
        await until(() => !globalThis.__AI_PLAYER_SMOKE_EDITOR__, 'Python editor disposed')
        route('lesson-0.mp4')
        await until(
          async () =>
            (await probe()).probe?.path === '/smoke-a' && (await probe()).probe?.text === 'Native Notion draft',
          'saved lesson binding restores native document',
        )
      })
      await step('programming-execution-and-cancellation', async () => {
        await click('课后练习')
        await editCode(code)
        await click('测试')
        await until(
          async () => (await codeRecord()).codeRun?.cases.every((c) => c.status === 'passed'),
          'all tests pass',
          45000,
        )
        await editCode('function sumPositive(numbers) { while (true) {} }')
        await click('测试')
        await click('取消')
        await until(() => !document.querySelector('.ide-button-test')?.disabled, 'cancel completes')
        await editCode(code)
        await click('测试')
        await until(async () => {
          const r = await codeRecord()
          return r.codeRun?.code === code && r.codeRun.cases.every((c) => c.status === 'passed')
        }, 'run after cancel')
        await click('关闭练习')
      })
      await step('pomodoro-pauses-playing-video', async () => {
        const video = await until(() => document.querySelector('video'), 'video')
        await click('重置番茄钟')
        video.muted = true
        await video.play()
        await until(() => document.querySelector('.pomodoro-heading')?.textContent.includes('进行中'), 'focus running')
        const originalNow = Date.now
        Date.now = () => originalNow() + 61000
        try {
          await until(
            () => video.paused && document.querySelector('.pomodoro-heading')?.textContent.includes('短休息'),
            'timer pauses video',
          )
        } finally {
          Date.now = originalNow
        }
      })
      await step('backup-ui-and-staged-restore', async () => {
        location.hash = '/?dialog=settings&section=backups'
        await until(() => document.querySelector('[data-testid="backup-settings"]'), 'backup panel')
        await click('立即备份')
        const backup = await until(
          async () => (await invoke('backup_status')).entries.find((e) => e.kind === 'manual'),
          'manual backup',
        )
        await click('恢复…')
        await until(() => document.body.textContent.includes('当前数据会先备份'), 'restore confirmation')
        await click('取消')
        await invoke('database_request', {
          endpoint: 'notes',
          method: 'POST',
          query: {},
          body: { courseId: 'smoke-course', videoPath: 'lesson-0.mp4', content: 'Newer note before restore' },
        })
        await invoke('restore_backup', { id: backup.id })
        expect((await storedNote()).content === 'Newer note before restore', 'Restore must wait for restart')
        expect(
          (await invoke('backup_status')).entries.some((e) => e.kind === 'before-restore'),
          'Safety backup missing',
        )
        let blocked = false
        try {
          await invoke('database_request', {
            endpoint: 'notes',
            method: 'POST',
            query: {},
            body: { courseId: 'smoke-course', videoPath: 'lesson-0.mp4', content: 'late write' },
          })
        } catch {
          blocked = true
        }
        expect(blocked, 'Late writes must be blocked after staging restore')
      })
    } else {
      await step('restart-restores-notion-binding-and-code-results', async () => {
        expect(
          (await storedNote()).content.includes('Original fixture'),
          'Legacy backup record did not survive restart',
        )
        route('lesson-0.mp4')
        await until(() => document.querySelector('[aria-label="Notion 笔记"]'), 'Notion panel after restart')
        await until(async () => {
          const probe = await invoke('desktop_smoke_notion', { text: null })
          return probe.probe?.text === 'Native Notion draft' && probe.probe?.hadCookie && !probe.hidden
        }, 'Notion page and browser session survive restart')
        await click('课后练习')
        expect((await editor()).getValue() === code, 'Monaco restored the wrong code')
        const record = await codeRecord()
        expect(
          record.codeRun.code === code && record.codeRun.cases.every((c) => c.status === 'passed'),
          'Stored results do not match restored code',
        )
        expect(!(await invoke('backup_status')).restorePending, 'Restore marker was not consumed')
      })
    }
    await invoke('desktop_smoke_report', { result: { success: true, steps, metrics: metrics() } })
  } catch (error) {
    await invoke('desktop_smoke_report', {
      result: {
        success: false,
        steps,
        error: String(error),
        metrics: metrics(),
        visibleText: document.body.innerText.slice(-8000),
      },
    })
  }
})()

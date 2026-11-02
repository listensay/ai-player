// Runs only in the isolated native desktop-smoke application.
void (async () => {
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const phase = globalThis.__AI_PLAYER_SMOKE_PHASE__
  const steps = []
  const probe = (action = null) => invoke('desktop_smoke_desktop', { action })
  const read = () =>
    invoke('database_request', { endpoint: 'settings', method: 'GET', query: { key: 'study-tools' }, body: null })
  async function until(work, label, timeout = 25000) {
    const start = performance.now()
    while (performance.now() - start < timeout) {
      const value = await work()
      if (value) return value
      await pause(100)
    }
    throw Error(`Timed out: ${label}`)
  }
  function expect(condition, message) {
    if (!condition) throw Error(message)
  }
  async function step(name, work) {
    await invoke('desktop_smoke_report', { result: { progress: name } })
    await work()
    steps.push(name)
  }
  const switchInput = (label) => {
    const node = [...document.querySelectorAll('#settings-general label')].find(
      (node) => node.textContent.trim() === label,
    )
    return node?.closest('.v-input')?.querySelector('input')
  }
  try {
    const initial = await until(async () => {
      const state = await probe()
      return state.ready && state
    }, 'frontend lifecycle ready')
    expect(initial.tray, 'Tray icon must exist')
    if (phase === 'desktop-settings-restart') {
      await step('autostart-launch-stays-in-tray', async () => {
        expect(!initial.visible, 'Autostart must not open the window')
        expect((await read()).reminderSound === true, 'Sound setting survives restart')
        await probe('open')
        expect((await probe()).visible, 'Tray action reopens autostart window')
        await pause(1200)
        expect((await probe()).soundPlays === 0, 'Previously delivered reminders do not ring again')
      })
    } else {
      location.hash = '/?dialog=settings&section=general'
      await until(() => switchInput('开机自启') && !switchInput('开机自启').disabled, 'general settings')
      await step('autostart-switch-writes-system-state', async () => {
        const original = await invoke('autostart_enabled')
        try {
          switchInput('开机自启').click()
          await until(async () => (await invoke('autostart_enabled')) === !original, 'autostart updates')
          await until(() => !switchInput('开机自启').disabled, 'autostart switch saved')
          switchInput('开机自启').click()
          await until(async () => (await invoke('autostart_enabled')) === original, 'autostart restored')
        } finally {
          await invoke('set_autostart', { enabled: original })
        }
      })
      await step('sound-setting-and-preview', async () => {
        switchInput('提醒响铃').click()
        await until(async () => (await read()).reminderSound === true, 'sound enabled')
        const preview = [...document.querySelectorAll('#settings-general button')].find(
          (node) => node.textContent.trim() === '试听',
        )
        preview.click()
        await until(async () => (await probe()).soundPlays === 1, 'native preview plays')
      })
      await step('close-hides-without-destroying-window', async () => {
        await probe('close')
        await until(async () => !(await probe()).visible, 'window hidden')
        expect((await probe()).tray, 'Tray remains after close')
        expect(switchInput('提醒响铃').checked, 'Settings view remains mounted')
      })
      await step('scheduled-reminder-rings-while-hidden-once', async () => {
        await until(async () => (await probe()).soundPlays === 2, 'hidden reminder sound', 50000)
        expect(!(await probe()).visible, 'Ringing must not force the window open')
        expect(
          (await read()).reminders.find((r) => r.id === 'smoke-sound-reminder').snoozedUntil === null,
          'Snooze consumed',
        )
        await pause(16000)
        expect((await probe()).soundPlays === 2, 'Repeated checks must not repeat the sound')
      })
      await step('tray-open-restores-window-and-settings', async () => {
        await probe('open')
        await until(async () => (await probe()).visible, 'window restored')
        expect(switchInput('提醒响铃').checked, 'Restored settings retain sound toggle')
      })
    }
    steps.push('tray-quit-flushes-and-exits')
    await invoke('desktop_smoke_report', { result: { success: true, steps, quit: true } })
  } catch (error) {
    await invoke('desktop_smoke_report', {
      result: { success: false, steps, error: String(error), visibleText: document.body.innerText.slice(-5000) },
    })
  }
})()

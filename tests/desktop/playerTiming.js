// Real media and timing regression in the isolated Tauri WebView.
void (async () => {
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const phase = globalThis.__AI_PLAYER_SMOKE_PHASE__
  const steps = []
  const mediaEvents = []
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const read = (endpoint, query = {}) => invoke('database_request', { endpoint, method: 'GET', query, body: null })
  const timing = async () => {
    const days = await read('check-in', { courseId: 'smoke-course' })
    return {
      video: Object.values(days).reduce((n, d) => n + d.seconds, 0),
      practice: Object.values(days).reduce((n, d) => n + (d.practiceSeconds ?? 0), 0),
    }
  }
  function expect(condition, message) {
    if (!condition) throw Error(message)
  }
  async function until(work, label, timeout = 30000) {
    const start = performance.now()
    while (performance.now() - start < timeout) {
      const value = await work()
      if (value) return value
      await pause(100)
    }
    throw Error(`Timed out: ${label}`)
  }
  async function step(name, work) {
    await invoke('desktop_smoke_report', { result: { progress: name } })
    await work()
    steps.push(name)
  }
  try {
    await until(() => document.querySelector('.home-page'), 'home ready')
    if (phase.endsWith('restart')) {
      await step('restart-keeps-video-and-practice-totals', async () => {
        const saved = await timing()
        expect(saved.video > 2 && saved.practice > 5, 'Both time categories survive restart')
        await pause(2500)
        expect(JSON.stringify(await timing()) === JSON.stringify(saved), 'Homepage does not count time')
      })
    } else {
      location.hash = '/courses/smoke-course/player?lesson=lesson-0.mp4'
      const video = await until(
        () => document.querySelector('video')?.readyState >= 2 && document.querySelector('video'),
        'video ready',
      )
      video.muted = true
      for (const event of ['play', 'pause', 'ended', 'waiting', 'playing']) {
        video.addEventListener(event, () => {
          mediaEvents.push({ event, at: performance.now(), time: video.currentTime, paused: video.paused })
        })
      }
      await step('player-entry-counts-practice-and-hides-reminders', async () => {
        await until(async () => (await timing()).practice >= 2, 'initial practice time')
        expect(video.paused, 'Entering the player does not automatically play')
        expect((await timing()).video === 0, 'Paused entry is not video time')
        expect(!document.querySelector('aside[aria-label="学习提醒"]'), 'Player entry is already learning')
      })
      await step('video-playback-counts-wall-time-without-practice-overlap', async () => {
        video.playbackRate = 2
        await video.play()
        await pause(3500)
        const during = await timing()
        await pause(2500)
        const after = await timing()
        expect(after.video > during.video + 1, 'Playback increases video time')
        expect(
          after.practice === during.practice,
          `Playback does not increase practice time: ${JSON.stringify({ during, after, paused: video.paused, time: video.currentTime })}`,
        )
        expect(after.video < 9, 'Double speed does not double the clock')
        video.pause()
      })
      await step('paused-and-ended-video-count-practice', async () => {
        await pause(2500)
        const paused = await timing()
        await until(async () => (await timing()).practice > paused.practice + 1, 'paused practice accrues')
        const practiced = await timing()
        expect(practiced.practice > paused.practice + 1, 'Pause increases practice time')
        expect(practiced.video === paused.video, 'Pause stops video time')
        video.currentTime = video.duration - 0.3
        await video.play()
        await until(() => video.ended, 'video ends')
        await pause(2500)
        const ended = await timing()
        await until(async () => (await timing()).practice > ended.practice + 1, 'post-video practice accrues')
        const stayed = await timing()
        expect(stayed.practice > ended.practice + 1, 'Staying after video ends counts practice')
        expect(stayed.video === ended.video, 'Ended video stops video time')
      })
      await step('hidden-player-does-not-count-time', async () => {
        await invoke('desktop_smoke_desktop', { action: 'close' })
        await until(async () => !(await invoke('desktop_smoke_desktop', { action: null })).visible, 'hidden player')
        await pause(500)
        const hidden = await timing()
        await pause(3000)
        expect(JSON.stringify(await timing()) === JSON.stringify(hidden), 'Tray does not accumulate time')
        await invoke('desktop_smoke_desktop', { action: 'open' })
        await until(async () => (await timing()).practice > hidden.practice + 1, 'practice resumes after tray open')
      })
      await step('leaving-player-stops-timing-and-home-shows-practice', async () => {
        location.hash = '/'
        await until(() => document.querySelector('.home-page'), 'return home')
        await pause(1000)
        const left = await timing()
        await pause(2500)
        expect(JSON.stringify(await timing()) === JSON.stringify(left), 'Leaving player stops both categories')
        const card = document.querySelector('[aria-label="累计学习时长"]')
        expect(card && card.textContent.includes('实践'), 'Home retains practice category')
        expect(left.practice > 5 && left.video > 2, 'Both categories recorded')
      })
    }
    await invoke('desktop_smoke_report', { result: { success: true, steps, quit: true } })
  } catch (error) {
    await invoke('desktop_smoke_report', {
      result: {
        success: false,
        steps,
        error: String(error),
        mediaEvents,
        visibleText: document.body.innerText.slice(-5000),
      },
    })
  }
})()

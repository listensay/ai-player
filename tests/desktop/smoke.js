// Runs inside the real Tauri WebView, only in the desktop-smoke feature build.
void (async () => {
  if (globalThis.__AI_PLAYER_SMOKE_RUNNING__) return
  globalThis.__AI_PLAYER_SMOKE_RUNNING__ = true
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const read = (endpoint, query = {}) => invoke('database_request', { endpoint, method: 'GET', query, body: null })
  const steps = []
  let ime = null
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
  async function checkLessonEndFlow() {
    await step('pomodoro-pauses-playing-video', async () => {
      const video = await until(() => document.querySelector('video'), 'video')
      await click('重置番茄钟')
      video.muted = true
      await video.play()
      await until(() => document.querySelector('.pomodoro-heading')?.textContent.includes('进行中'), 'focus running')
      video.pause()
      await until(
        () => document.querySelector('.pomodoro-heading')?.textContent.includes('已暂停'),
        'video pause pauses focus',
      )
      await video.play()
      await until(
        () => document.querySelector('.pomodoro-heading')?.textContent.includes('进行中'),
        'video resume resumes focus',
      )
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
      expect(
        !visible(document.getElementById('flow-check-title')),
        'Pomodoro completion must not prompt lesson feedback',
      )
    })
    await step('lesson-end-practice-and-single-feedback', async () => {
      const video = document.querySelector('video')
      await click('重置番茄钟')
      video.currentTime = video.duration - 0.5
      await video.play()
      await until(() => video.ended, 'actual media ended event')
      await editor()
      expect(!visible(document.getElementById('flow-check-title')), 'Practice must precede feedback')
      await click('关闭练习')
      await until(() => visible(document.getElementById('flow-check-title')), 'lesson feedback after practice')
      await click('😊 轻松跟上')
      const savedFlows = async () => (await read('settings', { key: 'learning-management:v1' })).flows
      await until(
        async () => (await savedFlows()).some((flow) => flow.path === 'lesson-0.mp4' && flow.mood === 'steady'),
        'lesson feedback saved',
      )
      await until(() => !visible(document.getElementById('flow-check-title')), 'feedback dismissed')
      video.currentTime = video.duration - 0.5
      await video.play()
      await until(() => video.ended, 'replayed lesson ends')
      await editor()
      await click('关闭练习')
      await until(() => !globalThis.__AI_PLAYER_SMOKE_EDITOR__, 'practice closed after replay')
      expect(!visible(document.getElementById('flow-check-title')), 'Replay must not ask for a second lesson state')
      expect(
        (await savedFlows()).filter((flow) => flow.path === 'lesson-0.mp4').length === 1,
        'Exactly one state per lesson',
      )
    })
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
    if (phase === 'lessons' || phase === 'lesson-restart') {
      route('lesson-0.mp4')
      await until(() => document.querySelector('video')?.readyState >= 2, 'lesson video ready')
      if (phase === 'lessons') await checkLessonEndFlow()
      else
        await step('restart-keeps-single-lesson-state', async () => {
          const flows = (await read('settings', { key: 'learning-management:v1' })).flows
          expect(
            flows.filter((flow) => flow.path === 'lesson-0.mp4').length === 1,
            'Saved lesson state survives restart',
          )
          expect(!visible(document.getElementById('flow-check-title')), 'Restart must not replay feedback')
          const video = document.querySelector('video')
          video.muted = true
          video.currentTime = video.duration - 0.5
          await video.play()
          await until(() => video.ended, 'lesson ends after restart')
          await editor()
          await click('关闭练习')
          await until(() => !globalThis.__AI_PLAYER_SMOKE_EDITOR__, 'practice closed after restart')
          expect(
            !visible(document.getElementById('flow-check-title')),
            'Saved state prevents duplicate feedback after replay',
          )
        })
    } else if (phase === 'first') {
      await step('learning-contract-edit-review-and-growth', async () => {
        location.hash = '/?dialog=study&section=outcomes'
        await click('签订学习契约')
        const goal = await until(
          () => document.querySelector('[aria-labelledby="learning-contract-title"] textarea'),
          'contract goal',
        )
        expect(goal.value === '', 'Whole-course contract must start with an empty goal')
        goal.value = '桌面回归实践目标'
        goal.dispatchEvent(new Event('input', { bubbles: true }))
        await click('签订契约')
        const stored = async () => read('settings', { key: 'learning-management:v1' })
        await until(async () => (await stored()).contracts[0]?.goal === '桌面回归实践目标', 'contract persisted')
        const original = (await stored()).contracts[0]
        await click('修改契约')
        const edit = await until(
          () => document.querySelector('[aria-labelledby="learning-contract-title"] textarea'),
          'edit contract',
        )
        expect(edit.value === original.goal, 'Edit must restore the saved goal')
        edit.value = '更新后的桌面回归实践目标'
        edit.dispatchEvent(new Event('input', { bubbles: true }))
        await click('保存修改')
        await until(async () => (await stored()).contracts[0]?.goal === edit.value, 'edited contract persisted')
        const contracts = (await stored()).contracts
        expect(
          contracts.length === 1 && contracts[0].id === original.id && contracts[0].signedAt === original.signedAt,
          'Editing must preserve contract identity without adding duplicates',
        )
        await click('抗遗忘复习')
        const review = await until(() => document.querySelector('[aria-label="抗遗忘复习"]'), 'weakness review')
        expect(review.textContent.includes('错题与薄弱项'), 'Weakness review remains available')
        expect(!/复习闪卡|显示答案|已牢记/.test(review.textContent), 'Flashcard queue controls must be removed')
        await click('成长与复盘')
        const growth = await until(() => document.querySelector('[aria-label="学习成长与复盘"]'), 'growth panel')
        expect(
          growth.firstElementChild.tagName === 'HEADER' && growth.firstElementChild.textContent.includes('Karen'),
          'Karen must appear at the top',
        )
        const health = await until(
          () => [...growth.querySelectorAll('h3')].find((node) => node.textContent === '计划健康度'),
          'plan health',
        )
        expect(
          getComputedStyle(health.closest('article')).backgroundColor === 'rgb(255, 255, 255)',
          'Plan health must retain its white card',
        )
        expect(
          getComputedStyle(growth.firstElementChild).backgroundColor === 'rgba(0, 0, 0, 0)',
          'Only the Karen header must be transparent',
        )
        expect(
          growth.querySelectorAll('.pane').length === 5 &&
            [...growth.querySelectorAll('.pane')].every(
              (card) => getComputedStyle(card).backgroundColor === 'rgb(255, 255, 255)',
            ),
          'The other growth sections must retain white cards',
        )
        await click('关闭学习管理')
      })
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
        const nativeUserAgent = (await probe()).probe?.userAgent ?? ''
        if (/Macintosh/u.test(nativeUserAgent) && /AppleWebKit/u.test(nativeUserAgent)) {
          expect(
            /Version\/\d+(?:\.\d+)* Safari\/605\.1\.15/u.test(nativeUserAgent),
            'Notion recognizes macOS WebKit as Safari',
          )
          expect(
            !/Chrome|Chromium|Electron/u.test(nativeUserAgent),
            'Notion must not use Chromium input handling on WebKit',
          )
        }
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

        if (globalThis.__AI_PLAYER_SMOKE_IME__) {
          await step('notion-chinese-ime', async () => {
            await until(
              async () => {
                const state = await probe()
                ime = { nativeInput: state.nativeInput, probe: state.probe }
                const result = state.probe
                return (
                  result?.text === '你好世界' &&
                  result.richText === '你好世界' &&
                  ['plain', 'rich'].every(
                    (editor) => result.compositionState?.[editor]?.started && result.compositionState?.[editor]?.ended,
                  )
                )
              },
              'Chinese IME composition/commit in both fixture editors (not paste)',
              600000,
            )
          })
        }

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
          expect(result.userAgent === nativeUserAgent, 'Login popup must keep the note panel browser profile')
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
      await checkLessonEndFlow()
      await step('legacy-note-features-removed', async () => {
        location.hash = '/?dialog=settings'
        await until(() => document.body.textContent.includes('桌宠设置'), 'settings panel')
        expect(!document.body.textContent.includes('备份与恢复'), 'Backup settings must be removed')
        expect(!document.querySelector('[aria-label="里程碑勋章"]'), 'Medals entry must be removed')
        let blocked = false
        try {
          await read('notes', { courseId: 'smoke-course', videoPath: 'lesson-0.mp4' })
        } catch {
          blocked = true
        }
        expect(blocked, 'Legacy local notes API must be disabled')
      })
    } else {
      await step('restart-restores-notion-binding-and-code-results', async () => {
        route('lesson-0.mp4')
        await until(() => document.querySelector('[aria-label="Notion 笔记"]'), 'Notion panel after restart')
        expect(!visible(document.getElementById('flow-check-title')), 'Restart must not replay saved lesson feedback')
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
      })
    }
    await invoke('desktop_smoke_report', { result: { success: true, steps, ime, metrics: metrics() } })
  } catch (error) {
    await invoke('desktop_smoke_report', {
      result: {
        success: false,
        steps,
        ime,
        error: String(error),
        metrics: metrics(),
        visibleText: document.body.innerText.slice(-8000),
      },
    })
  }
})()

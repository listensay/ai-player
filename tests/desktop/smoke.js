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
  function cursorIsRouted(state) {
    const cursor = state.cursorRouting
    return (
      !cursor ||
      (cursor.attached &&
        cursor.toolbarOwn &&
        cursor.notesOwn.every((owns) => owns === !state.hidden) &&
        cursor.hostOwn.every((owns) => owns === state.hidden))
    )
  }
  async function noteVisibility(hidden, label) {
    let state
    await until(async () => {
      state = await invoke('desktop_smoke_affine', { text: null })
      return state.exists && state.hidden === hidden && cursorIsRouted(state)
    }, label).catch((error) => {
      throw Error(`${error}: ${JSON.stringify(state?.cursorRouting)}`)
    })
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
    await step('playback-stays-user-controlled', async () => {
      const video = await until(() => document.querySelector('video'), 'video')
      video.muted = true
      video.currentTime = 0
      await video.play()
      const originalNow = Date.now
      Date.now = () => originalNow() + 26 * 60000
      try {
        await pause(1500)
        expect(!video.paused, 'Elapsed wall time must not pause playback')
        expect(!visible(document.getElementById('flow-check-title')), 'Playback must not prompt lesson feedback')
      } finally {
        Date.now = originalNow
      }
      video.pause()
      await pause(300)
      expect(!visible(document.getElementById('flow-check-title')), 'Pause must not prompt lesson feedback')
    })
    await step('lesson-end-practice-and-single-feedback', async () => {
      const video = await until(() => document.querySelector('video'), 'video')
      video.muted = true
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
  async function checkPracticeNavigation() {
    await step('practice-order-and-empty-answer-skipping', async () => {
      const leaveCourse = async () => {
        location.hash = '/courses'
        await until(
          () => !document.querySelector('video') && visible(document.querySelector('.course-card')),
          'course closed',
        )
        await pause(300)
      }
      await leaveCourse()
      const original = (await read('practice', { courseId: 'smoke-course' }))['lesson-0.mp4']
      const write = (records) =>
        invoke('database_request', {
          endpoint: 'practice',
          method: 'POST',
          query: {},
          body: { courseId: 'smoke-course', videoPath: 'lesson-0.mp4', records },
        })
      const base = { ...original[0], groupId: 'navigation', createdAt: Date.now(), draft: '', attempts: [] }
      delete base.codeRun
      const choice = {
        kind: 'single-choice',
        prompt: '第一题：数组索引从哪里开始？',
        concepts: ['数组索引'],
        criteria: ['选择正确索引'],
        referenceAnswer: '从零开始',
        sourceIds: ['s1'],
        options: [
          { id: 'A', text: '零' },
          { id: 'B', text: '一' },
        ],
        correctOptionIds: ['A'],
      }
      const records = [
        { ...base, id: 'navigation-first', question: choice },
        {
          ...base,
          id: 'navigation-second',
          question: { ...choice, kind: 'explain', prompt: '第二题：说明你的理解。' },
        },
        {
          ...base,
          id: 'navigation-third',
          question: original[0].question,
          draft: original[0].question.programming.starterCode,
        },
      ]
      await write([...records].reverse())
      try {
        route('lesson-0.mp4')
        await until(() => document.querySelector('video')?.readyState >= 2, 'practice lesson ready')
        await click('课后练习')
        const number = (value) =>
          document
            .querySelector('.practice-picker .v-field__input')
            ?.textContent.replace(/\s+/g, '')
            .includes(`第${value}题/3`)
        await until(
          () => number(1) && document.querySelector('.practice-question-text')?.textContent.includes('第一题'),
          'first question matches selection',
        )
        await click('跳过')
        await until(
          () => number(2) && document.querySelector('.practice-question-text')?.textContent.includes('第二题'),
          'second question matches selection',
        )
        expect(document.querySelector('textarea[aria-label="作答内容"]').value === '', 'Explanation starts empty')
        await click('跳过')
        await editor()
        expect(number(3), 'Programming question is third')
        expect(document.querySelector('.practice-toolbar [title="下一题"]').disabled, 'Third question is last')
        expect((await editor()).getValue() === records[2].draft, 'Third question has its own code draft')
        await click('跳过')
        await until(() => !visible(document.getElementById('practice-lesson-title')), 'last skip closes practice')
        await click('课后练习')
        await until(
          () => number(1) && document.querySelector('.practice-question-text')?.textContent.includes('第一题'),
          'reopening starts at first unanswered question',
        )
        await click('关闭练习')
        await until(() => !visible(document.getElementById('practice-lesson-title')), 'practice closes')
        const saved = (await read('practice', { courseId: 'smoke-course' }))['lesson-0.mp4']
        expect(
          saved.length === 3 && saved.every((record) => record.attempts.length === 0),
          'Skipping never submits or grades answers',
        )
      } finally {
        await leaveCourse()
        await write(original)
      }
    })
  }
  const captured = performance.getEntriesByType('measure')
  const observer = new PerformanceObserver((list) => captured.push(...list.getEntries()))
  observer.observe({ entryTypes: ['measure'] })
  const metrics = () =>
    captured.filter((m) => m.name.startsWith('ai-player:')).map(({ name, duration }) => ({ name, duration }))
  try {
    await step('home-load', async () => {
      location.hash = '/courses'
      await until(() => visible(document.querySelector('.course-card')), 'course in learning library')
      const library = await read('library')
      expect(library.length === 1 && library[0].id === 'smoke-course', 'Isolated library must have its fixture course')
      expect(
        document.querySelector('.course-card').textContent.includes(library[0].name),
        'Library must display the saved course name',
      )
    })
    if (phase === 'lessons' || phase === 'lesson-restart') {
      route('lesson-0.mp4')
      await until(() => document.querySelector('video')?.readyState >= 2, 'lesson video ready')
      if (phase === 'lessons') {
        await checkLessonEndFlow()
        await checkPracticeNavigation()
      } else
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
          growth.firstElementChild.tagName === 'HEADER' && growth.firstElementChild.textContent.includes('累计学习'),
          'Learning activity must appear at the top',
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
          'The activity header must be transparent',
        )
        expect(
          growth.querySelectorAll('.pane').length === 4 &&
            [...growth.querySelectorAll('.pane')].every(
              (card) => getComputedStyle(card).backgroundColor === 'rgb(255, 255, 255)',
            ),
          'The other growth sections must retain white cards',
        )
        await click('关闭学习管理')
        await until(
          () => ![...document.querySelectorAll('.v-overlay')].some(visible) && !location.hash.includes('dialog='),
          'learning manager closes before navigation',
        )
      })
      await step('affine-local-edit-switch-hide-restore', async () => {
        route('lesson-0.mp4')
        const probe = () => invoke('desktop_smoke_affine', { text: null })
        const noteList = async (path) =>
          until(
            async () => {
              const p = (await probe()).probe
              return p?.listReady && p.lesson?.path === path && p
            },
            'unbound lesson opens the note list',
            60000,
          )
        const initial = await noteList('lesson-0.mp4')
        expect(Number.isInteger(initial.docCount), 'Workspace document count must be available')
        route('lesson-1.mp4')
        expect((await noteList('lesson-1.mp4')).docCount === initial.docCount, 'Switching videos must not create notes')
        route('lesson-0.mp4')
        expect(
          (await noteList('lesson-0.mp4')).docCount === initial.docCount,
          'Reopening a video must not create notes',
        )
        await invoke('desktop_smoke_affine', { text: null, noteAction: 'create' })
        await until(async () => (await probe()).probe?.ready, 'manually created note opens')
        expect((await probe()).probe.docCount === initial.docCount + 1, 'Manual creation adds exactly one note')
        await invoke('desktop_smoke_affine', { text: null, noteAction: 'bind-lesson' })
        let lastNote
        await until(
          async () => {
            lastNote = (await probe()).probe
            return lastNote?.ready && lastNote.title === 'lesson-0' && lastNote.lesson?.path === 'lesson-0.mp4'
          },
          'local lesson note opens',
          60000,
        ).catch((error) => {
          throw Error(
            `${error}: ${JSON.stringify({ docId: lastNote?.docId, title: lastNote?.title, lesson: lastNote?.lesson })}`,
          )
        })
        const first = (await probe()).probe.docId
        await until(async () => (await probe()).probe?.ipcBlocked, 'notes cannot access the main database directly')
        expect(!(await probe()).probe.hasLogin, 'Local workspace has no account entry')
        const written = await invoke('desktop_smoke_affine', { text: 'Native AFFiNE draft' })
        expect(written.probe?.text === 'Native AFFiNE draft', `Local draft write returned: ${JSON.stringify(written)}`)
        await until(async () => (await probe()).probe?.text === 'Native AFFiNE draft', 'local editor stores its text')
        await until(async () => {
          const state = await probe(),
            rect = document.querySelector('.affine-webview-slot').getBoundingClientRect()
          return (
            Math.abs(state.position.x - Math.ceil(rect.left)) <= 1 &&
            Math.abs(
              state.position.y -
                Math.ceil(rect.top) -
                (state.windowGeometry.hostSize.height / state.windowGeometry.scale - innerHeight),
            ) <= 1
          )
        }, 'native notes align with the player panel')
        await noteVisibility(false, 'only notes own the covered cursor region')
        const overlay = document.createElement('div')
        overlay.setAttribute('data-native-webview-overlay', '')
        overlay.style.cssText = 'position:fixed;inset:0;z-index:4000'
        document.body.append(overlay)
        await noteVisibility(true, 'overlay hides notes and returns the cursor to the host')
        overlay.remove()
        await noteVisibility(false, 'notes return after overlay')
        await click('知识点')
        await noteVisibility(true, 'tab hides native notes')
        await click('笔记')
        await noteVisibility(false, 'tab restores native notes')
        await click('收起右侧面板')
        await noteVisibility(true, 'sidebar hides native notes')
        await click('展开右侧面板')
        await noteVisibility(false, 'sidebar restores native notes')
        await click('课后练习')
        await noteVisibility(true, 'practice hides notes')
        await editor()
        await click('关闭练习')
        await noteVisibility(false, 'closing practice restores notes')
        await click('全屏（F）')
        await noteVisibility(true, 'fullscreen hides notes')
        await click('退出全屏（F）')
        await noteVisibility(false, 'leaving fullscreen restores notes')
        const widthBefore = (await probe()).size.width
        document
          .querySelector('[aria-label="调整笔记面板宽度"]')
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
        await until(async () => (await probe()).size.width > widthBefore, 'resizing moves the native panel')
        await noteVisibility(false, 'resized notes own their cursor region')
        route('lesson-1.mp4')
        expect(
          (await noteList('lesson-1.mp4')).docCount === initial.docCount + 1,
          'Opening an unbound video after editing must not create another note',
        )
        await click('课后练习')
        const python = await editor()
        expect(python.getModel().getLanguageId() === 'python', 'Python language did not load')
        await click('关闭练习')
        await until(() => !globalThis.__AI_PLAYER_SMOKE_EDITOR__, 'Python editor disposed')
        route('lesson-0.mp4')
        await until(async () => {
          const p = (await probe()).probe
          return p?.docId === first && p.text === 'Native AFFiNE draft'
        }, 'lesson binding restores its local note')
        expect((await probe()).probe.docCount === initial.docCount + 1, 'Restoring a bound note must not duplicate it')
      })
      await step('notes-workspace-cursor-routing', async () => {
        location.hash = '/notes'
        await until(() => !document.querySelector('video'), 'standalone note workspace')
        await noteVisibility(false, 'standalone notes own their cursor region')
        location.hash = '/courses'
        await noteVisibility(true, 'course library restores the host cursor')
        route('lesson-0.mp4')
        await noteVisibility(false, 'returning to the player restores note cursor routing')
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
      await step('study-helper-about', async () => {
        location.hash = '/?dialog=settings&section=about'
        await until(() => visible(document.querySelector('#settings-about')), 'about panel')
        expect(
          document.querySelector('[aria-label="主导航"] [aria-label="Study Helper"]'),
          'Application name is visible',
        )
        expect(!document.querySelector('[aria-label="桌面挂件"]'), 'Companion entry is removed')
        expect(
          document.querySelector('#settings-about').textContent.includes('Study Helper'),
          'Application name is visible in about',
        )
        expect(!document.querySelector('#settings-companion'), 'Companion settings are removed')
        await click('关闭设置')
      })
      await step('legacy-note-features-removed', async () => {
        location.hash = '/?dialog=settings'
        await until(() => document.querySelector('#settings-ai'), 'settings panel')
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
      await step('restart-restores-local-notes-and-code-results', async () => {
        route('lesson-0.mp4')
        await until(() => document.querySelector('[aria-label="学习笔记"]'), 'Notes panel after restart')
        expect(!visible(document.getElementById('flow-check-title')), 'Restart must not replay saved lesson feedback')
        await until(async () => {
          const probe = await invoke('desktop_smoke_affine', { text: null })
          return (
            probe.probe?.text === 'Native AFFiNE draft' && probe.probe?.lesson?.path === 'lesson-0.mp4' && !probe.hidden
          )
        }, 'local document and lesson binding survive restart')
        await noteVisibility(false, 'cursor routing survives restart')
        await click('课后练习')
        expect((await editor()).getValue() === code, 'Monaco restored the wrong code')
        const record = await codeRecord()
        expect(
          record.codeRun.code === code && record.codeRun.cases.every((c) => c.status === 'passed'),
          'Stored results do not match restored code',
        )
      })
    }
    await invoke('desktop_smoke_report', { result: { success: true, steps, metrics: metrics() } })
  } catch (error) {
    await invoke('desktop_smoke_report', {
      result: {
        success: false,
        steps,
        error: String(error),
        note: await invoke('desktop_smoke_affine', { text: null }).catch(() => null),
        metrics: metrics(),
        visibleText: document.body.innerText.slice(-8000),
      },
    })
  }
})()

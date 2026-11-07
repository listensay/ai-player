// Exercises the homepage through the real Tauri window and isolated native database.
void (async () => {
  if (globalThis.__AI_PLAYER_SMOKE_RUNNING__) return
  globalThis.__AI_PLAYER_SMOKE_RUNNING__ = true
  // Background WKWebView CLI runs can suspend animation frames indefinitely.
  // Keep native frames when available, with a bounded fallback for UI transitions.
  const requestFrame = window.requestAnimationFrame.bind(window)
  const cancelFrame = window.cancelAnimationFrame.bind(window)
  const frames = new Map()
  window.requestAnimationFrame = (callback) => {
    const finish = (time) => {
      if (!frames.has(id)) return
      clearTimeout(frames.get(id))
      frames.delete(id)
      cancelFrame(id)
      callback(time)
    }
    const id = requestFrame(finish)
    frames.set(
      id,
      setTimeout(() => finish(performance.now()), 100),
    )
    return id
  }
  window.cancelAnimationFrame = (id) => {
    clearTimeout(frames.get(id))
    frames.delete(id)
    cancelFrame(id)
  }
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const request = (endpoint, method = 'GET', query = {}, body = null) =>
    invoke('database_request', { endpoint, method, query, body })
  const savedChats = () => request('settings', 'GET', { key: 'ai-chat-history:v1' })
  const steps = []
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const visible = (node) =>
    node &&
    node.getClientRects().length &&
    !node.closest('[inert]') &&
    !node.closest('.v-overlay:not(.v-overlay--active)')
  const expect = (condition, message) => {
    if (!condition) throw Error(message)
  }
  async function until(work, label) {
    const started = performance.now()
    while (performance.now() - started < 15000) {
      const result = await work()
      if (result) return result
      await pause(100)
    }
    throw Error(`Timed out: ${label}`)
  }
  async function step(name, work) {
    await invoke('desktop_smoke_report', { result: { progress: name } })
    await work()
    steps.push(name)
  }
  async function click(label, root = document) {
    const element = await until(
      () =>
        [...root.querySelectorAll('button,a,input[type="checkbox"]')].find(
          (el) =>
            visible(el) &&
            !el.disabled &&
            (el.textContent.trim() === label || el.title === label || el.getAttribute('aria-label') === label),
        ),
      `button ${label}`,
    )
    element.click()
  }
  async function input(selector, value) {
    const element = await until(() => {
      const el = document.querySelector(selector)
      return visible(el) && !el.disabled ? el : null
    }, selector)
    const prototype =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(100)
  }
  async function home() {
    location.hash = '/'
    await until(() => document.querySelector('.home-page [title="刷新首页"]')?.disabled === false, 'homepage ready')
  }
  const day = new Date()
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  try {
    await home()
    if (globalThis.__AI_PLAYER_SMOKE_PHASE__ === 'home') {
      await step('continue-learning-requires-study-history', async () => {
        expect(!document.querySelector('.resume-card'), 'Imported course without study history is hidden')
        const progress = {
          courseId: 'smoke-course',
          path: 'lesson-0.mp4',
          time: 0,
          duration: 120,
          ratio: 0,
          done: false,
        }
        await request('progress', 'POST', {}, progress)
        await click('刷新首页')
        await pause(300)
        expect(!document.querySelector('.resume-card'), 'Zero progress does not count as study')
        await request('progress', 'POST', {}, { ...progress, time: 30, ratio: 0.25 })
        await click('刷新首页')
        await until(() => document.querySelector('.resume-card'), 'Studied course appears')
        expect(document.querySelectorAll('.resume-card').length === 1, 'Only the studied course appears')
      })
      await step('actual-study-time-and-week-navigation', async () => {
        const yesterday = new Date(day)
        yesterday.setDate(yesterday.getDate() - 1)
        const previousDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
        await request(
          'check-in',
          'POST',
          {},
          {
            courseId: 'smoke-course',
            days: [
              { date: previousDate, seconds: 1800, targetSeconds: 3600, checkedAt: null },
              { date, seconds: 1800, targetSeconds: 3600, checkedAt: null },
            ],
          },
        )
        await click('刷新首页')
        await until(
          () => document.querySelector('[aria-label="累计学习时长"] > p')?.textContent.trim() === '1 小时',
          'cumulative study time is the main figure',
        )
        expect(
          document.querySelector('[aria-label="累计学习时长"] > p:last-child').textContent.trim() ===
            '今日投入 30 分钟',
          'Today remains secondary and excludes previous days',
        )
        const bars = document.querySelectorAll('[aria-label="每日学习时长"] button')
        expect(bars.length === 7, 'Week has seven calendar days')
        await click('上一周')
        await until(
          () => document.querySelector('[aria-label="本周学习趋势"]').textContent.includes('每周学习趋势'),
          'previous week',
        )
        await click('本周')
        await until(() => document.querySelector('[title="下一周"]').disabled, 'current week blocks future')
      })
      await step('homepage-retired-features-removed', async () => {
        expect(!document.querySelector('.home-page [aria-label="Todo"]'), 'Todo removed')
        expect(!document.querySelector('.home-page [aria-label="实践作品"]'), 'Portfolio removed')
        expect(!document.querySelector('.home-page').textContent.includes('学习契约'), 'Contracts removed')
        expect((await request('settings', 'GET', { key: 'home-tasks:v1' })) === null, 'Saved tasks deleted')
        const saved = await request('settings', 'GET', { key: 'learning-management:v1' })
        expect(
          ['contracts', 'works', 'cards', 'flows', 'protections'].every((key) => !Object.hasOwn(saved, key)) &&
            !Object.hasOwn(saved.preferences, 'flowPrompt'),
          'Retired records deleted',
        )
      })
      await step('homepage-responsive-layout', async () => {
        const main = document.querySelector('.home-page')
        main.scrollTop = 0
        expect(main.scrollWidth <= main.clientWidth + 1, 'Homepage has no horizontal overflow')
        const shell = document.querySelector('.home-shell')
        const oldWidth = main.style.maxWidth
        main.style.maxWidth = '620px'
        await pause(200)
        expect(shell.scrollWidth <= shell.clientWidth + 1, 'Narrow homepage has no horizontal overflow')
        const [today, trend] = document.querySelector('.home-summary-grid').children
        expect(trend.getBoundingClientRect().top >= today.getBoundingClientRect().bottom, 'Narrow cards stack')
        main.style.maxWidth = oldWidth
        await pause(4000)
      })
      await step('course-library-and-detail-use-full-width', async () => {
        const resumeCard = document.querySelector('.resume-card')
        expect(resumeCard?.classList.contains('course-card'), 'Homepage uses the shared course card')
        const cardStyles = (card) => {
          const body = card.querySelector('.course-card-body')
          const footer = card.querySelector('.course-card-footer')
          return [
            getComputedStyle(card).borderRadius,
            getComputedStyle(body).backgroundColor,
            getComputedStyle(body).borderRadius,
            getComputedStyle(body).minHeight,
            getComputedStyle(footer).padding,
            body.querySelector('.course-description').textContent.trim(),
            body.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),
            footer.textContent.trim().replace(/\s+/g, ' '),
          ]
        }
        const homeStyles = cardStyles(resumeCard)
        await click('网课学习')
        await until(() => document.querySelector('.course-library .course-card'), 'course library')
        expect(
          JSON.stringify(cardStyles(document.querySelector('.course-library .course-card'))) ===
            JSON.stringify(homeStyles),
          'Homepage and library share course-card colors, layout, progress and actions',
        )
        expect(!document.querySelector('.home-summary'), 'Course library has no summary sidebar')
        expect(document.querySelector('.home-layout').getBoundingClientRect().width > 850, 'Library fills the page')
        await click('桌面回归课程')
        await until(() => document.querySelector('.overview-catalog [data-path]'), 'course overview')
        expect(!document.querySelector('.overview-summaries'), 'Course overview has no summary sidebar')
        const catalog = document.querySelector('.overview-catalog').getBoundingClientRect()
        const header = document.querySelector('.overview-course-header').getBoundingClientRect()
        expect(Math.abs(catalog.width - header.width) < 2, 'Catalog fills the same width as header')
        await click('学习计划')
        await until(() => visible(document.getElementById('overview-plan-title')), 'plan dialog')
        expect(
          [...document.querySelectorAll('.overview-dialog button')].some((el) => el.textContent.trim() === '学习日历'),
          'Existing tools remain reachable',
        )
        await click('关闭学习计划')
      })
      await step('continue-learning-opens-the-saved-video', async () => {
        await home()
        const card = await until(() => document.querySelector('.resume-card'), 'recently studied course')
        const expected = 'lesson-0.mp4'
        await click('继续学习', card)
        await until(() => document.querySelector('video')?.readyState >= 1, 'video ready')
        expect(
          new URLSearchParams(location.hash.split('?')[1]).get('lesson') === expected,
          'Continue opens the selected lesson',
        )
        document.querySelector('video').pause()
        expect(document.querySelector('[aria-label="学习笔记"]'), 'Player retains its notes pane')
      })
      await step('ai-chat-model-switching-history-and-cancel', async () => {
        await click('AI助教')
        let panel = await until(() => document.querySelector('[aria-label="AI 聊天"]'), 'AI chat panel')
        for (const old of ['随堂问答', '整理文字', '知识脑图', '记忆闪卡', '费曼对练', '画面识别', '精华跳读'])
          expect(!panel.textContent.includes(old), `Retired tool removed: ${old}`)
        const selector = 'textarea[aria-label="消息"]'
        await input(selector, '第一行输入清晰可见\n第二行输入完整显示\n第三行也不会被裁切')
        const multiline = document.querySelector(selector)
        multiline.focus()
        const style = getComputedStyle(multiline)
        expect(style.webkitMaskImage === 'none' && style.maskImage === 'none', 'Textarea has no clipping mask')
        expect(multiline.clientHeight >= 72 && multiline.scrollHeight <= multiline.clientHeight + 1, 'Three lines fit')
        expect(style.color !== 'rgba(0, 0, 0, 0)', 'Typed content is visible')
        const composer = panel.querySelector('.ai-composer').getBoundingClientRect()
        const field = multiline.getBoundingClientRect()
        expect(field.top >= composer.top && field.bottom <= composer.bottom, 'Text stays inside composer')
        await invoke('desktop_smoke_report', { result: { progress: 'ai-chat-multiline-visible' } })
        await pause(4000)
        await input(selector, '你好')
        const textarea = document.querySelector(selector)
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
        expect(!panel.querySelector('[aria-label="你的消息"]'), 'Composition and Shift+Enter do not send')
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await until(() => panel.textContent.includes('chat-one：你好；历史 0'), 'first chat response')
        async function model(title) {
          const select = panel.querySelector('[role="combobox"]')
          select.focus()
          select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
          const option = await until(
            () =>
              [...document.querySelectorAll('[role="option"]')].find(
                (el) => visible(el) && el.textContent.includes(title),
              ),
            `model ${title}`,
          )
          option.click()
          await pause(150)
        }
        await model('chat-two')
        await input(selector, '继续')
        await click('发送', panel)
        await until(() => panel.textContent.includes('chat-two：继续；历史 1'), 'new model receives previous chat')
        await model('chat-native')
        await input(selector, '再继续')
        await click('发送', panel)
        await until(() => panel.textContent.includes('chat-native：再继续；历史 2'), 'Anthropic chat receives history')
        expect(
          (await request('settings', 'GET', { key: 'ai_settings' })).activeId === '',
          'Chat does not change global AI settings',
        )
        await input(selector, '慢回复')
        await click('发送', panel)
        await click('停止', panel)
        await until(() => panel.textContent.includes('已停止'), 'cancel preserves stopped message')
        expect(panel.querySelectorAll('[aria-label="你的消息"]').length === 4, 'Every submitted message is displayed')
        expect(panel.scrollWidth <= panel.clientWidth + 1, 'Chat does not overflow panel')
        await click('新对话', panel)
        expect(!panel.querySelector('[aria-label="你的消息"]'), 'New chat clears previous conversation')
        await click('历史对话', panel)
        await until(() => visible(document.querySelector('[aria-label="历史对话列表"]')), 'history dialog opens')
        await input('input[aria-label="搜索对话"]', '不存在的对话')
        expect(
          document.querySelector('[aria-label="历史对话列表"]').textContent.includes('未找到对话'),
          'History search filters',
        )
        await input('input[aria-label="搜索对话"]', '你好')
        await until(() => {
          const dialog = document.querySelector('[aria-label="历史对话列表"]')
          const rect = dialog.getBoundingClientRect()
          const front = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return rect.width > 200 && rect.height > 100 && dialog.contains(front)
        }, 'history dialog is visible above the player')
        await invoke('desktop_smoke_report', { result: { progress: 'ai-chat-history-visible' } })
        await pause(4000)
        await click('打开对话：你好')
        await until(() => panel.querySelectorAll('[aria-label="你的消息"]').length === 4, 'old conversation restored')
        await input(selector, '从历史继续')
        await click('发送', panel)
        await until(
          () => panel.textContent.includes('chat-native：从历史继续；历史 3'),
          'history resumes with previous replies',
        )
        const oldLesson = new URLSearchParams(location.hash.split('?')[1]).get('lesson')
        const newLesson = oldLesson === 'lesson-1.mp4' ? 'lesson-0.mp4' : 'lesson-1.mp4'
        location.hash = `/courses/smoke-course/player?lesson=${newLesson}`
        panel = await until(() => {
          const current = document.querySelector('[aria-label="AI 聊天"]')
          return current && current !== panel ? current : null
        }, 'AI panel for the next video')
        await until(
          () => !panel.querySelector('[aria-label="你的消息"]'),
          'switching videos opens a blank conversation',
        )
        await input(selector, '新视频的问题')
        await click('发送', panel)
        await until(
          () => panel.textContent.includes('新视频的问题；历史 0'),
          'new video starts without previous context',
        )
        location.hash = `/courses/smoke-course/player?lesson=${oldLesson}`
        panel = await until(() => {
          const current = document.querySelector('[aria-label="AI 聊天"]')
          return current && current !== panel ? current : null
        }, 'AI panel for the original video')
        await until(
          () => !panel.querySelector('[aria-label="你的消息"]'),
          'returning to a video still opens a new conversation',
        )
        await click('历史对话', panel)
        await click('打开对话：新视频的问题')
        await until(() => panel.textContent.includes('新视频的问题；历史 0'), 'other video history can be viewed')
        expect(!panel.querySelector(selector), 'Other video context cannot be used accidentally for a follow-up')
        await click('新对话', panel)
        await until(() => visible(panel.querySelector(selector)), 'new conversation restores the composer')
        await until(async () => {
          const chats = await savedChats()
          return chats?.sessions.length === 2 && chats.sessions.every((chat) => chat.turns.at(-1).status === 'done')
        }, 'all conversations persisted to the native database')
        await home()
      })
    } else {
      await step('homepage-retired-features-stay-deleted-after-restart', async () => {
        expect((await request('settings', 'GET', { key: 'home-tasks:v1' })) === null, 'Tasks stay deleted')
        const saved = await request('settings', 'GET', { key: 'learning-management:v1' })
        expect(
          ['contracts', 'works', 'cards', 'flows', 'protections'].every((key) => !Object.hasOwn(saved, key)) &&
            !Object.hasOwn(saved.preferences, 'flowPrompt'),
          'Records stay deleted',
        )
        expect(
          !/Todo|实践作品|学习契约/.test(document.querySelector('.home-page').textContent),
          'Features stay removed',
        )
      })
      await step('notes-and-home-have-separate-navigation', async () => {
        await click('笔记', document.querySelector('[aria-label="页面导航"]'))
        await until(
          () => location.hash === '#/notes' && document.querySelector('.affine-webview-slot'),
          'notes workspace route',
        )
        await click('首页', document.querySelector('[aria-label="页面导航"]'))
        await until(() => document.querySelector('.home-page'), 'return to homepage')
      })
      await step('ai-chat-history-survives-native-restart', async () => {
        location.hash = '/courses/smoke-course/player?lesson=lesson-0.mp4'
        await until(() => document.querySelector('video')?.readyState >= 1, 'reopened player')
        document.querySelector('video').pause()
        await click('AI助教')
        const panel = await until(() => document.querySelector('[aria-label="AI 聊天"]'), 'reopened AI chat')
        expect(!panel.querySelector('[aria-label="你的消息"]'), 'Restart starts with a new conversation')
        await click('历史对话', panel)
        await click('打开对话：你好')
        await until(
          () => panel.querySelectorAll('[aria-label="你的消息"]').length === 5,
          'history restored after restart',
        )
        expect(panel.textContent.includes('chat-native：从历史继续；历史 3'), 'Saved answers survive restart')
        expect((await savedChats()).sessions.length === 2, 'Both videos keep their conversations')
      })
    }
    await invoke('desktop_smoke_report', { result: { success: true, steps } })
  } catch (error) {
    await invoke('desktop_smoke_report', { result: { success: false, steps, error: String(error) } })
  }
})()

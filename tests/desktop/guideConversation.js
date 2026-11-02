// AI-driven interactive forms through the real native HTTP transport and Vuetify controls.
void (async () => {
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const phase = globalThis.__AI_PLAYER_SMOKE_PHASE__
  const steps = []
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const visible = (node) => node && node.getClientRects().length && !node.closest('[inert]')
  const read = (endpoint, query) => invoke('database_request', { endpoint, method: 'GET', query, body: null })
  const saved = () => read('settings', { key: 'guide-conversation:v1:smoke-course' })
  async function until(work, label, timeout = 30000) {
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
  async function click(title) {
    const button = await until(
      () =>
        [...document.querySelectorAll('button')].find(
          (node) =>
            visible(node) &&
            !node.disabled &&
            (node.textContent.trim() === title || node.title === title || node.getAttribute('aria-label') === title),
        ),
      title,
    )
    button.click()
  }
  async function step(name, task) {
    await invoke('desktop_smoke_report', { result: { progress: name } })
    await task()
    steps.push(name)
  }
  const field = (label) =>
    [...document.querySelectorAll('[aria-label="导学对话"] label')]
      .find((node) => node.textContent.trim() === label)
      ?.closest('.v-input')
      ?.querySelector('input,textarea')
  function input(label, text) {
    const node = field(label)
    expect(node && !node.disabled, `Input ${label}`)
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    ).set.call(node, text)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }
  async function choose(label) {
    const node = await until(
      () =>
        [...document.querySelectorAll('.ai-interaction-form label')].find(
          (node) => visible(node) && node.textContent.trim() === label,
        ),
      label,
    )
    node.click()
  }
  try {
    await until(() => document.querySelector('.home-page'), 'home ready')
    location.hash = '/courses/smoke-course/player?lesson=lesson-0.mp4'
    await until(() => document.querySelector('video')?.readyState >= 2, 'player ready')
    await click('查看今日学习计划')
    await click('定制路线')
    if (phase.endsWith('restart')) await click('调整路线')
    await until(() => document.querySelector('[aria-label="导学对话"]'), 'guide conversation')
    if (phase.endsWith('restart')) {
      await step('interactive-history-and-plan-survive-restart', async () => {
        const data = await saved()
        expect(data.turns.length === 4, 'User constraints and original answers retained')
        expect(data.turns[0].answers.equation === 'no', 'Math answer retained')
        expect(data.turns[1].answers.pace === 'steady', 'Selected scheme retained')
        expect(
          (await read('guide', { courseId: 'smoke-course' })).plan.dailyMinutes === 45,
          'AI recommendation retained',
        )
        expect(
          (await read('guide', { courseId: 'smoke-course' })).plan.lessons.length === 493,
          'Complete route retained',
        )
        expect(
          data.constraints.order === 'catalog' && data.constraints.excludedFolders.length === 4,
          'Confirmed constraints retained',
        )
      })
      await step('reset-conversation-preserves-route-and-progress', async () => {
        const before = await read('guide', { courseId: 'smoke-course' })
        const progress = await read('progress', { courseId: 'smoke-course' })
        await click('重新定制')
        const dialog = await until(() => document.querySelector('[aria-label="重新定制"]'), 'reset confirmation')
        const confirm = [...dialog.querySelectorAll('button')].find(
          (button) => button.textContent.trim() === '重新定制',
        )
        confirm.click()
        await until(async () => (await saved()).turns.length === 0, 'conversation reset saved')
        await until(
          async () => (await read('guide', { courseId: 'smoke-course' })).plan.messages.length === 0,
          'embedded messages cleared',
        )
        const after = await read('guide', { courseId: 'smoke-course' })
        expect(JSON.stringify(after.plan.lessons) === JSON.stringify(before.plan.lessons), 'Course route preserved')
        expect(JSON.stringify(after.mastery) === JSON.stringify(before.mastery), 'Mastery preserved')
        expect(
          JSON.stringify(await read('progress', { courseId: 'smoke-course' })) === JSON.stringify(progress),
          'Viewing progress preserved',
        )
        expect(
          [...document.querySelectorAll('button')].some(
            (node) => visible(node) && node.textContent.trim() === 'AI 定制初始化',
          ),
          'Ready for fresh questionnaire',
        )
      })
      await step('explicit-remaining-scope-without-questionnaire-submission', async () => {
        const progress = await read('progress', { courseId: 'smoke-course' })
        await click('AI 定制初始化')
        await until(() => document.querySelector('.ai-interaction-form'), 'fresh questionnaire')
        input('消息', '不学的章节：\n1安装软件教程\n2python快速入门\n3数据科学必备工具包\n环境\n\n剩下的都是要学的内容')
        await click('发送')
        const data = await until(async () => {
          const value = await saved()
          return value.turns.at(-1)?.replySource === 'selection' && value
        }, 'explicit selection accepted without answers')
        expect(data.turns.length === 2 && !data.turns[0].answers, 'Questionnaire need not be submitted')
        expect(data.constraints.excludedFolders.length === 4, 'Abbreviated names match all four source directories')
        expect(!document.querySelector('.guide-turn:last-child .ai-interaction-form'), 'No repeated questionnaire')
        const arrangement = document.querySelector('[aria-label="已确认的学习安排"]')
        expect(arrangement?.textContent.includes('6-方向导数'), 'Saved progress determines the continuation')
        expect(!arrangement.textContent.includes('原目录顺序'), 'No order explanation')
        await click('生成调整方案')
        await click('应用调整')
        const plan = await until(async () => {
          const value = (await read('guide', { courseId: 'smoke-course' })).plan
          return value?.profile === '已选择其余课程全部学习。' && value
        }, 'full route generated from explicit scope')
        expect(
          plan.lessons
            .filter((lesson) => /^[123]-|^环境\//.test(lesson.path))
            .every((lesson) => lesson.status === 'skipped'),
          'Exclusions cannot re-enter the route',
        )
        expect(
          plan.lessons.filter((lesson) => /^[456] /.test(lesson.path)).every((lesson) => lesson.status === 'required'),
          'All remaining mathematics, algorithms and projects are required',
        )
        expect(
          JSON.stringify(await read('progress', { courseId: 'smoke-course' })) === JSON.stringify(progress),
          'No viewing progress changes',
        )
      })
    } else {
      await step('initialize-with-course-catalog-and-no-fixed-fields', async () => {
        await until(
          () =>
            [...document.querySelectorAll('button')].some(
              (node) => visible(node) && !node.disabled && node.textContent.trim() === 'AI 定制初始化',
            ),
          'initialization ready',
        )
        expect(!field('每日学习时间（选填）'), 'Daily time field removed')
        expect(!field('预计完成学习时间（选填）'), 'Deadline field removed')
        expect(!field('学习背景与目标') && !field('消息'), 'No initial typed requirement')
        expect(!document.querySelector('[aria-label="AI 定制进度"]'), 'Implementation steps are not shown')
        expect(
          !['项目开发', '系统入门', '知识巩固'].some((title) =>
            [...document.querySelectorAll('button')].some((node) => visible(node) && node.textContent.trim() === title),
          ),
          'No fixed goal chips',
        )
        const profile = document.querySelector('[aria-label="导学对话"] .ai-profile-selector')
        expect(profile, 'Profile control mounted before initialization')
        await click('AI 定制初始化')
        await until(() => document.querySelector('.guide-thinking'), 'visible loading state')
        expect(
          document.querySelector('[aria-label="导学对话"] .ai-profile-selector') === profile,
          'Profile control remains mounted while generating',
        )
        const value = profile.querySelector('.ai-profile-value')
        const bounds = value.getBoundingClientRect()
        const fieldBounds = profile.querySelector('.v-field__input').getBoundingClientRect()
        expect(
          bounds.height >= 20 && bounds.top >= fieldBounds.top - 1 && bounds.bottom <= fieldBounds.bottom + 1,
          'Selected model is fully visible and unclipped',
        )
        expect(Number.parseFloat(getComputedStyle(value).fontSize) >= 14, 'Model value has readable type size')
        expect(
          getComputedStyle(profile.querySelector('.v-field')).opacity === '1',
          'Generating does not fade the model name',
        )
        expect(document.querySelector('.guide-thinking-track'), 'Indeterminate waiting indicator present')
        expect(!document.querySelector('.guide-user-message'), 'Initialization is not an empty chat bubble')
      })
      await step('AI-corrects-JSON-and-receives-questionnaire', async () => {
        await until(() => document.querySelector('.ai-interaction-form'), 'dynamic form')
        expect(
          document.querySelectorAll('.ai-interaction-form input[type="radio"]:checked').length === 0,
          'No preset answers',
        )
        expect((await saved()).turns[0].kind === 'initialization', 'Initialization recorded')
        expect(
          (await saved()).turns[0].reply.profile === '',
          'Valid questionnaire is accepted without an invented profile',
        )
        await choose('四则运算基本没问题，但分数、小数容易出错')
        await choose('完全不懂')
        input('最想用 AI 做什么？', '分析数据')
        await click('看看适合我的方案')
        await until(
          () =>
            [...document.querySelectorAll('.ai-interaction-form')].some((node) =>
              node.textContent.includes('稳步推进'),
            ),
          'AI-generated schemes',
        )
        expect(!(await read('guide', { courseId: 'smoke-course' })).plan, 'Questionnaire does not replace route')
        expect((await saved()).turns.length === 2, 'Format correction does not duplicate questionnaire answers')
      })
      await step('profile-actions-align-with-field-at-wide-and-narrow-widths', async () => {
        const panel = document.querySelector('[aria-label="导学对话"]')
        const profile = panel.querySelector('.ai-profile-selector')
        const field = profile.querySelector('.ai-profile-row .v-field')
        const action = [...profile.querySelectorAll('button')].find((node) => node.textContent.trim() === '重新定制')
        expect(action, 'Reset action shares the profile field row')
        expect(profile.querySelectorAll('.ai-profile-field').length === 2, 'Additional model selector is mounted')
        const aligned = () => {
          const control = field.getBoundingClientRect()
          const button = action.getBoundingClientRect()
          expect(button.left >= control.right, 'Action sits beside the field')
          expect(
            Math.abs(control.top + control.height / 2 - button.top - button.height / 2) <= 1,
            'Action aligns with the field, not its label or second selector',
          )
        }
        aligned()
        const value = profile.querySelector('.ai-profile-value')
        const original = value.textContent
        value.textContent = '长配置名称 · guide-fixture-with-a-long-model-identifier-for-alignment-regression'
        await pause(100)
        expect(field.getBoundingClientRect().height > 48, 'Long selected value wraps')
        aligned()
        value.textContent = original
        panel.style.maxWidth = '360px'
        await pause(100)
        const control = field.getBoundingClientRect()
        const button = action.getBoundingClientRect()
        expect(button.top >= control.bottom, 'Narrow layout wraps the action below the field')
        expect(Math.abs(button.left - control.left) <= 1, 'Wrapped action aligns with the field left edge')
        expect(profile.scrollWidth <= profile.clientWidth + 1, 'Narrow profile controls do not overflow')
        panel.style.maxWidth = ''
      })
      await step('scheme-selection-and-confirmed-generation', async () => {
        const label = [...document.querySelectorAll('.ai-interaction-form label')].find((node) =>
          node.textContent.includes('稳步推进'),
        )
        label.click()
        await click('采用这个节奏')
        await until(
          () =>
            [...document.querySelectorAll('button')].some(
              (node) => visible(node) && node.textContent.trim() === '生成学习路线',
            ),
          'generation confirmation',
        )
        expect(!(await read('guide', { courseId: 'smoke-course' })).plan, 'AI does not auto-apply scheme')
        await click('生成学习路线')
        await until(
          async () => (await read('guide', { courseId: 'smoke-course' })).plan?.dailyMinutes === 45,
          'route uses AI suggestion',
        )
        const data = await saved()
        expect(data.turns[0].answers.equation === 'no', 'Answer recorded')
        expect(data.turns[1].answers.pace === 'steady', 'Scheme recorded')
        const plan = (await read('guide', { courseId: 'smoke-course' })).plan
        expect(
          plan.lessons.length === 493 && new Set(plan.lessons.map((l) => l.path)).size === 493,
          'All 493 lessons covered',
        )
        expect(
          plan.lessons.some((l) => l.status === 'skipped'),
          'Skipped lessons are still included',
        )
        expect(plan.catalogVersion === 1, 'Original catalog bound to route')
        for (const [title, count] of [
          ['28.隐马尔科夫模型', 10],
          ['29.HMM应用实例', 4],
        ]) {
          const module = plan.modules.find((entry) => entry.title === title)
          expect(
            module && plan.lessons.filter((lesson) => lesson.moduleId === module.id).length === count,
            `Separate source directory ${title}`,
          )
        }
        const dependent = plan.lessons.find((l) => l.prerequisites.length)
        expect(
          plan.lessons.findIndex((l) => l.path === dependent.prerequisites[0]) < plan.lessons.indexOf(dependent),
          'Cross-batch prerequisite precedes dependent',
        )
      })
      await step('reopen-keeps-forms-and-narrow-layout', async () => {
        await click('关闭导学')
        await click('查看今日学习计划')
        await click('定制路线')
        await click('调整路线')
        await until(() => document.querySelector('.ai-interaction-form'), 'forms restored')
        const panel = document.querySelector('[aria-label="导学对话"]')
        panel.style.maxWidth = '360px'
        await pause(300)
        expect(panel.scrollWidth <= panel.clientWidth + 1, 'Dynamic form fits narrow width')
        expect(
          document.querySelectorAll('.ai-interaction-form input[type="radio"]:checked').length === 3,
          'Saved selections restored',
        )
      })
      await step('user-range-order-and-resume-are-authoritative', async () => {
        const panel = document.querySelector('[aria-label="导学对话"]')
        panel.style.maxWidth = ''
        input('消息', '不学1、2、3和环境目录，其余都学。我的学习路线从4开始到6结束，按原来的顺序学习，不要改学习顺序。')
        await click('发送')
        await until(() => document.querySelector('[aria-label="已确认的学习安排"]'), 'confirmed learning arrangement')
        const arrangement = document.querySelector('[aria-label="已确认的学习安排"]')
        expect(arrangement.textContent.includes('6-方向导数'), 'Real first unfinished lesson is the next lesson')
        expect(
          [...arrangement.querySelectorAll('dt')].every((node) => node.textContent.trim() !== '顺序'),
          'Order explanation is not displayed',
        )
        expect(
          !arrangement.textContent.includes('原目录顺序') && arrangement.textContent.includes('学习范围'),
          'Learning scope remains without order explanation',
        )
        expect(
          !document.querySelector('.guide-turn:last-child .ai-interaction-form'),
          'No redundant questionnaire after direct selection',
        )
        expect(arrangement.scrollWidth <= arrangement.clientWidth + 1, 'Confirmed selection wraps without overflow')
        if (await read('settings', { key: 'guide_visual_hold' }))
          await until(
            async () => !(await read('settings', { key: 'guide_visual_hold' })),
            'visual verification released',
            90000,
          )
        await click('生成调整方案')
        await click('应用调整')
        const plan = await until(async () => {
          const current = (await read('guide', { courseId: 'smoke-course' })).plan
          return current?.constraints?.order === 'catalog' && current
        }, 'confirmed order is saved')
        const selected = plan.lessons.filter((lesson) => lesson.status === 'required')
        expect(
          selected.every((lesson) => /^[456] /.test(lesson.path)),
          'Only chapters 4 through 6 are selected',
        )
        expect(
          plan.lessons
            .filter((lesson) => /^[123]-|^环境\//.test(lesson.path))
            .every((lesson) => lesson.status === 'skipped'),
          'Excluded directories remain excluded',
        )
        const first = selected.find((lesson) => !/高等数学基础\/[1-5]-/.test(lesson.path))
        expect(first.path.endsWith('6-方向导数.mp4'), 'Directional derivative is not skipped')
        expect(
          selected[selected.indexOf(first) + 1].path.endsWith('7-梯度.mp4'),
          'Gradient follows directional derivative',
        )
        await click('继续学习')
        await until(
          () => decodeURIComponent(location.hash).includes('6-方向导数.mp4'),
          'player opens the correct next lesson',
        )
      })
      await step('route-sidebar-keeps-source-hierarchy-and-renumbers', async () => {
        await click('显示全部')
        const search = document.querySelector('[aria-label="课程目录"] input[type="search"]')
        expect(search, 'Directory search mounted')
        const query = (value) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, value)
          search.dispatchEvent(new Event('input', { bubbles: true }))
        }
        for (const [term, source, count, label] of [
          ['隐马尔科夫模型', '28.隐马尔科夫模型', 10, '2. 隐马尔科夫模型'],
          ['HMM应用实例', '29.HMM应用实例', 4, '3. HMM应用实例'],
        ]) {
          query(term)
          const branch = await until(
            () => document.querySelector(`[data-path="5 机器学习算法精讲/${source}"]`),
            `Source branch ${source}`,
          )
          expect(branch.textContent.includes(label), 'Numbering follows complete route, not search results')
          expect(branch.title === source, 'Original directory name retained')
          await until(
            () => document.querySelectorAll('[aria-label="学习路线目录"] button[data-route-position]').length === count,
            `All ${count} source lessons displayed`,
          )
          const parent = document.querySelector('[data-path="5 机器学习算法精讲"]')
          expect(parent && parent.textContent.includes('2. 机器学习算法精讲'), 'Original parent hierarchy retained')
        }
        query('')
      })
    }
    await invoke('desktop_smoke_report', { result: { success: true, steps, quit: true } })
  } catch (error) {
    await invoke('desktop_smoke_report', {
      result: { success: false, steps, error: String(error), visibleText: document.body.innerText.slice(-7000) },
    })
  }
})()

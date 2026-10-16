// Real directory scan, nested expansion and playback in the isolated Tauri fixture.
void (async () => {
  if (globalThis.__AI_PLAYER_SMOKE_RUNNING__) return
  globalThis.__AI_PLAYER_SMOKE_RUNNING__ = true
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const steps = []
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const expect = (condition, message) => {
    if (!condition) throw Error(message)
  }
  const visible = (node) => node && node.getClientRects().length && !node.closest('[inert]')
  const folder = (path) => document.querySelector(`[data-folder="${CSS.escape(path)}"]`)
  const lesson = (path) => document.querySelector(`.overview-catalog [data-path="${CSS.escape(path)}"]`)
  async function until(work, label) {
    const start = performance.now()
    while (performance.now() - start < 15000) {
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
  async function click(text) {
    const node = await until(
      () =>
        [...document.querySelectorAll('button,.v-list-item')].find(
          (el) => visible(el) && !el.disabled && (el.textContent.trim() === text || el.title === text),
        ),
      text,
    )
    node.click()
  }
  async function search(value) {
    const input = document.querySelector('.overview-catalog input[type="search"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(250)
  }
  try {
    location.hash = '/courses/smoke-course'
    await until(() => folder('01-基础') && folder('02-进阶'), 'scanned folders')
    await step('folder-hierarchy-and-current-lesson', async () => {
      await until(() => visible(lesson('02-进阶/01-入门/一.mp4')), 'current lesson ancestors expanded')
      expect(!lesson('01-基础/01-入门/1.mp4'), 'Other folders must remain collapsed')
      expect(visible(lesson('介绍.mp4')), 'Root lesson remains at root')
      folder('01-基础').querySelector('button').click()
      await until(() => folder('01-基础/01-入门'), 'first nested folder')
      folder('01-基础/01-入门').querySelector('button').click()
      await until(() => visible(lesson('01-基础/01-入门/1.mp4')), 'nested lesson')
      expect(folder('01-基础').contains(folder('01-基础/01-入门')), 'Folder nesting must match filesystem')
      expect(folder('02-进阶').contains(folder('02-进阶/01-入门')), 'Same-named subfolders remain distinct')
      expect(!lesson('01-基础/01-入门/13.mp4'), 'Long folders are paginated')
      const next = [...folder('01-基础/01-入门').querySelectorAll('button')].find(
        (el) => el.textContent.trim() === '下一页',
      )
      next.click()
      await until(() => visible(lesson('01-基础/01-入门/13.mp4')), 'second folder page')
      expect(!lesson('01-基础/01-入门/1.mp4'), 'Only current page mounts its lessons')
    })
    await step('search-and-filter-preserve-folder-context', async () => {
      await search('13.mp4')
      await until(() => visible(lesson('01-基础/01-入门/13.mp4')), 'search result')
      expect(folder('01-基础') && folder('01-基础/01-入门'), 'Search keeps all ancestors')
      expect(!folder('02-进阶'), 'Unmatched folder hidden')
      await click('已完成')
      await until(
        () => document.querySelector('.overview-catalog').textContent.includes('未找到匹配的课节'),
        'empty completion filter',
      )
      await click('全部')
      await search('')
      await until(() => visible(lesson('02-进阶/01-入门/一.mp4')), 'current lesson restored after search')
      await click('目录选项')
      await click('全部收起')
      await until(() => !lesson('02-进阶/01-入门/一.mp4'), 'all collapsed')
      await click('目录选项')
      await click('全部展开')
      await until(() => visible(lesson('01-基础/01-入门/1.mp4')), 'all expanded')
    })
    await step('catalog-nested-layout', async () => {
      const viewport = document.querySelector('.overview-page')
      viewport.scrollTop = document.querySelector('.overview-catalog').offsetTop
      await pause(4000)
      expect(viewport.scrollWidth <= viewport.clientWidth + 1, 'No horizontal overflow')
    })
    await step('nested-lesson-opens-correct-video', async () => {
      lesson('01-基础/01-入门/2.mp4').click()
      await until(() => location.hash.includes('/player'), 'player route')
      expect(
        new URLSearchParams(location.hash.split('?')[1]).get('lesson') === '01-基础/01-入门/2.mp4',
        'Selected relative path must survive navigation',
      )
      const video = await until(() => document.querySelector('video'), 'native video')
      video.muted = true
      await until(() => video.readyState >= 1 && video.duration > 0, 'actual video metadata')
      video.pause()
    })
    await invoke('desktop_smoke_report', { result: { success: true, steps } })
  } catch (error) {
    await invoke('desktop_smoke_report', { result: { success: false, steps, error: String(error) } })
  }
})()

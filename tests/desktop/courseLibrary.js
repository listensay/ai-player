// Runs against isolated fixture data in the real Tauri WebView.
void (async () => {
  if (globalThis.__AI_PLAYER_SMOKE_RUNNING__) return
  globalThis.__AI_PLAYER_SMOKE_RUNNING__ = true
  const invoke = (...args) => globalThis.__TAURI_INTERNALS__.invoke(...args)
  const request = (endpoint, method = 'GET', query = {}, body = null) =>
    invoke('database_request', { endpoint, method, query, body })
  const course = () => request('library', 'GET', { id: 'smoke-course' })
  const steps = []
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const visible = (node) => node && node.getClientRects().length && !node.closest('[inert]')
  const expect = (condition, message) => {
    if (!condition) throw Error(message)
  }
  async function until(work, label) {
    const start = performance.now()
    while (performance.now() - start < 15000) {
      const value = await work()
      if (value) return value
      await pause(100)
    }
    throw Error(`Timed out: ${label}`)
  }
  async function click(text) {
    const node = await until(
      () =>
        [...document.querySelectorAll('button,a,.v-list-item')].find(
          (element) =>
            visible(element) &&
            !element.disabled &&
            (element.textContent.trim() === text ||
              element.title === text ||
              element.getAttribute('aria-label') === text),
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
  async function action(name, label) {
    await click(`${name}的课程操作`)
    await click(label)
    await until(() => visible(document.getElementById('course-action-title')), 'course dialog')
  }
  async function inputName(value) {
    const input = await until(() => document.querySelector('.study-form-dialog input'), 'name input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(100)
  }
  const renamed = '重命名回归课程'
  try {
    location.hash = '/courses'
    await until(() => document.querySelector('.course-card'), 'course library')
    if (globalThis.__AI_PLAYER_SMOKE_PHASE__ === 'library') {
      await step('invalid-name-and-cancel-preserve-course', async () => {
        await action('桌面回归课程', '重命名')
        await inputName('   ')
        await click('保存')
        await until(() => document.querySelector('.study-form-dialog [role="alert"]'), 'invalid name feedback')
        expect((await course()).name === '桌面回归课程', 'Invalid name must not persist')
        await click('取消')
        await until(() => !visible(document.getElementById('course-action-title')), 'dialog closes')
      })
      await step('rename-updates-card-and-recent-course', async () => {
        await action('桌面回归课程', '重命名')
        await inputName(`  ${renamed}  `)
        await click('保存')
        await until(() => !visible(document.getElementById('course-action-title')), 'rename completes')
        expect(document.querySelector('.course-card').textContent.includes(renamed), 'Card must show new name')
        expect((await course()).name === renamed, 'Library must persist new name')
        expect((await request('recent-courses'))[0].name === renamed, 'Recent course must use display name')
      })
      await step('reopening-original-folder-keeps-display-name', async () => {
        await click(renamed)
        await until(() => document.querySelector('.overview-page'), 'course opened')
        expect((await course()).name === renamed, 'Rescan must preserve display name')
        expect((await course()).sourceName === 'course', 'Directory identity must retain original folder name')
        location.hash = '/courses'
        await until(() => document.querySelector('.course-card')?.textContent.includes(renamed), 'return to library')
      })
    } else {
      await step('rename-survives-desktop-restart', async () => {
        expect((await course()).name === renamed, 'Restart must retain name')
        expect(document.querySelector('.course-card').textContent.includes(renamed), 'Restarted card must show name')
      })
      await step('cancel-delete-keeps-course', async () => {
        await action(renamed, '删除课程')
        await click('取消')
        await until(() => !visible(document.getElementById('course-action-title')), 'delete canceled')
        expect((await course()).name === renamed, 'Cancel must keep course')
      })
      await step('delete-removes-course-and-retains-learning-records', async () => {
        const progress = await request('progress', 'GET', { courseId: 'smoke-course' })
        const guide = await request('guide', 'GET', { courseId: 'smoke-course' })
        const practice = await request('practice', 'GET', { courseId: 'smoke-course' })
        await action(renamed, '删除课程')
        await click('删除')
        await until(() => !visible(document.getElementById('course-action-title')), 'delete completes')
        expect(!document.querySelector('.course-card'), 'Last course must disappear')
        expect((await request('library')).length === 0, 'Library must be empty')
        expect((await request('recent-courses')).length === 0, 'Recent list must be empty')
        expect(
          JSON.stringify(await request('progress', 'GET', { courseId: 'smoke-course' })) === JSON.stringify(progress),
          'Progress must be retained',
        )
        expect(
          JSON.stringify(await request('guide', 'GET', { courseId: 'smoke-course' })) === JSON.stringify(guide),
          'Study plan must be retained',
        )
        expect(
          JSON.stringify(await request('practice', 'GET', { courseId: 'smoke-course' })) === JSON.stringify(practice),
          'Practice records must be retained',
        )
        expect((await invoke('course_locations'))['smoke-course'], 'Original directory association must remain')
        let rejected = false
        try {
          await request('recent-courses', 'POST', {}, { id: 'smoke-course', name: 'course', videoCount: 2 })
        } catch {
          rejected = true
        }
        expect(rejected && (await request('library')).length === 0, 'Late writes must not restore deleted course')
      })
    }
    await invoke('desktop_smoke_report', { result: { success: true, steps } })
  } catch (error) {
    await invoke('desktop_smoke_report', { result: { success: false, steps, error: String(error) } })
  }
})()

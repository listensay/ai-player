import { test, expect, paths, titles, plan, seedLocalCourse, openCourse, configure, generate } from './fixtures'
import type { Page } from '@playwright/test'

const material = '反射可以在运行时读取类的信息，获得构造函数、字段和方法。通过类对象获取方法，再在实例上调用方法。注意方法的参数类型需要匹配，也要处理访问权限。'
const question = { kind: 'explain', prompt: '反射如何在运行时调用对象的方法？', concepts: ['反射调用'], criteria: ['说明获取方法和调用的步骤'], referenceAnswer: '获取 Class，再取得 Method，并对目标实例调用 invoke。', sourceIds: ['s1'] }
const feedback = { result: 'partial', strengths: ['理解了如何获取方法'], gaps: ['还需要传入目标实例'], nextStep: '补充 invoke 的对象参数，再解释一次。', sourceIds: ['s1'] }
const practice = (page: Page) => page.getByRole('dialog', { name: '学完一小练', exact: true })
async function enterPractice(page: Page) {
  await page.getByRole('button', { name: '学完一小练', exact: true }).last().click()
  await expect(practice(page)).toBeVisible()
  await expect(practice(page).getByText('正在读取本地材料…')).toHaveCount(0)
}
async function seek(page: Page, time: number, play = false) {
  await page.locator('video').evaluate(async (v: HTMLVideoElement, { time, play }) => {
    v.pause()
    const completed = new Promise<void>(resolve => v.addEventListener('seeked', () => resolve(), { once: true }))
    v.currentTime = time
    await completed
    if (play) { v.playbackRate = 4; await v.play() }
  }, { time, play })
}

test('小练习：材料不足不请求 AI，作答、显式掌握与草稿支持恢复', async ({ page }, testInfo) => {
  await seedLocalCourse(page)
  const payloads: string[] = [], errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://guide.test/v1/chat/completions', route => {
    const body = route.request().postData()!; payloads.push(body)
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(body.includes('作答反馈') ? feedback : question) } }] } })
  })
  await openCourse(page); await configure(page)
  await page.getByRole('button', { name: '关闭导学', exact: true }).click()
  await enterPractice(page)
  await practice(page).getByRole('button', { name: '生成一小练', exact: true }).click()
  await expect(practice(page).getByRole('alert')).toContainText('学习材料不足')
  expect(payloads).toHaveLength(0)
  await practice(page).getByLabel('补充学习内容', { exact: true }).fill(material)
  await practice(page).getByRole('button', { name: '生成一小练', exact: true }).click()
  await expect(practice(page).getByRole('heading', { name: question.prompt })).toBeVisible()
  await expect(practice(page).getByText(question.referenceAnswer, { exact: true })).toBeHidden()
  await practice(page).getByLabel('你的作答', { exact: true }).fill('用 getMethod 获得方法。')
  await practice(page).getByRole('button', { name: '提交作答，看看反馈', exact: true }).click()
  await expect(practice(page).getByLabel('答题反馈')).toContainText(feedback.gaps[0]!)
  const mastery = practice(page).getByLabel('练习知识点 反射调用 掌握程度', { exact: true })
  await expect(mastery).toHaveValue('')
  await mastery.selectOption('needs-review')
  await practice(page).getByLabel('你的作答', { exact: true }).fill('改进草稿：获取方法后，向 invoke 传入目标对象。')
  await page.screenshot({ path: testInfo.outputPath('practice-feedback.png') })
  await practice(page).getByRole('button', { name: '关闭练习', exact: true }).click()
  await enterPractice(page)
  await expect(practice(page).getByLabel('你的作答', { exact: true })).toHaveValue('改进草稿：获取方法后，向 invoke 传入目标对象。')
  await page.reload()
  await page.getByRole('button', { name: /导学测试课程.*集/ }).click()
  await enterPractice(page)
  await expect(practice(page).getByLabel('你的作答', { exact: true })).toHaveValue('改进草稿：获取方法后，向 invoke 传入目标对象。')
  await expect(practice(page).getByLabel('练习知识点 反射调用 掌握程度', { exact: true })).toHaveValue('needs-review')
  await expect(practice(page).getByLabel('答题反馈')).toContainText(feedback.gaps[0]!)
  expect(payloads).toHaveLength(2)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('only-for-this-test')
  await practice(page).getByRole('button', { name: '关闭练习', exact: true }).click()
  await page.getByRole('button', { name: '切换课程', exact: true }).click()
  await page.evaluate(() => localStorage.setItem('test-course-name', '另一门课'))
  await page.getByRole('button', { name: '打开课程文件夹', exact: true }).click()
  await enterPractice(page)
  await expect(practice(page).getByLabel('本课练习记录', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('片段提醒：跳转不触发，连续播放到点提醒且可按片段出题', async ({ page }, testInfo) => {
  await seedLocalCourse(page, 360)
  const requests: string[] = []
  await page.route('https://guide.test/v1/chat/completions', route => {
    const prompt = route.request().postDataJSON().messages.at(-1).content as string
    requests.push(prompt)
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(prompt.includes('学完一小练') ? question : plan()) } }] } })
  })
  await openCourse(page)
  await page.evaluate(async ({ material }) => {
    const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('导学测试课程')
    const file = await dir.getFileHandle('02-反射.srt', { create: true }), writer = await file.createWritable()
    await writer.write(`1\n00:00:10,000 --> 00:00:20,000\n${material}\n\n2\n00:05:01,000 --> 00:05:10,000\n片段以外不应发送。\n`); await writer.close()
  }, { material })
  await configure(page); await generate(page)
  await page.getByRole('button', { name: '今日学习', exact: true }).click()
  await page.getByLabel('今天可用分钟数', { exact: true }).fill('5')
  await page.getByLabel('今天可用分钟数', { exact: true }).press('Tab')
  await page.getByRole('button', { name: '开始下一项', exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
  const reminder = page.getByLabel('学习片段结束提醒', { exact: true })
  await seek(page, 302)
  await expect(reminder).toHaveCount(0)
  await page.getByTitle('全屏（F）', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await seek(page, 297, true)
  await expect(reminder).toBeVisible()
  expect(await reminder.evaluate(el => document.fullscreenElement?.contains(el))).toBe(true)
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('ai-player.guide.v1.')).some(([, v]) => JSON.parse(v).today.items.some((i: any) => i.done)))).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('segment-reminder.png') })
  await reminder.getByRole('button', { name: '检验一下', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
  await expect(practice(page)).toContainText('新题范围：00:00–05:00')
  await practice(page).getByRole('button', { name: '生成一小练', exact: true }).click()
  await expect(practice(page).getByRole('heading', { name: question.prompt })).toBeVisible()
  expect(requests.at(-1)).toContain(material)
  expect(requests.at(-1)).not.toContain('片段以外不应发送')
  await practice(page).getByText('题目与反馈的依据', { exact: true }).click()
  await practice(page).getByRole('button', { name: '回看 00:10–00:20', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(10)
  await seek(page, 297, true)
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(301)
  await expect(reminder).toHaveCount(0)
  // 从今日安排重新开始可再次提醒；切课会清理待显示提醒。
  await page.getByRole('button', { name: /今日学习.*查看安排/ }).click()
  await page.getByRole('button', { name: '开始下一项', exact: true }).click()
  await seek(page, 297, true)
  await expect(reminder).toBeVisible()
  await page.getByTitle('下一集（Shift+N）', { exact: true }).click()
  await expect(reminder).toHaveCount(0)
})

test('小练习：使用未保存笔记，拒绝伪造依据，取消和服务失败保留已有作答', async ({ page }) => {
  await seedLocalCourse(page)
  let mode = 'valid', calls = 0
  let release: (() => void) | undefined
  await page.route('https://guide.test/v1/chat/completions', async route => {
    calls++
    const requestMode = mode
    if (requestMode === 'pending') await new Promise<void>(resolve => { release = resolve })
    if (requestMode === 'error') return route.fulfill({ status: 429, body: '' })
    const raw = requestMode === 'bad' ? { ...question, sourceIds: ['fake'] } : question
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(raw) } }] } }).catch(() => {})
  })
  await openCourse(page); await configure(page)
  await page.getByRole('button', { name: '关闭导学', exact: true }).click()
  await page.locator('.ProseMirror[contenteditable=true]').fill(material)
  await enterPractice(page)
  await expect(practice(page).getByText(/出题材料.*有笔记/)).toBeVisible()
  await practice(page).getByRole('button', { name: '生成一小练', exact: true }).click()
  await expect(practice(page).getByRole('heading', { name: question.prompt })).toBeVisible()
  await practice(page).getByLabel('你的作答', { exact: true }).fill('保留这份答案')
  mode = 'bad'
  await practice(page).getByRole('button', { name: '换一道题', exact: true }).click()
  await expect(practice(page).getByRole('alert')).toContainText('不存在的学习材料')
  await expect(practice(page).getByLabel('你的作答', { exact: true })).toHaveValue('保留这份答案')
  mode = 'error'
  await practice(page).getByRole('button', { name: '提交作答，看看反馈', exact: true }).click()
  await expect(practice(page).getByRole('alert')).toContainText('额度不足')
  mode = 'pending'
  await practice(page).getByRole('button', { name: '换一道题', exact: true }).click()
  await expect.poll(() => calls).toBe(4)
  await practice(page).getByRole('button', { name: '关闭练习', exact: true }).click()
  release?.()
  await enterPractice(page)
  await expect(practice(page).getByLabel('你的作答', { exact: true })).toHaveValue('保留这份答案')
  await expect(practice(page).getByLabel('本课练习记录', { exact: true }).locator('option')).toHaveCount(2)
})

test('片段自然结束可以标记完成；窄屏练习可作答且不溢出', async ({ page }, testInfo) => {
  await seedLocalCourse(page)
  await page.route('https://guide.test/v1/chat/completions', route => {
    const body = route.request().postData()!
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(body.includes('学完一小练') ? question : plan()) } }] } })
  })
  await openCourse(page); await configure(page); await generate(page)
  await page.getByRole('button', { name: '今日学习', exact: true }).click()
  await page.getByRole('button', { name: '开始下一项', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
  await seek(page, 117, true)
  await expect(page.getByLabel('学习片段结束提醒', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '标记片段完成', exact: true }).click()
  await expect(page.getByLabel('学习片段结束提醒', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /今日学习.*查看安排/ }).click()
  await expect(page.getByLabel('完成今日第 1 项', { exact: true })).toBeChecked()
  await page.getByRole('button', { name: '关闭导学', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await enterPractice(page)
  await practice(page).getByLabel('补充学习内容', { exact: true }).fill(material)
  await practice(page).getByRole('button', { name: '生成一小练', exact: true }).click()
  await expect(practice(page).getByRole('heading', { name: question.prompt })).toBeVisible()
  await practice(page).getByLabel('你的作答', { exact: true }).fill('窄屏也能作答')
  expect(await practice(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('practice-mobile.png') })
})

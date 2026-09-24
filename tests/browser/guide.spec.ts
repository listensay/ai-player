import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, paths, titles, plan, courseId, openCourse, configure, generate } from './fixtures'

test('完整导学闭环：生成、依赖保护、播放、笔记疑问、精确回溯与恢复', async ({ page, desktop }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const requests: unknown[] = []
  await page.route('https://guide.test/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); requests.push(body)
    const prompt = body.messages.at(-1).content as string
    const result = prompt.includes('最多 3 节') ? { recommendations: [{ path: paths[3], reason: '需要先理解多态的方法分派。', keywords: ['多态'] }] }
      : prompt.includes('cueId') ? { segments: [{ path: paths[3], cueId: 1 }] } : plan()
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] } })
  })
  await openCourse(page)
  await configure(page)
  await generate(page)
  await expect(page.getByText('已自动保留 2 节关键前置课', { exact: false })).toBeVisible()
  await expect(page.getByLabel(`${titles[1]} 学习状态`, { exact: true })).toHaveValue('required')
  await page.getByLabel('每天学习分钟数', { exact: true }).fill('5')
  await page.getByLabel('每天学习分钟数', { exact: true }).press('Tab')
  await expect(page.getByLabel('学习排期')).toContainText('每天看课 5 分钟')
  await expect(page.getByLabel('学习排期')).toContainText('2天预计')
  expect(requests).toHaveLength(1)
  await page.screenshot({ path: testInfo.outputPath('guide-desktop.png') })
  // 跳过前置课需要明确确认，取消不会改动路线。
  await page.getByLabel(`${titles[1]} 学习状态`, { exact: true }).selectOption('skipped')
  await expect(page.getByText('调整后将缺少必要的前置课程')).toBeVisible()
  await page.getByRole('button', { name: '保留当前安排', exact: true }).click()
  await expect(page.getByLabel(`${titles[1]} 学习状态`, { exact: true })).toHaveValue('required')
  await page.getByLabel(`${titles[1]} 学习状态`, { exact: true }).selectOption('skipped')
  await page.getByRole('button', { name: '确认调整', exact: true }).click()
  await expect(page.getByText('有 1 节前置知识尚未加入路线')).toBeVisible()
  await page.getByRole('button', { name: '补齐前置课', exact: true }).click()
  await expect(page.getByLabel(`${titles[1]} 学习状态`, { exact: true })).toHaveValue('required')
  await page.getByRole('button', { name: '知识地图', exact: true }).click()
  await expect(page.getByText('先修板块：Java 基础与机制')).toBeVisible()
  await page.getByRole('button', { name: '定制路线', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()
  await page.getByTitle('下一集（Shift+N）', { exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[2], exact: true })).toBeVisible()
  await page.keyboard.press('Shift+N')
  await expect(page.getByRole('heading', { name: titles[4], exact: true })).toBeVisible()
  await page.locator('video').evaluate((video: HTMLVideoElement) => new Promise<void>(resolve => { video.pause(); video.addEventListener('seeked', () => resolve(), { once: true }); video.currentTime = 42 }))
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(42, 0)
  await page.locator('.ProseMirror[contenteditable=true]').fill('多态为什么会调用子类的方法？')
  await page.getByRole('button', { name: '查找基础课', exact: true }).click()
  await expect(page.getByLabel('疑问描述', { exact: true })).toHaveValue('多态为什么会调用子类的方法？')
  await page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('button', { name: '查找基础课', exact: true }).click()
  await expect(page.getByText('字幕证据 · 00:20–00:30')).toBeVisible()
  await page.getByRole('button', { name: '回看片段', exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[3], exact: true })).toBeVisible()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(20)
  await page.getByRole('button', { name: '返回原课 00:42', exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[4], exact: true })).toBeVisible()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(42)
  await page.getByLabel('回看反馈', { exact: true }).getByRole('button', { name: '仍不理解', exact: true }).click()
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await expect(page.getByLabel(`${titles[3]} 学习状态`, { exact: true })).toHaveValue('required')
  await expect(page.getByLabel(`${titles[3]} · 多态 掌握程度`, { exact: true }).filter({ visible: true })).toHaveValue('needs-review')
  await page.getByRole('button', { name: '关闭导学', exact: true }).click()
  // 课程、路线和笔记可在刷新后恢复；密钥不落盘。
  const id = courseId(page)
  await expect.poll(() => (desktop.read('guide', { courseId: id }) as any)?.plan?.dailyMinutes).toBe(5)
  // AI 配置与密钥保存在 SQLite，不写入 WebView 存储。
  expect((desktop.read('settings', { key: 'ai_settings' }) as any).profiles[0].apiKey).toBe('only-for-this-test')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('only-for-this-test')
  await page.reload()
  await expect(page.locator('video')).toBeVisible()
  await expect(page.locator('.ProseMirror')).toContainText('多态为什么会调用子类的方法？')
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('heading', { name: '学习路线', exact: true })).toBeVisible()
  await expect(page.getByLabel('每天学习分钟数', { exact: true })).toHaveValue('5')
  await page.getByRole('button', { name: '导出路线', exact: true }).click()
  await expect.poll(() => desktop.exports.length).toBe(1)
  expect(desktop.exports[0]!.name).toContain('学习路线.json')
  expect(JSON.parse(desktop.exports[0]!.content).plan.dailyMinutes).toBe(5)
  expect(requests).toHaveLength(3)
  expect(errors).toEqual([])
})

test('知识掌握独立于观看，标记调整路线并在 AI 重排和刷新后保留', async ({ page, desktop }, testInfo) => {
  const payloads: string[] = []
  await page.route('https://guide.test/v1/chat/completions', route => {
    payloads.push(route.request().postData()!)
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(plan()) } }] } })
  })
  await openCourse(page); await configure(page); await generate(page)
  const mastery = (i: number) => page.getByLabel(`${titles[i]} · ${titles[i]!.split('-')[1]} 掌握程度`, { exact: true }).filter({ visible: true })
  await expect(mastery(0)).toHaveValue('')
  await mastery(1).selectOption('mastered')
  await expect(page.getByLabel(`${titles[1]} 学习状态`, { exact: true })).toHaveValue('skipped')
  await expect(page.getByText(/节前置知识尚未加入路线/)).toHaveCount(0)
  await mastery(0).selectOption('uncertain')
  await expect(page.getByLabel(`${titles[0]} 学习状态`, { exact: true })).toHaveValue('optional')
  await mastery(0).selectOption('needs-review')
  await expect(page.getByLabel(`${titles[0]} 学习状态`, { exact: true })).toHaveValue('required')
  await page.getByLabel('继续补充或调整目标', { exact: true }).fill('请按我的掌握情况调整')
  await page.getByRole('button', { name: '调整学习路线', exact: true }).click()
  await expect(page.getByLabel('继续补充或调整目标', { exact: true })).toHaveValue('')
  expect(payloads[1]).toContain('needs-review')
  // 已有路线时先预览变化，确认后才应用。
  await page.getByRole('region', { name: '路线调整预览', exact: true }).getByRole('button', { name: '应用调整', exact: true }).click()
  await expect(page.getByRole('region', { name: '路线调整预览', exact: true })).toHaveCount(0)
  await expect(mastery(0)).toHaveValue('needs-review')
  await expect(page.getByLabel(`${titles[0]} 学习状态`, { exact: true })).toHaveValue('required')
  await mastery(0).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('mastery.png') })
  for (let i = 0; i < paths.length; i++) await mastery(i).selectOption('mastered')
  await page.reload()
  await expect(page.locator('video')).toBeVisible()
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('heading', { name: '学习路线', exact: true })).toBeVisible()
  for (let i = 0; i < paths.length; i++) {
    await expect(mastery(i)).toHaveValue('mastered')
    await expect(page.getByLabel(`${titles[i]} 学习状态`, { exact: true })).toHaveValue('skipped')
  }
  expect(Object.values(desktop.read('progress') as object).some((v: any) => Object.values(v).some((p: any) => p.done))).toBe(false)
})

test('无需 AI 即可记录和解决疑问，保留提问时间并支持重新打开', async ({ page, desktop }, testInfo) => {
  let calls = 0
  page.on('request', r => { if (r.url().includes('/chat/completions')) calls++ })
  await openCourse(page)
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
  await page.locator('video').evaluate((v: HTMLVideoElement) => new Promise<void>(resolve => { v.pause(); v.addEventListener('seeked', () => resolve(), { once: true }); v.currentTime = 37 }))
  await page.locator('.ProseMirror[contenteditable=true]').fill('为什么要使用接口？')
  await page.getByRole('button', { name: '记录疑问', exact: true }).click()
  await expect(page.getByText('疑问已记录，可在导学清单中继续处理')).toBeVisible()
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await page.getByRole('button', { name: '疑问回溯', exact: true }).click()
  const inbox = page.getByRole('region', { name: '疑问清单' })
  await expect(inbox.getByText('为什么要使用接口？', { exact: true })).toBeVisible()
  await expect(inbox.getByRole('button', { name: /00:37.*返回提问位置/ })).toBeVisible()
  await inbox.getByRole('button', { name: '标记已解决', exact: true }).click()
  await page.getByLabel('筛选疑问状态').selectOption('resolved')
  await expect(inbox.getByText('为什么要使用接口？', { exact: true })).toBeVisible()
  await inbox.getByRole('button', { name: '重新打开', exact: true }).click()
  await page.getByLabel('筛选疑问状态').selectOption('open')
  await inbox.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('questions.png') })
  await page.reload()
  await expect(page.locator('video')).toBeVisible()
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await page.getByRole('button', { name: '疑问回溯', exact: true }).click()
  await expect(inbox.getByText('为什么要使用接口？', { exact: true })).toBeVisible()
  await inbox.getByRole('button', { name: /00:37.*返回提问位置/ }).click()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(37)
  expect(calls).toBe(0)
})

test('今日短安排拆分长课，完成事项不会重复，跨天恢复每日时间', async ({ page, desktop }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-23T12:00:00+08:00'))
  desktop.course.duration = 1200
  await page.route('https://guide.test/v1/chat/completions', route => route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(plan()) } }] } }))
  await openCourse(page); await configure(page); await generate(page)
  await page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('button', { name: '今日学习与打卡', exact: true }).click()
  await page.getByRole('button', { name: '精简安排（最多 15 分钟）', exact: true }).click()
  const today = page.getByRole('region', { name: '今日学习安排' })
  await expect(page.getByLabel('今日可用分钟数')).toHaveValue('15')
  await expect(today.getByText('00:00 → 15:00', { exact: true })).toBeVisible()
  await expect(today.locator('[data-today-id]')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('today.png') })
  await today.getByRole('button', { name: '开始下一项', exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()
  await page.getByRole('button', { name: /今日学习与打卡/ }).click()
  await page.getByLabel('完成今日第 1 项', { exact: true }).check()
  await page.getByRole('button', { name: '按最新进度更新', exact: true }).click()
  await expect(today.locator('[data-today-id]')).toHaveCount(1)
  await expect(page.getByLabel('完成今日第 1 项', { exact: true })).toBeChecked()
  await page.getByLabel('今日可用分钟数').fill('5')
  await page.getByLabel('今日可用分钟数').press('Tab')
  await expect(today.getByText('已完成时长超过调整后的可用时间，今日不再新增安排。')).toBeVisible()
  await page.reload()
  await expect(page.locator('video')).toBeVisible()
  await page.getByRole('button', { name: /今日学习与打卡/ }).click()
  await expect(page.getByLabel('今日可用分钟数')).toHaveValue('5')
  await expect(page.getByLabel('完成今日第 1 项', { exact: true })).toBeChecked()
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+08:00'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByLabel('今日可用分钟数')).toHaveValue('120')
  await expect(today).toContainText('2026-09-24')
  await expect(page.getByLabel('完成今日第 1 项', { exact: true })).not.toBeChecked()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator('dialog[open]').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await today.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('today-mobile.png'), animations: 'disabled' })
})

test('无效响应保留旧路线；取消请求后不应用过期结果；课程隔离', async ({ page, desktop }) => {
  let mode = 'ok'
  let releaseResponse: (() => void) | undefined
  let completeResponse: (() => void) | undefined
  const responseCompleted = new Promise<void>(resolve => { completeResponse = resolve })
  await page.route('https://guide.test/v1/chat/completions', async route => {
    const value = plan()
    if (mode === 'invalid') value.lessons.pop()
    if (mode === 'slow') {
      value.summary = '这条过期路线绝不能显示'
      await new Promise<void>(resolve => { releaseResponse = resolve })
    }
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(value) } }] } }).catch(() => {})
    if (mode === 'slow') completeResponse?.()
  })
  await openCourse(page); await configure(page); await generate(page)
  mode = 'invalid'
  await page.getByLabel('继续补充或调整目标', { exact: true }).fill('每天半小时')
  await page.getByRole('button', { name: '调整学习路线', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('遗漏了部分课节')
  await expect(page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('heading', { name: '学习路线', exact: true })).toBeVisible()
  await expect(page.getByLabel(`${titles[1]} 学习状态`, { exact: true })).toHaveValue('required')
  mode = 'slow'
  await page.getByRole('button', { name: '调整学习路线', exact: true }).click()
  await expect.poll(() => !!releaseResponse).toBe(true)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  releaseResponse?.()
  await responseCompleted
  await expect(page.getByRole('button', { name: '调整学习路线', exact: true })).toBeEnabled()
  await expect(page.getByText('这条过期路线绝不能显示', { exact: true })).toHaveCount(0)
  await expect(page.getByText(plan().summary, { exact: true }).filter({ visible: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭导学', exact: true }).click()
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  desktop.picker.name = '另一门课程'
  await page.getByRole('button', { name: '打开课程文件夹', exact: true }).click()
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await expect(page.getByLabel('学习背景与目标', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('heading', { name: '学习路线', exact: true })).not.toBeVisible()
})

test('窄屏导学布局可操作，没有横向溢出', async ({ page, desktop }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openCourse(page)
  await page.getByTitle('AI 智能导学与定制路线', { exact: true }).click()
  await expect(page.getByLabel('学习背景与目标', { exact: true })).toBeVisible()
  expect(await page.locator('dialog[open]').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('guide-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})

test('回溯缺少字幕或定位失败时保留整课建议，拒绝虚构片段', async ({ page, desktop }) => {
  let mode: 'no-subtitle' | 'invalid-cue' | 'unavailable' = 'no-subtitle'
  let requests = 0
  await page.route('https://guide.test/v1/chat/completions', async route => {
    requests++
    const prompt = route.request().postDataJSON().messages.at(-1).content as string
    if (prompt.includes('cueId') && mode === 'unavailable') {
      await route.fulfill({ status: 503, body: 'unavailable' }); return
    }
    const result = prompt.includes('最多 3 节')
      ? { recommendations: [{ path: paths[mode === 'no-subtitle' ? 0 : 3], reason: '补充语言机制。', keywords: ['多态'] }] }
      : prompt.includes('cueId') ? { segments: [{ path: paths[3], cueId: 99999 }] } : plan()
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result) } }] } })
  })
  await openCourse(page); await configure(page); await generate(page)
  await page.getByRole('dialog', { name: 'AI 智能导学' }).getByRole('button', { name: '开始学习', exact: true }).click()
  await page.getByTitle('下一集（Shift+N）', { exact: true }).click()
  await page.getByTitle('下一集（Shift+N）', { exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[4], exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await page.getByRole('button', { name: '疑问回溯', exact: true }).click()
  await page.getByLabel('疑问描述', { exact: true }).fill('多态为什么会调用子类的方法？')
  for (const scenario of ['no-subtitle', 'invalid-cue', 'unavailable'] as const) {
    mode = scenario
    await page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('button', { name: '查找基础课', exact: true }).click()
    await expect(page.getByRole('button', { name: '回看基础课', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '回看片段', exact: true })).toHaveCount(0)
    if (scenario !== 'no-subtitle') await expect(page.getByText('已找到相关基础课，字幕定位不可用，可从课节起点回看。')).toBeVisible()
  }
  expect(requests).toBe(6)
})

test('目录课节变化后要求重新规划，不恢复遗漏课节的旧路线', async ({ page, desktop }) => {
  await page.route('https://guide.test/v1/chat/completions', route => route.fulfill({
    json: { choices: [{ message: { content: JSON.stringify(plan()) } }] },
  }))
  await openCourse(page); await configure(page); await generate(page)
  await page.getByRole('button', { name: '关闭导学', exact: true }).click()
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await rm(join(desktop.coursePath(), paths[5]!))
  await page.getByRole('button', { name: /导学测试课程.*节/ }).click()
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await expect(page.getByText('原路线数据读取异常，可重新生成；观看进度仍可使用。')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('heading', { name: '学习路线', exact: true })).toHaveCount(0)
})

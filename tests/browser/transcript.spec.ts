import { test, expect, paths, titles } from './fixtures'
import type { Page } from '@playwright/test'

const segments = [
  { id: 0, start: 2, end: 6.5, text: '这一集先把 Java 开发环境装好。' },
  { id: 1, start: 8, end: 14, text: '反射可以在运行时读取类的信息。' },
  { id: 2, start: 16, end: 22, text: '后面讲 SpringBoot 时还会用到反射。' },
]

/** 导入后进入课程概览。 */
async function openCourse(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '打开课程文件夹', exact: true }).click()
  await expect(page.getByRole('heading', { name: '导学测试课程', level: 1 })).toBeVisible()
}

async function enterPlayer(page: Page) {
  await page.getByRole('button', { name: /开始学习|继续学习/ }).click()
  await expect(page.locator('video')).toBeVisible()
}

const transcriptTab = (page: Page) => page.getByRole('tab', { name: /逐字稿/ })
const panel = (page: Page) => page.getByRole('region', { name: '逐字稿', exact: true })

test('逐字稿：自动准备本机服务、转写写入 .srt、点击跳转、检索与引用到笔记', async ({ page, desktop }, testInfo) => {
  desktop.course.duration = 60
  desktop.asr.readyOnStart = false
  desktop.asr.transcribe = () => ({ events: [
    ...segments.flatMap(s => [{ event: 'segment', data: s }, { event: 'progress', data: { seconds: s.end, ratio: s.end / 60 } }]),
    { event: 'done', data: { duration: 60, language: 'zh', segments: segments.length, elapsed: 0.4 } },
  ] })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await openCourse(page)
  await enterPlayer(page)
  await transcriptTab(page).click()
  await expect(panel(page).getByRole('heading', { name: '本节暂无逐字稿' })).toBeVisible()
  // 打开页签后自动启动服务；模型加载完成前不可转写。
  await expect(panel(page).getByText('正在加载模型…')).toBeVisible()
  await expect(panel(page).getByRole('button', { name: '转写本节' })).toBeDisabled()
  desktop.asr.readyOnStart = true
  const start = panel(page).getByRole('button', { name: '转写本节' })
  await expect(start).toBeEnabled()
  await expect(panel(page).getByText('本机转写已就绪 · 支持离线使用')).toBeVisible()

  // 停止后可重新启动。
  await panel(page).getByRole('button', { name: '停止服务' }).click()
  await expect(panel(page).getByText('本机转写已停止')).toBeVisible()
  await expect(start).toBeDisabled()
  await panel(page).getByRole('button', { name: '启动', exact: true }).click()
  await expect(start).toBeEnabled()
  await start.click()

  // 逐句出现，写入同名 .srt
  await expect(panel(page).locator('li')).toHaveCount(3)
  await expect(panel(page).getByText(`3 句 · ${titles[0]}.srt`)).toBeVisible()
  expect(desktop.asr.requests).toHaveLength(1)
  expect(desktop.asr.requests[0]!.relative).toBe(paths[0])
  expect(desktop.asr.requests[0]!.duration).toBeCloseTo(60, 0)
  const srt = await desktop.readCourseFile(`${titles[0]}.srt`)
  expect(srt).toContain('1\n00:00:02,000 --> 00:00:06,500\n这一集先把 Java 开发环境装好。')
  expect(srt).toContain('3\n00:00:16,000 --> 00:00:22,000\n')

  // 点击句子跳转，播放头所在句高亮
  await panel(page).getByRole('button', { name: segments[1]!.text }).click()
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause())
  const t = await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)
  expect(t).toBeGreaterThanOrEqual(8)
  expect(t).toBeLessThan(9.5)
  await expect(panel(page).locator('li[data-index="1"]')).toHaveClass(/bg-sunbeam-yellow/)

  // 检索：两处命中，Enter 在命中间切换
  const search = panel(page).getByPlaceholder('搜索本节逐字稿')
  await search.fill('反射')
  await expect(panel(page).locator('mark')).toHaveCount(2)
  await expect(panel(page).getByText('1/2')).toBeVisible()
  await search.press('Enter')
  await expect(panel(page).getByText('2/2')).toBeVisible()
  await search.fill('不存在的词')
  await expect(panel(page).getByText('0 处')).toBeVisible()
  await search.fill('')
  await page.screenshot({ path: testInfo.outputPath('transcript-ready.png') })

  // 引用到笔记：切回笔记页签，插入 [时间戳] 原句
  await panel(page).locator('li[data-index="2"]').hover()
  await panel(page).locator('li[data-index="2"]').getByRole('button', { name: '引用' }).click()
  await expect(transcriptTab(page)).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('.milkdown')).toContainText(segments[2]!.text)
  await expect(page.locator('.milkdown')).toContainText('00:16')

  // 刷新后从 .srt 恢复，不再请求转写
  await page.reload()
  await expect(page.locator('video')).toBeVisible()
  await transcriptTab(page).click()
  await expect(panel(page).getByText(`3 句 · ${titles[0]}.srt`)).toBeVisible()
  expect(desktop.asr.requests).toHaveLength(1)
  expect(errors).toEqual([])
})

test('逐字稿：转写出错时提示原因，可重试', async ({ page, desktop }) => {
  desktop.course.duration = 30
  let attempt = 0
  desktop.asr.transcribe = () => ++attempt === 1
    ? { events: [{ event: 'ready', data: { duration: 30 } }, { event: 'error', data: { message: '文件中未检测到音轨，无法转写。' } }] }
    : { events: [{ event: 'ready', data: { duration: 30 } }, { event: 'segment', data: segments[0] }, { event: 'done', data: { duration: 30, language: 'zh', segments: 1, elapsed: 0.1 } }] }
  await openCourse(page)
  await enterPlayer(page)
  await transcriptTab(page).click()
  await panel(page).getByRole('button', { name: '转写本节' }).click()
  await expect(panel(page).getByRole('alert')).toContainText('未检测到音轨')
  await panel(page).getByRole('button', { name: '转写本节' }).click()
  await expect(panel(page).getByText(`1 句 · ${titles[0]}.srt`)).toBeVisible()
})

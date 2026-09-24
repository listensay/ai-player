import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, paths, titles } from './fixtures'
import type { DesktopBackend } from './desktop'
import type { Page } from '@playwright/test'

type Recent = { id: string; name: string; videoCount: number; lastOpenedAt: number; lastVideoPath?: string }
function setup(desktop: DesktopBackend, initial: Recent[] = []) {
  for (const recent of initial) desktop.write('recent-courses', recent)
  return {
    recents: () => desktop.read('recent-courses') as Recent[],
    progress: () => desktop.read('progress') as Record<string, Record<string, { time: number }>>,
    note: (courseId: string, videoPath: string) => desktop.read('notes', { courseId, videoPath }) as { content: string },
  }
}
/** 应用使用 hash 路由，返回 hash 中的路径与查询参数。 */
const route = (page: Page) => new URL(new URL(page.url()).hash.slice(1) || '/', 'http://app')
const HOME = /\/#\/$/
const home = (page: Page) => page.getByRole('link', { name: 'AI Player 首页', exact: true })
const recentButton = (page: Page) => page.getByRole('region', { name: '最近打开' }).getByRole('button', { name: /导学测试课程.*共 6 节/ })
async function importCourse(page: Page) {
  await page.getByRole('button', { name: '打开课程文件夹', exact: true }).click()
  await expect(page).toHaveURL(/#\/courses\/[^/?]+$/)
  await expect(page.getByRole('heading', { name: '导学测试课程', exact: true })).toBeVisible()
  return route(page).pathname
}

test('保存目录后，刷新和重复导入复用同一课程及最近记录', async ({ page, desktop }, testInfo) => {
  const db = setup(desktop)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  const overview = await importCourse(page)
  await home(page).click()
  await expect(page).toHaveURL(HOME)
  await page.reload()
  await recentButton(page).click()
  await expect.poll(() => route(page).pathname).toBe(overview)
  expect(desktop.picker.count).toBe(1)
  await home(page).click()
  await expect(page).toHaveURL(HOME)
  await importCourse(page)
  expect(route(page).pathname).toBe(overview)
  expect(db.recents().length).toBe(1)
  await home(page).click()
  await expect(page).toHaveURL(HOME)
  await expect(recentButton(page)).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('home-recents.png') })
  expect(errors).toEqual([])
})

test('首页、概览、播放器支持路由、历史导航、课节与进度恢复', async ({ page, desktop }, testInfo) => {
  const db = setup(desktop)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  const overview = await importCourse(page)
  const id = overview.split('/').at(-1)!
  await page.getByRole('link', { name: '播放器', exact: true }).click()
  await expect(page.locator('video')).toBeVisible()
  await expect.poll(() => route(page).searchParams.get('lesson')).toBe(paths[0])
  await page.locator('video').evaluate(async (v: HTMLVideoElement) => { v.currentTime = 24; await v.play(); v.pause() })
  await page.getByRole('link', { name: '概览', exact: true }).click()
  await expect(page.locator('video')).toHaveCount(0)
  await expect.poll(() => db.progress()[id]?.[paths[0]!]?.time ?? 0).toBeGreaterThanOrEqual(24)
  await page.goBack()
  await expect(page.locator('video')).toBeVisible()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(24)
  await page.getByTitle('下一集（Shift+N）', { exact: true }).click()
  await expect.poll(() => route(page).searchParams.get('lesson')).toBe(paths[1])
  await page.reload()
  await expect(page.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()
  expect(desktop.picker.count).toBe(1)
  const editor = page.locator('.milkdown [contenteditable="true"]')
  await editor.fill('路由切换时保留本节笔记。')
  await page.getByRole('link', { name: '概览', exact: true }).click()
  await expect.poll(() => db.note(id, paths[1]!).content).toContain('保留本节笔记')
  await page.screenshot({ path: testInfo.outputPath('overview.png') })
  await home(page).click()
  await expect(page).toHaveURL(HOME)
  await page.goBack()
  await expect.poll(() => route(page).pathname).toBe(overview)
  await page.goBack()
  await expect(page.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()
  await expect(editor).toContainText('保留本节笔记')
  await page.screenshot({ path: testInfo.outputPath('player-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('player-mobile.png') })
  await page.goForward()
  await expect.poll(() => route(page).pathname).toBe(overview)
  expect(errors).toEqual([])
})

test('同名不同文件夹独立保存，移除再导入仍保留课程身份', async ({ page, desktop }) => {
  const db = setup(desktop)
  await page.goto('/')
  const first = await importCourse(page)
  await home(page).click()
  await expect(page).toHaveURL(HOME)
  desktop.picker.parent = '另一目录'
  const second = await importCourse(page)
  expect(second).not.toBe(first)
  expect(db.recents().length).toBe(2)
  await home(page).click()
  await expect(page).toHaveURL(HOME)
  await page.getByTitle('从最近列表移除「导学测试课程」').first().click()
  await expect.poll(() => db.recents().length).toBe(1)
  const again = await importCourse(page)
  expect(again).toBe(second)
  expect(db.recents().length).toBe(2)
})

test('旧课程首次关联后保留 ID，取消及误选文件夹不会新增记录', async ({ page, desktop }) => {
  const db = setup(desktop, [{ id: 'legacy-course', name: '导学测试课程', videoCount: 6, lastOpenedAt: 1, lastVideoPath: paths[2] }])
  await page.goto('/#/courses/legacy-course/player?lesson=' + encodeURIComponent(paths[2]!))
  await expect(page.getByRole('button', { name: '关联课程文件夹', exact: true })).toBeVisible()
  expect(desktop.picker.count).toBe(0)
  desktop.picker.cancel = true
  await page.getByRole('button', { name: '关联课程文件夹', exact: true }).click()
  await expect(page.getByRole('button', { name: '关联课程文件夹', exact: true })).toBeVisible()
  expect(db.recents().length).toBe(1)
  desktop.picker.cancel = false
  desktop.picker.name = '错误目录'
  await page.getByRole('button', { name: '关联课程文件夹', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('不一致')
  expect(db.recents().length).toBe(1)
  desktop.picker.name = '导学测试课程'
  await page.getByRole('button', { name: '关联课程文件夹', exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[2], exact: true })).toBeVisible()
  expect(db.recents().map((recent: Recent) => recent.id)).toEqual(['legacy-course'])
  await page.reload()
  await expect(page.locator('video')).toBeVisible()
  expect(desktop.picker.count).toBe(3)
})

test('课程目录移动后仅显示重新关联入口，关联原目录后恢复且保留课程 ID', async ({ page, desktop }) => {
  const db = setup(desktop)
  await page.goto('/')
  const overview = await importCourse(page)
  await mkdir(join(desktop.dir, 'courses', '已移动'))
  await rename(desktop.coursePath(), desktop.coursePath('导学测试课程', '已移动'))
  await page.reload()
  await expect(page.getByText('课程目录已移动或无法访问，请重新关联原文件夹。')).toBeVisible()
  expect(desktop.picker.count).toBe(1)
  desktop.picker.parent = '已移动'
  await page.getByRole('button', { name: '关联课程文件夹', exact: true }).click()
  await expect(page.getByRole('heading', { name: '导学测试课程', exact: true })).toBeVisible()
  expect(route(page).pathname).toBe(overview)
  expect(desktop.picker.count).toBe(2)
  expect(db.recents()).toHaveLength(1)
  const locations = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('course_locations'))
  expect(Object.values(locations)).toEqual([desktop.coursePath('导学测试课程', '已移动')])
  await page.goto('/#/courses/unknown/player')
  await expect(page.getByRole('heading', { name: '无法打开课程', exact: true })).toBeVisible()
  expect(desktop.picker.count).toBe(2)
  await page.getByRole('link', { name: '返回首页', exact: true }).click()
  await expect(page).toHaveURL(HOME)
})

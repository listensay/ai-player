import { test, expect, paths, titles, plan, courseId, openCourse } from './fixtures'

test('定制顺序在概览、导学、知识地图、侧栏与连续播放中一致，筛选不重编号', async ({ page, desktop }) => {
  await openCourse(page)
  const id = courseId(page)
  const playerUrl = page.url()
  // 卸载课程后再写入夹具，避免页面退出时把旧路线覆盖回数据库。
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(page.getByRole('button', { name: '打开课程文件夹', exact: true })).toBeVisible()
  await page.goto('about:blank')
  const custom = plan()
  custom.lessons = [3, 1, 4, 5, 0, 2].map(i => ({
    ...custom.lessons[i]!,
    status: [3, 1, 4].includes(i) ? 'required' : i === 5 ? 'optional' : 'skipped',
    prerequisites: i === 1 ? [paths[3]!] : i === 4 ? [paths[1]!] : [],
  }))
  desktop.write('guide', { courseId: id, plan: custom, view: 'route', includeOptional: false,
    metadata: {}, mastery: {}, questions: [], today: null })
  desktop.write('progress', { courseId: id, path: paths[3]!, time: 120, duration: 120, ratio: 1, done: true })
  await page.goto(playerUrl)
  const expected = [paths[3], paths[1], paths[4]]
  const sidebar = page.getByRole('list', { name: 'AI 推荐课节', exact: true })
  // 默认只展开当前阶段；展开全部后检查完整顺序。
  await expect(sidebar.locator('button[data-path]')).toHaveCount(2)
  await expect(sidebar.getByRole('button', { name: /SpringBoot 项目/ })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('region', { name: '课程目录', exact: true }).getByRole('button', { name: '全部展开', exact: true }).click()
  await expect(sidebar.locator('button[data-path]')).toHaveCount(3)
  await expect.poll(() => sidebar.locator('button[data-path]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-path')))).toEqual(expected)
  await expect(sidebar.locator('button[data-path]').nth(1)).toHaveAttribute('data-route-position', '2')

  await page.getByRole('link', { name: '概览', exact: true }).click()
  const catalog = page.getByRole('region', { name: '课程章节目录', exact: true })
  const cards = catalog.locator('button[data-path]')
  await expect(cards).toHaveCount(2)
  await catalog.getByRole('button', { name: '全部展开', exact: true }).click()
  await expect.poll(() => cards.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-path')))).toEqual(expected)
  await expect(catalog.getByRole('button', { name: '全部 (3)', exact: true })).toBeVisible()
  await expect(catalog.getByRole('button', { name: '已完成 (1)', exact: true })).toBeVisible()
  await catalog.getByPlaceholder('搜索课节名称…').fill('SpringBoot')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toHaveAttribute('data-route-position', '3')
  await catalog.getByPlaceholder('搜索课节名称…').fill('')
  await catalog.getByLabel('包含选修 / 查漏', { exact: true }).check()
  await expect(cards).toHaveCount(4)
  await expect(cards.last()).toHaveAttribute('data-path', paths[5]!)
  await catalog.getByLabel('包含选修 / 查漏', { exact: true }).uncheck()

  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'AI 智能导学', exact: true })
  const arranged = dialog.getByRole('list', { name: '课节安排', exact: true }).locator(':scope > li')
  await expect.poll(() => arranged.evaluateAll(nodes => nodes.slice(0, 3).map(n => n.getAttribute('data-path')))).toEqual(expected)
  await expect(arranged.nth(3)).not.toHaveAttribute('data-route-position')
  await dialog.getByRole('button', { name: '知识地图', exact: true }).click()
  const baseModule = dialog.locator('article').filter({ has: page.getByRole('heading', { name: 'Java 基础与机制', exact: true }) })
  await baseModule.locator('summary').click()
  // 列表显示精简标题（去掉文件名序号），原文件名保留在提示中。
  await expect(baseModule.locator('details button').first()).toHaveText('多态')
  await expect(baseModule.locator('details button').nth(1)).toHaveText('反射')
  await dialog.getByRole('button', { name: '关闭导学', exact: true }).click()

  // 当前停在路线外的首课，也应从定制路线的第一节未完成课继续。
  await page.getByRole('button', { name: '继续学习', exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()
  await page.getByTitle('下一集（Shift+N）', { exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[4], exact: true })).toBeVisible()
  await page.getByTitle('上一集（Shift+P）', { exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()

  await page.getByRole('link', { name: '概览', exact: true }).click()
  await catalog.getByRole('button', { name: '完整目录', exact: true }).click()
  await expect.poll(() => cards.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-path')))).toEqual(paths)
  await expect(cards.first()).not.toHaveAttribute('data-route-position')
  await catalog.getByRole('button', { name: 'AI 定制路线', exact: true }).click()
  await catalog.getByRole('button', { name: '全部展开', exact: true }).click()
  await expect.poll(() => cards.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-path')))).toEqual(expected)
  await expect.poll(() => (desktop.read('guide', { courseId: id }) as any).view).toBe('route')
  await page.reload()
  await catalog.getByRole('button', { name: '全部展开', exact: true }).click()
  await expect.poll(() => cards.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-path')))).toEqual(expected)
})

import { test, expect, paths, plan, courseId, openCourse, configure } from './fixtures'

function localDay(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const budget = (video: number, code: number, project: number, recap: number) => ({ video, code, project, recap })
function practice(startDay: number, endDay: number, prefix: string) {
  return {
    startDay, endDay, goal: `${prefix}阶段目标`, project: `${prefix}阶段交付物`, skipWhen: `${prefix}可跳过条件`,
    tasks: [
      { id: 'c1', kind: 'code', title: `${prefix}编码任务一`, instructions: '完成第一项编码练习' },
      { id: 'c2', kind: 'code', title: `${prefix}编码任务二`, instructions: '完成第二项编码练习' },
      { id: 'p1', kind: 'project', title: `${prefix}项目任务`, instructions: '完成项目功能' },
      { id: 'r1', kind: 'recap', title: '每日复盘', instructions: '复述要点并记录问题', repeat: true },
    ],
    checks: [{ id: 'e1', kind: 'exercise', text: `${prefix}练习验收` }, { id: 'j1', kind: 'project', text: `${prefix}项目验收` }],
  }
}
/** 带完整学习计划的路线：第 1 天从今天开始，两个阶段各 10 天。 */
function programPlan() {
  const value: any = plan()
  value.lessons = value.lessons.map((l: any, i: number) => ({ ...l, status: i === 5 ? 'optional' : 'required', prerequisites: [] }))
  value.dailyMinutes = 60
  value.program = { days: 20, startDate: localDay(), budget: budget(60, 120, 120, 30), lightEvery: 7, lightMinutes: 90 }
  value.modules[0].practice = practice(1, 10, '基础')
  value.modules[1].practice = { ...practice(11, 20, '项目'), budget: budget(30, 60, 240, 30) }
  return value
}

async function seed(page: any, desktop: any, value: any, records?: unknown) {
  await openCourse(page)
  const id = courseId(page)
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(page.getByRole('button', { name: '打开课程文件夹', exact: true })).toBeVisible()
  await page.goto('about:blank')
  desktop.write('guide', { courseId: id, plan: value, view: 'route', includeOptional: false, metadata: {}, mastery: {}, questions: [], today: null })
  if (records) desktop.write('settings', { key: `study-records:${id}`, value: records })
  await page.goto(`/#/courses/${id}`)
  return id
}

test('概览：完整计划与视频排期分开显示，今日任务包含实践，阶段折叠与推荐说明', async ({ page, desktop }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const id = await seed(page, desktop, programPlan())
  await expect(page.getByTestId('plan-day')).toHaveText('计划第 1 / 20 天')
  const time = page.getByLabel('时间安排', { exact: true })
  await expect(time).toContainText('每日总投入 5 小时 30 分钟')
  await expect(time).toContainText('路线视频剩余')
  await expect(time).toContainText('按各阶段看课额度预计第 1 天看完')

  const todayRegion = page.getByRole('region', { name: '今日任务', exact: true })
  const allocation = todayRegion.getByRole('list', { name: '今日时间分配', exact: true })
  await expect(allocation.locator('li')).toHaveCount(4)
  const work = todayRegion.getByRole('list', { name: '今日实践任务', exact: true })
  await expect(work.locator('li')).toHaveCount(3)
  await expect(work.locator('li').first()).toContainText('基础编码任务一')

  // 记录投入时间并完成任务：剩余编码时间顺延给下一项任务。
  await work.getByLabel('基础编码任务一 已投入分钟数', { exact: true }).fill('45')
  await work.getByLabel('基础编码任务一 已投入分钟数', { exact: true }).press('Tab')
  await work.getByLabel('基础编码任务一 成果记录', { exact: true }).fill('https://example.test/commit/1')
  await work.getByLabel('基础编码任务一 成果记录', { exact: true }).press('Tab')
  await work.getByLabel('完成任务：基础编码任务一', { exact: true }).check()
  await expect(work.locator('li')).toHaveCount(4)
  await expect(work.locator('li', { hasText: '基础编码任务二' })).toContainText('计划 1 小时 15 分钟')
  await expect(allocation.locator('li').nth(1)).toContainText('45 / 120 分钟')
  await expect.poll(() => (desktop.read('settings', { key: `study-records:${id}` }) as any)?.entries?.find((e: any) => e.taskId === 'c1')?.done).toBe(true)

  // 阶段折叠：默认只展开当前阶段。
  const catalog = page.getByRole('region', { name: '课程章节目录', exact: true })
  await expect(catalog.getByRole('button', { name: /Java 基础与机制/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(catalog.getByRole('button', { name: /SpringBoot 项目/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(catalog.locator('button[data-path]')).toHaveCount(4)
  await expect(catalog.locator('button[data-path]').first()).toHaveText(/Java基础/)

  // 推荐说明：原因、服务目标、可跳过条件与原文件名。
  await catalog.getByRole('button', { name: '为什么学这节', exact: true }).first().click()
  const info = catalog.getByLabel('Java基础 推荐说明', { exact: true })
  await expect(info).toContainText('基础阶段交付物')
  await expect(info).toContainText('基础可跳过条件')
  await expect(info).toContainText(paths[0]!)

  // 阶段验收：必须先填写证据。
  await todayRegion.getByRole('button', { name: '查看阶段验收', exact: true }).click()
  const checks = catalog.getByRole('region', { name: '验收清单', exact: true })
  const pass = checks.locator('li[data-check-id="e1"]').getByRole('checkbox')
  await expect(pass).toBeDisabled()
  await checks.getByLabel('验收证据：基础练习验收', { exact: true }).fill('pytest 10 passed')
  await checks.getByLabel('验收证据：基础练习验收', { exact: true }).press('Tab')
  await expect(pass).toBeEnabled()
  await pass.check()
  await expect(checks.locator('li[data-check-id="e1"]')).toContainText('已通过')
  await expect(todayRegion.getByLabel('阶段进度', { exact: true })).toContainText('练习验收1/1')
  await page.screenshot({ path: testInfo.outputPath('dashboard-plan.png'), fullPage: true })

  // 刷新后记录保留。
  await page.reload()
  await expect(page.getByRole('region', { name: '今日任务', exact: true }).getByRole('list', { name: '今日实践任务', exact: true }).locator('li')).toHaveCount(4)
  await expect(page.getByRole('region', { name: '今日任务', exact: true }).getByLabel('阶段进度', { exact: true })).toContainText('练习验收1/1')
  // 打卡目标为每日总投入，实践时间计入学习时长。
  await expect(page.getByRole('region', { name: '学习打卡日历', exact: true })).toContainText('5 小时 30 分钟')
  expect(errors).toEqual([])
})

test('导学：设置完整计划、导入实践安排、AI 调整路线先预览再应用，并支持撤销', async ({ page, desktop }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let mode = 'route'
  await page.route('https://guide.test/v1/chat/completions', async route => {
    const value: any = plan()
    if (mode === 'route') value.lessons = value.lessons.map((l: any, i: number) => ({ ...l, status: i === 3 ? 'required' : l.status }))
    const content = mode === 'practice'
      ? { program: { days: 40, startDate: localDay(), budget: budget(60, 60, 60, 30), lightEvery: 0, lightMinutes: 60 }, stages: [{ moduleId: 'base', ...practice(1, 20, 'AI') }] }
      : value
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] } })
  })
  const base: any = plan()
  const id = await seed(page, desktop, base)
  await configure(page)
  const dialog = page.getByRole('dialog', { name: 'AI 智能导学', exact: true })
  const settings = dialog.getByRole('region', { name: '完整学习计划', exact: true })
  await expect(settings).toContainText('未设置')

  // 手动设置完整计划：看课时间同步到播放器排期。
  await settings.getByRole('button', { name: '设置计划', exact: true }).click()
  await settings.getByLabel('总天数', { exact: true }).fill('60')
  await settings.getByLabel('看课 / 回看', { exact: true }).fill('45')
  await settings.getByLabel('独立编码', { exact: true }).fill('90')
  await settings.getByRole('button', { name: '保存计划', exact: true }).click()
  await expect(settings).toContainText('共 60 天')
  await expect(dialog.getByLabel('每天学习分钟数', { exact: true })).toHaveValue('45')

  // 导入实践安排后可撤销。
  await settings.getByLabel('选择实践安排文件', { exact: true }).setInputFiles({ name: 'practice.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ stages: { base: practice(1, 30, '导入'), project: practice(31, 60, '导入') } })) })
  await expect(settings).toContainText('已为 2 个阶段设置实践任务与验收清单')
  await dialog.getByRole('button', { name: '知识地图', exact: true }).click()
  await expect(dialog.getByText('导入阶段目标').first()).toBeVisible()
  await dialog.getByRole('button', { name: '定制路线', exact: true }).click()
  await dialog.getByRole('button', { name: '撤销上次调整', exact: true }).click()
  await expect(settings).toContainText('实践安排：尚未设置')
  await expect(settings).toContainText('共 60 天')

  // AI 调整路线：先预览，放弃后路线不变；应用后可撤销。
  await dialog.getByLabel('继续补充或调整目标', { exact: true }).fill('加入多态')
  await dialog.getByRole('button', { name: '调整学习路线', exact: true }).click()
  const preview = dialog.getByRole('region', { name: '路线调整预览', exact: true })
  await expect(preview).toContainText('新增课节')
  await expect(preview.getByRole('row', { name: /路线课节/ })).toContainText('1 节')
  await expect(preview.getByRole('row', { name: /路线课节/ })).toContainText('4 节')
  await preview.getByRole('button', { name: '放弃调整', exact: true }).click()
  await expect(dialog.getByLabel('04-多态 学习状态', { exact: true })).toHaveValue('skipped')
  await dialog.getByLabel('继续补充或调整目标', { exact: true }).fill('加入多态')
  await dialog.getByRole('button', { name: '调整学习路线', exact: true }).click()
  await preview.getByRole('button', { name: '应用调整', exact: true }).click()
  await expect(dialog.getByLabel('04-多态 学习状态', { exact: true })).toHaveValue('required')
  // 未返回实践安排时沿用原计划。
  await expect(settings).toContainText('共 60 天')
  await dialog.getByRole('button', { name: '撤销上次调整', exact: true }).click()
  await expect(dialog.getByLabel('04-多态 学习状态', { exact: true })).toHaveValue('skipped')

  // AI 补全实践安排。
  mode = 'practice'
  await settings.getByRole('button', { name: 'AI 补全实践安排', exact: true }).click()
  await expect(settings).toContainText('已为 1 个阶段设置实践任务与验收清单')
  await expect(settings).toContainText('共 40 天')
  await expect.poll(() => (desktop.read('guide', { courseId: id }) as any)?.plan?.modules?.[0]?.practice?.goal).toBe('AI阶段目标')
  expect(errors).toEqual([])
})

test('窄屏概览与导学计划区域可操作，没有横向溢出', async ({ page, desktop }, testInfo) => {
  await seed(page, desktop, programPlan())
  await page.setViewportSize({ width: 390, height: 844 })
  const todayRegion = page.getByRole('region', { name: '今日任务', exact: true })
  await expect(todayRegion.getByRole('list', { name: '今日实践任务', exact: true }).locator('li')).toHaveCount(3)
  const scroller = page.locator('.scroll-soft').first()
  expect(await scroller.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true })
})

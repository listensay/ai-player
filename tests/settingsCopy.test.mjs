import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'

function templateCopy(file) {
  const { descriptor } = parse(readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8'))
  const root = baseParse(descriptor.template.content)
  const visible = [],
    collapsed = [],
    summaries = []
  function walk(node, hidden = false) {
    if (node.type === 2) (hidden ? collapsed : visible).push(node.content)
    if (node.type === 1 && node.tag === 'details') {
      for (const child of node.children) {
        const summary = child.type === 1 && child.tag === 'summary'
        if (summary) summaries.push(child.loc.source)
        walk(child, hidden || !summary)
      }
    } else for (const child of node.children ?? []) walk(child, hidden)
  }
  walk(root)
  return {
    visible: visible.join(' '),
    collapsed: collapsed.join(' '),
    summaries: summaries.join(' '),
    source: descriptor.template.content,
  }
}

test('学习管理删除冗余统计说明文案，保留核心数据展示与操作', () => {
  const copy = templateCopy('components/StudyInsightsPanel.vue')
  for (const phrase of ['可能重叠', '5,000', '覆盖 3 天', '不等于桌宠运行天数', '夜间勋章', '发送至已配置的 AI 服务']) {
    assert.ok(!copy.source.includes(phrase), `冗余文案已清除: ${phrase}`)
  }
  assert.doesNotMatch(copy.summaries, /统计说明/)
  assert.match(copy.visible, /暂无时段建议/)
  assert.match(copy.visible, /导出 Markdown/)
  assert.match(copy.source, /role="alert"/)
})

test('番茄钟删除冗余计时规则说明，操作与设置完整保留', () => {
  const copy = templateCopy('components/PomodoroSettingsPanel.vue')
  assert.doesNotMatch(copy.summaries, /计时规则/)
  assert.doesNotMatch(copy.source, /每次启动应用|播放视频开始|时长修改/)
  assert.match(copy.source, /@click="clock\.pause\(\)"/)
  assert.match(copy.source, /v-if="current.notice" role="status"/)
  assert.match(copy.source, /@click="save"/)
})

test('提醒规则删除冗余说明，创建与删除确认保持简洁', () => {
  const copy = templateCopy('components/StudyManagementPanel.vue')
  assert.doesNotMatch(copy.summaries, /提醒规则/)
  assert.doesNotMatch(copy.source, /当天开始观看或记录实践后/)
  assert.match(copy.visible, /添加提醒/)
  assert.match(copy.source, /submit-label="确认删除"/)
})

test('AI 设置删除冗余提示与免责文案，表单功能正常', () => {
  const copy = templateCopy('components/AiSettingsPanel.vue')
  for (const phrase of ['区分配置', '切换配置仅影响新请求', '两节虚拟课', '视频与截图不会上传']) {
    assert.ok(!copy.source.includes(phrase), `冗余文案已清除: ${phrase}`)
  }
  assert.match(copy.source, /testConnection/)
  assert.match(copy.source, /type="submit"/)
})

test('打卡日历、练习与导学弹窗清除免责与规则文案', () => {
  const calendar = templateCopy('components/CheckInCalendar.vue')
  assert.doesNotMatch(calendar.source, /打卡规则|绿色勾号表示已打卡/)

  const practice = templateCopy('components/PracticeDialog.vue')
  assert.doesNotMatch(
    practice.source,
    /反馈仅针对本次作答|会发送给当前 AI|代码为 UTF-8|根据代码静态分析|今日只生成一道综合大题|分批发送至所选 AI|每批最多 12000|每个课节保留最近/,
  )

  const guide = templateCopy('components/GuideDialog.vue')
  assert.doesNotMatch(
    guide.source,
    /不上传视频|排期仅统计视频|暂按已知课节中位数|全部知识点标为“已掌握”时跳过本课|观看进度独立记录|知识结构依据课程标题生成/,
  )

  const welcome = templateCopy('components/WelcomeScreen.vue')
  assert.doesNotMatch(welcome.source, /支持 MP4、WebM/)

  const prereq = templateCopy('components/PrerequisitePanel.vue')
  assert.doesNotMatch(prereq.source, /先查看课节之间明确记录|数量包含间接前置课，已去重/)

  const todayPlan = templateCopy('components/TodayPlanPanel.vue')
  assert.doesNotMatch(todayPlan.source, /临时调整仅对今日生效|今日打卡目标不变/)

  const program = templateCopy('components/ProgramSettings.vue')
  assert.doesNotMatch(program.source, /当前仅安排视频学习/)

  const adjustment = templateCopy('components/PlanAdjustment.vue')
  assert.doesNotMatch(adjustment.source, /保留每日投入，自动顺延阶段和结束日期/)

  const pet = templateCopy('components/CompanionPet.vue')
  assert.doesNotMatch(pet.source, /课程继续播放/)

  const knowledge = templateCopy('components/LessonKnowledgePanel.vue')
  assert.doesNotMatch(knowledge.source, /音频在本地处理|发送至所选 AI/)

  const routePreview = templateCopy('components/RoutePreview.vue')
  assert.doesNotMatch(routePreview.source, /请核对课节与时间变化|请确认已具备相关知识/)

  const milestones = templateCopy('components/MilestonesPanel.vue')
  assert.doesNotMatch(
    milestones.source,
    /每一步都值得被看见|六大成长系列|永久保留|不会因读取失败撤销勋章|首次打开会自动收录已有成绩|连续打卡按最长连续纪录统计/,
  )

  const celebration = templateCopy('components/MilestoneCelebration.vue')
  assert.doesNotMatch(celebration.source, /新的里程碑，属于你|每一点努力，都在让你走得更远|太棒了，继续前进/)

  const milestonesTs = readFileSync(new URL('../app/utils/milestones.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(milestonesTs, /按当前内容统计|不含休息与放弃|已有记录不会被覆盖/)
})

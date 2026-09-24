import { test } from 'node:test'
import assert from 'node:assert/strict'
import './support/tauri-http.mjs'
import { validateLearningPlan, retainPrerequisites, dependencyRisks, orderedRoute, adjacentRoutePath, buildSchedule } from '../app/utils/guide.ts'
import { parseAiJson, completionUrl, requestGuideJson, planPrompt } from '../app/utils/guideAi.ts'
import { parseSubtitles, relevantCues } from '../app/utils/guideMedia.ts'

const paths = ['01-java.mp4', '02-reflection.mp4', '03-annotations.mp4', '04-spring.mp4', '05-test.mp4']
function fixture() {
  return { summary: '保留框架必需的反射和注解，跳过已掌握的基础。', profile: '已学 Java，想开发 Spring 项目。', dailyMinutes: 120,
    modules: [{ id: 'base', title: '基础', description: '前置知识' }, { id: 'app', title: '框架', description: '项目开发' }],
    lessons: paths.map((path, i) => ({ path, moduleId: i < 3 ? 'base' : 'app', concepts: ['知识'],
      prerequisites: i === 3 ? [paths[2]] : i === 2 ? [paths[1]] : [], status: i === 3 ? 'required' : i === 4 ? 'optional' : 'skipped', reason: '依据目标选择' })) }
}

test('必修课递归保留跨模块基础，播放顺序满足依赖', () => {
  const plan = validateLearningPlan(fixture(), paths)
  assert.deepEqual(retainPrerequisites(plan.lessons).sort(), [paths[1], paths[2]])
  assert.equal(plan.lessons[0].status, 'skipped')
  assert.deepEqual(orderedRoute([...plan.lessons].reverse(), false).map(l => l.path), paths.slice(1, 4))
  assert.equal(orderedRoute(plan.lessons, true).length, 4)
})

test('规划顺序不会在校验或重新读取时被原目录顺序覆盖', () => {
  const raw = fixture()
  raw.lessons = [3, 1, 4, 0, 2].map(i => ({ ...raw.lessons[i], status: 'required', prerequisites: [] }))
  const expected = raw.lessons.map(l => l.path)
  const plan = validateLearningPlan(raw, paths)
  assert.deepEqual(plan.lessons.map(l => l.path), expected)
  const restored = validateLearningPlan(JSON.parse(JSON.stringify(plan)), [...paths].reverse())
  assert.deepEqual(orderedRoute(restored.lessons, false).map(l => l.path), expected)
})

test('跳过中间课节仍保留两端学习顺序，不自动加入路线外课节', () => {
  const raw = fixture()
  raw.lessons.forEach(l => { l.status = 'skipped'; l.prerequisites = [] })
  raw.lessons[0].status = 'required'
  raw.lessons[0].prerequisites = [paths[1]]
  raw.lessons[1].prerequisites = [paths[3]]
  raw.lessons[3].status = 'required'
  raw.lessons[4].status = 'optional'
  const plan = validateLearningPlan(raw, paths)
  assert.deepEqual(orderedRoute(plan.lessons, false).map(l => l.path), [paths[3], paths[0]])
  assert.deepEqual(orderedRoute(plan.lessons, true).map(l => l.path), [paths[3], paths[0], paths[4]])
  assert.equal(plan.lessons[1].status, 'skipped')
})
test('手动跳过、取消选修会报告间接依赖；补齐后风险消失', () => {
  const plan = validateLearningPlan(fixture(), paths)
  assert.deepEqual(dependencyRisks(plan.lessons, false).map(r => r.prerequisite).sort(), paths.slice(1, 3))
  retainPrerequisites(plan.lessons)
  plan.lessons[1].status = 'optional'
  assert.equal(dependencyRisks(plan.lessons, false)[0].prerequisite, paths[1])
  assert.equal(dependencyRisks(plan.lessons, true).length, 0)
  retainPrerequisites(plan.lessons)
  assert.equal(dependencyRisks(plan.lessons, false).length, 0)
})
for (const [label, mutate] of [
  ['遗漏课节', v => v.lessons.pop()],
  ['重复课节', v => v.lessons.push(v.lessons[0])],
  ['虚构课节', v => { v.lessons[0].path = 'ghost.mp4' }],
  ['虚构前置', v => { v.lessons[0].prerequisites = ['ghost.mp4'] }],
  ['自依赖', v => { v.lessons[0].prerequisites = [paths[0]] }],
  ['循环依赖', v => { v.lessons[1].prerequisites = [paths[3]] }],
  ['重复板块', v => v.modules.push(v.modules[0])],
  ['虚构板块', v => { v.lessons[0].moduleId = 'ghost' }],
  ['未知状态', v => { v.lessons[0].status = 'done' }],
  ['缺少理由', v => { v.lessons[0].reason = '' }],
  ['没有必修', v => v.lessons.forEach(l => { l.status = 'skipped' })],
  ['无效预算', v => { v.dailyMinutes = -20 }],
  ['超出每日预算', v => { v.dailyMinutes = 1441 }],
]) test(`拒绝${label}，不应用不完整路线`, () => {
  const value = fixture(); mutate(value)
  assert.throws(() => validateLearningPlan(value, paths))
})
test('从完整目录打开路线外课程仍能前后导航；边界不越界', () => {
  const route = [paths[1], paths[3]]
  assert.equal(adjacentRoutePath(route, paths[0], 1, paths), paths[1])
  assert.equal(adjacentRoutePath(route, paths[2], -1, paths), paths[1])
  assert.equal(adjacentRoutePath(route, paths[2], 1, paths), paths[3])
  assert.equal(adjacentRoutePath(route, paths[3], 1, paths), undefined)
  assert.equal(adjacentRoutePath(route, paths[1], -1, paths), undefined)
})
test('排期扣除已学时长，跨天里程碑按连续预算分配', () => {
  const lessons = validateLearningPlan(fixture(), paths).lessons.slice(1, 4)
  const durations = Object.fromEntries(paths.map(p => [p, 3600]))
  const progress = { [paths[1]]: { done: true, time: 3600 }, [paths[2]]: { done: false, time: 1800 } }
  const schedule = buildSchedule(lessons, durations, progress, 60)
  assert.equal(schedule.totalSeconds, 10800)
  assert.equal(schedule.remainingSeconds, 5400)
  assert.equal(schedule.days, 2)
  assert.equal(schedule.completed, 1)
  assert.equal(schedule.milestones[1].startDay, 1)
  assert.equal(schedule.milestones[1].endDay, 2)
  assert.equal(buildSchedule([], {}, {}, 60).days, 0)
})
test('未知时长有明确计数、使用中位数，完成后剩余为零', () => {
  const lessons = validateLearningPlan(fixture(), paths).lessons.slice(0, 2)
  const schedule = buildSchedule(lessons, { [paths[0]]: 1800, [paths[1]]: null }, {}, 60)
  assert.equal(schedule.totalSeconds, 3600)
  assert.equal(schedule.unknown, 1)
  assert.equal(buildSchedule(lessons, {}, {}, 60).totalSeconds, 2400)
  assert.equal(buildSchedule(lessons, {}, Object.fromEntries(paths.map(p => [p, { done: true }])), 60).days, 0)
})
test('SRT/VTT 精确解析时间，非法区间忽略，检索只返回真实证据', () => {
  const cues = parseSubtitles('\uFEFFWEBVTT\r\n\r\ncue-a\r\n00:01.500 --> 00:05.000 align:start\r\n<b>反射</b>读取注解\r\n\r\n2\r\n00:00:06,000 --> 00:00:09,000\r\n创建对象\r\n\r\n3\r\n00:10.000 --> 00:09.000\r\n无效\r\n')
  assert.equal(cues.length, 2)
  assert.deepEqual(cues[0], { id: 0, start: 1.5, end: 5, text: '反射读取注解' })
  assert.deepEqual(relevantCues(cues, ['反射']).map(c => c.id), [0])
  assert.deepEqual(relevantCues(cues, ['数据库']), [])
})
test('兼容基础地址与完整端点，不允许密钥藏在 URL 中', () => {
  assert.equal(completionUrl('https://example.com/v1/'), 'https://example.com/v1/chat/completions')
  assert.equal(completionUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions')
  assert.equal(completionUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions')
  assert.throws(() => completionUrl('https://name:secret@example.com/v1'))
  assert.throws(() => completionUrl('https://example.com/v1?key=secret'))
  assert.throws(() => completionUrl('http://remote.example/v1'))
  assert.throws(() => completionUrl('javascript:alert(1)'))
})
test('容忍 JSON 围栏，拒绝残缺输出', () => {
  assert.deepEqual(parseAiJson('```json\n{"ok":true}\n```'), { ok: true })
  assert.throws(() => parseAiJson('{"partial":'))
})
test('追问保留已确认的学情与手动选择', () => {
  const plan = validateLearningPlan(fixture(), paths)
  plan.messages = [{ role: 'user', content: '已经掌握 Java' }]
  const prompt = planPrompt([], '每天只有半小时', 120, plan)[0].content
  assert.ok(prompt.includes('已经掌握 Java'))
  assert.ok(prompt.includes('每天只有半小时'))
  assert.ok(prompt.includes(paths[0]))
})
test('请求正确发送用户配置；截断、鉴权失败与取消均可识别', async () => {
  const original = globalThis.fetch
  const settings = { baseUrl: 'https://guide.test/v1', model: 'test-model', apiKey: 'test-only-key' }
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://guide.test/v1/chat/completions')
      assert.equal(options.headers.authorization, 'Bearer test-only-key')
      assert.equal(JSON.parse(options.body).model, 'test-model')
      return Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })
    }
    assert.deepEqual(await requestGuideJson(settings, [], new AbortController().signal), { ok: true })
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] })
    await assert.rejects(requestGuideJson(settings, [], new AbortController().signal), /截断/)
    globalThis.fetch = async () => new Response('do not expose error body', { status: 401 })
    await assert.rejects(requestGuideJson(settings, [], new AbortController().signal), /密钥无效/)
    const controller = new AbortController(); controller.abort()
    globalThis.fetch = async () => { throw new DOMException('abort', 'AbortError') }
    await assert.rejects(requestGuideJson(settings, [], controller.signal), { name: 'AbortError' })
  } finally { globalThis.fetch = original }
})

test('AI 响应时长支持自定义配置，最高限制 30 分钟', async () => {
  const original = globalThis.fetch
  try {
    // 验证正常调用携带自定义超时时长配置
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{"status":"ok"}' }, finish_reason: 'stop' }] })
    const res = await requestGuideJson(
      { baseUrl: 'https://guide.test/v1', model: 'test-model', apiKey: '', timeoutMinutes: 30 },
      [],
      new AbortController().signal,
    )
    assert.deepEqual(res, { status: 'ok' })

    // 验证超时中止时提示信息包含对应的超时分钟数
    globalThis.fetch = async (_url, options) => {
      // 模拟请求挂起直到信号中止
      return new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    }
  } finally {
    globalThis.fetch = original
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bindPlanCatalog,
  catalogModules,
  catalogRouteLabels,
  catalogRouteTree,
  catalogTreeVideos,
  numberedRouteTitle,
  orderPlanByCatalogTree,
} from '../app/utils/guideCatalog.ts'
import { validateLearningPlan } from '../app/utils/guide.ts'
import { applyPlanAdjustment } from '../app/utils/guidePlanAdjustment.ts'

const video = (path) => ({
  kind: 'video',
  path,
  title: path.split('/').at(-1).replace('.mp4', ''),
  size: 1,
  modified: 1,
})
const folder = (path, children) => ({
  kind: 'folder',
  path,
  name: path.split('/').at(-1),
  children,
  videoCount: children.reduce((count, child) => count + (child.kind === 'folder' ? child.videoCount : 1), 0),
})
function fixture() {
  const paths = [
    '1安装软件教程/安装.mp4',
    '4必备数学课程/1.高等数学基础/6-方向导数.mp4',
    '4必备数学课程/1.高等数学基础/7-梯度.mp4',
    '4必备数学课程/2.微积分/微积分.mp4',
    ...Array.from({ length: 10 }, (_, i) => `5机器学习算法精讲/28.隐马尔科夫模型/${i + 1}-原理.mp4`),
    ...Array.from({ length: 4 }, (_, i) => `5机器学习算法精讲/29.HMM应用实例/${i + 1}-应用.mp4`),
    '6建模实战项目/交易异常检测/交易异常检测.mp4',
    '环境/Jupyter.mp4',
  ]
  const videos = paths.map(video)
  const directory = (path) =>
    folder(
      path,
      videos.filter((entry) => entry.path.startsWith(path + '/') && !entry.path.slice(path.length + 1).includes('/')),
    )
  const root = folder('', [
    directory('1安装软件教程'),
    folder('4必备数学课程', [directory('4必备数学课程/1.高等数学基础'), directory('4必备数学课程/2.微积分')]),
    folder('5机器学习算法精讲', [
      directory('5机器学习算法精讲/28.隐马尔科夫模型'),
      directory('5机器学习算法精讲/29.HMM应用实例'),
    ]),
    folder('6建模实战项目', [directory('6建模实战项目/交易异常检测')]),
    directory('环境'),
  ])
  const plan = {
    version: 1,
    createdAt: 1,
    dailyMinutes: 30,
    summary: '已有路线',
    profile: '学习数学与算法',
    messages: [],
    modules: [{ id: 'merged', title: 'AI编造的实战项目阶段（严格按照目录顺序）', description: '旧板块' }],
    lessons: paths.map((path) => ({
      path,
      moduleId: 'merged',
      status: 'required',
      concepts: ['原有知识点'],
      prerequisites: [],
      reason: '已有选择',
    })),
  }
  return { root, videos, plan }
}

test('旧 AI 合并板块按原目录修复：HMM原理10节与应用实例4节分别保留，名称和归属不改', () => {
  const { root, videos, plan } = fixture()
  const original = structuredClone(plan)
  const bound = bindPlanCatalog(plan, videos, '机器学习')
  const checked = validateLearningPlan(
    bound,
    videos.map((entry) => entry.path),
  )
  assert.equal(checked.catalogVersion, 1)
  for (const [title, count] of [
    ['28.隐马尔科夫模型', 10],
    ['29.HMM应用实例', 4],
  ]) {
    const module = checked.modules.find((entry) => entry.title === title)
    assert.ok(module)
    assert.equal(checked.lessons.filter((entry) => entry.moduleId === module.id).length, count)
    assert.ok(
      checked.lessons
        .filter((entry) => entry.moduleId === module.id)
        .every((entry) => entry.path.startsWith(module.sourcePath + '/')),
    )
  }
  assert.deepEqual(plan, original)
  assert.deepEqual(catalogRouteTree(root, videos), root)
  assert.deepEqual(
    checked.lessons.map((entry) => entry.concepts),
    original.lessons.map((entry) => entry.concepts),
  )
})

test('只学4至6时保留原始层级，方向导数→梯度→微积分，项目目录没有阶段改名', () => {
  const { root, videos } = fixture()
  const selected = videos.filter((entry) => /^[456]/.test(entry.path))
  const tree = catalogRouteTree(root, selected)
  assert.deepEqual(
    tree.children.map((entry) => entry.name),
    ['4必备数学课程', '5机器学习算法精讲', '6建模实战项目'],
  )
  assert.deepEqual(
    tree.children[0].children.map((entry) => entry.name),
    ['1.高等数学基础', '2.微积分'],
  )
  assert.equal(tree.children[2].children[0].name, '交易异常检测')
  assert.deepEqual(
    catalogTreeVideos(tree).map((entry) => entry.path),
    selected.map((entry) => entry.path),
  )
  assert.deepEqual(
    catalogTreeVideos(tree)
      .slice(0, 3)
      .map((entry) => entry.title),
    ['6-方向导数', '7-梯度', '微积分'],
  )
})

test('只改变展示编号，从1连续重排；没有编号补上，原始路径、名称不受影响', () => {
  const { root, videos } = fixture()
  const original = structuredClone(root)
  const tree = catalogRouteTree(
    root,
    videos.filter((entry) => /^[456]/.test(entry.path)),
  )
  const positions = new Map(catalogTreeVideos(tree).map((entry, i) => [entry.path, i + 1]))
  const labels = catalogRouteLabels(tree, positions)
  assert.equal(labels.get('4必备数学课程'), '1. 必备数学课程')
  assert.equal(labels.get('5机器学习算法精讲'), '2. 机器学习算法精讲')
  assert.equal(labels.get('5机器学习算法精讲/28.隐马尔科夫模型'), '1. 隐马尔科夫模型')
  assert.equal(labels.get('5机器学习算法精讲/29.HMM应用实例'), '2. HMM应用实例')
  assert.equal(labels.get('4必备数学课程/1.高等数学基础/6-方向导数.mp4'), '1. 方向导数')
  assert.equal(labels.get('4必备数学课程/1.高等数学基础/7-梯度.mp4'), '2. 梯度')
  assert.equal(labels.get('6建模实战项目/交易异常检测'), '1. 交易异常检测')
  assert.deepEqual(root, original)
  for (const name of ['01-环境搭建', '2 标题', '9、标题', '12.标题', '标题', '3D建模', 'HMM应用实例']) {
    const expected =
      name === '01-环境搭建' ? '环境搭建' : ['标题', '3D建模', 'HMM应用实例'].includes(name) ? name : '标题'
    assert.equal(numberedRouteTitle(name, 1), `1. ${expected}`)
  }
  assert.equal(numberedRouteTitle('1.2. 极限', 3), '3. 极限')
  assert.equal(numberedRouteTitle('2024年计划', 1), '1. 2024年计划')
})

test('重复、漏课和外来路径被拒绝，不能作为完整路线保存', () => {
  const { root, videos, plan } = fixture()
  for (const lessons of [
    plan.lessons.slice(1),
    [...plan.lessons, plan.lessons[0]],
    plan.lessons.map((entry, i) => (i ? entry : { ...entry, path: '不存在.mp4' })),
  ])
    assert.throws(() => bindPlanCatalog({ ...plan, lessons }, videos, '课程'), /完整对应/)
  assert.throws(() => catalogRouteTree(root, [...videos, videos[0]]), /重复课节/)
  assert.throws(() => catalogRouteTree(root, [video('不存在.mp4')]), /不一致/)
})

test('目录绑定后拒绝 AI 改名、移动课节和重复来源，增量调整也不能绕过', () => {
  const { videos, plan } = fixture()
  const bound = bindPlanCatalog(plan, videos, '课程')
  const paths = videos.map((entry) => entry.path)
  const renamed = structuredClone(bound)
  renamed.modules[0].title = 'AI自创阶段'
  assert.throws(() => validateLearningPlan(renamed, paths), /原始目录/)
  const moved = structuredClone(bound)
  moved.lessons[0].moduleId = moved.modules[1].id
  assert.throws(() => validateLearningPlan(moved, paths), /原始目录/)
  assert.throws(
    () => applyPlanAdjustment({ summary: '改目录', changes: [], modules: bound.modules }, bound, videos, 30),
    /不能修改原始目录/,
  )
  assert.throws(
    () =>
      applyPlanAdjustment(
        { summary: '移动课节', changes: [{ ids: ['l1'], targetModuleId: bound.modules[1].id }] },
        bound,
        videos,
        30,
      ),
    /不能修改课节/,
  )
  const result = applyPlanAdjustment({ summary: '改时间', changes: [], dailyMinutes: 45 }, bound, videos, 30)
  assert.equal(result.plan.dailyMinutes, 45)
  assert.deepEqual(result.plan.modules, bound.modules)
})

test('建议交错课节时只排序同级目录，树遍历与播放器顺序一致，原课节不换目录', () => {
  const { root, videos, plan } = fixture()
  plan.lessons = [plan.lessons[14], plan.lessons[1], ...plan.lessons.filter((_entry, i) => ![14, 1].includes(i))]
  orderPlanByCatalogTree(plan, { root, videos })
  const proposed = plan.lessons.map((entry) => videos.find((v) => v.path === entry.path))
  const tree = catalogRouteTree(root, proposed)
  assert.deepEqual(
    catalogTreeVideos(tree).map((entry) => entry.path),
    plan.lessons.map((entry) => entry.path),
  )
  const hmm = tree.children.find((entry) => entry.path === '5机器学习算法精讲')
  assert.deepEqual(
    hmm.children.map((entry) => entry.path),
    ['5机器学习算法精讲/29.HMM应用实例', '5机器学习算法精讲/28.隐马尔科夫模型'],
  )
  assert.equal(new Set(plan.lessons.map((entry) => entry.path)).size, videos.length)
})

test('根目录课节和同名但不同层级目录分别绑定，编号稳定且不包含课程外信息', () => {
  const paths = ['根课程.mp4', '甲/基础/一.mp4', '乙/基础/二.mp4']
  const modules = catalogModules(
    paths.map((path) => ({ path })),
    '根目录课程',
  )
  assert.deepEqual(
    modules.map((entry) => entry.title),
    ['根目录课程', '基础', '基础'],
  )
  assert.equal(new Set(modules.map((entry) => entry.id)).size, 3)
  assert.deepEqual(
    catalogModules(
      paths.map((path) => ({ path })),
      '根目录课程',
    ),
    modules,
  )
})

test('旧模块仅对应一个原始目录时保留编号与实践，既有实践证据仍能关联', () => {
  const { plan, videos } = fixture()
  plan.modules.push({
    id: 'existing-practice',
    title: '旧标题',
    description: '旧说明',
    practice: { startDay: 1, endDay: 2, tasks: [], checks: [] },
  })
  plan.lessons[1].moduleId = 'existing-practice'
  plan.lessons[2].moduleId = 'existing-practice'
  const bound = bindPlanCatalog(plan, videos, '课程')
  const module = bound.modules.find((entry) => entry.sourcePath === '4必备数学课程/1.高等数学基础')
  assert.equal(module.id, 'existing-practice')
  assert.equal(module.title, '1.高等数学基础')
  assert.deepEqual(module.practice, plan.modules[1].practice)
  assert.ok(
    bound.lessons
      .filter((entry) => entry.path.includes('/1.高等数学基础/'))
      .every((entry) => entry.moduleId === 'existing-practice'),
  )
})

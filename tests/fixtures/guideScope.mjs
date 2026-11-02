export const explicitRemainingScope =
  '不学的章节：\n1安装软件教程\n2python快速入门\n3数据科学必备工具包\n环境\n\n剩下的都是要学的内容'

export const sourceCourseRoots = [
  '1-Al课程所需安装软件教程',
  '2-Python快速入门',
  '3-Python数据科学必备工具包实战',
  '4-人工智能-必备数学课程',
  '5-机器学习算法精讲及其案例应用',
  '6-机器学习算法建模实战项目',
  '环境',
]

export const abbreviatedScopeCatalog = () =>
  [
    ...sourceCourseRoots.slice(0, 3).map((name) => ({ path: `${name}/入门.mp4`, title: '入门' })),
    ...['函数', '极限', '无穷小', '连续性与导数', '偏导数', '方向导数', '梯度'].map((title, index) => ({
      path: `${sourceCourseRoots[3]}/1.高等数学基础/${index + 1}-${title}.mp4`,
      title: `${index + 1}-${title}`,
      done: index < 5,
    })),
    { path: `${sourceCourseRoots[3]}/2.微积分/微积分.mp4`, title: '微积分' },
    { path: `${sourceCourseRoots[4]}/28.隐马尔科夫模型/HMM.mp4`, title: 'HMM' },
    { path: `${sourceCourseRoots[4]}/29.HMM应用实例/HMM应用.mp4`, title: 'HMM应用' },
    { path: `${sourceCourseRoots[5]}/交易异常检测/项目.mp4`, title: '项目' },
    { path: '环境/Jupyter.mp4', title: 'Jupyter' },
  ].map((entry) => ({ duration: 600, done: false, ...entry }))

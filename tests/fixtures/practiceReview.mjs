// 既有生命周期测试的 AI 审查响应；规则拒绝与修正行为在 practiceGeneration.test.mjs 单独覆盖。
export function approvedPracticeReview(messages) {
  const data = JSON.parse(messages[0].content.split('输入数据：')[1])
  const questions = data.questions
  const programming = questions.find((question) => question.programming)?.programming
  return {
    profile: {
      programming: !!programming,
      language: programming?.language ?? '',
      requiresProject: false,
      density:
        questions.length === 1
          ? 'narrow'
          : questions.length === 2
            ? 'small'
            : questions.length === 3
              ? 'normal'
              : 'rich',
      reason: '本批练习覆盖所选学习目标。',
      goals: [{ id: 'g1', skill: '应用列表索引', sourceIds: data.sources.map((source) => source.id) }],
    },
    items: questions.map((question, index) => ({
      index,
      goalIds: ['g1'],
      withinScope: true,
      conditionsComplete: true,
      skillFocused: true,
      distinct: true,
      adapted: true,
      practice: question.programming?.mode ?? 'understanding',
      revision: '',
    })),
  }
}

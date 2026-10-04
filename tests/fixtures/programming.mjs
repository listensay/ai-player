export const programmingExercise = {
  version: 1,
  language: 'javascript',
  mode: 'completion',
  functionName: 'sumPositive',
  signature: '`sumPositive(numbers: number[]): number`，返回数组中所有正数的总和；空数组返回 0。',
  starterCode:
    'function sumPositive(numbers) {\n  const positive = numbers.filter(n => n > 0);\n  // TODO: 计算正数总和，空数组返回 0\n}',
  referenceCode:
    'function sumPositive(numbers) {\n  return numbers.filter(n => n > 0).reduce((sum, n) => sum + n, 0);\n}',
  hints: ['先筛选正数，再累加。', '为累加设置初始值。'],
  tests: [
    { id: 'mixed', name: '正负数混合', kind: 'normal', example: true, args: [[1, -2, 3, 0]], expected: 4 },
    { id: 'empty', name: '空数组', kind: 'boundary', example: true, args: [[]], expected: 0 },
    { id: 'negative', name: '全部为负数', kind: 'boundary', example: false, args: [[-1, -5]], expected: 0 },
  ],
}
export const programmingQuestion = {
  kind: 'code',
  prompt:
    '实现 **正数求和** 功能。\n\n1. 筛选数组中大于零的数字。\n2. 返回这些数字的总和。\n3. 空数组或没有正数时返回 `0`。',
  concepts: ['数组筛选', '数组累加'],
  criteria: ['正确筛选并累加正数', '处理空数组和没有正数的情况'],
  criterionPoints: [70, 30],
  referenceAnswer: '使用 `filter` 筛选正数，再用 `reduce` 累加，初始值设为 `0`。',
  sourceIds: ['s1'],
  knowledge: { category: 'procedure', level: 'proficiency', reason: '组合数组筛选与累加完成数据处理。' },
  programming: programmingExercise,
}

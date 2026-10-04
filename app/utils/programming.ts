import type {
  JsonValue,
  PracticeQuestion,
  ProgrammingExercise,
  ProgrammingRun,
  ProgrammingCaseResult,
} from '../types/practice'
import { isRecord } from './guide.ts'

export const CODE_LIMIT = 32000
export const CODE_OUTPUT_LIMIT = 8000
export const PROGRAMMING_MODES = { completion: '代码补全', implementation: '功能实现' }
export type ProgrammingPreference = 'auto' | 'completion' | 'implementation'
export function programmingQuestion(question: PracticeQuestion | undefined) {
  return question?.kind === 'code' ? question.programming : undefined
}
function text(raw: unknown, max: number, label: string) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max)
    throw new Error(`编程题的${label}缺失或过长，请重新生成。`)
  return raw
}
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 1000 && value.every((v) => isJsonValue(v, depth + 1))
  return (
    isRecord(value) && Object.keys(value).length <= 1000 && Object.values(value).every((v) => isJsonValue(v, depth + 1))
  )
}
/** 新出题至少 3 个用例；恢复旧记录或运行历史题目时传 minTests=2 放宽。 */
export function validateProgrammingExercise(raw: unknown, minTests = 3): ProgrammingExercise {
  if (
    !isRecord(raw) ||
    raw.version !== 1 ||
    raw.language !== 'javascript' ||
    !['completion', 'implementation'].includes(String(raw.mode))
  )
    throw new Error('编程题需使用 JavaScript，并指定代码补全或功能实现。')
  const functionName = text(raw.functionName, 80, '函数名')
  if (
    !/^[A-Za-z_$][\w$]*$/.test(functionName) ||
    ['eval', 'arguments', 'constructor', '__proto__'].includes(functionName)
  )
    throw new Error('编程题函数名无效，请重新生成。')
  const starterCode = text(raw.starterCode, CODE_LIMIT, '初始代码')
  const referenceCode = text(raw.referenceCode, CODE_LIMIT, '参考实现')
  if (starterCode.trim() === referenceCode.trim()) throw new Error('初始代码已包含参考实现，请重新生成。')
  if (raw.mode === 'completion' && !/\bTODO\b/.test(starterCode))
    throw new Error('代码补全题需要用 TODO 标出待完成部分。')
  if (!Array.isArray(raw.hints) || raw.hints.length > 4) throw new Error('编程题提示格式无效。')
  if (!Array.isArray(raw.tests) || raw.tests.length < minTests || raw.tests.length > 12)
    throw new Error(`编程题需要 ${minTests}–12 个测试用例。`)
  const tests = raw.tests.map((test) => {
    if (
      !isRecord(test) ||
      !Array.isArray(test.args) ||
      test.args.length > 12 ||
      !isJsonValue(test.args) ||
      !isJsonValue(test.expected) ||
      typeof test.example !== 'boolean' ||
      !['normal', 'boundary'].includes(String(test.kind)) ||
      JSON.stringify([test.args, test.expected]).length > 6000
    )
      throw new Error('测试用例需提供有效的参数、预期结果与类型。')
    return {
      id: text(test.id, 60, '用例编号'),
      name: text(test.name, 160, '用例名称'),
      kind: test.kind as 'normal' | 'boundary',
      example: test.example,
      args: test.args,
      expected: test.expected,
    }
  })
  if (
    new Set(tests.map((t) => t.id)).size !== tests.length ||
    new Set(tests.map((t) => JSON.stringify(t.args))).size !== tests.length
  )
    throw new Error('测试用例编号或输入重复，请重新生成。')
  if (
    !tests.some((t) => t.example) ||
    !tests.some((t) => t.kind === 'normal') ||
    !tests.some((t) => t.kind === 'boundary')
  )
    throw new Error('编程题需同时包含公开示例、正常情况和边界情况。')
  return {
    version: 1,
    language: 'javascript',
    mode: raw.mode as ProgrammingExercise['mode'],
    functionName,
    signature: text(raw.signature, 1500, '接口约定'),
    starterCode,
    referenceCode,
    hints: raw.hints.map((h) => text(h, 1000, '提示')),
    tests,
  }
}
export function equalJson(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equalJson(v, b[i]!))
  const left = a as Record<string, JsonValue>,
    right = b as Record<string, JsonValue>
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && equalJson(left[key]!, right[key]!))
  )
}
/** Persisted results are bound to known cases; edited drafts may retain visibly stale results. */
export function restoreProgrammingRun(
  raw: unknown,
  exercise: ProgrammingExercise,
  submittedCode?: string,
): ProgrammingRun {
  if (
    !isRecord(raw) ||
    raw.version !== 1 ||
    typeof raw.code !== 'string' ||
    raw.code.length > CODE_LIMIT ||
    (submittedCode !== undefined && raw.code !== submittedCode) ||
    !['run', 'test'].includes(String(raw.mode)) ||
    typeof raw.at !== 'number' ||
    !Number.isFinite(raw.at) ||
    !Array.isArray(raw.cases)
  )
    throw new Error('编程测试记录无效。')
  if (raw.cases.length !== (raw.mode === 'run' ? 1 : exercise.tests.length)) throw new Error('编程测试记录不完整。')
  const ids = new Set<string>()
  const cases = raw.cases.map((item): ProgrammingCaseResult => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      ids.has(item.id) ||
      !exercise.tests.some((t) => t.id === item.id) ||
      !['passed', 'failed', 'error', 'timeout'].includes(String(item.status)) ||
      typeof item.durationMs !== 'number' ||
      !Number.isFinite(item.durationMs) ||
      item.durationMs < 0 ||
      ['actual', 'output', 'error'].some(
        (key) => typeof item[key] !== 'string' || (item[key] as string).length > CODE_OUTPUT_LIMIT,
      ) ||
      ['line', 'column'].some(
        (key) => item[key] !== undefined && (!Number.isInteger(item[key]) || (item[key] as number) < 1),
      )
    )
      throw new Error('编程测试结果无效。')
    ids.add(item.id)
    return {
      id: item.id,
      status: item.status as ProgrammingCaseResult['status'],
      actual: item.actual as string,
      output: item.output as string,
      error: item.error as string,
      durationMs: item.durationMs,
      ...(item.line !== undefined ? { line: item.line as number } : {}),
      ...(item.column !== undefined ? { column: item.column as number } : {}),
    }
  })
  return { version: 1, code: raw.code, mode: raw.mode as ProgrammingRun['mode'], at: raw.at, cases }
}

export const PROGRAMMING_PROMPT = `JavaScript 函数级代码题使用 kind:"code" 并必须提供 programming 对象；其他语言、DOM、网络、异步、多文件或依赖安装的练习使用 task，不要强行改写课程语言。
programming 格式：{"version":1,"language":"javascript","mode":"completion或implementation","functionName":"solve","signature":"solve(items: number[]): number；描述参数、返回值和边界约束","starterCode":"function solve(items) {\n  // TODO: 补全逻辑\n}","referenceCode":"完整可运行的同步 JavaScript 参考实现","hints":["思路提示，不泄漏完整答案"],"tests":[{"id":"normal","name":"常规输入","kind":"normal","example":true,"args":[[1,2]],"expected":3},{"id":"empty","name":"空数组","kind":"boundary","example":false,"args":[[]],"expected":0}]}。
mode=completion 提供已有业务逻辑和明确 TODO 待补全部分；mode=implementation 提供函数骨架，由用户完整实现。初始代码不得直接通过全部测试。函数名与接口、题干、初始代码、参考实现一致，不使用 export、import、require、console 作为返回值。输入是位置参数数组 args，输出是 JSON 值，函数同步返回，不使用 Promise、定时器、浏览器或 Node API。代码最多 32000 字，接口最多 1500 字，提示 0–4 项每项最多 1000 字。
提供 3–12 个输入互不重复的测试用例，同时覆盖正常情况和边界情况；边界用例要按题目适用的输入类型尽量多样，例如空数组或空字符串、负数、零、正负数混合、极值、重复值等。至少一个 example=true。全部用例在用户运行测试时自动执行，输入只在测试结果中展示，不要把具体用例的输入或预期值写进题干、接口和提示。每个用例 args 与 expected 合计最多 6000 字；id 最多 60 字、name 最多 160 字。对象按键值比较、数组按顺序比较。运行程序会独立执行参考实现校验，失败的题不会展示；不要声称已运行。参考代码和参考答案默认隐藏。criteria 包括核心功能和边界要求，给出与其一一对应、合计100的 criterionPoints。`

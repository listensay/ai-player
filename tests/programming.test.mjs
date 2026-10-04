import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'
import { executeProgramming } from '../app/utils/programmingRuntime.ts'
import {
  validateProgrammingExercise,
  restoreProgrammingRun,
  equalJson,
  PROGRAMMING_PROMPT,
} from '../app/utils/programming.ts'
import { verifyProgrammingExercise, runProgramming } from '../app/utils/programmingRunner.ts'
import { programmingExercise as exercise } from './fixtures/programming.mjs'

const quickjs = await newQuickJSWASMModuleFromVariant(variant)
const run = (code, changes = {}) => executeProgramming(quickjs, { exercise, code, mode: 'test', ...changes })
const runner = async (input, signal) => {
  signal.throwIfAborted()
  return executeProgramming(quickjs, input)
}

test('补全与实现题校验语言、接口、TODO、测试覆盖和重复用例', () => {
  assert.deepEqual(validateProgrammingExercise(exercise), exercise)
  assert.equal(validateProgrammingExercise({ ...exercise, mode: 'implementation' }).mode, 'implementation')
  for (const patch of [
    { language: 'python' },
    { functionName: 'sumPositive();' },
    { mode: 'unknown' },
    { starterCode: exercise.referenceCode },
    { starterCode: 'function sumPositive() {}' },
    { tests: [exercise.tests[0]] },
    { tests: exercise.tests.slice(0, 2) },
    { tests: [exercise.tests[0], exercise.tests[0]] },
    { tests: exercise.tests.map((t) => ({ ...t, example: false })) },
    { tests: exercise.tests.map((t) => ({ ...t, kind: 'normal' })) },
    { tests: exercise.tests.map((t) => ({ ...t, expected: NaN })) },
    { tests: exercise.tests.map((t) => ({ ...t, args: [undefined] })) },
  ])
    assert.throws(() => validateProgrammingExercise({ ...exercise, ...patch }))
  assert.equal(validateProgrammingExercise({ ...exercise, tests: exercise.tests.slice(0, 2) }, 2).tests.length, 2)
})

test('出题要求多样输入类型，并声明测试输入只在结果中展示', () => {
  assert.match(PROGRAMMING_PROMPT, /3–12 个输入互不重复的测试用例/)
  assert.match(PROGRAMMING_PROMPT, /正负数混合/)
  assert.match(PROGRAMMING_PROMPT, /全部用例在用户运行测试时自动执行/)
  assert.match(PROGRAMMING_PROMPT, /不要把具体用例的输入或预期值写进题干/)
})

test('实际执行全部测试与选中示例，显示真实输出且各用例互相隔离', () => {
  const result = run(exercise.referenceCode.replace('return numbers', 'console.log("input", numbers); return numbers'))
  assert.deepEqual(
    result.cases.map((c) => c.status),
    ['passed', 'passed', 'passed'],
  )
  assert.match(result.cases[0].output, /input \[1,-2,3,0\]/)
  const single = run(exercise.referenceCode, { mode: 'run', caseId: 'empty' })
  assert.deepEqual(
    single.cases.map((c) => c.id),
    ['empty'],
  )
  assert.equal(single.code, exercise.referenceCode)
  assert.equal(run('let count=0; function sumPositive() { return ++count; }').cases[1].actual, '1')
})

test('真实对比结果，键顺序无关，数组顺序和类型参与比较', () => {
  assert.equal(equalJson({ a: [1, 2], b: true }, { b: true, a: [1, 2] }), true)
  assert.equal(equalJson([1, 2], [2, 1]), false)
  assert.equal(equalJson(1, '1'), false)
  assert.equal(run('function sumPositive() { return 42; }').cases[0].status, 'failed')
  assert.equal(run('function sumPositive() {}').cases[1].actual, 'undefined')
})

test('语法错误和运行错误带位置，不把异常当作通过', () => {
  const syntax = run('function sumPositive( {')
  assert.ok(syntax.cases.every((c) => c.status === 'error'))
  assert.match(syntax.cases[0].error, /SyntaxError|expected/)
  const runtime = run('function sumPositive(numbers) {\n  throw new Error("bad input");\n}')
  assert.match(runtime.cases[0].error, /bad input/)
  assert.equal(runtime.cases[0].line, 2)
})

test('隔离执行不暴露网络、文件、主窗口、模块加载或进程', () => {
  const check = { ...exercise, tests: [{ ...exercise.tests[0], args: [], expected: Array(9).fill('undefined') }] }
  const result = run(
    'function sumPositive() { return [typeof fetch,typeof XMLHttpRequest,typeof require,typeof process,typeof window,typeof document,typeof __TAURI_INTERNALS__,typeof Worker,typeof importScripts]; }',
    { exercise: check },
  )
  assert.equal(result.cases[0].status, 'passed')
  assert.equal(run('import fs from "node:fs"; function sumPositive() { return 4; }').cases[0].status, 'error')
})

test('死循环和递归受限，控制台输出有上限，之后仍可正常运行', () => {
  const single = { mode: 'run', caseId: 'empty' }
  assert.equal(run('function sumPositive() { while(true) {} }', single).cases[0].status, 'timeout')
  assert.equal(run('function sumPositive() { return sumPositive(); }', single).cases[0].status, 'error')
  const flood = run(
    'function sumPositive() { for(let i=0;i<3000;i++) console.log("x".repeat(100)); return 0; }',
    single,
  )
  assert.ok(flood.cases[0].output.length <= 8000)
  assert.equal(flood.cases[0].status, 'passed')
  assert.equal(run(exercise.referenceCode).cases[0].status, 'passed')
})

test('无法通过修改 JSON 或控制台伪造测试结果，非 JSON 和异步结果报错', () => {
  assert.equal(
    run('JSON.stringify = () => "4"; function sumPositive() { console.log("passed"); return 0; }').cases[0].status,
    'failed',
  )
  for (const value of ['NaN', 'Infinity', 'Promise.resolve(4)', 'new Map()', '{a:undefined}', '1n']) {
    assert.equal(run(`function sumPositive() { return ${value}; }`, { mode: 'run' }).cases[0].status, 'error', value)
  }
})

test('参考实现需通过，起始代码需留有待完成内容，错误题不会展示', async () => {
  await verifyProgrammingExercise(exercise, new AbortController().signal, runner)
  await assert.rejects(
    verifyProgrammingExercise(
      { ...exercise, referenceCode: 'function sumPositive(){return 0}' },
      new AbortController().signal,
      runner,
    ),
    /参考实现未通过/,
  )
  await assert.rejects(
    verifyProgrammingExercise(
      { ...exercise, starterCode: exercise.referenceCode },
      new AbortController().signal,
      runner,
    ),
    /初始代码已通过/,
  )
  const controller = new AbortController()
  controller.abort()
  assert.throws(() => runProgramming({ exercise, code: '', mode: 'test' }, controller.signal), { name: 'AbortError' })
})

test('恢复运行结果严格绑定题目与提交代码，允许保留过期草稿结果', () => {
  const result = run(exercise.referenceCode)
  assert.deepEqual(restoreProgrammingRun(result, exercise, exercise.referenceCode), result)
  assert.throws(() => restoreProgrammingRun(result, exercise, 'changed'))
  assert.throws(() => restoreProgrammingRun({ ...result, cases: result.cases.slice(1) }, exercise))
  assert.throws(() =>
    restoreProgrammingRun({ ...result, cases: result.cases.map((c) => ({ ...c, id: 'foreign' })) }, exercise),
  )
  assert.throws(() =>
    restoreProgrammingRun(
      { ...result, cases: result.cases.map((c) => ({ ...c, output: 'x'.repeat(8001) })) },
      exercise,
    ),
  )
})

test('JSON 参数保留普通对象方法，特殊键不改变原型', () => {
  const input = JSON.parse('{"x":1,"__proto__":{"injected":true}}')
  const check = { ...exercise, tests: [{ ...exercise.tests[0], args: [input], expected: [true, true, true, false] }] }
  const result = run(
    'function sumPositive(value) { return [value.hasOwnProperty("x"), Object.getPrototypeOf(value) === Object.prototype, value.hasOwnProperty("__proto__"), "injected" in value]; }',
    { exercise: check },
  )
  assert.equal(result.cases[0].status, 'passed')
})

test('返回值快照不受原型序列化钩子影响，getter 只读取一次', () => {
  const result = run('Object.prototype.toJSON = function() { return 4 }; function sumPositive() { return { x: 1 }; }', {
    mode: 'run',
  })
  assert.equal(result.cases[0].status, 'failed')
  assert.equal(result.cases[0].actual, '{"x":1}')
  const check = { ...exercise, tests: [{ ...exercise.tests[0], args: [], expected: [1, 2] }] }
  assert.equal(
    run('Array.prototype.toJSON = function() { return [3] }; function sumPositive() { return [1, 2]; }', {
      exercise: check,
    }).cases[0].status,
    'passed',
  )
  check.tests[0].expected = { x: 1 }
  assert.equal(
    run('function sumPositive() { let calls = 0; return { get x() { return ++calls; } }; }', { exercise: check })
      .cases[0].status,
    'passed',
  )
  const error = run(
    'Object.prototype.toJSON = function() { return 4 }; function sumPositive() { throw new Error("still visible"); }',
    { mode: 'run' },
  )
  assert.match(error.cases[0].error, /still visible/)
  assert.equal(run('function sumPositive() { return new Array(2); }', { mode: 'run' }).cases[0].status, 'error')
})

test('Worker 派发失败或取消后立即释放，后续运行仍可完成', async (t) => {
  const original = globalThis.Worker
  t.after(() => {
    globalThis.Worker = original
  })
  const workers = []
  let fail = true
  globalThis.Worker = class {
    constructor() {
      this.terminated = 0
      workers.push(this)
    }
    postMessage() {
      if (fail) throw new Error('dispatch failed')
    }
    terminate() {
      this.terminated++
    }
  }
  const input = { exercise, code: exercise.referenceCode, mode: 'test' }
  const failed = new AbortController()
  await assert.rejects(runProgramming(input, failed.signal), /dispatch failed/)
  assert.equal(workers[0].terminated, 1)
  failed.abort()
  assert.equal(workers[0].terminated, 1)
  fail = false
  const controller = new AbortController()
  const cancelled = runProgramming(input, controller.signal)
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  assert.equal(workers[1].terminated, 1)
  const succeeded = runProgramming(input, new AbortController().signal)
  workers[2].onmessage({ data: { result: run(exercise.referenceCode) } })
  assert.ok((await succeeded).cases.every((item) => item.status === 'passed'))
  assert.equal(workers[2].terminated, 1)
})

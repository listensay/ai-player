import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { programmingExercise } from './fixtures/programming.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@tauri-apps/api/core')
      return {
        url: 'data:text/javascript,export const invoke=(...args)=>globalThis.environmentIO(...args)',
        shortCircuit: true,
      }
    return nextResolve(specifier, context)
  },
})
const {
  loadProgrammingEnvironments,
  programmingEnvironments: state,
  availableProgrammingLanguages,
  setProgrammingDirectories,
} = await import('../app/utils/programmingEnvironments.ts')
const { runProgramming } = await import('../app/utils/programmingRunner.ts')
const detected = {
  environments: [
    {
      id: 'python:/tools/python3',
      name: 'Python',
      version: 'Python 3.12.0',
      executable: '/tools/python3',
      directory: '/tools',
      languages: ['python'],
    },
  ],
  searchDirectories: ['/tools'],
  workingDirectory: '/cache/programming',
}
function setup(t, invoke) {
  const previous = globalThis.window
  globalThis.window = { __TAURI_INTERNALS__: {} }
  globalThis.environmentIO = invoke
  t.after(() => {
    globalThis.window = previous
  })
}
test('检测只开放已安装语言，刷新可移除已卸载的环境', async (t) => {
  let environments = detected
  let calls = 0
  setup(t, async (command) => {
    if (command === 'database_request') return null
    assert.equal(command, 'programming_environments')
    calls++
    return environments
  })
  await loadProgrammingEnvironments(true)
  assert.deepEqual(await availableProgrammingLanguages(), ['python'])
  assert.equal(calls, 1)
  environments = { ...detected, environments: [] }
  await loadProgrammingEnvironments(true)
  assert.deepEqual(await availableProgrammingLanguages(), [])
})
test('环境目录持久化后重新检测，检测失败可重试', async (t) => {
  let saved = null
  let fail = false
  setup(t, async (command, args) => {
    if (command === 'database_request') {
      if (args.method === 'POST') saved = args.body.value
      return saved
    }
    assert.deepEqual(args.extraDirectories, saved ?? [])
    if (fail) throw new Error('检测失败')
    return detected
  })
  await setProgrammingDirectories(['/env with spaces/bin'])
  assert.deepEqual(state.extraDirectories, ['/env with spaces/bin'])
  fail = true
  await assert.rejects(loadProgrammingEnvironments(true), /检测失败/)
  assert.equal(state.inventory, null)
  fail = false
  await loadProgrammingEnvironments(true)
  assert.equal(state.error, '')
})
test('本地执行根据语言选择检测到的程序，结果绑定当前代码', async (t) => {
  const exercise = { ...programmingExercise, language: 'python', functionName: 'solve' }
  const code = 'def solve(numbers): return sum(n for n in numbers if n > 0)'
  setup(t, async (command, args) => {
    if (command === 'database_request') return null
    if (command === 'programming_environments') return detected
    assert.equal(command, 'run_programming')
    assert.equal(args.environmentId, detected.environments[0].id)
    assert.equal(args.input.language, 'python')
    assert.equal(args.input.code, code)
    return {
      version: 1,
      code,
      mode: 'test',
      at: Date.now(),
      cases: exercise.tests.map((item) => ({
        id: item.id,
        status: 'passed',
        actual: JSON.stringify(item.expected),
        output: '',
        error: '',
        durationMs: 5,
      })),
    }
  })
  await loadProgrammingEnvironments(true)
  const result = await runProgramming({ exercise, code, mode: 'test' }, new AbortController().signal)
  assert.ok(result.cases.every((item) => item.status === 'passed'))
  await assert.rejects(
    runProgramming({ exercise: { ...exercise, language: 'java' }, code, mode: 'test' }, new AbortController().signal),
    /未检测到 Java/,
  )
})
test('取消本地执行通知原生进程，迟到响应不会产生运行结果', async (t) => {
  const commands = []
  let finish
  setup(t, async (command, args) => {
    commands.push([command, args])
    if (command === 'database_request') return null
    if (command === 'programming_environments') return detected
    if (command === 'run_programming')
      return new Promise((resolve) => {
        finish = resolve
      })
    assert.equal(command, 'cancel_programming')
  })
  await loadProgrammingEnvironments(true)
  const controller = new AbortController()
  const result = runProgramming(
    { exercise: { ...programmingExercise, language: 'python' }, code: 'def solve(n): return n', mode: 'test' },
    controller.signal,
  )
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' })
  await new Promise((resolve) => setImmediate(resolve))
  const run = commands.find(([name]) => name === 'run_programming')
  const cancel = commands.find(([name]) => name === 'cancel_programming')
  assert.equal(cancel[1].runId, run[1].runId)
  finish({})
})

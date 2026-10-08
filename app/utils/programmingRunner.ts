import type { ProgrammingRun } from '../types/practice'
import type { ProgrammingExecution } from './programmingRuntime'
import { restoreProgrammingRun, validateProgrammingExercise } from './programming.ts'
import { isRecord } from './guide.ts'
import { desktopInvoke, isDesktop } from './platform.ts'
import { loadProgrammingEnvironments } from './programmingEnvironments.ts'
import { programmingLanguageName } from './programmingLanguages.ts'

export function runProgramming(input: ProgrammingExecution, signal: AbortSignal): Promise<ProgrammingRun> {
  signal.throwIfAborted()
  // 运行器可能执行恢复出的旧题（历史上最少 2 个用例），结构下限取 2；新出题下限由校验层保证。
  const exercise = validateProgrammingExercise(input.exercise, 2)
  if (isDesktop()) return runLocalProgramming({ ...input, exercise }, signal)
  return runProgrammingSandbox({ ...input, exercise }, signal)
}

/** Explicit scratch execution always stays in QuickJS, including on desktop. */
export function runProgrammingSandbox(input: ProgrammingExecution, signal: AbortSignal): Promise<ProgrammingRun> {
  signal.throwIfAborted()
  const exercise = validateProgrammingExercise(input.exercise, 2)
  if (exercise.language !== 'javascript') throw new Error('请在桌面应用中使用本机编程环境。')
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./programming.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      finish()
      reject(new DOMException('已取消代码执行。', 'AbortError'))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('代码运行超时，请重试。'))
    }, 20000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      finish()
      reject(new Error('代码运行环境加载失败，请重试。'))
    }
    worker.onmessage = (event: MessageEvent<unknown>) => {
      finish()
      try {
        if (!isRecord(event.data)) throw new Error('代码运行结果无效。')
        if (typeof event.data.error === 'string') throw new Error(event.data.error)
        resolve(restoreProgrammingRun(event.data.result, exercise, input.code))
      } catch (error) {
        reject(error)
      }
    }
    try {
      worker.postMessage(JSON.parse(JSON.stringify({ ...input, exercise })))
    } catch (error) {
      finish()
      reject(error)
    }
  })
}

async function runLocalProgramming(input: ProgrammingExecution, signal: AbortSignal): Promise<ProgrammingRun> {
  const inventory = await loadProgrammingEnvironments()
  signal.throwIfAborted()
  const environment = inventory.environments.find((item) => item.languages.includes(input.exercise.language))
  if (!environment)
    throw new Error(
      `未检测到 ${programmingLanguageName(input.exercise.language)} 运行环境，请在设置的「编程环境」中安装后重新检测或添加目录。`,
    )
  const runId = crypto.randomUUID()
  const tests =
    input.mode === 'test'
      ? input.exercise.tests
      : [
          input.exercise.tests.find((test) => test.id === input.caseId) ??
            input.exercise.tests.find((test) => test.example)!,
        ]
  return new Promise((resolve, reject) => {
    const abort = () => {
      void desktopInvoke('cancel_programming', { runId }).catch(() => {})
      reject(new DOMException('已取消代码执行。', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    void desktopInvoke('run_programming', {
      runId,
      environmentId: environment.id,
      input: {
        code: input.code,
        language: input.exercise.language,
        functionName: input.exercise.functionName,
        mode: input.mode,
        tests,
      },
    })
      .then((raw) => {
        signal.throwIfAborted()
        resolve(restoreProgrammingRun(raw, input.exercise, input.code))
      })
      .catch(reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function verifyProgrammingExercise(
  exercise: ProgrammingExecution['exercise'],
  signal: AbortSignal,
  runner = runProgramming,
) {
  const reference = await runner({ exercise, code: exercise.referenceCode, mode: 'test' }, signal)
  signal.throwIfAborted()
  const failed = reference.cases.find((c) => c.status !== 'passed')
  if (failed)
    throw new Error(`参考实现未通过「${exercise.tests.find((t) => t.id === failed.id)?.name}」测试，请重新生成。`)
  const starter = await runner({ exercise, code: exercise.starterCode, mode: 'test' }, signal)
  signal.throwIfAborted()
  if (starter.cases.every((c) => c.status === 'passed'))
    throw new Error('初始代码已通过全部测试，请重新生成有待完成内容的题目。')
}

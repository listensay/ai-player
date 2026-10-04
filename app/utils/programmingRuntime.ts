import type { QuickJSWASMModule, QuickJSHandle, QuickJSContext } from 'quickjs-emscripten-core'
import type { JsonValue, ProgrammingExercise, ProgrammingRun, ProgrammingCaseResult } from '../types/practice'
import { CODE_LIMIT, CODE_OUTPUT_LIMIT, equalJson, isJsonValue } from './programming.ts'

export interface ProgrammingExecution {
  code: string
  exercise: ProgrammingExercise
  mode: 'run' | 'test'
  caseId?: string
}

// The guest receives only JS intrinsics, copied JSON arguments and bounded console output.
// It has no host eval, module loader, file, network, DOM, worker or Tauri bindings.
function argument(vm: QuickJSContext, value: JsonValue): QuickJSHandle {
  // Parse before guest code runs: preserve ordinary JSON object prototypes, while
  // treating keys such as __proto__ as data rather than prototype setters.
  return vm.unwrapResult(vm.evalCode(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, 'input.js'))
}

export function executeProgramming(quickjs: QuickJSWASMModule, input: ProgrammingExecution): ProgrammingRun {
  if (input.code.length > CODE_LIMIT) throw new Error('代码超过 32000 字。')
  const tests =
    input.mode === 'run'
      ? [input.exercise.tests.find((t) => t.id === input.caseId) ?? input.exercise.tests.find((t) => t.example)!]
      : input.exercise.tests
  const totalDeadline = Date.now() + 5000
  let remainingOutput = CODE_OUTPUT_LIMIT
  const cases = tests.map((test): ProgrammingCaseResult => {
    const start = Date.now()
    const result: ProgrammingCaseResult = {
      id: test.id,
      status: 'error',
      actual: '',
      output: '',
      error: '',
      durationMs: 0,
    }
    if (start >= totalDeadline) return { ...result, status: 'timeout', error: '本次测试已达到执行时限。' }
    const runtime = quickjs.newRuntime()
    runtime.setMemoryLimit(32 * 1024 * 1024)
    runtime.setMaxStackSize(64 * 1024)
    const deadline = Math.min(start + 1000, totalDeadline)
    runtime.setInterruptHandler(() => Date.now() >= deadline)
    const vm = runtime.newContext()
    const handles: QuickJSHandle[] = []
    const keep = (handle: QuickJSHandle) => {
      handles.push(handle)
      return handle
    }
    try {
      // Capture serialization before running untrusted source; compare outside the guest.
      const serialize = keep(
        vm.unwrapResult(
          vm.evalCode(
            `(function() {
        const stringify = JSON.stringify, keys = Object.keys, array = Array.isArray, finite = Number.isFinite;
        const prototype = Object.getPrototypeOf, objectPrototype = Object.prototype;
        const create = Object.create, setPrototype = Object.setPrototypeOf, define = Object.defineProperty;
        const Failure = Error;
        function snapshot(v, depth) {
          if (depth > 20) throw new Failure('返回结果嵌套过深。');
          if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
          if (typeof v === 'number' && finite(v)) return v;
          if (typeof v !== 'object' || (!array(v) && prototype(v) !== objectPrototype && prototype(v) !== null)) throw new Failure('请返回有效的 JSON 值。');
          const list = array(v), names = keys(v);
          if (names.length > 1000 || (list && v.length > 1000)) throw new Failure('返回结果过长。');
          const copy = list ? setPrototype([], null) : create(null);
          if (list) {
            for (let i = 0; i < v.length; i++) {
              define(copy, i, { value: snapshot(v[i], depth + 1), enumerable: true });
            }
          } else {
            for (let i = 0; i < names.length; i++) {
              const key = names[i];
              define(copy, key, { value: snapshot(v[key], depth + 1), enumerable: true });
            }
          }
          return copy;
        }
        return function(value) {
          if (value && typeof value.then === 'function') throw new Failure('请同步返回结果，不使用 Promise。');
          return value === undefined ? undefined : stringify(snapshot(value, 0));
        };
      })()`,
            'harness.js',
          ),
        ),
      )
      const errorText = keep(
        vm.unwrapResult(
          vm.evalCode(
            `(function() {
        const stringify = JSON.stringify, toString = String, create = Object.create;
        return e => {
          const detail = create(null);
          detail.message = toString(e && e.name || 'Error') + ': ' + toString(e && e.message || e);
          detail.stack = toString(e && e.stack || '');
          return stringify(detail);
        };
      })()`,
            'harness.js',
          ),
        ),
      )
      const args = test.args.map((value) => keep(argument(vm, value)))
      const consoleObject = keep(vm.newObject())
      const log = keep(
        vm.newFunction('log', (...values) => {
          if (remainingOutput <= 0) return
          const parts: string[] = []
          for (const value of values.slice(0, 20)) {
            if (vm.typeof(value) === 'string') parts.push(vm.getString(value).slice(0, 2000))
            else {
              const rendered = vm.callFunction(serialize, vm.undefined, value)
              try {
                parts.push(
                  rendered.error
                    ? '[无法显示]'
                    : vm.typeof(rendered.value) === 'undefined'
                      ? 'undefined'
                      : vm.getString(rendered.value).slice(0, 2000),
                )
              } finally {
                rendered.dispose()
              }
            }
          }
          const line = (parts.join(' ') + '\n').slice(0, remainingOutput)
          result.output += line
          remainingOutput -= line.length
        }),
      )
      for (const name of ['log', 'info', 'warn', 'error', 'debug']) vm.setProp(consoleObject, name, log)
      vm.setProp(vm.global, 'console', consoleObject)
      const check = (evaluation: ReturnType<QuickJSContext['evalCode']>) => {
        if (!evaluation.error) return keep(evaluation.value)
        if (Date.now() >= deadline) {
          evaluation.error.dispose()
          throw new Error('执行超时。')
        }
        let rendered: ReturnType<QuickJSContext['callFunction']> | undefined
        try {
          rendered = vm.callFunction(errorText, vm.undefined, evaluation.error)
          if (rendered.error) throw new Error(Date.now() >= deadline ? '执行超时。' : '执行失败或内存不足。')
          const detail = JSON.parse(vm.getString(rendered.value)) as { message: string; stack: string }
          const location = /solution\.js:(\d+)(?::(\d+))?/.exec(detail.stack)
          if (location) {
            result.line = Number(location[1])
            if (location[2]) result.column = Number(location[2])
          }
          throw new Error(`${detail.message}\n${detail.stack}`.slice(0, 4000).trim())
        } finally {
          rendered?.dispose()
          evaluation.error.dispose()
        }
      }
      check(vm.evalCode(input.code, 'solution.js', { type: 'global' }))
      const fn = check(vm.evalCode(input.exercise.functionName, 'interface.js'))
      if (vm.typeof(fn) !== 'function') throw new Error(`请实现函数 ${input.exercise.functionName}。`)
      const actual = check(vm.callFunction(fn, vm.undefined, args))
      const encoded = check(vm.callFunction(serialize, vm.undefined, actual))
      if (vm.typeof(encoded) === 'undefined') {
        result.actual = 'undefined'
        result.status = 'failed'
      } else {
        const value = vm.getString(encoded)
        if (value.length > CODE_OUTPUT_LIMIT) throw new Error('返回结果过长。')
        const parsed: unknown = JSON.parse(value)
        if (!isJsonValue(parsed)) throw new Error('请返回有效的 JSON 值。')
        result.actual = value
        result.status = equalJson(parsed, test.expected) ? 'passed' : 'failed'
      }
    } catch (error) {
      result.status = Date.now() >= deadline ? 'timeout' : 'error'
      result.error =
        result.status === 'timeout'
          ? '执行超过时限，请检查循环或递归。'
          : (error instanceof Error ? error.message : '代码执行失败。').slice(0, 4000)
    } finally {
      runtime.removeInterruptHandler()
      for (const handle of handles.reverse()) handle.dispose()
      vm.dispose()
      runtime.dispose()
      result.durationMs = Date.now() - start
    }
    return result
  })
  return { version: 1, code: input.code, mode: input.mode, at: Date.now(), cases }
}

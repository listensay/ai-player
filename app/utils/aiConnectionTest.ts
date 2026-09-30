import type { GuideSettings } from '../types/guide'
import { planPrompt, requestGuideJson } from './guideAi.ts'
import { validateLearningPlan } from './guide.ts'

const SAMPLE_CATALOG = [
  { path: 'demo/01.mp4', title: '变量与数据类型', duration: 600, done: false },
  { path: 'demo/02.mp4', title: '条件判断', duration: 900, done: false },
]

/** 使用虚拟课程走完导学的提示词、模型请求与路线校验，不读写用户课程。 */
export async function testAiConnection(settings: GuideSettings, signal: AbortSignal) {
  const start = performance.now()
  const result = await requestGuideJson(
    { ...settings },
    planPrompt(SAMPLE_CATALOG, '零基础，每日学习 30 分钟，请安排这两节样例课程。', 30, null),
    signal,
  )
  signal.throwIfAborted()
  try {
    validateLearningPlan(
      result,
      SAMPLE_CATALOG.map((lesson) => lesson.path),
    )
  } catch (error) {
    throw new Error(`服务已响应，但导学结果未通过校验：${(error as Error).message}`, { cause: error })
  }
  return { milliseconds: Math.round(performance.now() - start), lessonCount: SAMPLE_CATALOG.length }
}

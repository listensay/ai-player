import type { GuideSettings, SubtitleCue } from '../types/guide'
import type { PracticeRecord } from '../types/practice'
import { dbFetchPractice, dbSavePractice } from '~/utils/dbClient'
import { requestGuideJson } from '~/utils/guideAi'
import { materialBatches, transcriptSources } from '~/utils/knowledge'
import { enoughPracticeMaterial, PRACTICE_HISTORY_LIMIT } from '~/utils/practice'
import { generatePracticeBatch, validateGeneratedPractice } from '~/utils/practiceGeneration'
import { practiceLearningContext } from '~/utils/practiceLearning'
import { programmingQuestion } from '~/utils/programming'
import { availableProgrammingLanguages } from '~/utils/programmingEnvironments'
import { verifyProgrammingExercise } from '~/utils/programmingRunner'

const revisions = new Map<string, number>()
export function automaticPracticeRevision(courseId: string, path: string) {
  return revisions.get(JSON.stringify([courseId, path])) ?? 0
}
const jobs = new Map<string, Promise<void>>()
export function waitForAutomaticPractice(courseId: string, path: string) {
  return jobs.get(JSON.stringify([courseId, path]))
}

/** 自动触发只尝试一次相同材料；显式出题与重试仍直接走生成流程。 */
export function createAutomaticPracticePreparer(
  onError: (error: unknown, courseId: string, path: string) => void,
  generate = generateAutomaticPractice,
) {
  const attempts = new Map<string, { signature: string; task: Promise<void>; settled: boolean }>()
  return (...args: Parameters<typeof generateAutomaticPractice>) => {
    const [courseId, path, title, cues, settings] = args
    const key = JSON.stringify([courseId, path])
    const signature = JSON.stringify([title, cues, settings])
    const previous = attempts.get(key)
    if (previous?.signature === signature) return previous.task
    const submittedCues = cues.map((cue) => ({ ...cue }))
    const submittedSettings = { ...settings }
    const attempt = { signature, task: Promise.resolve(), settled: false }
    attempts.set(key, attempt)
    attempt.task = Promise.resolve()
      .then(async () => {
        await previous?.task
        if (attempts.get(key) === attempt) await generate(courseId, path, title, submittedCues, submittedSettings)
      })
      .catch((error) => {
        if (attempts.get(key) === attempt) onError(error, courseId, path)
      })
      .finally(() => {
        attempt.settled = true
        for (const [oldKey, old] of attempts) {
          if (attempts.size <= 20) break
          if (old.settled) attempts.delete(oldKey)
        }
      })
    return attempt.task
  }
}
/** A captured lesson identity keeps background work independent of player navigation. */
export function generateAutomaticPractice(
  courseId: string,
  path: string,
  title: string,
  cues: SubtitleCue[],
  settings: GuideSettings,
) {
  const key = JSON.stringify([courseId, path])
  const existing = jobs.get(key)
  if (existing) return existing
  const snapshot = { ...settings }
  const task = (async () => {
    const saved = (await dbFetchPractice(courseId))[path] ?? []
    if (saved.some((r) => r.scope === null)) return
    if (!snapshot.baseUrl || !snapshot.model) throw Error('请先配置 AI，再打开本课重试生成练习。')
    const sources = transcriptSources(cues)
    if (!enoughPracticeMaterial(sources)) throw Error('逐字稿内容不足，无法自动生成课后练习。')
    const controller = new AbortController()
    const records: PracticeRecord[] = []
    const groupId = crypto.randomUUID()
    const programmingLanguages = await availableProgrammingLanguages()
    // 与手动出题使用同一套规则和运行校验，覆盖完整逐字稿。
    const batches = materialBatches(sources)
    if (batches.length > 20) throw Error('逐字稿较长，请在课后练习中按片段生成。')
    for (const [index, batch] of batches.entries()) {
      // 按剩余批次分配题目额度，避免前半课出满后无法保存整组练习。
      const questionLimit = Math.min(
        5,
        Math.floor((PRACTICE_HISTORY_LIMIT - records.length) / (batches.length - index)),
      )
      const options = {
        title,
        sources: batch,
        scope: null,
        recent: [...records, ...saved].map((r) => r.question),
        count: 'auto' as const,
        limit: questionLimit,
        daily: false,
        preference: 'auto' as const,
        languages: programmingLanguages,
        learning: practiceLearningContext(saved),
      }
      const raw = await generatePracticeBatch({
        ...options,
        signal: controller.signal,
        request: (messages) => requestGuideJson(snapshot, messages, controller.signal),
        verify: verifyProgrammingExercise,
      })
      for (const question of validateGeneratedPractice(raw, options)) {
        const programming = programmingQuestion(question)
        records.push({
          id: crypto.randomUUID(),
          groupId,
          path,
          createdAt: Date.now(),
          scope: null,
          sources: batch,
          question,
          draft: programming?.starterCode ?? '',
          attempts: [],
        })
      }
    }
    const latest = (await dbFetchPractice(courseId))[path] ?? []
    if (latest.some((r) => r.scope === null)) return
    if (!(await dbSavePractice(courseId, path, [...records.reverse(), ...latest])))
      throw Error('课后练习保存失败，请重试。')
    revisions.set(key, (revisions.get(key) ?? 0) + 1)
  })().finally(() => jobs.delete(key))
  jobs.set(key, task)
  return task
}

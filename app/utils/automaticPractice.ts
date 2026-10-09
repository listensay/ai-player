import type { GuideSettings, SubtitleCue } from '../types/guide'
import type { PracticeRecord } from '../types/practice'
import { dbFetchPractice, dbSavePractice } from '~/utils/dbClient'
import { requestGuideJson } from '~/utils/guideAi'
import { materialBatches } from '~/utils/knowledge'
import { enoughPracticeMaterial, practicePrompt, practiceSources, validatePracticeQuestion } from '~/utils/practice'

const revisions = new Map<string, number>()
export function automaticPracticeRevision(courseId: string, path: string) {
  return revisions.get(JSON.stringify([courseId, path])) ?? 0
}
const jobs = new Map<string, Promise<void>>()
export function waitForAutomaticPractice(courseId: string, path: string) {
  return jobs.get(JSON.stringify([courseId, path]))
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
    if ((await dbFetchPractice(courseId))[path]?.some((r) => r.scope === null)) return
    if (!snapshot.baseUrl || !snapshot.model) throw Error('请先配置 AI，再打开本课重试生成练习。')
    const sources = practiceSources('', cues, '', null)
    if (!enoughPracticeMaterial(sources)) throw Error('逐字稿内容不足，无法自动生成课后练习。')
    const controller = new AbortController()
    const records: PracticeRecord[] = []
    const groupId = crypto.randomUUID()
    // Cover the lesson in bounded batches; conceptual questions need no local runtime.
    const batches = materialBatches(sources)
    if (batches.length > 20) throw Error('逐字稿较长，请在课后练习中按片段生成。')
    for (const batch of batches) {
      const raw = await requestGuideJson(
        snapshot,
        practicePrompt(
          title,
          batch,
          null,
          records.map((r) => r.question),
          1,
          false,
          'auto',
          [],
        ),
        controller.signal,
      )
      const question = validatePracticeQuestion(raw, batch, true, true)
      if (question.kind === 'code') throw Error('自动练习需要概念题，请打开课后练习重新生成。')
      records.push({
        id: crypto.randomUUID(),
        groupId,
        path,
        createdAt: Date.now(),
        scope: null,
        sources: batch,
        question,
        draft: '',
        attempts: [],
      })
    }
    const latest = (await dbFetchPractice(courseId))[path] ?? []
    if (latest.some((r) => r.scope === null)) return
    if (!(await dbSavePractice(courseId, path, [...records, ...latest]))) throw Error('课后练习保存失败，请重试。')
    revisions.set(key, (revisions.get(key) ?? 0) + 1)
  })().finally(() => jobs.delete(key))
  jobs.set(key, task)
  return task
}

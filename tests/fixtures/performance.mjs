import { emptyStudyRecords } from '../../app/utils/studyProgram.ts'

/** Deterministic, synthetic learning data; never reads the user's library. */
export function performanceContext(size = 2000) {
  const lessons = Array.from({ length: size }, (_, i) => ({
    path: `lesson-${i}.mp4`,
    moduleId: `module-${Math.floor(i / 20)}`,
    status: 'required',
    reason: '性能样例',
    concepts: ['基础概念'],
    prerequisites: i % 20 ? [`lesson-${i - 1}.mp4`] : [],
  }))
  const modules = Array.from({ length: Math.ceil(size / 20) }, (_, i) => ({
    id: `module-${i}`,
    title: `阶段 ${i}`,
    description: '性能样例',
  }))
  return {
    plan: {
      version: 1,
      createdAt: 1,
      summary: '性能样例',
      profile: '基础',
      messages: [],
      dailyMinutes: 120,
      modules,
      lessons,
      program: {
        startDate: '2026-09-30',
        days: 365,
        budget: { video: 120, code: 20, project: 0, recap: 10 },
        lightEvery: 0,
        lightMinutes: 30,
      },
    },
    includeOptional: false,
    metadata: Object.fromEntries(
      lessons.map((l, i) => [l.path, { duration: 600 + (i % 10) * 60, size: 1, modified: 1 }]),
    ),
    progress: Object.fromEntries(
      lessons
        .slice(0, Math.floor(size / 2))
        .map((l) => [l.path, { time: 1200, duration: 1200, ratio: 1, done: true, updatedAt: 1 }]),
    ),
    mastery: {},
    questions: [],
    records: emptyStudyRecords(),
    today: null,
  }
}

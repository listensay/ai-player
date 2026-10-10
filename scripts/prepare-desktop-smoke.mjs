import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import ffmpeg from 'ffmpeg-static'
import { performanceContext } from '../tests/fixtures/performance.mjs'
import { programmingQuestion } from '../tests/fixtures/programming.mjs'
import { defaultPomodoroSettings, freshPomodoro } from '../app/utils/pomodoro.ts'
import { localDayKey } from '../app/utils/learningFeedback.ts'

export async function prepareDesktopSmoke(directory) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, '.ai-player-smoke'), 'isolated desktop regression\n', { flag: 'wx' })
  const videos = join(directory, 'course')
  await mkdir(videos)
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=5',
      '-t',
      '120',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      join(videos, `lesson-${i}.mp4`),
    ])
    if (result.status !== 0) throw Error(result.stderr.toString())
    await writeFile(
      join(videos, `lesson-${i}.srt`),
      '1\n00:00:00,000 --> 00:02:00,000\n数组筛选与累加，使用 filter 和 reduce。\n',
    )
  }
  const db = new DatabaseSync(join(directory, 'ai-player.db'))
  try {
    db.exec(await readFile(new URL('../src-tauri/src/schema.sql', import.meta.url), 'utf8'))
    const id = 'smoke-course',
      now = Date.now(),
      context = performanceContext(2)
    context.plan.program.startDate = localDayKey()
    context.plan.lessons.forEach((lesson, i) => {
      lesson.path = `lesson-${i}.mp4`
      lesson.prerequisites = []
    })
    context.metadata = Object.fromEntries(
      context.plan.lessons.map((l) => [l.path, { duration: 120, size: 0, modified: 0 }]),
    )
    db.prepare('INSERT INTO recent_courses VALUES (?,?,?,?,?,?,?)').run(
      id,
      '桌面回归课程',
      2,
      now,
      'lesson-0.mp4',
      now,
      now,
    )
    db.prepare('INSERT INTO course_locations VALUES (?,?)').run(id, videos)
    db.prepare('INSERT INTO learning_guides VALUES (?,?,?,?,?,?,?,?,?)').run(
      id,
      JSON.stringify(context.plan),
      JSON.stringify(context.metadata),
      'all',
      0,
      '{}',
      '[]',
      'null',
      now,
    )
    const settings = { ...defaultPomodoroSettings(), focusMinutes: 1, shortBreakMinutes: 1 }
    const setting = db.prepare('INSERT INTO app_settings VALUES (?,?,?)')
    const learning = {
      version: 1,
      cards: [],
      rewardDays: [],
      flows: [],
      contracts: [],
      works: [],
      protections: [],
      preferences: {
        flowPrompt: true,
        quietFocus: false,
        shortcut: '',
        calendarTime: '19:00',
        calendarDays: 14,
        calendarEnabled: false,
      },
    }
    setting.run('learning-management:v1', JSON.stringify(learning), now)
    setting.run('desktop-auto-open-companion', 'false', now)
    setting.run('pomodoro:v1', JSON.stringify({ version: 1, settings, timer: freshPomodoro(settings) }), now)
    db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(id, 'lesson-0.mp4', '# Native note\n\nOriginal fixture', now)
    const record = {
      id: 'smoke-code',
      groupId: 'smoke',
      path: 'lesson-0.mp4',
      createdAt: now,
      scope: null,
      sources: [{ id: 's1', kind: 'note', text: '数组筛选和累加' }],
      question: programmingQuestion,
      draft: programmingQuestion.programming.starterCode,
      attempts: [],
    }
    db.prepare('INSERT INTO lesson_practices VALUES (?,?,?,?)').run(id, 'lesson-0.mp4', JSON.stringify([record]), now)
    const python = structuredClone(record)
    python.id = 'smoke-python'
    python.path = 'lesson-1.mp4'
    python.question.programming.language = 'python'
    python.question.programming.signature = 'sumPositive(numbers: list) -> int'
    python.question.programming.starterCode = 'def sumPositive(numbers):\n    # TODO: 实现求和\n    pass'
    python.question.programming.referenceCode = 'def sumPositive(numbers):\n    return sum(n for n in numbers if n > 0)'
    python.draft = python.question.programming.starterCode
    db.prepare('INSERT INTO lesson_practices VALUES (?,?,?,?)').run(id, 'lesson-1.mp4', JSON.stringify([python]), now)
  } finally {
    db.close()
  }
}

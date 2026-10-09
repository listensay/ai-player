import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { effectScope, nextTick, ref } from 'vue'
import {
  defaultPomodoroSettings,
  finishPomodoro,
  freshPomodoro,
  restorePomodoro,
  parsePomodoroSettings,
} from '../app/utils/pomodoro.ts'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest = () => { throw Error("Unexpected native storage call") }',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { createPomodoro, watchPomodoroPlayback } = await import('../app/composables/usePomodoro.ts')
function fixture(raw = null, effects = {}) {
  let now = 1000,
    saved = raw
  const writes = []
  const sounds = []
  const timer = createPomodoro(
    {
      read: async () => saved,
      write: async (record) => {
        saved = structuredClone(record)
        writes.push(saved)
      },
    },
    () => now,
    { onPhaseEnd: (phase) => sounds.push(phase), ...effects },
  )
  return {
    timer,
    writes,
    sounds,
    advance: (ms) => {
      now += ms
      timer.tick()
    },
    read: () => saved,
    clock: () => now,
  }
}
test('默认待开始，开始、暂停和继续使用截止时间，不随视频或逐次 tick 漂移', async () => {
  const h = fixture()
  await h.timer.load()
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1500)
  assert.equal(h.timer.snapshot.value.status, 'idle')
  h.timer.start()
  h.advance(12_500)
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1488)
  h.timer.pause()
  h.advance(500_000)
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1488)
  h.timer.start()
  h.advance(1487_500)
  assert.equal(h.timer.snapshot.value.phase, 'short-break')
  assert.equal(h.timer.snapshot.value.status, 'running')
  assert.equal(h.timer.snapshot.value.completedFocuses, 1)
  assert.equal(h.timer.snapshot.value.remainingSeconds, 300)
  await h.timer.flush()
})
test('每四次专注自动进入长休息，休息结束等待手动开始下一轮', () => {
  const settings = defaultPomodoroSettings(),
    timer = freshPomodoro(settings)
  for (let round = 1; round <= 4; round++) {
    timer.status = 'running'
    timer.endsAt = 1
    assert.match(finishPomodoro(timer, settings, 1), /专注完成/)
    assert.equal(timer.completedFocuses, round)
    assert.equal(timer.phase, round === 4 ? 'long-break' : 'short-break')
    assert.equal(timer.status, 'running')
    assert.equal(timer.endsAt, 1 + timer.durationMs)
    assert.match(finishPomodoro(timer, settings, timer.endsAt), /休息结束/)
    assert.equal(timer.endsAt, null)
    assert.equal(timer.phase, 'focus')
    assert.equal(timer.status, 'idle')
  }
})
test('重新启动始终初始化为专注待开始：同日、跨日、运行中与暂停状态均不补发提醒', async () => {
  const yesterday = new Date('2026-10-01T21:00:00+08:00').getTime()
  for (const launchAt of [yesterday + 10_000, yesterday + 3_600_000, yesterday + 86_400_000]) {
    for (const phase of ['focus', 'short-break', 'long-break']) {
      for (const status of ['idle', 'paused', 'running']) {
        const stored = restorePomodoro(null)
        Object.assign(stored.settings, {
          focusMinutes: 40,
          shortBreakMinutes: 7,
          longBreakMinutes: 20,
          showOnCompanion: false,
        })
        Object.assign(stored.timer, {
          phase,
          status,
          completedFocuses: 7,
          remainingMs: 120_000,
          endsAt: status === 'running' ? yesterday + 120_000 : null,
          revision: yesterday,
        })
        const original = structuredClone(stored)
        const effects = []
        const writes = []
        const timer = createPomodoro(
          { read: async () => stored, write: async (record) => writes.push(structuredClone(record)) },
          () => launchAt,
          {
            onPhaseEnd: (phase) => effects.push(phase),
            onBreakStart: () => effects.push('pause-video'),
            onStart: () => effects.push('start'),
          },
        )
        await timer.load()
        timer.tick()
        timer.tick()
        assert.equal(timer.snapshot.value.phase, 'focus')
        assert.equal(timer.snapshot.value.status, 'idle')
        assert.equal(timer.snapshot.value.remainingSeconds, 2400)
        assert.equal(timer.snapshot.value.completedFocuses, 0)
        assert.equal(timer.snapshot.value.round, 1)
        assert.equal(timer.snapshot.value.notice, '')
        assert.equal(timer.state.timer.endsAt, null)
        assert.ok(timer.state.timer.revision > original.timer.revision)
        assert.deepEqual(timer.state.settings, original.settings)
        assert.deepEqual(effects, [])
        assert.equal(writes.length, 1)
        assert.equal(writes[0].timer.status, 'idle')
        assert.equal(writes[0].timer.phase, 'focus')
        assert.deepEqual(stored, original)
      }
    }
  }
})

test('重启保留已完成历史，旧活动会话记为放弃，不按离线截止时间计为完成', async () => {
  const h = fixture()
  await h.timer.load()
  h.timer.start()
  h.advance(1500_000)
  h.timer.startFocus()
  await h.timer.flush()
  const stored = h.read()
  const completed = structuredClone(stored.focusHistory[0])
  let saved
  const launchAt = h.clock() + 86_400_000
  const timer = createPomodoro(
    {
      read: async () => stored,
      write: async (value) => {
        saved = structuredClone(value)
      },
    },
    () => launchAt,
  )
  await timer.load()
  assert.deepEqual(saved.focusHistory[0], completed)
  assert.equal(saved.focusHistory[1].outcome, 'abandoned')
  assert.equal(saved.focusHistory[1].endedAt, launchAt)
  assert.equal(saved.timer.completedFocuses, 0)
  timer.startFocus()
  assert.equal(timer.state.focusHistory.length, 3)
  assert.equal(timer.state.focusHistory[2].startedAt, launchAt)
  assert.equal(timer.state.focusHistory[2].outcome, 'active')
  await timer.flush()
})

test('重复或并发加载不重置本次计时，保持页面切换与窗口聚焦后的专注和休息', async () => {
  const h = fixture()
  const first = h.timer.load()
  assert.equal(h.timer.load(), first)
  await first
  h.timer.start()
  h.advance(60_000)
  const running = structuredClone(h.read())
  const deadline = h.timer.state.timer.endsAt
  await h.timer.load()
  assert.equal(h.timer.state.timer.endsAt, deadline)
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1440)
  h.advance(1440_000)
  const breakDeadline = h.timer.state.timer.endsAt
  await h.timer.load()
  h.timer.tick()
  assert.equal(h.timer.state.timer.endsAt, breakDeadline)
  assert.equal(h.timer.snapshot.value.phase, 'short-break')
  assert.equal(h.timer.snapshot.value.completedFocuses, 1)
  assert.equal(running.timer.phase, 'focus')
  await h.timer.flush()
})
test('修改时长从下一段生效，禁用会暂停，重新启用可继续；重置从第一轮开始', async () => {
  const h = fixture()
  await h.timer.load()
  h.timer.start()
  h.advance(60_000)
  await h.timer.saveSettings({ ...h.timer.state.settings, focusMinutes: 30, shortBreakMinutes: 10, enabled: false })
  assert.equal(h.timer.snapshot.value.status, 'paused')
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1440)
  h.advance(60_000)
  await h.timer.saveSettings({ ...h.timer.state.settings, enabled: true })
  h.timer.start()
  h.advance(1440_000)
  assert.equal(h.timer.snapshot.value.remainingSeconds, 600)
  h.timer.reset()
  assert.equal(h.timer.snapshot.value.phase, 'focus')
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1800)
  assert.equal(h.timer.snapshot.value.completedFocuses, 0)
  await h.timer.flush()
})
test('拒绝损坏记录和无效设置，读取失败不覆盖旧数据', async () => {
  assert.throws(() => parsePomodoroSettings({ ...defaultPomodoroSettings(), focusMinutes: 0 }))
  assert.throws(() => parsePomodoroSettings({ ...defaultPomodoroSettings(), longBreakEvery: 1 }))
  const record = restorePomodoro(null)
  assert.throws(() => restorePomodoro({ ...record, timer: { ...record.timer, status: 'running', endsAt: null } }))
  const h = fixture({ version: 999 })
  await h.timer.load()
  h.timer.start()
  h.timer.reset()
  await h.timer.flush()
  assert.equal(h.timer.state.ready, false)
  assert.equal(h.writes.length, 0)
})
test('计时期间不逐秒写盘，保存失败可重试，后来的暂停状态不会丢失', async () => {
  let fail = true,
    saved,
    writes = 0,
    now = 0
  const timer = createPomodoro(
    {
      read: async () => null,
      write: async (record) => {
        writes++
        if (fail) throw Error('disk')
        saved = structuredClone(record)
      },
    },
    () => now,
  )
  await timer.load()
  timer.start()
  await assert.rejects(timer.flush(), /尚未保存/)
  const attempts = writes
  for (let i = 0; i < 10; i++) {
    now += 1000
    timer.tick()
  }
  assert.equal(writes, attempts)
  timer.pause()
  fail = false
  await timer.flush()
  assert.equal(saved.timer.status, 'paused')
  assert.equal(saved.timer.remainingMs, 1490_000)
  assert.equal(timer.state.error, '')
})

test('三个阶段按结束前的阶段发声，重复 tick 不重放，暂停/重置/设置不发声', async () => {
  const h = fixture()
  await h.timer.load()
  await h.timer.saveSettings({ ...h.timer.state.settings, longBreakEvery: 2 })
  h.timer.start()
  h.timer.pause()
  h.timer.reset()
  assert.deepEqual(h.sounds, [])
  for (const phase of ['focus', 'short-break', 'focus', 'long-break']) {
    h.timer.start()
    h.advance(h.timer.state.timer.remainingMs)
    h.timer.tick()
    h.timer.tick()
    assert.equal(h.sounds.at(-1), phase)
  }
  assert.deepEqual(h.sounds, ['focus', 'short-break', 'focus', 'long-break'])
  assert.equal(h.timer.snapshot.value.completedFocuses, 2)
  await h.timer.flush()
})

test('本次运行休眠后只结算一次，声音失败不影响结算、保存或下一轮', async () => {
  let calls = 0,
    saved,
    now = 1000
  const timer = createPomodoro(
    {
      read: async () => null,
      write: async (value) => {
        saved = value
      },
    },
    () => now,
    {
      onPhaseEnd: () => {
        calls++
        throw Error('audio unavailable')
      },
    },
  )
  await timer.load()
  timer.start()
  now += 3_600_000
  timer.tick()
  timer.tick()
  await timer.flush()
  assert.equal(calls, 1)
  assert.equal(timer.state.ready, true)
  assert.equal(saved.timer.phase, 'short-break')
  assert.equal(saved.timer.completedFocuses, 1)
  assert.match(timer.state.notice, /专注完成/)
  timer.startFocus()
  assert.equal(timer.state.timer.phase, 'focus')
  assert.equal(timer.state.timer.status, 'running')
})

test('视频触发专注可开始和续计，重复播放不重置时长与版本', async () => {
  const h = fixture()
  h.timer.startFocus()
  assert.equal(h.timer.state.timer.status, 'idle')
  await h.timer.load()
  h.timer.startFocus()
  const endsAt = h.timer.state.timer.endsAt,
    revision = h.timer.state.timer.revision
  h.advance(60_000)
  h.timer.startFocus()
  assert.equal(h.timer.state.timer.endsAt, endsAt)
  assert.equal(h.timer.state.timer.revision, revision)
  h.timer.pause()
  h.advance(60_000)
  h.timer.startFocus()
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1440)
  assert.equal(h.timer.state.timer.endsAt, endsAt + 60_000)
  await h.timer.saveSettings({ ...h.timer.state.settings, enabled: false })
  h.timer.startFocus()
  assert.equal(h.timer.state.timer.status, 'paused')
  assert.deepEqual(h.sounds, [])
})

test('休息阶段播放切回新专注，保留完成次数且不伪造休息结束提示音', async () => {
  for (const phase of ['short-break', 'long-break']) {
    for (const status of ['idle', 'paused', 'running']) {
      const stored = restorePomodoro(null)
      Object.assign(stored.timer, { phase, status, completedFocuses: 4, endsAt: status === 'running' ? 50_000 : null })
      const h = fixture()
      await h.timer.load()
      // This is a break reached within the running app, not restored at startup.
      Object.assign(h.timer.state.timer, stored.timer)
      h.timer.startFocus()
      assert.equal(h.timer.snapshot.value.phase, 'focus')
      assert.equal(h.timer.snapshot.value.status, 'running')
      assert.equal(h.timer.snapshot.value.remainingSeconds, 1500)
      assert.equal(h.timer.snapshot.value.completedFocuses, 4)
      assert.deepEqual(h.sounds, [])
      await h.timer.flush()
    }
  }
})

function watchPlayback(t, timer, initial = false) {
  const playing = ref(initial)
  const scope = effectScope()
  scope.run(() => watchPomodoroPlayback(timer, () => playing.value))
  t.after(() => scope.stop())
  return playing
}

test('真实播放状态驱动专注：暂停视频同步暂停计时，连续播放不会自动跳过到点后的休息', async (t) => {
  const h = fixture()
  const playing = watchPlayback(t, h.timer)
  await h.timer.load()
  assert.equal(h.timer.snapshot.value.status, 'idle')
  playing.value = true
  await nextTick()
  assert.equal(h.timer.snapshot.value.status, 'running')
  const endsAt = h.timer.state.timer.endsAt
  playing.value = false
  await nextTick()
  h.advance(60_000)
  assert.equal(h.timer.snapshot.value.status, 'paused')
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1500)
  playing.value = true
  await nextTick()
  assert.equal(h.timer.state.timer.endsAt, endsAt + 60_000)
  h.advance(1500_000)
  await nextTick()
  assert.equal(h.timer.snapshot.value.phase, 'short-break')
  assert.equal(h.timer.snapshot.value.status, 'running')
  await h.timer.saveSettings({ ...h.timer.state.settings, focusMinutes: 30 })
  await nextTick()
  assert.equal(h.timer.snapshot.value.phase, 'short-break')
  assert.equal(h.timer.snapshot.value.status, 'running')
  playing.value = false
  await nextTick()
  playing.value = true
  await nextTick()
  assert.equal(h.timer.snapshot.value.phase, 'focus')
  assert.equal(h.timer.snapshot.value.remainingSeconds, 1800)
  assert.equal(h.timer.snapshot.value.completedFocuses, 1)
  h.timer.pause()
  await nextTick()
  assert.equal(h.timer.snapshot.value.status, 'paused')
})

test('加载前开始播放不漏启动，加载前已暂停不误启动；禁用或加载失败不启动', async (t) => {
  for (const initial of [true, false]) {
    const h = fixture()
    const playing = watchPlayback(t, h.timer, true)
    playing.value = initial
    await nextTick()
    await h.timer.load()
    await nextTick()
    assert.equal(h.timer.snapshot.value.status, initial ? 'running' : 'idle')
  }
  const stored = restorePomodoro(null)
  stored.settings.enabled = false
  const h = fixture(stored)
  watchPlayback(t, h.timer, true)
  await h.timer.load()
  await nextTick()
  assert.equal(h.timer.snapshot.value.status, 'idle')
  await h.timer.saveSettings({ ...h.timer.state.settings, enabled: true })
  await nextTick()
  assert.equal(h.timer.snapshot.value.status, 'running')
  const bad = fixture({ version: 999 })
  watchPlayback(t, bad.timer, true)
  await bad.timer.load()
  await nextTick()
  assert.equal(bad.timer.state.ready, false)
  assert.equal(bad.writes.length, 0)
})

test('完整四轮：专注到点自动休息并暂停视频，休息到点只提示，用户再次播放才专注', async (t) => {
  let playing,
    pauses = 0
  const h = fixture(null, {
    onBreakStart: () => {
      pauses++
      playing.value = false
    },
  })
  playing = watchPlayback(t, h.timer)
  await h.timer.load()
  for (let round = 1; round <= 4; round++) {
    playing.value = true
    await nextTick()
    assert.equal(h.timer.snapshot.value.phase, 'focus')
    assert.equal(h.timer.snapshot.value.status, 'running')
    h.advance(1500_000)
    await nextTick()
    const breakPhase = round === 4 ? 'long-break' : 'short-break'
    assert.equal(playing.value, false)
    assert.equal(pauses, round)
    assert.equal(h.timer.snapshot.value.phase, breakPhase)
    assert.equal(h.timer.snapshot.value.status, 'running')
    assert.equal(h.timer.snapshot.value.remainingSeconds, round === 4 ? 900 : 300)
    assert.equal(h.timer.snapshot.value.completedFocuses, round)
    assert.equal(h.sounds.at(-1), 'focus')
    await h.timer.flush()
    assert.equal(h.read().timer.status, 'running')
    assert.equal(h.read().timer.endsAt, h.clock() + (round === 4 ? 900_000 : 300_000))
    h.advance(round === 4 ? 900_000 : 300_000)
    await nextTick()
    assert.equal(h.timer.snapshot.value.phase, 'focus')
    assert.equal(h.timer.snapshot.value.status, 'idle')
    assert.equal(h.timer.state.timer.endsAt, null)
    assert.equal(h.sounds.at(-1), breakPhase)
    assert.equal(playing.value, false)
    assert.equal(pauses, round)
    h.advance(60_000)
    await nextTick()
    assert.equal(h.timer.snapshot.value.status, 'idle')
    assert.equal(h.timer.snapshot.value.remainingSeconds, 1500)
    assert.equal(h.sounds.length, round * 2)
  }
})

test('重启清除旧休息后，加载前或加载后播放视频均开始新专注，不暂停视频', async (t) => {
  for (const phase of ['short-break', 'long-break']) {
    for (const endsAt of [500, 121_000]) {
      for (const initialPlaying of [false, true]) {
        const stored = restorePomodoro(null)
        Object.assign(stored.timer, { phase, status: 'running', completedFocuses: 4, endsAt })
        let pauses = 0
        const h = fixture(stored, {
          onBreakStart: () => {
            pauses++
          },
        })
        const playing = watchPlayback(t, h.timer, initialPlaying)
        await h.timer.load()
        await nextTick()
        assert.equal(h.timer.snapshot.value.phase, 'focus')
        assert.equal(h.timer.snapshot.value.status, initialPlaying ? 'running' : 'idle')
        assert.equal(h.timer.snapshot.value.completedFocuses, 0)
        assert.equal(h.timer.snapshot.value.remainingSeconds, 1500)
        assert.equal(h.timer.snapshot.value.notice, '')
        assert.equal(pauses, 0)
        assert.deepEqual(h.sounds, [])
        playing.value = true
        await nextTick()
        assert.equal(h.timer.snapshot.value.status, 'running')
        assert.equal(h.timer.state.focusHistory.length, 1)
        await h.timer.flush()
      }
    }
  }
})

test('本次专注的播放与暂停命令恰好到点时，不跳过或暂停自动休息', async (t) => {
  for (const action of ['startFocus', 'pause']) {
    let now = 1000,
      pauses = 0
    const timer = createPomodoro({ read: async () => null, write: async () => {} }, () => now, {
      onBreakStart: () => {
        pauses++
      },
    })
    watchPlayback(t, timer, true)
    await timer.load()
    await nextTick()
    now = timer.state.timer.endsAt
    timer[action]()
    await nextTick()
    timer.tick()
    assert.equal(timer.snapshot.value.phase, 'short-break')
    assert.equal(timer.snapshot.value.status, 'running')
    assert.equal(timer.snapshot.value.remainingSeconds, 300)
    assert.equal(pauses, 1)
  }
})

test('播放器暂停失败不阻断自动休息和提示音，禁用时不自动结算或暂停视频', async () => {
  let pauses = 0
  const h = fixture(null, {
    onBreakStart: () => {
      pauses++
      throw Error('player unavailable')
    },
  })
  await h.timer.load()
  h.timer.start()
  h.advance(1500_000)
  assert.equal(h.timer.snapshot.value.phase, 'short-break')
  assert.equal(h.timer.snapshot.value.status, 'running')
  assert.deepEqual(h.sounds, ['focus'])
  assert.equal(pauses, 1)
  h.timer.reset()
  h.timer.start()
  await h.timer.saveSettings({ ...h.timer.state.settings, enabled: false })
  h.advance(3600_000)
  assert.equal(h.timer.snapshot.value.phase, 'focus')
  assert.equal(h.timer.snapshot.value.status, 'paused')
  assert.equal(pauses, 1)
  await h.timer.flush()
})

test('专注会话持久化：暂停不重复开始，完成按截止时刻记录，重置记录放弃', async () => {
  const h = fixture()
  await h.timer.load()
  h.timer.start()
  h.advance(10000)
  h.timer.pause()
  assert.equal(h.timer.state.focusHistory.length, 1)
  assert.equal(h.timer.state.focusHistory[0].interruptions, 1)
  h.timer.start()
  h.advance(1490000)
  await h.timer.flush()
  assert.equal(h.read().focusHistory[0].outcome, 'completed')
  const reloaded = fixture(h.read())
  await reloaded.timer.load()
  assert.equal(reloaded.timer.state.focusHistory.length, 1)
  h.timer.startFocus()
  h.timer.reset()
  assert.equal(h.timer.state.focusHistory[1].outcome, 'abandoned')
  h.timer.reset()
  assert.equal(h.timer.state.focusHistory.length, 2)
})

test('关闭番茄钟计为一次中断，历史不因计时设置改变而丢失', async () => {
  const h = fixture()
  await h.timer.load()
  h.timer.start()
  await h.timer.saveSettings({ ...h.timer.state.settings, enabled: false })
  assert.equal(h.timer.state.focusHistory[0].interruptions, 1)
  await h.timer.saveSettings({ ...h.timer.state.settings, enabled: true })
  h.timer.start()
  assert.equal(h.timer.state.focusHistory.length, 1)
})

test('启动初始化保存失败不恢复旧休息，重试保存不丢失设置和历史', async () => {
  const stored = restorePomodoro(null)
  stored.settings.enabled = false
  stored.settings.focusMinutes = 30
  Object.assign(stored.timer, { phase: 'long-break', status: 'paused', completedFocuses: 4 })
  let fail = true,
    saved
  const timer = createPomodoro({
    read: async () => stored,
    write: async (value) => {
      if (fail) throw Error('disk')
      saved = value
    },
  })
  await timer.load()
  assert.equal(timer.state.ready, true)
  assert.equal(timer.snapshot.value.phase, 'focus')
  assert.equal(timer.snapshot.value.status, 'idle')
  assert.equal(timer.snapshot.value.remainingSeconds, 1800)
  assert.equal(timer.snapshot.value.enabled, false)
  assert.match(timer.state.error, /尚未保存/)
  fail = false
  await timer.persist()
  assert.equal(saved.timer.phase, 'focus')
  assert.equal(saved.settings.enabled, false)
  assert.equal(timer.state.error, '')
})

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
test('关闭重开恢复进行中的倒计时，离线超时仅结算一段且不重复加次数', async () => {
  const h = fixture()
  await h.timer.load()
  h.timer.start()
  await h.timer.flush()
  const stored = h.read()
  const restored = createPomodoro({ read: async () => stored, write: async () => {} }, () => 1000 + 3_600_000)
  await restored.load()
  assert.equal(restored.snapshot.value.completedFocuses, 1)
  assert.equal(restored.snapshot.value.phase, 'short-break')
  restored.tick()
  restored.tick()
  assert.equal(restored.snapshot.value.completedFocuses, 1)
  assert.equal(restored.snapshot.value.status, 'running')
  assert.equal(restored.state.timer.endsAt, 1000 + 3_600_000 + 300_000)
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

test('恢复已超时的计时只提示一次，声音失败不影响结算、保存或下一轮', async () => {
  const stored = restorePomodoro(null)
  stored.timer.status = 'running'
  stored.timer.endsAt = 500
  let calls = 0,
    saved
  const timer = createPomodoro(
    {
      read: async () => stored,
      write: async (value) => {
        saved = value
      },
    },
    () => 1000,
    {
      onPhaseEnd: () => {
        calls++
        throw Error('audio unavailable')
      },
    },
  )
  await timer.load()
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
      const h = fixture(stored)
      await h.timer.load()
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

test('真实播放状态驱动专注：暂停视频不暂停计时，连续播放不会自动跳过到点后的休息', async (t) => {
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
  assert.equal(h.timer.snapshot.value.status, 'running')
  playing.value = true
  await nextTick()
  assert.equal(h.timer.state.timer.endsAt, endsAt)
  h.advance(1440_000)
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

test('休息重开保留剩余时间，已超时的休息只提醒一次且不自动专注', async (t) => {
  for (const phase of ['short-break', 'long-break']) {
    const stored = restorePomodoro(null)
    Object.assign(stored.timer, { phase, status: 'running', completedFocuses: 4, endsAt: 121_000 })
    let pauses = 0
    const h = fixture(stored, {
      onBreakStart: () => {
        pauses++
      },
    })
    watchPlayback(t, h.timer, true)
    await h.timer.load()
    await nextTick()
    assert.equal(h.timer.snapshot.value.phase, phase)
    assert.equal(h.timer.snapshot.value.remainingSeconds, 120)
    assert.equal(pauses, 1)
    assert.deepEqual(h.sounds, [])
    h.advance(120_000)
    await nextTick()
    assert.equal(h.timer.snapshot.value.phase, 'focus')
    assert.equal(h.timer.snapshot.value.status, 'idle')
    assert.deepEqual(h.sounds, [phase])
    stored.timer.endsAt = 500
    const expired = fixture(stored)
    const playing = watchPlayback(t, expired.timer, true)
    await expired.timer.load()
    await nextTick()
    expired.timer.tick()
    assert.equal(expired.timer.snapshot.value.status, 'idle')
    assert.deepEqual(expired.sounds, [phase])
    playing.value = false
    await nextTick()
    playing.value = true
    await nextTick()
    assert.equal(expired.timer.snapshot.value.status, 'running')
  }
})

test('专注超时加载、播放与暂停同时到点时，自动休息不会被旧操作跳过或暂停', async (t) => {
  for (const action of ['load', 'startFocus', 'pause']) {
    const stored = restorePomodoro(null)
    Object.assign(stored.timer, { status: 'running', endsAt: action === 'load' ? 500 : 2000 })
    let now = 1000,
      pauses = 0
    const timer = createPomodoro({ read: async () => stored, write: async () => {} }, () => now, {
      onBreakStart: () => {
        pauses++
      },
    })
    watchPlayback(t, timer, true)
    await timer.load()
    await nextTick()
    if (action !== 'load') {
      now = 2000
      timer[action]()
    }
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

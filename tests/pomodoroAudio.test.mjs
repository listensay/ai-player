import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPomodoroAudio } from '../app/utils/pomodoroAudio.ts'

function audioContext(state = 'running') {
  const oscillators = [],
    gains = []
  const context = {
    state,
    currentTime: 10,
    destination: {},
    resumes: 0,
    closes: 0,
    resume: async () => {
      context.resumes++
      context.state = 'running'
    },
    close: async () => {
      context.closes++
      context.state = 'closed'
    },
    createOscillator() {
      const oscillator = {
        type: '',
        frequency: {
          setValueAtTime: (value, at) => {
            oscillator.note = [value, at]
          },
        },
        connect: (target) => {
          oscillator.target = target
        },
        disconnect: () => {
          oscillator.disconnected = true
        },
        start: (at) => {
          oscillator.startAt = at
        },
        stop: (at) => {
          oscillator.stopAt = at
        },
      }
      oscillators.push(oscillator)
      return oscillator
    },
    createGain() {
      const events = []
      const gain = {
        events,
        gain: {
          setValueAtTime: (value, at) => events.push(['set', value, at]),
          linearRampToValueAtTime: (value, at) => events.push(['linear', value, at]),
          exponentialRampToValueAtTime: (value, at) => events.push(['exponential', value, at]),
        },
        connect: (target) => {
          gain.target = target
        },
        disconnect: () => {
          gain.disconnected = true
        },
      }
      gains.push(gain)
      return gain
    },
  }
  return { context, oscillators, gains }
}

test('三个结束音使用不同旋律/节奏，温和淡入淡出，并断开已播放的音频节点', async () => {
  const h = audioContext()
  let created = 0
  const audio = createPomodoroAudio(() => {
    created++
    return h.context
  })
  assert.equal(created, 0)
  const melodies = []
  for (const phase of ['focus', 'short-break', 'long-break']) {
    const before = h.oscillators.length
    await audio.play(phase)
    const notes = h.oscillators.slice(before)
    melodies.push(notes.map((note) => note.note[0]))
    for (const note of notes) {
      assert.equal(note.type, 'sine')
      assert.ok(note.startAt >= 10)
      assert.ok(note.stopAt > note.startAt && note.stopAt < 12)
      assert.equal(note.target.target, h.context.destination)
      assert.deepEqual(note.target.events[0], ['set', 0, note.startAt])
      assert.equal(note.target.events.at(-1)[1], 0)
      note.onended()
      assert.equal(note.disconnected, true)
      assert.equal(note.target.disconnected, true)
    }
  }
  assert.deepEqual(
    melodies.map((notes) => notes.length),
    [3, 2, 4],
  )
  assert.equal(new Set(melodies.map(JSON.stringify)).size, 3)
  assert.equal(created, 1)
  audio.dispose()
  await audio.play('focus')
  audio.unlock()
  audio.dispose()
  assert.equal(h.context.closes, 1)
  assert.equal(created, 1)
})

test('手势可预先解锁音频，到点时也会恢复挂起的音频上下文', async () => {
  const h = audioContext('suspended')
  const audio = createPomodoroAudio(() => h.context)
  audio.unlock()
  assert.equal(h.context.resumes, 1)
  h.context.state = 'suspended'
  await audio.play('focus')
  assert.equal(h.context.resumes, 2)
  assert.equal(h.oscillators.length, 3)
  audio.dispose()
})

test('不支持音频、设备异常或自动播放被拒绝时安全降级，不产生未处理拒绝', async () => {
  const missing = createPomodoroAudio(() => {
    throw Error('no audio')
  })
  missing.unlock()
  await missing.play('focus')
  missing.dispose()
  const h = audioContext('suspended')
  h.context.resume = async () => {
    throw Error('not allowed')
  }
  const audio = createPomodoroAudio(() => h.context)
  audio.unlock()
  await audio.play('short-break')
  assert.equal(h.oscillators.length, 0)
  h.context.state = 'running'
  h.context.createOscillator = () => {
    throw Error('device unavailable')
  }
  await audio.play('long-break')
  audio.dispose()
})

test('挂起恢复前关闭时不播放，多个未完成提醒不会堆叠播放', async () => {
  const h = audioContext('suspended')
  let resume
  const resumed = new Promise((resolve) => {
    resume = resolve
  })
  h.context.resume = () => resumed
  const audio = createPomodoroAudio(() => h.context)
  const first = audio.play('focus')
  const second = audio.play('short-break')
  h.context.state = 'running'
  resume()
  await Promise.all([first, second])
  assert.equal(h.oscillators.length, 2)
  h.context.state = 'suspended'
  const pending = audio.play('long-break')
  audio.dispose()
  await pending
  assert.equal(h.oscillators.length, 2)
})

test('被拦截超过两秒的提醒不在后续手势解锁时补播', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const h = audioContext('suspended')
  let resume
  h.context.resume = () =>
    new Promise((resolve) => {
      resume = resolve
    })
  const audio = createPomodoroAudio(() => h.context)
  const pending = audio.play('focus')
  t.mock.timers.tick(2001)
  h.context.state = 'running'
  resume()
  await pending
  assert.equal(h.oscillators.length, 0)
  audio.dispose()
})

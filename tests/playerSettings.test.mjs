import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

// 使用实际播放器状态；只替换持久化和媒体元素，模拟 load() 将倍速重置为 defaultPlaybackRate。
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/dbClient') {
      return {
        url: 'data:text/javascript,export const dbFetchSetting=(...args)=>globalThis.playerSettingsIO.read(...args); export const dbSaveSetting=(...args)=>globalThis.playerSettingsIO.write(...args);',
        shortCircuit: true,
      }
    }
    return next(specifier, context)
  },
})

const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let instance = 0
async function harness(t, settings = null) {
  const oldWindow = globalThis.window
  globalThis.window = new EventTarget()
  const writes = []
  let reads = 0
  globalThis.playerSettingsIO = {
    read: async (key) => {
      assert.equal(key, 'player_settings')
      reads++
      return settings
    },
    write: async (key, value) => {
      writes.push({ key, value })
      return true
    },
  }
  const { usePlayer } = await import(`../app/composables/usePlayer.ts?player-settings-test=${++instance}`)
  const player = usePlayer()
  t.after(() => {
    player.detach()
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
  })
  function video() {
    return {
      playbackRate: 1,
      defaultPlaybackRate: 1,
      volume: 1,
      muted: false,
      paused: true,
      duration: 120,
      currentTime: 0,
      load() {
        this.playbackRate = this.defaultPlaybackRate
        player.sync.rateChange(this)
      },
      async play() {
        this.paused = false
        player.sync.play()
      },
      pause() {
        this.paused = true
        player.sync.pause()
      },
    }
  }
  return { player, usePlayer, video, writes, reads: () => reads }
}

test('从最近播放重新进入时，已保存倍速在视频加载后实际生效', async (t) => {
  const h = await harness(t, { rate: 1.75, volume: 0.6, muted: true })
  await tick()
  const video = h.video()
  h.player.attach(video)
  video.load()
  h.player.sync.loadedMetadata(video)
  await h.player.play()
  assert.equal(h.player.state.rate, 1.75)
  assert.equal(video.playbackRate, 1.75)
  assert.equal(video.defaultPlaybackRate, 1.75)
  assert.equal(video.volume, 0.6)
  assert.equal(video.muted, true)
  assert.equal(video.paused, false)
  assert.equal(h.writes.length, 0)
})

test('保存设置晚于视频就绪返回时，同步更新实际倍速和界面', async (t) => {
  const stored = deferred()
  const h = await harness(t, stored.promise)
  const video = h.video()
  h.player.attach(video)
  video.load()
  h.player.sync.loadedMetadata(video)
  await h.player.play()
  stored.resolve({ rate: 2, volume: 0.4, muted: true })
  await tick()
  assert.equal(h.player.state.rate, 2)
  assert.equal(video.playbackRate, 2)
  assert.equal(video.defaultPlaybackRate, 2)
  assert.equal(video.volume, 0.4)
  assert.equal(video.muted, true)
  assert.equal(h.writes.length, 0)
})

test('修改倍速后，下一节、上一节和重新进入播放器都沿用同一倍速', async (t) => {
  const h = await harness(t)
  await tick()
  const first = h.video()
  h.player.attach(first)
  first.load()
  h.player.sync.loadedMetadata(first)
  h.player.setRate(2.5)
  for (let index = 0; index < 3; index++) {
    h.player.detach()
    const next = h.video()
    h.player.attach(next)
    next.load()
    h.player.sync.loadedMetadata(next)
    await h.player.play()
    assert.equal(next.playbackRate, 2.5)
    assert.equal(h.player.state.rate, 2.5)
  }
  assert.deepEqual(h.writes, [{ key: 'player_settings', value: { rate: 2.5, volume: 1, muted: false } }])
})

test('视频就绪前的倍速重置事件不覆盖偏好，就绪时重新应用', async (t) => {
  const h = await harness(t, { rate: 1.5 })
  await tick()
  const video = h.video()
  h.player.attach(video)
  video.playbackRate = 1
  h.player.sync.rateChange(video)
  assert.equal(h.player.state.rate, 1.5)
  h.player.sync.loadedMetadata(video)
  assert.equal(video.playbackRate, 1.5)
})

test('设置读取过程中切换视频，迟到的设置只应用于当前视频', async (t) => {
  const stored = deferred()
  const h = await harness(t, stored.promise)
  const old = h.video()
  h.player.attach(old)
  h.player.detach()
  const current = h.video()
  h.player.attach(current)
  current.load()
  h.player.sync.loadedMetadata(current)
  stored.resolve({ rate: 3 })
  await tick()
  assert.equal(old.playbackRate, 1)
  assert.equal(current.playbackRate, 3)
  assert.equal(h.player.state.rate, 3)
  h.player.sync.rateChange(old)
  assert.equal(h.player.state.rate, 3)
})

test('用户已修改倍速时，迟到的旧设置不能覆盖新选择', async (t) => {
  const stored = deferred()
  const h = await harness(t, stored.promise)
  const video = h.video()
  h.player.attach(video)
  h.player.setRate(2.5)
  stored.resolve({ rate: 1.25 })
  await tick()
  assert.equal(video.playbackRate, 2.5)
  assert.equal(video.defaultPlaybackRate, 2.5)
  assert.equal(h.player.state.rate, 2.5)
  assert.equal(h.writes.at(-1).value.rate, 2.5)
})

test('同一视频重新加载及快捷键修改也保持倍速，不因媒体事件重复保存', async (t) => {
  const h = await harness(t, { rate: 1.5 })
  await tick()
  const video = h.video()
  h.player.attach(video)
  video.load()
  h.player.sync.loadedMetadata(video)
  h.player.stepRate(1)
  h.player.state.ready = false
  video.load()
  h.player.sync.loadedMetadata(video)
  assert.equal(video.playbackRate, 1.75)
  assert.equal(h.player.state.rate, 1.75)
  h.player.stepRate(-1)
  assert.equal(video.playbackRate, 1.5)
  assert.equal(video.defaultPlaybackRate, 1.5)
  h.player.sync.rateChange(video)
  assert.equal(h.writes.length, 2)
  h.usePlayer()
  assert.equal(h.reads(), 1)
})

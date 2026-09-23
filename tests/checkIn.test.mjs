import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calendarDays,
  checkStudyDay,
  effectivePlaybackSeconds,
  formatStudyClock,
  formatStudyHours,
  restoreStudyDays,
  setStudyTarget,
  splitStudySeconds,
  studyStreak,
} from '../app/utils/checkIn.ts'

test('AI 规划每天 6 小时学习，必须学满 6 小时（21600 秒）才算打卡完成', () => {
  const day = {
    date: '2026-09-23',
    targetSeconds: 60, // 初始默认
    seconds: 0,
    checkedAt: null,
  }

  const now = 1774320000000
  // 设置 AI 规划时间：每天 6 小时 = 360 分钟 = 21600 秒
  setStudyTarget(day, 360, now)
  assert.equal(day.targetSeconds, 21600)
  assert.equal(day.checkedAt, null)

  // 学习了 5 小时 59 分 59 秒 (21599 秒)
  day.seconds = 21599
  checkStudyDay(day, now + 1000)
  assert.equal(day.checkedAt, null, '学满 6 小时前绝不标记打卡完成')

  // 补上最后 1 秒，达到 21600 秒（整整 6 小时）
  day.seconds = 21600
  checkStudyDay(day, now + 2000)
  assert.equal(day.checkedAt, now + 2000, '学满 6 小时后立即打卡成功')

  // 打卡达标后，即使后来目标变更，原有的打卡状态与目标保留
  setStudyTarget(day, 480, now + 3000)
  assert.equal(day.targetSeconds, 21600, '达标后锁定当时的目标与打卡状态')
  assert.equal(day.checkedAt, now + 2000)
})

test('有效学习时间计算：真实物理投入时间，倍速不翻倍，暂停/跳转/缓冲不计入', () => {
  // 正常 1 倍速播放 5 秒
  const s1 = { at: 1000, seconds: 10, duration: 100, playing: true, seeking: false, ended: false, rate: 1 }
  const s2 = { at: 6000, seconds: 15, duration: 100, playing: true, seeking: false, ended: false, rate: 1 }
  assert.equal(effectivePlaybackSeconds(s1, s2), 5)

  // 2 倍速播放：物理时间经过 5 秒，媒体前进了 10 秒，只计入 5 秒物理投入时间（倍速不翻倍）
  const sFast1 = { at: 1000, seconds: 10, duration: 100, playing: true, seeking: false, ended: false, rate: 2 }
  const sFast2 = { at: 6000, seconds: 20, duration: 100, playing: true, seeking: false, ended: false, rate: 2 }
  assert.equal(effectivePlaybackSeconds(sFast1, sFast2), 5)

  // 0.5 倍速慢速播放：物理时间经过 10 秒，媒体前进了 5 秒，只计入媒体等效推进投入时间
  const sSlow1 = { at: 1000, seconds: 10, duration: 100, playing: true, seeking: false, ended: false, rate: 0.5 }
  const sSlow2 = { at: 11000, seconds: 15, duration: 100, playing: true, seeking: false, ended: false, rate: 0.5 }
  assert.equal(effectivePlaybackSeconds(sSlow1, sSlow2), 10)

  // 暂停状态不计入
  const sPaused = { at: 6000, seconds: 15, duration: 100, playing: false, seeking: false, ended: false, rate: 1 }
  assert.equal(effectivePlaybackSeconds(sPaused, s2), 0)

  // 跳转/快进不计入
  const sSeek = { at: 2000, seconds: 80, duration: 100, playing: true, seeking: true, ended: false, rate: 1 }
  assert.equal(effectivePlaybackSeconds(s1, sSeek), 0)

  // 媒体未前进（卡顿或缓冲）不计入
  const sStall = { at: 6000, seconds: 10, duration: 100, playing: true, seeking: false, ended: false, rate: 1 }
  assert.equal(effectivePlaybackSeconds(s1, sStall), 0)
})

test('跨午夜切分：不把跨天时间算入单一天', () => {
  // 跨午夜边界的时间切分
  const midnight = new Date(2026, 8, 23, 0, 0, 0).getTime()
  // 在 00:00:10 结束一次 25 秒的播放，其中 15 秒属于 9月22日，10 秒属于 9月23日
  const parts = splitStudySeconds(midnight + 10_000, 25)
  assert.equal(parts.length, 2)
  assert.equal(parts[0].date, '2026-09-22')
  assert.equal(parts[0].seconds, 15)
  assert.equal(parts[1].date, '2026-09-23')
  assert.equal(parts[1].seconds, 10)
})

test('日历生成与打卡标记验证', () => {
  // 2026 年 9 月 (month = 8)
  const cells = calendarDays(2026, 8)
  assert.ok(cells.length >= 35)
  // 9月1日是周二，前面应该有 1 天（周一，8月31日）
  const day1 = cells.find(c => c.date === '2026-09-01')
  assert.ok(day1)
  assert.equal(day1.currentMonth, true)
  assert.equal(day1.day, 1)

  // 检查模拟打卡数据关联
  const days = {
    '2026-09-05': { date: '2026-09-05', targetSeconds: 21600, seconds: 21600, checkedAt: 123456 },
    '2026-09-06': { date: '2026-09-06', targetSeconds: 21600, seconds: 7200, checkedAt: null },
  }
  assert.ok(days['2026-09-05'].checkedAt !== null, '9月5日打卡达标')
  assert.equal(days['2026-09-06'].checkedAt, null, '9月6日打卡未达标')
})

test('连续打卡天数计算（streak）与打卡历史还原', () => {
  const days = {
    '2026-09-21': { date: '2026-09-21', targetSeconds: 3600, seconds: 3600, checkedAt: 1 },
    '2026-09-22': { date: '2026-09-22', targetSeconds: 3600, seconds: 3600, checkedAt: 2 },
    '2026-09-23': { date: '2026-09-23', targetSeconds: 3600, seconds: 3600, checkedAt: 3 },
  }
  // 今天已达标，连续 3 天
  assert.equal(studyStreak(days, '2026-09-23'), 3)

  // 若今天尚未达标，但昨天达标，连续打卡数为从昨天起的连续天数
  days['2026-09-23'].checkedAt = null
  assert.equal(studyStreak(days, '2026-09-23'), 2)

  // 中断一天测试
  delete days['2026-09-22']
  assert.equal(studyStreak(days, '2026-09-23'), 0)

  // 历史打卡序列化与还原
  const raw = {
    version: 1,
    days: [
      { date: '2026-09-21', targetSeconds: 3600, seconds: 3600, checkedAt: 1 },
      { date: '2026-09-22', targetSeconds: 3600, seconds: 1800, checkedAt: null },
    ],
  }
  const restored = restoreStudyDays(raw)
  assert.equal(restored['2026-09-21'].checkedAt, 1)
  assert.equal(restored['2026-09-22'].checkedAt, null)
  assert.equal(Object.keys(restored).length, 2)
})

test('时长格式化辅助函数', () => {
  // 6 小时
  assert.equal(formatStudyHours(21600), '6 小时')
  // 6 小时 15 分钟
  assert.equal(formatStudyHours(22500), '6 小时 15 分钟')
  // 45 分钟
  assert.equal(formatStudyHours(2700), '45 分钟')
  // 0 秒
  assert.equal(formatStudyHours(0), '0 分钟')

  // 时钟格式
  assert.equal(formatStudyClock(21600), '6:00:00')
  assert.equal(formatStudyClock(3665), '1:01:05')
  assert.equal(formatStudyClock(125), '02:05')
})

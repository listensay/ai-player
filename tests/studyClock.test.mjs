import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStudyClock } from '../app/utils/studyClock.ts'

test('进入播放器后计时，播放与暂停互斥分类，离开时补齐最后一段', () => {
  const records = []
  const clock = createStudyClock((context, end, seconds) => records.push({ ...context, end, seconds }))
  const practice = { courseId: 'one', kind: 'practice' }
  const video = { courseId: 'one', kind: 'video' }
  clock.tick(null, 1000, 0)
  clock.tick(practice, 2000, 1000)
  clock.tick(video, 3500, 2500)
  clock.tick(practice, 4500, 3500)
  clock.tick(null, 5750, 4750)
  clock.tick(null, 8750, 7750)
  assert.deepEqual(records, [
    { ...practice, end: 3500, seconds: 1.5 },
    { ...video, end: 4500, seconds: 1 },
    { ...practice, end: 5750, seconds: 1.25 },
  ])
})
test('切课时区间属于原课程，重新进入不补计离开和隐藏的时间', () => {
  const records = []
  const clock = createStudyClock((context, end, seconds) => records.push([context.courseId, end, seconds]))
  clock.tick({ courseId: 'one', kind: 'practice' }, 0, 0)
  clock.tick({ courseId: 'two', kind: 'video' }, 1000, 1000)
  clock.tick(null, 2000, 2000)
  clock.reset()
  clock.tick({ courseId: 'two', kind: 'practice' }, 12000, 12000)
  clock.tick(null, 13000, 13000)
  assert.deepEqual(records, [
    ['one', 1000, 1],
    ['two', 2000, 1],
    ['two', 13000, 1],
  ])
})
test('休眠、系统时钟跳变和无效时间不补算，恢复后正常计时', () => {
  const records = []
  const clock = createStudyClock((_context, _end, seconds) => records.push(seconds))
  const context = { courseId: 'one', kind: 'video' }
  clock.tick(context, 0, 0)
  clock.tick(context, 10000, 10000)
  clock.tick(context, 11000, 11000)
  clock.tick(context, 40000, 12000)
  clock.tick(context, 41000, 13000)
  clock.tick(context, NaN, NaN)
  clock.tick(context, 43000, 15000)
  clock.tick(context, 44000, 16000)
  assert.deepEqual(records, [1, 1, 1])
})

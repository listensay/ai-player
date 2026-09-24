import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desktopDirectory, fileMetadata, mediaSource } from '../app/utils/desktopFiles.ts'

test('视频通过受限的原生资源地址播放，不将整个文件读入内存', async () => {
  const calls = []
  globalThis.window = { __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      calls.push(command)
      if (command === 'fs_read') throw new Error('The full video must not be read')
      return { name: 'video.mp4', relative: args.relative, kind: 'file', path: '/course/video.mp4', size: 10_000_000_000, modified: 123 }
    },
    convertFileSrc: path => `asset://localhost${path}`,
  } }
  try {
    const file = await desktopDirectory('/course').getFileHandle('video.mp4')
    assert.deepEqual(await fileMetadata(file), { size: 10_000_000_000, lastModified: 123 })
    const source = await mediaSource(file)
    assert.equal(source.url, 'asset://localhost/course/video.mp4')
    assert.equal(calls.includes('fs_read'), false)
    source.release()
  } finally { delete globalThis.window }
})

test('读取不存在的笔记文件时抛出 NotFoundError', async () => {
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => { throw 'No such file or directory (os error 2)' } } }
  try {
    await assert.rejects(desktopDirectory('/course').getFileHandle('new.md'), { name: 'NotFoundError' })
  } finally { delete globalThis.window }
})

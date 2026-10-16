import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const json = (path) => JSON.parse(read(path))
const releases = json('app/data/releases.json')

test('版本日志按新到旧排列，每次发布都有日期和具体变化', () => {
  assert.ok(releases.length > 0)
  let previous
  for (const release of releases) {
    assert.match(release.version, /^\d+\.\d+\.\d+$/)
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(new Date(`${release.date}T12:00:00Z`).toISOString().slice(0, 10), release.date)
    for (const field of ['title', 'summary']) assert.ok(release[field]?.trim())
    const changes = ['added', 'changed', 'fixed', 'removed'].flatMap((field) => {
      assert.ok(Array.isArray(release[field]), field)
      assert.ok(release[field].every((entry) => typeof entry === 'string' && entry.trim()))
      return release[field]
    })
    assert.ok(changes.length > 0)
    assert.equal(new Set(changes).size, changes.length)
    if (previous) {
      const before = previous.version.split('.').map(Number)
      const after = release.version.split('.').map(Number)
      const different = before.findIndex((part, index) => part !== after[index])
      assert.ok(different >= 0 && before[different] > after[different], '版本号必须唯一且递减')
      assert.ok(previous.date >= release.date)
    }
    previous = release
  }
})

test('应用、构建和依赖锁中的项目版本与最新日志一致', () => {
  const version = releases[0].version
  assert.equal(json('package.json').version, version)
  assert.equal(json('package-lock.json').version, version)
  assert.equal(json('package-lock.json').packages[''].version, version)
  assert.equal(json('src-tauri/tauri.conf.json').version, version)
  assert.equal(read('src-tauri/Cargo.toml').match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)[1], version)
  assert.equal(read('src-tauri/Cargo.lock').match(/name = "study-helper"\nversion = "([^"]+)"/)[1], version)
})

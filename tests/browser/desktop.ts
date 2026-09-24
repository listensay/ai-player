/**
 * e2e 测试用的桌面端后端。
 *
 * 前端只通过 Tauri IPC 访问本地能力。测试在页面中注入 `__TAURI_INTERNALS__`，
 * 将原生命令转发到这里：学习数据写入真实的 SQLite 文件（与客户端共用 schema.sql），
 * 课程文件位于临时目录，并按 src-tauri/src/files.rs 的规则限制访问范围。
 * 数据读写语义与 src-tauri/src/db.rs 保持一致，Rust 端实现由 `npm run desktop:test` 覆盖。
 */
import { DatabaseSync } from 'node:sqlite'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, realpath, stat, lstat, readdir, rm, rename, open } from 'node:fs/promises'
import { existsSync, readFileSync, createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Row = Record<string, unknown>
export interface Reply { ok: boolean; value?: unknown; error?: string; base64?: string; channels?: Array<{ channel: string; messages: unknown[] }> }
export interface TranscribeScript { events?: Array<{ event: string; data: unknown }>; error?: string }

const schema = readFileSync(new URL('../../src-tauri/src/schema.sql', import.meta.url), 'utf8')
const WRITABLE = ['md', 'srt', 'vtt', 'png', 'jpg', 'jpeg', 'webp', 'gif']
const OS_ERRORS: Record<string, string> = {
  ENOENT: 'No such file or directory (os error 2)',
  EACCES: 'Permission denied (os error 13)',
  ENOTDIR: 'Not a directory (os error 20)',
  EEXIST: 'File exists (os error 17)',
}

class CommandError extends Error {}
const fail = (message: string): never => { throw new CommandError(message) }
const ioError = (error: unknown) => new CommandError(OS_ERRORS[(error as NodeJS.ErrnoException).code ?? ''] ?? String((error as Error).message))

/** 与测试页面中生成的 WAV 相同：8 kHz 单声道静音，文件名使用 .mp4 以进入视频扫描。 */
function silentWav(seconds: number) {
  const samples = 8000 * seconds, buffer = Buffer.alloc(44 + samples, 128)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(8000, 28); buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(samples, 40)
  return buffer
}

export class DesktopBackend {
  readonly db: DatabaseSync
  readonly roots = new Set<string>()
  /** 系统目录选择框的模拟结果。 */
  readonly picker = { count: 0, cancel: false, name: '导学测试课程', parent: '' }
  readonly course = { paths: [] as string[], duration: 120, subtitle: '' }
  /** 模拟 SQLite 读写失败，仅作用于 AI 配置。 */
  readonly failures = { settingsRead: false, settingsWrite: false }
  settingWrites = 0
  readonly window = { fullscreen: false }
  readonly asr = {
    running: false,
    readyOnStart: true,
    transcribe: (() => ({ error: '未配置转写结果' })) as (args: { relative: string; duration: number }) => TranscribeScript,
    requests: [] as Array<{ relative: string; duration: number }>,
  }
  readonly exports: Array<{ name: string; content: string }> = []
  mediaBase = ''
  private server?: Server

  readonly dir: string

  private constructor(dir: string) {
    this.dir = dir
    this.db = new DatabaseSync(path.join(dir, 'ai-player.db'))
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
    this.db.exec(schema)
  }

  static async create() {
    const backend = new DesktopBackend(await realpath(await mkdtemp(path.join(tmpdir(), 'ai-player-e2e-'))))
    await backend.listen()
    return backend
  }

  async close() {
    await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve())
    this.db.close()
    await rm(this.dir, { recursive: true, force: true })
  }

  /** 课程目录：<临时目录>/courses/[parent/]<name> */
  coursePath(name = this.picker.name, parent = this.picker.parent) {
    return path.join(this.dir, 'courses', parent, name)
  }
  async readCourseFile(name: string, course = this.coursePath()) {
    return existsSync(path.join(course, name)) ? readFile(path.join(course, name), 'utf8') : null
  }
  async writeCourseFile(name: string, content: string | Buffer, course = this.coursePath()) {
    await writeFile(path.join(course, name), content)
  }

  /** 直接查询 SQLite，与前端 databaseRequest 的返回结构一致。 */
  read(endpoint: string, query: Record<string, string> = {}) {
    return this.database(endpoint, 'GET', query, null)
  }
  write(endpoint: string, body: Json) {
    return this.database(endpoint, 'POST', {}, body)
  }

  async handle(command: string, args: Record<string, any>): Promise<Reply> {
    try { return await this.dispatch(command, args ?? {}) }
    catch (error) {
      if (error instanceof CommandError) return { ok: false, error: error.message }
      throw error
    }
  }

  private async dispatch(command: string, a: Record<string, any>): Promise<Reply> {
    const ok = (value: unknown = null): Reply => ({ ok: true, value })
    switch (command) {
      case 'database_request': {
        const { endpoint, method, query, body } = a
        if (endpoint === 'settings' && (query?.key ?? body?.key) === 'ai_settings') {
          if (method === 'GET' && this.failures.settingsRead) fail('database is locked')
          if (method === 'POST') {
            this.settingWrites++
            if (this.failures.settingsWrite) fail('database or disk is full')
          }
        }
        return ok(this.database(endpoint, method, query ?? {}, body ?? null))
      }
      case 'choose_course_folder': return ok(await this.choose())
      case 'course_locations': {
        const saved: Record<string, string> = {}
        for (const r of this.db.prepare('SELECT course_id,path FROM course_locations').all() as Row[]) saved[String(r.course_id)] = String(r.path)
        return ok(saved)
      }
      case 'save_course_location': {
        if (a.root) {
          const target = await this.resolve(a.root, '', false)
          this.db.prepare('INSERT INTO course_locations(course_id,path) VALUES (?,?) ON CONFLICT(course_id) DO UPDATE SET path=excluded.path').run(a.id, target)
        } else this.db.prepare('DELETE FROM course_locations WHERE course_id=?').run(a.id)
        return ok()
      }
      case 'fs_stat': return ok(await this.entry(await this.resolve(a.root, a.relative, false), a.relative))
      case 'fs_entries': {
        const dir = await this.resolve(a.root, a.relative, false)
        const entries = []
        for (const name of await readdir(dir).catch(e => { throw ioError(e) })) {
          if ((await lstat(path.join(dir, name))).isSymbolicLink()) continue
          const child = a.relative ? `${a.relative}/${name}` : name
          try { entries.push(await this.entry(await this.resolve(a.root, child, false), child)) } catch { /* 与 Rust 端一致：跳过不可读的子项 */ }
        }
        return ok(entries)
      }
      case 'fs_child': {
        const target = await this.resolve(a.root, a.relative, a.create)
        if (a.create && !existsSync(target)) {
          if (a.directory) await mkdir(target).catch(e => { throw ioError(e) })
          else { this.checkWrite(target); await (await open(target, 'wx')).close() }
        }
        const item = await this.entry(target, a.relative)
        if ((item.kind === 'directory') !== a.directory) fail('文件类型不匹配')
        return ok(item)
      }
      case 'fs_read': {
        const bytes = await readFile(await this.resolve(a.root, a.relative, false)).catch(e => { throw ioError(e) })
        return { ok: true, base64: bytes.toString('base64') }
      }
      case 'fs_write': {
        const target = await this.resolve(a.root, a.relative, true)
        this.checkWrite(target)
        const temp = path.join(path.dirname(target), `.tmp-${randomUUID()}`)
        await writeFile(temp, Buffer.from(a.bytes as number[]))
        await rename(temp, target)
        return ok()
      }
      case 'asr_start': this.asr.running = true; return ok()
      case 'asr_stop': this.asr.running = false; return ok()
      case 'asr_cancel': return ok()
      case 'asr_health': return ok(this.asr.running
        ? { ok: true, status: this.asr.readyOnStart ? 'ready' : 'loading', error: '', download: null, queued: 0, modelDir: '/models', engine: 'sherpa-onnx', model: 'SenseVoice (zh/en/ja/ko/yue, int8)', version: 'test' }
        : { status: 'stopped', error: '' })
      case 'asr_transcribe': {
        const file = await this.resolve(a.root, a.relative, false)
        if (!(await stat(file)).isFile()) fail('请选择视频文件')
        if (!this.asr.running) fail('本机转写服务未启动')
        this.asr.requests.push({ relative: a.relative, duration: a.duration })
        const script = this.asr.transcribe({ relative: a.relative, duration: a.duration })
        const messages: Array<{ event: string; data: unknown }> = []
        for (const item of script.events ?? []) {
          if (item.event === 'error') { script.error = (item.data as { message: string }).message; break }
          messages.push(item)
        }
        const done = messages.find(m => m.event === 'done')
        const channels = [{ channel: String(a.onEvent), messages }]
        if (script.error || !done) return { ok: false, error: script.error ?? '转写已取消或中断', channels }
        return { ok: true, value: done.data, channels }
      }
      case 'confirm_asr_quit': return ok(true)
      case 'export_learning_plan': this.exports.push({ name: a.name, content: a.content }); return ok(true)
      case 'frontend_ready': case 'finish_close': return ok()
      case 'plugin:window|set_fullscreen': this.window.fullscreen = !!a.value; return ok()
      case 'plugin:window|is_fullscreen': return ok(this.window.fullscreen)
      default:
        if (command.startsWith('plugin:window|')) return ok()
        return fail(`测试环境未实现命令：${command}`)
    }
  }

  // ---- 课程目录（对应 files.rs） ----

  private async choose() {
    this.picker.count++
    if (this.picker.cancel) return null
    const dir = this.coursePath()
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
      const media = silentWav(this.course.duration)
      for (const name of this.course.paths) await writeFile(path.join(dir, name), media)
      if (this.course.subtitle) await writeFile(path.join(dir, '04-多态.srt'), this.course.subtitle)
    }
    const canonical = await realpath(dir)
    this.roots.add(canonical)
    return this.entry(canonical, '')
  }

  private async resolve(root: string, relative: string, create: boolean) {
    if (!this.roots.has(root)) fail('未授权访问此课程目录')
    if (relative && (path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '.'))) fail('无效的课程文件路径')
    const base = await realpath(root).catch(() => fail('课程目录不存在，请重新关联文件夹'))
    const target = path.join(base, relative)
    const canonical = create && !existsSync(target)
      ? path.join(await realpath(path.dirname(target)).catch(e => { throw ioError(e) }), path.basename(target))
      : await realpath(target).catch(e => { throw ioError(e) })
    if (canonical !== base && !canonical.startsWith(base + path.sep)) fail('文件位于授权的课程目录之外')
    return canonical
  }

  private async entry(target: string, relative: string) {
    const info = await stat(target).catch(e => { throw ioError(e) })
    return { name: path.basename(target), kind: info.isDirectory() ? 'directory' : 'file', relative, size: info.size, modified: Math.floor(info.mtimeMs), path: target }
  }

  private checkWrite(target: string) {
    if (!WRITABLE.includes(path.extname(target).slice(1).toLowerCase())) fail('仅支持写入笔记、字幕和图片文件')
  }

  // ---- 视频资源（对应 Tauri asset 协议，支持 Range 请求） ----

  private async listen() {
    this.server = createServer(async (req, res) => {
      const file = decodeURIComponent((req.url ?? '').replace(/^\/asset\//, ''))
      const allowed = [...this.roots].some(root => file.startsWith(root + path.sep))
      res.setHeader('Access-Control-Allow-Origin', '*')
      if (!allowed || !existsSync(file)) { res.statusCode = allowed ? 404 : 403; res.end(); return }
      const size = (await stat(file)).size
      const head = Buffer.alloc(4)
      const fd = await open(file, 'r'); await fd.read(head, 0, 4, 0); await fd.close()
      res.setHeader('Content-Type', head.toString('latin1') === 'RIFF' ? 'audio/wav' : 'application/octet-stream')
      res.setHeader('Accept-Ranges', 'bytes')
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
      if (!range) { res.setHeader('Content-Length', size); createReadStream(file).pipe(res); return }
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size || end < start) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); res.end(); return }
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', end - start + 1)
      createReadStream(file, { start, end }).pipe(res)
    })
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    this.mediaBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  }

  // ---- 学习数据（对应 db.rs） ----

  private database(endpoint: string, method: string, query: Record<string, any>, body: any): unknown {
    if (method === 'GET') return this.readData(endpoint, query)
    this.db.exec('BEGIN')
    try {
      const result = this.writeData(endpoint, method, query, body)
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  private rows(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).all(...(args as never[])) as Row[]
  }
  private canonical(id: string) {
    const alias = this.db.prepare('SELECT course_id FROM course_aliases WHERE alias_id=?').get(id) as Row | undefined
    return alias ? String(alias.course_id) : id
  }

  private readData(endpoint: string, q: Record<string, any>): unknown {
    const course = () => this.canonical(text(q, 'courseId'))
    switch (endpoint) {
      case 'recent-courses': {
        const list = (typeof q.id === 'string'
          ? this.rows('SELECT * FROM recent_courses WHERE id=?', this.canonical(q.id))
          : this.rows('SELECT * FROM recent_courses ORDER BY last_opened_at DESC LIMIT 20'))
          .map(r => ({ id: r.id, name: r.name, videoCount: r.video_count, lastOpenedAt: r.last_opened_at, lastVideoPath: r.last_video_path }))
        return typeof q.id === 'string' ? list[0] ?? null : list
      }
      case 'progress': {
        const byCourse = typeof q.courseId === 'string'
        const result: Record<string, any> = {}
        for (const r of byCourse ? this.rows('SELECT * FROM video_progress WHERE course_id=?', course()) : this.rows('SELECT * FROM video_progress')) {
          const item = { time: r.time, duration: r.duration, ratio: r.ratio, done: r.done === 1, updatedAt: r.updated_at }
          if (byCourse) result[String(r.video_path)] = item
          else (result[String(r.course_id)] ??= {})[String(r.video_path)] = item
        }
        return result
      }
      case 'check-in': {
        const result: Record<string, unknown> = {}
        for (const r of this.rows('SELECT * FROM check_ins WHERE course_id=?', course())) {
          result[String(r.date)] = { date: r.date, seconds: r.seconds, targetSeconds: r.target_seconds, checkedAt: r.checked_at }
        }
        return result
      }
      case 'notes': {
        const r = this.rows('SELECT content,updated_at FROM notes WHERE course_id=? AND video_path=?', course(), text(q, 'videoPath'))[0]
        return r ? { content: r.content, updatedAt: r.updated_at } : { content: '', updatedAt: null }
      }
      case 'note-images':
        if (typeof q.id === 'string') return this.rows('SELECT id,name,data_base64 FROM note_images WHERE id=?', q.id)[0] ?? null
        return this.rows('SELECT id,name,data_base64,created_at FROM note_images WHERE course_id=? AND video_path=? ORDER BY created_at', course(), text(q, 'videoPath'))
      case 'guide': {
        const r = this.rows('SELECT * FROM learning_guides WHERE course_id=?', course())[0]
        return r ? {
          plan: decoded(r.plan_json, null), metadata: decoded(r.metadata_json, {}), view: r.view, includeOptional: r.include_optional === 1,
          mastery: decoded(r.mastery_json, {}), questions: decoded(r.questions_json, []), today: decoded(r.today_json, null), updatedAt: r.updated_at,
        } : null
      }
      case 'practice': {
        const result: Record<string, unknown> = {}
        for (const r of this.rows('SELECT video_path,records_json FROM lesson_practices WHERE course_id=?', course())) result[String(r.video_path)] = decoded(r.records_json, [])
        return result
      }
      case 'settings': {
        if (typeof q.key === 'string') {
          const r = this.rows('SELECT value_json FROM app_settings WHERE key=?', q.key)[0]
          return r ? decoded(r.value_json, null) : null
        }
        const result: Record<string, unknown> = {}
        for (const r of this.rows('SELECT key,value_json FROM app_settings')) result[String(r.key)] = decoded(r.value_json, null)
        return result
      }
      default: return fail('不支持的数据操作')
    }
  }

  private writeData(endpoint: string, method: string, q: Record<string, any>, b: any): unknown {
    if (method === 'DELETE' && endpoint === 'recent-courses') {
      this.db.prepare('DELETE FROM recent_courses WHERE id=?').run(this.canonical(text(q, 'id')))
      return { success: true }
    }
    if (method !== 'POST') fail('不支持的数据操作')
    const time = Date.now()
    const course = () => this.canonical(text(b, 'courseId'))
    const or = (key: string, fallback: unknown) => b[key] ?? fallback
    const upsert = (table: string, columns: string, conflict: string, values: unknown[]) => {
      const names = columns.split(','), keys = conflict.split(',')
      const update = names.filter(n => !keys.includes(n) && n !== 'created_at').map(n => `${n}=excluded.${n}`).join(',')
      this.db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${names.map(() => '?').join(',')}) ON CONFLICT(${conflict}) DO UPDATE SET ${update}`)
        .run(...(values.map(sqlValue) as never[]))
    }
    switch (endpoint) {
      case 'recent-courses':
        upsert('recent_courses', 'id,name,video_count,last_opened_at,last_video_path,created_at,updated_at', 'id',
          [this.canonical(text(b, 'id')), text(b, 'name'), or('videoCount', 0), or('lastOpenedAt', time), b.lastVideoPath ?? null, time, time])
        break
      case 'progress':
        upsert('video_progress', 'course_id,video_path,time,duration,ratio,done,updated_at', 'course_id,video_path',
          [course(), text(b, 'path'), or('time', 0), or('duration', 0), or('ratio', 0), b.done === true, time])
        break
      case 'notes':
        if (typeof b.content !== 'string') fail('笔记内容无效')
        upsert('notes', 'course_id,video_path,content,updated_at', 'course_id,video_path', [course(), text(b, 'videoPath'), b.content, time])
        break
      case 'note-images': {
        const id = typeof b.id === 'string' ? b.id : randomUUID()
        this.db.prepare('INSERT INTO note_images (id,course_id,video_path,name,data_base64,created_at) VALUES (?,?,?,?,?,?)')
          .run(id, course(), text(b, 'videoPath'), text(b, 'name'), text(b, 'dataBase64'), time)
        return { success: true, id, dataBase64: b.dataBase64 }
      }
      case 'check-in':
        if (!Array.isArray(b.days)) fail('打卡数据无效')
        for (const day of b.days) {
          upsert('check_ins', 'course_id,date,seconds,target_seconds,checked_at,created_at,updated_at', 'course_id,date',
            [course(), text(day, 'date'), day.seconds ?? null, day.targetSeconds ?? null, day.checkedAt ?? null, time, time])
        }
        break
      case 'guide':
        upsert('learning_guides', 'course_id,plan_json,metadata_json,view,include_optional,mastery_json,questions_json,today_json,updated_at', 'course_id',
          [course(), b.plan ?? null, b.metadata ?? null, or('view', 'all'), b.includeOptional === true, b.mastery ?? null, b.questions ?? null, b.today ?? null, time])
        break
      case 'practice':
        if (!Array.isArray(b.records)) fail('练习记录无效')
        upsert('lesson_practices', 'course_id,video_path,records_json,updated_at', 'course_id,video_path', [course(), text(b, 'videoPath'), b.records, time])
        break
      case 'settings':
        upsert('app_settings', 'key,value_json,updated_at', 'key', [text(b, 'key'), JSON.stringify(b.value ?? null), time])
        break
      default: fail('不支持的数据操作')
    }
    return { success: true, updatedAt: time }
  }
}

function text(value: any, key: string): string {
  const v = value?.[key]
  return typeof v === 'string' && v ? v : fail(`缺少参数：${key}`)
}
/** 与 db.rs 的 sql() 相同：布尔存为整数，对象与数组存为 JSON 文本，字符串原样保存。 */
function sqlValue(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string') return value
  return JSON.stringify(value)
}
function decoded(value: unknown, fallback: unknown) {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

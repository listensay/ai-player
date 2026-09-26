import { desktopInvoke } from './platform'

export type DatabaseCollection = 'recent-courses' | 'progress' | 'check-in' | 'notes' | 'note-images' | 'guide' | 'practice' | 'settings' | 'library' | 'dashboard' | 'day-snapshots'
export interface DatabaseOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  query?: Record<string, string>
}

const pending = new Set<Promise<unknown>>()
export async function flushDatabaseWrites() {
  while (pending.size) await Promise.all([...pending])
}

export async function databaseRequest<T = unknown>(collection: DatabaseCollection, options: DatabaseOptions = {}): Promise<T> {
  const request = desktopInvoke<T>('database_request', {
      endpoint: collection, method: options.method ?? 'GET', query: options.query ?? {}, body: options.body ?? null,
    })
  if (!options.method || options.method === 'GET') return request
  pending.add(request)
  try { return await request } finally { pending.delete(request) }
}

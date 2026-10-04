import type { DatabaseCollection, DatabaseOptions } from './database'
type Listener = (collection: DatabaseCollection, options: DatabaseOptions) => void
const listeners = new Set<Listener>()
export function subscribeDatabaseChanges(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function notifyDatabaseChange(collection: DatabaseCollection, options: DatabaseOptions) {
  for (const listener of listeners) {
    try {
      listener(collection, options)
    } catch {
      /* Observers must not fail a successful write. */
    }
  }
}

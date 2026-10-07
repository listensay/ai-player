/** Coalesce readers; only commit successful reads and retain invalidations arriving during I/O. */
export function incrementalCache<T>(
  read: (id?: string) => Promise<T>,
  merge: (current: T, update: T, id: string) => T,
) {
  let value: T | undefined
  let revision = 0
  let full: number | undefined = 0
  const dirty = new Map<string, number>()
  let pending: Promise<T> | undefined
  function invalidate(id?: string) {
    revision++
    if (id) dirty.set(id, revision)
    else full = revision
  }
  function load(): Promise<T> {
    if (pending) return pending
    if (full === undefined && !dirty.size && value !== undefined) return Promise.resolve(value)
    pending = (async () => {
      while (full !== undefined || dirty.size) {
        const version = full
        const changes = new Map(dirty)
        if (version !== undefined) {
          const next = await read()
          value = next
          if (full === version) full = undefined
        } else {
          const updates = await Promise.all([...changes.keys()].map(async (id) => [id, await read(id)] as const))
          for (const [id, update] of updates) value = merge(value!, update, id)
        }
        for (const [id, at] of changes) if (dirty.get(id) === at) dirty.delete(id)
      }
      return value!
    })().finally(() => {
      pending = undefined
    })
    return pending
  }
  return { load, invalidate }
}

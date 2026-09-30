/** LRU eviction with explicit leases for displayed values and work in progress. */
export function retainedCache<K, V>(
  values: Map<K, V>,
  options: {
    entries: number
    weight: number
    measure: (value: V) => number
    disposable: (key: K, value: V) => boolean
  },
) {
  const access = new Map<K, number>(),
    retained = new Map<K, number>()
  let sequence = 0
  function touch(key: K) {
    access.set(key, ++sequence)
  }
  function prune(except?: K) {
    let weight = [...values.values()].reduce((sum, value) => sum + options.measure(value), 0)
    for (const [key] of [...access].sort((a, b) => a[1] - b[1])) {
      if (values.size <= options.entries && weight <= options.weight) break
      const value = values.get(key)
      if (value === undefined || key === except || retained.has(key) || !options.disposable(key, value)) continue
      weight -= options.measure(value)
      values.delete(key)
      access.delete(key)
    }
  }
  function retain(key: K) {
    retained.set(key, (retained.get(key) ?? 0) + 1)
    touch(key)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = retained.get(key)! - 1
      if (count) retained.set(key, count)
      else retained.delete(key)
      prune()
    }
  }
  return { touch, prune, retain }
}

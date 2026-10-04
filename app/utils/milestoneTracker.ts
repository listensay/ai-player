import { restoreMilestoneLedger, type Milestone, type MilestoneLedger } from './milestones.ts'
export function createMilestoneState() {
  return { badges: [] as Milestone[], ready: false, loading: false, error: '' }
}
/** Save before celebrating. A first install imports old achievements silently. */
export function createMilestoneTracker(
  io: {
    readLedger: () => Promise<unknown>
    readBadges: () => Promise<Milestone[]>
    saveLedger: (ledger: MilestoneLedger) => Promise<unknown>
    celebrate: (badges: Milestone[]) => void
  },
  state = createMilestoneState(),
) {
  let disposed = false
  let ledger: MilestoneLedger | null | undefined
  let running: Promise<void> | undefined
  let again = false
  async function update() {
    state.loading = true
    state.error = ''
    try {
      if (ledger === undefined) ledger = restoreMilestoneLedger(await io.readLedger())
      const badges = await io.readBadges()
      if (disposed) return
      const firstLoad = ledger === null
      const next: MilestoneLedger = { version: 1, unlocked: { ...ledger?.unlocked } }
      const earned = badges.filter((badge) => badge.unlocked && !Object.hasOwn(next.unlocked, badge.id))
      for (const badge of earned) next.unlocked[badge.id] = Date.now()
      if (firstLoad || earned.length) await io.saveLedger(next)
      if (disposed) return
      ledger = next
      state.badges = badges.map((badge) => ({ ...badge, unlocked: Object.hasOwn(next.unlocked, badge.id) }))
      state.ready = true
      if (!firstLoad && earned.length) io.celebrate(earned)
    } catch (error) {
      if (!disposed) state.error = '勋章同步失败：' + String(error)
    } finally {
      state.loading = false
    }
  }
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await update()
      } while (again && !disposed)
    })().finally(() => {
      running = undefined
    })
    return running
  }
  return {
    state,
    refresh,
    dispose: () => {
      disposed = true
    },
  }
}

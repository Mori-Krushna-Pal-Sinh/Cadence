import { create } from 'zustand'
import type { Data } from '../domain/types'
import { supabase } from '../lib/supabase'
import { replaceData } from './store'

// Phase 2 only: a one-time, opt-in upload of local guest data into a freshly
// signed-in, empty cloud account. This does NOT implement ongoing sync — no
// realtime, no polling, no background sync, no subscriptions. Every write here
// is triggered by one explicit user action (accepting the offer), and every
// read is triggered by one of two deliberate checks (deciding whether to
// offer, and re-confirming immediately before writing).

interface MigrationState {
  /** True while there's an unresolved offer the user hasn't acted on yet. */
  pending: boolean
  counts: { areas: number; activities: number; completions: number }
  /** True while an upload (or the pre-write re-check) is in flight. */
  busy: boolean
}

const initialState: MigrationState = { pending: false, counts: { areas: 0, activities: 0, completions: 0 }, busy: false }

export const useMigration = create<MigrationState>(() => initialState)

// Held only in memory, only between the offer being shown and the user acting
// on it. Never written anywhere on its own — the source of truth for "local
// guest data" remains the `cadence:data:local` IndexedDB entry, untouched by
// any of this.
let pendingSnapshot: Data | null = null
let pendingUserId: string | null = null

/** Synchronous reentrancy guard for acceptMigration() — independent of the React `busy` flag, so a duplicate call is rejected even before a re-render could disable the button. */
let migrating = false

const declineKey = (userId: string) => `cadence:migration-declined:${userId}`
const checkedKey = (userId: string) => `cadence:migration-checked:${userId}`

function readFlag(key: string): boolean {
  try { return !!localStorage.getItem(key) } catch { return false }
}
function writeFlag(key: string): void {
  try { localStorage.setItem(key, '1') } catch { /* private browsing: no localStorage */ }
}

/**
 * Has this account already reached a genuine terminal outcome on this device?
 * "Terminal" means: no meaningful guest data, the account already had cloud
 * data, the user explicitly declined, or a migration succeeded. Merely
 * showing the offer is NOT terminal — if the person reloads or closes the tab
 * without choosing, this stays false so the offer can appear again later.
 */
export function isMigrationChecked(userId: string): boolean {
  return readFlag(checkedKey(userId))
}

function markChecked(userId: string): void {
  writeFlag(checkedKey(userId))
}

function hasMeaningfulData(data: Data): boolean {
  return Object.keys(data.activities).length > 0 || Object.keys(data.completions).length > 0
}

/** Re-run every time this matters (decision time AND immediately before writing) — never cached. */
async function cloudIsEmpty(userId: string): Promise<boolean> {
  const [areas, activities, completions] = await Promise.all([
    supabase.from('areas').select('id').eq('user_id', userId).limit(1),
    supabase.from('activities').select('id').eq('user_id', userId).limit(1),
    supabase.from('completions').select('id').eq('user_id', userId).limit(1),
  ])
  const firstError = areas.error ?? activities.error ?? completions.error
  if (firstError) throw firstError
  return (areas.data?.length ?? 0) === 0 && (activities.data?.length ?? 0) === 0 && (completions.data?.length ?? 0) === 0
}

/**
 * Called by persist.ts, at most once per (account, device), to decide whether
 * to show a migration offer. Marks "checked" itself for the outcomes it can
 * resolve directly (no meaningful data, already declined before, cloud
 * already has data) — but deliberately NOT for successfully showing the
 * offer, since seeing the prompt isn't a decision. declineMigration() and
 * acceptMigration() below mark "checked" once the user actually decides.
 * Throws if the cloud-emptiness check itself fails (network/Supabase error) —
 * left unmarked in that case, so persist.ts retries on the next boot.
 */
export async function maybeOfferMigration(snapshot: Data, userId: string): Promise<void> {
  if (isMigrationChecked(userId)) return // already resolved on this device

  if (!hasMeaningfulData(snapshot)) { markChecked(userId); return }
  if (readFlag(declineKey(userId))) { markChecked(userId); return }

  const empty = await cloudIsEmpty(userId)
  if (!empty) { markChecked(userId); return }

  pendingSnapshot = snapshot
  pendingUserId = userId
  useMigration.setState({
    pending: true,
    busy: false,
    counts: {
      areas: Object.keys(snapshot.areas).length,
      activities: Object.keys(snapshot.activities).length,
      completions: Object.keys(snapshot.completions).length,
    },
  })
  // Deliberately not marked "checked" here — see the function comment above.
}

/**
 * Clears any pending offer that no longer matches the currently active user —
 * e.g. sign-out, a session expiring, or switching to a different account.
 * Safe to call any time; no-ops if nothing is pending or it already matches
 * `activeUserId`. This is what stops a stale prompt from lingering for an
 * account that's no longer active, and stops a subsequent "Add it" click from
 * being able to target the wrong account — once cleared, acceptMigration()
 * reads `pendingUserId` as null and no-ops.
 */
export function clearMigrationIfStale(activeUserId: string | null): void {
  if (pendingUserId !== null && pendingUserId !== activeUserId) {
    pendingSnapshot = null
    pendingUserId = null
    useMigration.setState(initialState)
  }
}

/**
 * User said no — a genuine terminal decision, so "checked" is marked here.
 * Local guest data is not touched — it simply stays at `cadence:data:local`.
 */
export function declineMigration(): void {
  if (pendingUserId) {
    writeFlag(declineKey(pendingUserId))
    markChecked(pendingUserId)
  }
  pendingSnapshot = null
  pendingUserId = null
  useMigration.setState(initialState)
}

/**
 * User said yes. Guarded synchronously by `migrating` so a duplicate call —
 * a double-click, or any other re-entrant trigger — is rejected immediately,
 * before any async work starts, independent of the React `busy` flag. Then:
 * re-checks cloud emptiness immediately before writing (closing the race
 * window since the offer was first shown), uploads areas, then activities,
 * then completions, and makes a best-effort attempt to roll back anything
 * already inserted if a later step fails — this reduces the chance of
 * partial cloud data but is not a guarantee (rollback itself could fail, e.g.
 * on a dropped connection). What IS guaranteed: the original error always
 * propagates to the caller, so a failure is never hidden, and a retry always
 * re-checks cloudIsEmpty() fresh rather than trusting that rollback
 * succeeded. "Checked" is marked on every terminal path here — success, and
 * the "someone else already migrated this account" stand-down — but NOT on
 * failure, so a failed attempt can be retried. The local guest snapshot and
 * the app's current in-memory data are never touched by any of this, on
 * success or failure.
 */
export async function acceptMigration(): Promise<void> {
  if (migrating) return
  const snapshot = pendingSnapshot
  const userId = pendingUserId
  if (!snapshot || !userId) return

  migrating = true
  try {
    useMigration.setState((s) => ({ ...s, busy: true }))

    const insertedAreaIds: string[] = []
    const insertedActivityIds: string[] = []
    const insertedCompletionIds: string[] = []

    const rollback = async () => {
      try {
        // Scoped to user_id in addition to id — belt-and-braces with RLS, so a
        // rollback can never delete another user's rows even in an unexpected
        // id-collision or data-integrity scenario.
        if (insertedCompletionIds.length) await supabase.from('completions').delete().in('id', insertedCompletionIds).eq('user_id', userId)
        if (insertedActivityIds.length) await supabase.from('activities').delete().in('id', insertedActivityIds).eq('user_id', userId)
        if (insertedAreaIds.length) await supabase.from('areas').delete().in('id', insertedAreaIds).eq('user_id', userId)
      } catch {
        // Best-effort only — not guaranteed (e.g. a network drop right here
        // would leave some rows behind), so cloud emptiness is NOT assumed
        // after this runs. The original insert error still propagates below
        // regardless of whether rollback fully succeeded, so the failure is
        // never silently swallowed, and a retry always re-checks
        // cloudIsEmpty() fresh rather than trusting that rollback worked.
      }
    }

    try {
      const stillEmpty = await cloudIsEmpty(userId)
      if (!stillEmpty) {
        // Someone/something else populated this account since the offer was
        // shown (e.g. another device). Nothing left to migrate — terminal outcome.
        markChecked(userId)
        pendingSnapshot = null
        pendingUserId = null
        useMigration.setState(initialState)
        return
      }

      const areaRows = Object.values(snapshot.areas).map((a) => ({
        id: a.id,
        user_id: userId,
        name: a.name,
        color: a.color,
        order: a.order,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
        deleted_at: a.deletedAt ?? null,
      }))

      const activityRows = Object.values(snapshot.activities).map((a) => ({
        id: a.id,
        user_id: userId,
        title: a.title,
        notes: a.notes ?? null,
        kind: a.kind,
        schedule: a.schedule,
        area_id: a.areaId,
        start_date: a.startDate,
        archived_at: a.archivedAt ?? null,
        goal_id: a.goalId ?? null,
        order: a.order,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
        deleted_at: a.deletedAt ?? null,
      }))

      const completionRows = Object.values(snapshot.completions).map((c) => ({
        id: c.id,
        user_id: userId,
        activity_id: c.activityId,
        date: c.date,
        completed_at: c.completedAt,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        deleted_at: c.deletedAt ?? null,
      }))

      // Parent-before-child, matching the composite foreign keys from Phase 0.
      if (areaRows.length) {
        const { error } = await supabase.from('areas').insert(areaRows)
        if (error) throw error
        insertedAreaIds.push(...areaRows.map((r) => r.id))
      }
      if (activityRows.length) {
        const { error } = await supabase.from('activities').insert(activityRows)
        if (error) throw error
        insertedActivityIds.push(...activityRows.map((r) => r.id))
      }
      if (completionRows.length) {
        const { error } = await supabase.from('completions').insert(completionRows)
        if (error) throw error
        insertedCompletionIds.push(...completionRows.map((r) => r.id))
      }

      // Reflect the migrated data immediately in the live app, in this account's
      // own (currently empty) namespace — persist.ts's normal debounced write
      // then carries it into `cadence:data:<userId>` the same way any other edit is saved.
      replaceData(snapshot)
      markChecked(userId) // terminal: migration succeeded

      pendingSnapshot = null
      pendingUserId = null
      useMigration.setState(initialState)
    } catch (err) {
      await rollback()
      // Leave "checked" unmarked so a retry is possible, and leave `pending`
      // true so the prompt stays open with the same snapshot — only `busy`
      // clears here.
      useMigration.setState((s) => ({ ...s, busy: false }))
      throw err
    }
  } finally {
    migrating = false
  }
}
import { get, set } from 'idb-keyval'
import type { Data, Meta } from '../domain/types'
import { emptyData, replaceData, useStore, type Theme } from './store'
import { demoData } from './demo'
import { useAuth } from './auth'
import { clearMigrationIfStale, isMigrationChecked, maybeOfferMigration } from './migration'

// Local-first persistence: the whole dataset lives in memory and is written to
// IndexedDB (debounced) after every change. Sample data uses a separate key so
// it can never touch real data. Other open tabs are told to reload via BroadcastChannel.
//
// Storage is account-aware: each signed-in user gets their own IndexedDB key
// (`cadence:data:<userId>`), and the signed-out/no-account state uses
// `cadence:data:local`. This is what stops one person's data from appearing
// when a different person signs in on the same browser.

export const isDemo = new URLSearchParams(location.search).has('demo')
const THEME_KEY = 'cadence:theme'
/** Pre-account key, from before per-user storage existed. Migrated once, never deleted. */
const LEGACY_KEY = 'cadence:data'
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('cadence') : null

const keyFor = (userId: string | null) => (isDemo ? 'cadence:demo' : `cadence:data:${userId ?? 'local'}`)

let KEY = keyFor(null)
/** undefined until startPersistence has run once; distinguishes "not yet loaded" from "loaded as local/null". */
let currentUserId: string | null | undefined
let applyingRemote = false
let timer: number | undefined

export function readTheme(): Theme {
  try { return (localStorage.getItem(THEME_KEY) as Theme) || 'system' } catch { return 'system' }
}

/**
 * Shared by both the boot-time path (startPersistence, when the app loads
 * already signed in — e.g. right after a redirect-based Google/magic-link
 * sign-in) and the live-transition path (switchUser, for any future non-
 * redirect auth method). Reads the guest snapshot from the local namespace
 * BEFORE anything touches the signed-in namespace, and hands it to
 * migration.ts's maybeOfferMigration(), which decides on its own whether to
 * show anything and owns marking the account "checked" — see migration.ts for
 * exactly which outcomes count as terminal.
 */
async function offerMigrationOnce(userId: string) {
  if (isDemo || isMigrationChecked(userId)) return

  const guestSnapshot = (await get<Data>(keyFor(null)).catch(() => undefined))
    ?? { version: 1 as const, areas: {}, activities: {}, completions: {} }

  try {
    await maybeOfferMigration(guestSnapshot, userId)
  } catch {
    // cloudIsEmpty() failed (network/Supabase error) — leave unchecked, retry on next boot.
  }
}

/**
 * Call once at startup, after the initial auth session is known (pass the
 * signed-in user's id, or null if signed out) — see auth.ts's initAuth().
 * Rendering the app only after this resolves is what stops a stale or
 * wrong-account view from ever flashing on screen.
 */
export async function startPersistence(userId: string | null) {
  currentUserId = userId
  KEY = keyFor(userId)

  // One-time migration: bring forward data that predates per-account keys.
  // Only applies to the signed-out/local namespace, and never overwrites —
  // if `cadence:data:local` already has something, the legacy key is left alone.
  if (!isDemo && userId === null) {
    const already = await get<Data>(KEY).catch(() => undefined)
    if (!already) {
      const legacy = await get<Data>(LEGACY_KEY).catch(() => undefined)
      if (legacy) await set(KEY, legacy)
    }
  }

  // Covers the common case in this app: sign-in via Google/magic-link redirects
  // the whole page, so the app boots up ALREADY signed in — this never passes
  // through switchUser()'s live-transition detection below, since there's no
  // in-page transition to observe. Runs before loadInto(), so the guest
  // snapshot is read before anything touches the signed-in namespace.
  if (userId !== null) await offerMigrationOnce(userId)

  await loadInto(KEY)
  useStore.setState({ theme: readTheme() })

  useStore.subscribe((s, prev) => {
    if (s.theme !== prev.theme) try { localStorage.setItem(THEME_KEY, s.theme) } catch { /* private mode */ }
    if (s.data === prev.data || applyingRemote) return
    clearTimeout(timer)
    timer = window.setTimeout(flush, 250)
  })

  channel?.addEventListener('message', async (e) => {
    if (e.data?.key !== KEY) return
    const fresh = await get<Data>(KEY)
    if (!fresh) return
    applyingRemote = true
    replaceData(fresh)
    applyingRemote = false
  })

  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  addEventListener('pagehide', flush)

  // React to sign-in / sign-out / account switches that happen after startup —
  // kept for any future non-redirect auth method, even though today both of
  // this app's sign-in methods redirect and are handled by the block above instead.
  useAuth.subscribe((s) => {
    // Always run first, regardless of what follows: stops a pending migration
    // offer from lingering for an account that's no longer active (sign-out,
    // session expiry, or switching to a different account), and stops a
    // subsequent "Add it" click from being able to target the wrong account.
    clearMigrationIfStale(s.userId)

    // The first emission from useAuth always matches currentUserId (it's the
    // same session startPersistence was just called with), so this only fires
    // on real changes.
    if (s.status === 'loading' || s.userId === currentUserId) return
    switchUser(s.userId)
  })
}

async function loadInto(key: string) {
  const stored = await get<Data>(key).catch(() => undefined)
  replaceData(stored && stored.version === 1 ? stored : isDemo ? demoData() : emptyData())
}

/**
 * Switches the active namespace to a different user (or null for signed-out/local).
 *
 * If this is specifically a guest (null) → signed-in (non-null) transition
 * happening live, in an already-running session, offerMigrationOnce() is given
 * a chance to run (it no-ops instantly if this account was already checked via
 * the boot-time path above, e.g. because the sign-in actually redirected).
 */
async function switchUser(userId: string | null) {
  const previousUserId = currentUserId
  await flush() // don't drop pending edits made under the outgoing account

  if (previousUserId === null && userId !== null) await offerMigrationOnce(userId)

  currentUserId = userId
  KEY = keyFor(userId)
  await loadInto(KEY)
}

async function flush() {
  if (timer === undefined) return
  clearTimeout(timer)
  timer = undefined
  await set(KEY, useStore.getState().data)
  channel?.postMessage({ key: KEY })
  if (!isDemo) requestPersistentStorage()
}

let askedPersist = false
async function requestPersistentStorage() {
  if (askedPersist || !navigator.storage?.persist) return
  askedPersist = true
  await navigator.storage.persist().catch(() => false)
}

export async function storageStatus() {
  const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false
  const est = await navigator.storage?.estimate?.().catch(() => undefined)
  return { persisted, usage: est?.usage ?? null }
}

// ─── Import ─────────────────────────────────────────────────────────────────

export function validate(raw: unknown): Data {
  const d = raw as Partial<Data>
  if (!d || d.version !== 1 || typeof d.areas !== 'object' || typeof d.activities !== 'object' || typeof d.completions !== 'object')
    throw new Error('This file is not a Cadence export.')
  return { version: 1, areas: d.areas!, activities: d.activities!, completions: d.completions! }
}

/** Per-record last-write-wins merge — the same rule a future sync layer would use. */
export function merge(a: Data, b: Data): Data {
  const pick = <T extends Meta>(x: Record<string, T>, y: Record<string, T>) => {
    const out = { ...x }
    for (const [id, r] of Object.entries(y)) if (!out[id] || out[id].updatedAt < r.updatedAt) out[id] = r
    return out
  }
  return {
    version: 1,
    areas: pick(a.areas, b.areas),
    activities: pick(a.activities, b.activities),
    completions: pick(a.completions, b.completions),
  }
}

export function importData(raw: unknown): { mode: 'replaced' | 'merged' } {
  const incoming = validate(raw)
  const current = useStore.getState().data
  const pristine = !Object.keys(current.activities).length && !Object.keys(current.completions).length
  replaceData(pristine ? incoming : merge(current, incoming))
  return { mode: pristine ? 'replaced' : 'merged' }
}
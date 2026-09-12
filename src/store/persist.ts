import { get, set } from 'idb-keyval'
import type { Data, Meta } from '../domain/types'
import { emptyData, replaceData, useStore, type Theme } from './store'
import { demoData } from './demo'
import { useAuth } from './auth'

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

  // React to sign-in / sign-out / account switches that happen after startup.
  // The first emission from useAuth always matches currentUserId (it's the same
  // session startPersistence was just called with), so this only fires on real changes.
  useAuth.subscribe((s) => {
    if (s.status === 'loading' || s.userId === currentUserId) return
    switchUser(s.userId)
  })
}

async function loadInto(key: string) {
  const stored = await get<Data>(key).catch(() => undefined)
  replaceData(stored && stored.version === 1 ? stored : isDemo ? demoData() : emptyData())
}

/** Switches the active namespace to a different user (or null for signed-out/local). */
async function switchUser(userId: string | null) {
  await flush() // don't drop pending edits made under the outgoing account
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

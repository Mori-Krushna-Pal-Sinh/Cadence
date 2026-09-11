import { get, set } from 'idb-keyval'
import type { Data, Meta } from '../domain/types'
import { emptyData, replaceData, useStore, type Theme } from './store'
import { demoData } from './demo'

// Local-first persistence: the whole dataset lives in memory and is written to
// IndexedDB (debounced) after every change. Sample data uses a separate key so
// it can never touch real data. Other open tabs are told to reload via BroadcastChannel.

export const isDemo = new URLSearchParams(location.search).has('demo')
const KEY = isDemo ? 'cadence:demo' : 'cadence:data'
const THEME_KEY = 'cadence:theme'
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('cadence') : null

let applyingRemote = false
let timer: number | undefined

export function readTheme(): Theme {
  try { return (localStorage.getItem(THEME_KEY) as Theme) || 'system' } catch { return 'system' }
}

export async function startPersistence() {
  const stored = await get<Data>(KEY).catch(() => undefined)
  replaceData(stored && stored.version === 1 ? stored : isDemo ? demoData() : emptyData())
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

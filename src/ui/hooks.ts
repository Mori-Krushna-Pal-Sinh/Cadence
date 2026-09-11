import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { todayKey, type DateKey } from '../domain/dates'
import { liveActivities, liveAreas, useStore } from '../store/store'

/** Current day; rolls over at midnight and when the tab regains focus. */
export function useToday(): DateKey {
  const [today, setToday] = useState(todayKey)
  useEffect(() => {
    const tick = () => setToday((t) => (t === todayKey() ? t : todayKey()))
    const id = setInterval(tick, 30_000)
    addEventListener('focus', tick)
    return () => { clearInterval(id); removeEventListener('focus', tick) }
  }, [])
  return today
}

export function useActivities() {
  const activities = useStore((s) => s.data.activities)
  return useMemo(() => liveActivities({ activities } as never), [activities])
}

export function useAreas() {
  const areas = useStore((s) => s.data.areas)
  const list = useMemo(() => liveAreas({ areas } as never), [areas])
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list])
  return { list, byId }
}

// ─── Hash router ────────────────────────────────────────────────────────────

export type Route = 'today' | 'activities' | 'review' | 'calendar' | 'settings'
const ROUTES: Route[] = ['today', 'activities', 'review', 'calendar', 'settings']

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, '').split('/')[0] as Route
  return ROUTES.includes(r) ? r : 'today'
}

const subscribe = (cb: () => void) => { addEventListener('hashchange', cb); return () => removeEventListener('hashchange', cb) }

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, readRoute)
}

export function navigate(r: Route) {
  location.hash = `/${r}`
}

export function useMediaQuery(q: string) {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => matchMedia(q).matches,
  )
}

export const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

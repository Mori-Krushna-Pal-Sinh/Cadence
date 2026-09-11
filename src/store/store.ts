import { create } from 'zustand'
import { minKey, todayKey, type DateKey } from '../domain/dates'
import { buildIndex, type CompletionIndex } from '../domain/schedule'
import { alive, AREA_COLORS, type Activity, type Area, type Completion, type Data, type ID, type Kind, type Schedule } from '../domain/types'

export type Theme = 'system' | 'light' | 'dark'

interface State {
  data: Data
  theme: Theme
  loaded: boolean
  /** Derived; rebuilt whenever completions change. */
  index: CompletionIndex
}

export interface NewActivity {
  title: string
  kind: Kind
  schedule: Schedule
  areaId: ID | null
  notes?: string
  startDate?: DateKey
}

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

export function emptyData(): Data {
  const t = now()
  const areas: Data['areas'] = {}
  ;[['Health', 'sage'], ['Mind', 'ocean'], ['Work', 'slate'], ['Home', 'ochre'], ['People', 'rose']].forEach(([name, color], order) => {
    const id = uid()
    areas[id] = { id, name, color: color as Area['color'], order, createdAt: t, updatedAt: t }
  })
  return { version: 1, areas, activities: {}, completions: {} }
}

export const useStore = create<State>(() => ({
  data: { version: 1, areas: {}, activities: {}, completions: {} },
  theme: 'system',
  loaded: false,
  index: new Map(),
}))

function setData(fn: (d: Data) => Data) {
  useStore.setState((s) => {
    const data = fn(s.data)
    return { data, index: data.completions === s.data.completions ? s.index : buildIndex(data.completions) }
  })
}

export function replaceData(data: Data) {
  useStore.setState({ data, index: buildIndex(data.completions), loaded: true })
}

// ─── Selectors ──────────────────────────────────────────────────────────────

export const liveActivities = (d: Data) =>
  Object.values(d.activities).filter(alive).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))

export const liveAreas = (d: Data) => Object.values(d.areas).filter(alive).sort((a, b) => a.order - b.order)

// ─── Actions ────────────────────────────────────────────────────────────────

export function addActivity(input: NewActivity): ID {
  const id = uid()
  const t = now()
  const today = todayKey()
  const start = input.startDate ?? (input.schedule.type === 'once' ? minKey(today, input.schedule.date) : today)
  setData((d) => {
    const order = Math.max(-1, ...Object.values(d.activities).map((a) => a.order)) + 1
    const a: Activity = {
      id, title: input.title.trim(), kind: input.kind, schedule: input.schedule, areaId: input.areaId,
      notes: input.notes, startDate: start, order, createdAt: t, updatedAt: t, archivedAt: null, goalId: null,
    }
    return { ...d, activities: { ...d.activities, [id]: a } }
  })
  return id
}

export function updateActivity(id: ID, patch: Partial<Omit<Activity, 'id' | 'createdAt'>>) {
  setData((d) => {
    const a = d.activities[id]
    if (!a) return d
    const next = { ...a, ...patch, updatedAt: now() }
    // A one-off moved to an earlier date must still exist on that date
    if (next.schedule.type === 'once' && next.schedule.date < next.startDate) next.startDate = next.schedule.date
    return { ...d, activities: { ...d.activities, [id]: next } }
  })
}

export function setArchived(id: ID, archived: boolean) {
  updateActivity(id, { archivedAt: archived ? now() : null })
}

export function deleteActivity(id: ID) {
  const t = now()
  setData((d) => {
    const a = d.activities[id]
    if (!a) return d
    const completions = { ...d.completions }
    for (const c of Object.values(completions)) if (c.activityId === id && !c.deletedAt) completions[c.id] = { ...c, deletedAt: t, updatedAt: t }
    return { ...d, activities: { ...d.activities, [id]: { ...a, deletedAt: t, updatedAt: t } }, completions }
  })
}

/** Returns the new done-state. One-off tasks keep at most one live completion. */
export function toggleCompletion(activityId: ID, date: DateKey): boolean {
  const { data, index } = useStore.getState()
  const a = data.activities[activityId]
  const existing = a?.schedule.type === 'once' ? [...(index.get(activityId)?.values() ?? [])][0] : index.get(activityId)?.get(date)
  const t = now()
  if (existing) {
    setData((d) => ({ ...d, completions: { ...d.completions, [existing.id]: { ...existing, deletedAt: t, updatedAt: t } } }))
    return false
  }
  // Revive a tombstone for the same slot rather than growing the log on every toggle
  const tomb = Object.values(data.completions).find((c) => c.activityId === activityId && c.date === date && c.deletedAt)
  const c: Completion = tomb
    ? { ...tomb, deletedAt: null, completedAt: t, updatedAt: t }
    : { id: uid(), activityId, date, completedAt: t, createdAt: t, updatedAt: t }
  setData((d) => ({ ...d, completions: { ...d.completions, [c.id]: c } }))
  return true
}

export function addArea(name: string, color?: Area['color']): ID {
  const id = uid()
  const t = now()
  setData((d) => {
    const live = liveAreas(d)
    const used = new Set(live.map((a) => a.color))
    const c = color ?? AREA_COLORS.find((x) => !used.has(x)) ?? AREA_COLORS[live.length % AREA_COLORS.length]
    const area: Area = { id, name: name.trim(), color: c, order: live.length, createdAt: t, updatedAt: t }
    return { ...d, areas: { ...d.areas, [id]: area } }
  })
  return id
}

export function updateArea(id: ID, patch: Partial<Pick<Area, 'name' | 'color'>>) {
  setData((d) => ({ ...d, areas: { ...d.areas, [id]: { ...d.areas[id], ...patch, updatedAt: now() } } }))
}

export function deleteArea(id: ID) {
  const t = now()
  setData((d) => {
    const activities = { ...d.activities }
    for (const a of Object.values(activities)) if (a.areaId === id) activities[a.id] = { ...a, areaId: null, updatedAt: t }
    return { ...d, activities, areas: { ...d.areas, [id]: { ...d.areas[id], deletedAt: t, updatedAt: t } } }
  })
}

/** Find an area by #tag (case-insensitive prefix), or null. */
export function matchArea(d: Data, tag: string): Area | null {
  const t = tag.toLowerCase()
  const areas = liveAreas(d)
  return areas.find((a) => a.name.toLowerCase() === t) ?? areas.find((a) => a.name.toLowerCase().startsWith(t)) ?? null
}

export function setTheme(theme: Theme) {
  useStore.setState({ theme })
}

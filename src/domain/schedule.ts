import {
  addDays, diffDays, keyOfTimestamp, startOfWeek, weekday,
  formatRelative, WEEKDAY_SHORT, type DateKey,
} from './dates'
import { alive, type Activity, type Completion, type Data, type ID, type Schedule } from './types'

/** activityId → (date → completion). Built once per data change; everything else reads from it. */
export type CompletionIndex = Map<ID, Map<DateKey, Completion>>

export function buildIndex(completions: Data['completions']): CompletionIndex {
  const idx: CompletionIndex = new Map()
  for (const c of Object.values(completions)) {
    if (!alive(c)) continue
    let m = idx.get(c.activityId)
    if (!m) idx.set(c.activityId, (m = new Map()))
    m.set(c.date, c)
  }
  return idx
}

export function archiveDay(a: Activity): DateKey | null {
  return a.archivedAt ? keyOfTimestamp(a.archivedAt) : null
}

/** Whether the activity exists on this day (started, not yet archived). */
export function isActiveOn(a: Activity, day: DateKey): boolean {
  if (day < a.startDate) return false
  const arch = archiveDay(a)
  return !arch || day < arch
}

export function isScheduledOn(a: Activity, day: DateKey): boolean {
  if (!isActiveOn(a, day)) return false
  const s = a.schedule
  switch (s.type) {
    case 'once': return day === s.date
    case 'daily': return true
    case 'weekdays': return s.days.includes(weekday(day))
    case 'interval': return diffDays(day, a.startDate) % Math.max(1, s.every) === 0
    case 'weekly': return true
  }
}

/** Day-based schedules have one occurrence per scheduled day; weekly ones are measured per week. */
export const isDayBased = (s: Schedule) => s.type === 'daily' || s.type === 'weekdays' || s.type === 'interval'

/** Most recent scheduled day strictly before `before`, or null. */
export function prevOccurrence(a: Activity, before: DateKey, maxLookback = 400): DateKey | null {
  for (let i = 1; i <= maxLookback; i++) {
    const d = addDays(before, -i)
    if (d < a.startDate) return null
    if (isScheduledOn(a, d)) return d
  }
  return null
}

/** First scheduled day on/after `from`, or null. */
export function nextOccurrence(a: Activity, from: DateKey, maxLookahead = 400): DateKey | null {
  if (a.schedule.type === 'once') return a.schedule.date >= from ? a.schedule.date : null
  for (let i = 0; i <= maxLookahead; i++) {
    const d = addDays(from, i)
    if (isScheduledOn(a, d)) return d
  }
  return null
}

export function describeSchedule(s: Schedule, today?: DateKey): string {
  switch (s.type) {
    case 'once': return today ? formatRelative(s.date, today) : s.date
    case 'daily': return 'Every day'
    case 'weekdays': {
      const d = [...s.days].sort()
      if (d.length === 7) return 'Every day'
      if (d.join() === '0,1,2,3,4') return 'Weekdays'
      if (d.join() === '5,6') return 'Weekends'
      if (d.length === 1) return `Every ${WEEKDAY_SHORT[d[0]]}`
      return d.map((i) => WEEKDAY_SHORT[i]).join(', ')
    }
    case 'interval': return s.every === 2 ? 'Every other day' : `Every ${s.every} days`
    case 'weekly': return s.times === 1 ? 'Once a week' : `${s.times}× a week`
  }
}

export function weekCount(a: Activity, idx: CompletionIndex, day: DateKey): number {
  const m = idx.get(a.id)
  if (!m) return 0
  const ws = startOfWeek(day)
  let n = 0
  for (let i = 0; i < 7; i++) if (m.has(addDays(ws, i))) n++
  return n
}

export interface DayItem {
  activity: Activity
  /** Date the completion is (or would be) recorded under. */
  date: DateKey
  done: boolean
  /** A repeating/one-off task carried forward from an earlier day. */
  overdue: boolean
  /** Completed on a day the habit wasn't scheduled. */
  extra: boolean
  weekCount?: number
  weekTarget?: number
}

/**
 * Everything that belongs on a given day. Carry-forward only happens when
 * viewing today: past days show what was scheduled then, nothing more.
 */
export function itemsForDay(activities: Activity[], idx: CompletionIndex, day: DateKey, today: DateKey): DayItem[] {
  const items: DayItem[] = []
  for (const a of activities) {
    if (!alive(a)) continue
    const m = idx.get(a.id)
    const s = a.schedule
    const base = { activity: a, overdue: false, extra: false }

    if (s.type === 'once') {
      const c = m ? [...m.values()][0] : undefined
      if (c) {
        if (c.date === day) items.push({ ...base, date: day, done: true, overdue: s.date < day })
      } else if (!a.archivedAt) {
        if (s.date === day) items.push({ ...base, date: day, done: false })
        else if (day === today && s.date < today) items.push({ ...base, date: day, done: false, overdue: true })
      }
      continue
    }

    if (s.type === 'weekly') {
      if (!isActiveOn(a, day)) {
        if (m?.has(day)) items.push({ ...base, date: day, done: true, extra: true })
        continue
      }
      items.push({ ...base, date: day, done: !!m?.has(day), weekCount: weekCount(a, idx, day), weekTarget: s.times })
      continue
    }

    if (isScheduledOn(a, day)) {
      items.push({ ...base, date: day, done: !!m?.has(day) })
      continue
    }
    if (m?.has(day)) {
      items.push({ ...base, date: day, done: true, extra: true })
      continue
    }
    if (a.kind === 'task' && day === today && isActiveOn(a, day)) {
      const prev = prevOccurrence(a, day)
      if (!prev) continue
      const c = m?.get(prev)
      if (!c) items.push({ ...base, date: prev, done: false, overdue: true })
      else if (keyOfTimestamp(c.completedAt) === today) items.push({ ...base, date: prev, done: true, overdue: true })
    }
  }
  return items
}

import { addDays, diffDays, fromKey, todayKey, type DateKey } from '../domain/dates'
import { isScheduledOn } from '../domain/schedule'
import type { Activity, Completion, Data, Kind, Schedule } from '../domain/types'
import { emptyData } from './store'

// Deterministic sample dataset (~7 months) for previewing the app with history.

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Spec {
  title: string
  area: string
  kind: Kind
  schedule: Schedule
  startAgo: number
  /** Adherence as a function of progress 0..1 through the activity's life. */
  p: (x: number) => number
  hour: number
  doneToday?: boolean
}

const SPECS: Spec[] = [
  { title: 'Morning pages', area: 'Mind', kind: 'habit', schedule: { type: 'daily' }, startAgo: 210, p: () => 0.86, hour: 7, doneToday: true },
  { title: 'Exercise', area: 'Health', kind: 'habit', schedule: { type: 'weekly', times: 4 }, startAgo: 190, p: (x) => 0.3 + 0.5 * x, hour: 18 },
  { title: 'Read 20 minutes', area: 'Mind', kind: 'habit', schedule: { type: 'daily' }, startAgo: 160, p: () => 0.74, hour: 22 },
  { title: 'Meditate', area: 'Health', kind: 'habit', schedule: { type: 'weekdays', days: [0, 1, 2, 3, 4] }, startAgo: 130, p: (x) => 0.92 - 0.45 * x, hour: 7, doneToday: true },
  { title: 'Spanish practice', area: 'Mind', kind: 'habit', schedule: { type: 'weekdays', days: [0, 2, 4] }, startAgo: 95, p: () => 0.82, hour: 20 },
  { title: 'Floss', area: 'Health', kind: 'habit', schedule: { type: 'daily' }, startAgo: 70, p: (x) => 0.45 + 0.3 * x, hour: 23 },
  { title: 'Call parents', area: 'People', kind: 'habit', schedule: { type: 'weekly', times: 2 }, startAgo: 170, p: () => 0.8, hour: 19 },
  { title: 'Weekly review', area: 'Work', kind: 'task', schedule: { type: 'weekdays', days: [6] }, startAgo: 120, p: () => 0.85, hour: 17 },
  { title: 'Water the plants', area: 'Home', kind: 'task', schedule: { type: 'interval', every: 3 }, startAgo: 64, p: () => 0.9, hour: 9 },
]

const ONE_OFFS: [string, string, number, boolean][] = [
  // title, area, days from today, done?
  ['Pay electricity bill', 'Home', 0, false],
  ['Draft project proposal', 'Work', 0, true],
  ['Return library books', 'Home', -2, false],
  ['Book train tickets', 'People', 1, false],
  ['Renew passport', 'Home', 5, false],
  ['Schedule dentist appointment', 'Health', -9, true],
  ['Send invoice to client', 'Work', -4, true],
  ['Fix the leaking tap', 'Home', -16, true],
  ['Prepare quarterly report', 'Work', -23, true],
  ['Birthday gift for Maya', 'People', -31, true],
]

const WORK_TASKS = ['Review pull requests', 'Update roadmap', 'Clear inbox', 'Write meeting notes', 'Plan sprint', 'Refactor settings page']
const HOME_TASKS = ['Grocery run', 'Laundry', 'Clean the kitchen', 'Take out recycling', 'Change bedsheets']

export function demoData(today: DateKey = todayKey()): Data {
  const r = rng(42)
  const data = emptyData()
  const areaId = (name: string) => Object.values(data.areas).find((a) => a.name === name)!.id
  let n = 0
  const ts = (d: DateKey, hour: number) => {
    const dt = fromKey(d)
    dt.setHours(hour, Math.floor(r() * 50), Math.floor(r() * 60))
    if (r() < 0.25) dt.setHours(hour + (r() < 0.5 ? -1 : 1))
    return dt.toISOString()
  }
  const addActivity = (a: Omit<Activity, 'id' | 'createdAt' | 'updatedAt' | 'order'>) => {
    const id = `demo-a${n++}`
    const created = fromKey(a.startDate).toISOString()
    data.activities[id] = { ...a, id, order: n, createdAt: created, updatedAt: created }
    return data.activities[id]
  }
  const complete = (activityId: string, date: DateKey, hour: number) => {
    const id = `demo-c${n++}`
    const at = date === today && hour > new Date().getHours() ? new Date().toISOString() : ts(date, hour)
    data.completions[id] = { id, activityId, date, completedAt: at, createdAt: at, updatedAt: at } satisfies Completion
  }

  for (const s of SPECS) {
    const start = addDays(today, -s.startAgo)
    const a = addActivity({ title: s.title, kind: s.kind, schedule: s.schedule, areaId: areaId(s.area), startDate: start, archivedAt: null, goalId: null })
    for (let d = start; d < today; d = addDays(d, 1)) {
      const x = diffDays(d, start) / s.startAgo
      // a quiet stretch ~6 weeks ago, like a holiday
      const lull = diffDays(today, d) > 38 && diffDays(today, d) < 45 ? 0.35 : 1
      if (s.schedule.type === 'weekly') {
        if (r() < (s.p(x) * s.schedule.times * lull) / 7 + 0.02) complete(a.id, d, s.hour)
      } else if (isScheduledOn(a, d) && r() < s.p(x) * lull) complete(a.id, d, s.hour)
    }
    if (s.doneToday) complete(a.id, today, s.hour)
  }

  for (const [title, area, offset, done] of ONE_OFFS) {
    const date = addDays(today, offset)
    const a = addActivity({ title, kind: 'task', schedule: { type: 'once', date }, areaId: areaId(area), startDate: addDays(date, -3) > today ? today : addDays(date, -3), archivedAt: null, goalId: null })
    if (done) complete(a.id, offset > 0 ? today : date, 11)
  }

  // Background volume of small completed tasks
  for (let ago = 200; ago >= 1; ago--) {
    if (r() > 0.42) continue
    const date = addDays(today, -ago)
    const work = r() < 0.6
    const list = work ? WORK_TASKS : HOME_TASKS
    const a = addActivity({
      title: list[Math.floor(r() * list.length)], kind: 'task', schedule: { type: 'once', date },
      areaId: areaId(work ? 'Work' : 'Home'), startDate: date, archivedAt: null, goalId: null,
    })
    complete(a.id, date, work ? 15 : 12)
  }
  return data
}

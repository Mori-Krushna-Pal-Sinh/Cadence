import { addDays, days, diffDays, keyOfTimestamp, maxKey, minKey, startOfWeek, weekday, type DateKey } from './dates'
import { archiveDay, isActiveOn, isDayBased, isScheduledOn, type CompletionIndex } from './schedule'
import { alive, isRecurring, type Activity, type ID } from './types'

/**
 * Per-day ledger for one activity over [from, to].
 *   expected — occurrences that were due (fractional for flexible weekly habits)
 *   done     — expected occurrences that were completed
 *   extra    — completions beyond what was scheduled
 * Rules that keep the numbers honest rather than harsh:
 *   - today's pending occurrence is not counted as missed until the day is over
 *   - a weekly target is only "missed" once it can no longer be reached
 */
export interface Series {
  from: DateKey
  expected: number[]
  done: number[]
  extra: number[]
}

export function activitySeries(a: Activity, idx: CompletionIndex, from: DateKey, to: DateKey, today: DateKey): Series {
  const n = Math.max(0, diffDays(to, from) + 1)
  const expected = new Array<number>(n).fill(0)
  const done = new Array<number>(n).fill(0)
  const extra = new Array<number>(n).fill(0)
  const m = idx.get(a.id)
  const at = (d: DateKey) => diffDays(d, from)
  const inRange = (d: DateKey) => d >= from && d <= to

  if (a.schedule.type === 'once') {
    if (m) for (const d of m.keys()) if (inRange(d)) extra[at(d)] += 1
    return { from, expected, done, extra }
  }

  if (isDayBased(a.schedule)) {
    const end = minKey(to, today)
    for (let d = maxKey(from, a.startDate); d <= end; d = addDays(d, 1)) {
      const i = at(d)
      const has = !!m?.has(d)
      if (isScheduledOn(a, d)) {
        if (d === today && !has) continue
        expected[i] = 1
        if (has) done[i] = 1
      } else if (has) extra[i] = 1
    }
    return { from, expected, done, extra }
  }

  // Flexible weekly target
  const times = a.schedule.times
  const lastWeek = startOfWeek(minKey(to, today))
  for (let ws = startOfWeek(from); ws <= lastWeek; ws = addDays(ws, 7)) {
    const week = days(ws, addDays(ws, 6))
    const active = week.filter((d) => isActiveOn(a, d))
    if (!active.length) continue
    const target = Math.min(times, active.length)
    const doneDays = active.filter((d) => d <= today && m?.has(d))
    const counted = doneDays.slice(0, target)
    let expectedW: number
    if (addDays(ws, 6) < today) expectedW = target
    else {
      const remaining = active.filter((d) => d > today || (d === today && !m?.has(d))).length
      expectedW = counted.length + Math.max(0, target - counted.length - remaining)
    }
    for (const d of counted) if (inRange(d)) { expected[at(d)] += 1; done[at(d)] += 1 }
    for (const d of doneDays.slice(target)) if (inRange(d)) extra[at(d)] += 1
    const missed = expectedW - counted.length
    if (missed > 0) {
      const open = active.filter((d) => d <= today && !m?.has(d) && !(d === today))
      const pool = open.length ? open : active.filter((d) => d <= today && !m?.has(d))
      for (const d of pool) if (inRange(d)) expected[at(d)] += missed / pool.length
    }
  }
  return { from, expected, done, extra }
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

export interface ActivityPeriod { expected: number; done: number; extra: number; rate: number | null }

export function activityPeriod(a: Activity, idx: CompletionIndex, from: DateKey, to: DateKey, today: DateKey): ActivityPeriod {
  const s = activitySeries(a, idx, from, to, today)
  const expected = sum(s.expected)
  const done = sum(s.done)
  return { expected, done, extra: sum(s.extra), rate: expected > 0 ? done / expected : null }
}

// ─── Streaks ────────────────────────────────────────────────────────────────

export interface Run { start: DateKey; end: DateKey; length: number }
export interface Streaks { current: number; longest: number; unit: 'occurrence' | 'week'; runs: Run[] }

export function streaks(a: Activity, idx: CompletionIndex, today: DateKey): Streaks {
  const m = idx.get(a.id)
  const runs: Run[] = []
  let run: Run | null = null
  const close = () => { if (run) runs.push(run); run = null }
  const arch = archiveDay(a)
  const last = arch && arch <= today ? addDays(arch, -1) : today

  if (a.schedule.type === 'weekly') {
    const times = a.schedule.times
    let openAtEnd = false
    for (let ws = startOfWeek(a.startDate); ws <= startOfWeek(last); ws = addDays(ws, 7)) {
      const week = days(ws, addDays(ws, 6)).filter((d) => isActiveOn(a, d))
      const target = Math.min(times, week.length)
      const count = week.filter((d) => m?.has(d)).length
      const inProgress = addDays(ws, 6) >= today
      if (count >= target && target > 0) {
        const r: Run = run ?? { start: ws, end: ws, length: 0 }
        r.end = addDays(ws, 6); r.length++
        run = r
        openAtEnd = true
      } else if (!inProgress) { close(); openAtEnd = false }
    }
    const current = openAtEnd && run ? (run as Run).length : 0
    close()
    return { current, longest: Math.max(0, ...runs.map((r) => r.length)), unit: 'week', runs }
  }

  if (!isRecurring(a.schedule)) return { current: 0, longest: 0, unit: 'occurrence', runs: [] }

  let openAtEnd = false
  for (let d = a.startDate; d <= last; d = addDays(d, 1)) {
    if (!isScheduledOn(a, d)) continue
    const has = !!m?.has(d)
    if (has) {
      const r: Run = run ?? { start: d, end: d, length: 0 }
      r.end = d; r.length++
      run = r
      openAtEnd = true
    } else if (d === today) {
      // still today — the streak is alive until the day ends
    } else { close(); openAtEnd = false }
  }
  const current = openAtEnd && run ? (run as Run).length : 0
  close()
  return { current, longest: Math.max(0, ...runs.map((r) => r.length)), unit: 'occurrence', runs }
}

export function streakLabel(n: number, a: Activity): string {
  if (a.schedule.type === 'weekly') return `${n} ${n === 1 ? 'week' : 'weeks'}`
  if (a.schedule.type === 'daily') return `${n} ${n === 1 ? 'day' : 'days'}`
  return `${n} in a row`
}

// ─── Aggregates ─────────────────────────────────────────────────────────────

export interface DailyTotals {
  from: DateKey
  /** Consistency: across recurring activities. */
  expected: number[]
  done: number[]
  /** Volume: every completion dated that day (tasks, extras, everything). */
  volume: number[]
  /** Volume split by area (null = no area). */
  byArea: Map<ID | null, number[]>
}

export function dailyTotals(activities: Activity[], idx: CompletionIndex, from: DateKey, to: DateKey, today: DateKey): DailyTotals {
  const n = Math.max(0, diffDays(to, from) + 1)
  const expected = new Array<number>(n).fill(0)
  const done = new Array<number>(n).fill(0)
  const volume = new Array<number>(n).fill(0)
  const byArea = new Map<ID | null, number[]>()
  for (const a of activities) {
    if (!alive(a)) continue
    const m = idx.get(a.id)
    if (m) {
      let arr = byArea.get(a.areaId)
      for (const d of m.keys()) {
        if (d < from || d > to) continue
        if (!arr) byArea.set(a.areaId, (arr = new Array<number>(n).fill(0)))
        const i = diffDays(d, from)
        volume[i] += 1
        arr[i] += 1
      }
    }
    if (!isRecurring(a.schedule)) continue
    const s = activitySeries(a, idx, from, to, today)
    for (let i = 0; i < n; i++) { expected[i] += s.expected[i]; done[i] += s.done[i] }
  }
  return { from, expected, done, volume, byArea }
}

export function rollingRate(t: DailyTotals, window: number): (number | null)[] {
  const out: (number | null)[] = []
  let e = 0, d = 0
  for (let i = 0; i < t.expected.length; i++) {
    e += t.expected[i]; d += t.done[i]
    if (i >= window) { e -= t.expected[i - window]; d -= t.done[i - window] }
    out.push(i >= window - 1 && e > 0.0001 ? Math.min(1, d / e) : null)
  }
  return out
}

export function weekdayPattern(a: Activity, idx: CompletionIndex, from: DateKey, to: DateKey, today: DateKey) {
  const s = activitySeries(a, idx, from, to, today)
  const exp = new Array<number>(7).fill(0)
  const dn = new Array<number>(7).fill(0)
  const cnt = new Array<number>(7).fill(0)
  s.expected.forEach((e, i) => {
    const wd = weekday(addDays(from, i))
    exp[wd] += e; dn[wd] += s.done[i]; cnt[wd] += s.done[i] + s.extra[i]
  })
  return exp.map((e, i) => ({ expected: e, done: dn[i], count: cnt[i], rate: e > 0.0001 ? dn[i] / e : null }))
}

/** Hour-of-day histogram, only from same-day logs so late backfills don't skew it. */
export function timeOfDay(a: Activity, idx: CompletionIndex): number[] {
  const h = new Array<number>(24).fill(0)
  const m = idx.get(a.id)
  if (m) for (const c of m.values()) if (keyOfTimestamp(c.completedAt) === c.date) h[new Date(c.completedAt).getHours()]++
  return h
}

export function totalCompletions(a: Activity, idx: CompletionIndex): number {
  return idx.get(a.id)?.size ?? 0
}

export type Trend = 'steady' | 'building' | 'drifting' | 'new' | null

/** Neutral one-word read on a habit, from the last 30 days vs the 30 before. */
export function habitTrend(a: Activity, idx: CompletionIndex, today: DateKey) {
  const now = activityPeriod(a, idx, addDays(today, -29), today, today)
  const prev = activityPeriod(a, idx, addDays(today, -59), addDays(today, -30), today)
  let trend: Trend = null
  if (diffDays(today, a.startDate) < 14) trend = 'new'
  else if (now.rate !== null && prev.rate !== null && now.rate - prev.rate >= 0.15) trend = 'building'
  else if (now.rate !== null && prev.rate !== null && now.rate - prev.rate <= -0.15) trend = 'drifting'
  else if (now.rate !== null && now.rate >= 0.8) trend = 'steady'
  return { now, prev, trend }
}

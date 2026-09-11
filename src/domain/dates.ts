// Calendar days are local-time strings "YYYY-MM-DD" (DateKey). They sort
// lexicographically, survive JSON, and sidestep timezone/DST drift.
// Weekdays use ISO order: 0 = Monday … 6 = Sunday.

export type DateKey = string

const pad = (n: number) => String(n).padStart(2, '0')

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromKey(k: DateKey): Date {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey(now: Date = new Date()): DateKey {
  return toKey(now)
}

export function addDays(k: DateKey, n: number): DateKey {
  const d = fromKey(k)
  d.setDate(d.getDate() + n)
  return toKey(d)
}

/** Whole days from b to a (a - b). */
export function diffDays(a: DateKey, b: DateKey): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000)
}

export function weekday(k: DateKey): number {
  return (fromKey(k).getDay() + 6) % 7
}

export function startOfWeek(k: DateKey): DateKey {
  return addDays(k, -weekday(k))
}

export function endOfWeek(k: DateKey): DateKey {
  return addDays(startOfWeek(k), 6)
}

export function startOfMonth(k: DateKey): DateKey {
  return k.slice(0, 8) + '01'
}

export function endOfMonth(k: DateKey): DateKey {
  const d = fromKey(k)
  return toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function addMonths(k: DateKey, n: number): DateKey {
  const d = fromKey(startOfMonth(k))
  return toKey(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

/** Inclusive list of days from → to. Empty if from > to. */
export function days(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k)
  return out
}

export const minKey = (a: DateKey, b: DateKey) => (a < b ? a : b)
export const maxKey = (a: DateKey, b: DateKey) => (a > b ? a : b)

export function keyOfTimestamp(iso: string): DateKey {
  return toKey(new Date(iso))
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
export const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function formatDayMonth(k: DateKey): string {
  const d = fromKey(k)
  return `${d.getDate()} ${MONTH_LONG[d.getMonth()]}`
}

export function formatShort(k: DateKey): string {
  const d = fromKey(k)
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
}

export function formatMonthYear(k: DateKey): string {
  const d = fromKey(k)
  return `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`
}

/** "Today", "Yesterday", "Tomorrow", "Tue", or "3 Sep". */
export function formatRelative(k: DateKey, today: DateKey): string {
  const n = diffDays(k, today)
  if (n === 0) return 'Today'
  if (n === -1) return 'Yesterday'
  if (n === 1) return 'Tomorrow'
  if (n > 1 && n < 7) return WEEKDAY_SHORT[weekday(k)]
  if (n < -1 && n > -7) return WEEKDAY_SHORT[weekday(k)]
  return formatShort(k)
}

export function formatWeekRange(start: DateKey): string {
  const end = addDays(start, 6)
  const s = fromKey(start)
  const e = fromKey(end)
  if (s.getMonth() === e.getMonth()) return `${s.getDate()} – ${e.getDate()} ${MONTH_SHORT[e.getMonth()]}`
  return `${s.getDate()} ${MONTH_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTH_SHORT[e.getMonth()]}`
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

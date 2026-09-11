import { addDays, fromKey, startOfWeek, toKey, weekday, type DateKey } from './dates'
import type { Kind, Schedule } from './types'

export interface Parsed {
  title: string
  kind: Kind
  schedule: Schedule
  /** Raw #tag text, resolved to an area by the caller. */
  areaTag: string | null
  /** Whether the text contained an explicit schedule or date. */
  explicit: boolean
}

const DAY_RE = '(mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?'
const DAY_FULL: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
}
const DAY_ABBR: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WORD_NUM: Record<string, number> = { once: 1, twice: 2, thrice: 3 }

const dayIndex = (s: string) => DAY_ABBR[s.slice(0, 3).toLowerCase()]

/** Next date on/after `today` that falls on weekday `wd` (ISO, 0 = Mon). */
function nextWeekday(today: DateKey, wd: number, skipToday = false): DateKey {
  let n = (wd - weekday(today) + 7) % 7
  if (n === 0 && skipToday) n = 7
  return addDays(today, n)
}

/**
 * Natural-language quick add. Examples:
 *   "Read 20 min every day #mind"   → habit, daily, area "mind"
 *   "Gym 3x/week #health"           → habit, 3 times a week
 *   "Yoga every mon wed fri"        → habit, weekdays
 *   "Water plants every 3 days"     → habit, interval
 *   "Call mom tomorrow"             → task, once, tomorrow
 */
export function parseQuickAdd(input: string, today: DateKey, defaultDate: DateKey = today): Parsed {
  let text = ` ${input} `
  let schedule: Schedule | null = null
  let date: DateKey | null = null
  let areaTag: string | null = null

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = text.match(re)
    if (!m) return false
    if (fn(m) === false) return false
    text = text.replace(m[0], ' ')
    return true
  }

  take(/\s#([\p{L}\p{N}_-]+)/u, (m) => { areaTag = m[1] })

  const recurrence: [RegExp, (m: RegExpMatchArray) => Schedule | null][] = [
    [/\b(\d)\s*(?:x|×|times?)\s*(?:a|per|\/|each)?\s*(?:week|wk|w)\b/i, (m) => ({ type: 'weekly', times: clamp(+m[1], 1, 7) })],
    [/\b(\d)\s*\/\s*(?:week|wk|w)\b/i, (m) => ({ type: 'weekly', times: clamp(+m[1], 1, 7) })],
    [/\b(once|twice|thrice)\s+(?:a|per|each)\s+week\b/i, (m) => ({ type: 'weekly', times: WORD_NUM[m[1].toLowerCase()] })],
    [/\bevery\s+other\s+day\b/i, () => ({ type: 'interval', every: 2 })],
    [/\bevery\s+(\d{1,3})\s+days?\b/i, (m) => (+m[1] <= 1 ? { type: 'daily' } : { type: 'interval', every: +m[1] })],
    [/\b(?:every\s*day|everyday|daily|each\s+day)\b/i, () => ({ type: 'daily' })],
    [/\b(?:every\s+weekday|weekdays)\b/i, () => ({ type: 'weekdays', days: [0, 1, 2, 3, 4] })],
    [/\b(?:every\s+weekend|weekends)\b/i, () => ({ type: 'weekdays', days: [5, 6] })],
    [new RegExp(`\\b(?:every|each|on)\\s+(${DAY_RE}(?:\\s*(?:,|and|&|/|\\s)\\s*${DAY_RE})*)`, 'i'), (m) => {
      const found = [...m[1].matchAll(new RegExp(DAY_RE, 'gi'))].map((x) => dayIndex(x[0]))
      const unique = [...new Set(found)].sort()
      // "on friday" alone is a date, not a recurrence — handled below
      if (unique.length < 2 && !/^\s*(every|each)/i.test(m[0].trim())) return null
      return { type: 'weekdays', days: unique }
    }],
    [/\b(mon|tues|wednes|thurs|fri|satur|sun)days\b/i, (m) => ({ type: 'weekdays', days: [dayIndex(m[1])] })],
    [/\b(?:every\s+week|weekly)\b/i, () => ({ type: 'weekly', times: 1 })],
  ]
  for (const [re, fn] of recurrence) {
    if (take(re, (m) => { const s = fn(m); if (!s) return false; schedule = s })) break
  }

  if (!schedule) {
    const dates: [RegExp, (m: RegExpMatchArray) => DateKey][] = [
      [/\b(?:today|tonight)\b/i, () => today],
      [/\b(?:tomorrow|tmrw|tmr)\b/i, () => addDays(today, 1)],
      [/\bnext\s+week\b/i, () => addDays(startOfWeek(today), 7)],
      [/\bin\s+(\d{1,3})\s+days?\b/i, (m) => addDays(today, +m[1])],
      [/\b(?:on\s+)?next\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i, (m) => nextWeekday(today, dayIndex(m[1]), true)],
      [/\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, (m) => nextWeekday(today, DAY_FULL[m[1].toLowerCase()])],
      [/\bon\s+(mon|tue|wed|thu|fri|sat|sun)\b/i, (m) => nextWeekday(today, dayIndex(m[1]))],
      [new RegExp(`\\b(?:on\\s+)?(\\d{1,2})\\s+(${MONTHS.join('|')})[a-z]*\\b`, 'i'), (m) => resolveDate(today, +m[1], m[2])],
      [new RegExp(`\\b(?:on\\s+)?(${MONTHS.join('|')})[a-z]*\\s+(\\d{1,2})\\b`, 'i'), (m) => resolveDate(today, +m[2], m[1])],
    ]
    for (const [re, fn] of dates) if (take(re, (m) => { date = fn(m) })) break
  }

  let title = text.replace(/\s+/g, ' ').trim().replace(/\s+(on|at|by)$/i, '').replace(/[,;]+$/, '').trim()
  if (title) title = title[0].toUpperCase() + title.slice(1)

  const explicit = schedule !== null || date !== null
  const finalSchedule: Schedule = schedule ?? { type: 'once', date: date ?? defaultDate }
  return { title, kind: schedule ? 'habit' : 'task', schedule: finalSchedule, areaTag, explicit }
}

function resolveDate(today: DateKey, day: number, month: string): DateKey {
  const t = fromKey(today)
  const mi = MONTHS.indexOf(month.slice(0, 3).toLowerCase())
  let d = new Date(t.getFullYear(), mi, clamp(day, 1, 31))
  // A date well in the past most likely means next year
  if ((t.getTime() - d.getTime()) / 86_400_000 > 60) d = new Date(t.getFullYear() + 1, mi, clamp(day, 1, 31))
  return toKey(d)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

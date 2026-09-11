import { todayKey } from './dates'
import { buildIndex, describeSchedule } from './schedule'
import { streaks } from './stats'
import { alive, type Data } from './types'

export function toJSON(d: Data): string {
  return JSON.stringify({ app: 'cadence', exportedAt: new Date().toISOString(), ...d }, null, 2)
}

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (xs: unknown[]) => xs.map(esc).join(',')

/** One row per completion — the most useful shape for spreadsheets. */
export function completionsCSV(d: Data): string {
  const lines = [row(['date', 'completed_at', 'activity', 'kind', 'schedule', 'area', 'activity_id'])]
  const cs = Object.values(d.completions).filter(alive).sort((a, b) => a.date.localeCompare(b.date) || a.completedAt.localeCompare(b.completedAt))
  for (const c of cs) {
    const a = d.activities[c.activityId]
    if (!alive(a)) continue
    lines.push(row([c.date, c.completedAt, a.title, a.kind, describeSchedule(a.schedule), d.areas[a.areaId ?? '']?.name ?? '', a.id]))
  }
  return lines.join('\n')
}

export function activitiesCSV(d: Data): string {
  const idx = buildIndex(d.completions)
  const today = todayKey()
  const lines = [row(['id', 'title', 'kind', 'schedule', 'area', 'start_date', 'archived', 'completions', 'current_streak', 'longest_streak'])]
  for (const a of Object.values(d.activities).filter(alive)) {
    const s = streaks(a, idx, today)
    lines.push(row([
      a.id, a.title, a.kind, describeSchedule(a.schedule), d.areas[a.areaId ?? '']?.name ?? '', a.startDate,
      a.archivedAt ? 'yes' : 'no', idx.get(a.id)?.size ?? 0, s.current, s.longest,
    ]))
  }
  return lines.join('\n')
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

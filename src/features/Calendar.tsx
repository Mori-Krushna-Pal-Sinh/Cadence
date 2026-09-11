import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  addDays, addMonths, diffDays, endOfMonth, formatDayMonth, formatMonthYear, formatShort, fromKey,
  startOfMonth, startOfWeek, WEEKDAY_LETTER, WEEKDAY_LONG, weekday, type DateKey,
} from '../domain/dates'
import { dailyTotals } from '../domain/stats'
import { useStore } from '../store/store'
import { useActivities, useAreas, useToday } from '../ui/hooks'
import { HeatLegend, Heatmap, rateLevel, volumeLevels, type CellState } from '../ui/charts'
import { areaVar, hideTip, pct, Segmented, showTip } from '../ui/primitives'
import { DayList, useDayItems } from './DayList'

type Mode = 'volume' | 'consistency'

export function Calendar() {
  const today = useToday()
  const activities = useActivities()
  const index = useStore((s) => s.index)
  const [mode, setMode] = useState<Mode>('volume')
  const [selected, setSelected] = useState<DateKey>(today)
  const [month, setMonth] = useState(startOfMonth(today))

  const from = addDays(startOfWeek(today), -52 * 7)
  const t = useMemo(() => dailyTotals(activities, index, from, today, today), [activities, index, from, today])
  const level = useMemo(() => volumeLevels(t.volume), [t])

  const stats = useMemo(() => {
    const last365 = t.volume.slice(-365)
    const active = last365.filter((v) => v > 0).length
    let run = 0, best = 0, cur = 0
    t.volume.forEach((v) => { run = v > 0 ? run + 1 : 0; best = Math.max(best, run) })
    for (let i = t.volume.length - 1; i >= 0; i--) {
      if (t.volume[i] > 0) cur++
      else if (i === t.volume.length - 1) continue
      else break
    }
    return { total: last365.reduce((a, b) => a + b, 0), active, best, cur }
  }, [t])

  const cell = useCallback((d: DateKey): CellState => {
    const i = diffDays(d, from)
    if (d > today || i < 0) return { kind: 'none' }
    if (mode === 'volume') return t.volume[i] ? { kind: 'level', level: level(t.volume[i]) } : { kind: 'off' }
    const e = t.expected[i]
    if (e < 0.01) return { kind: 'off' }
    const r = t.done[i] / e
    return r > 0 ? { kind: 'level', level: rateLevel(r) } : { kind: 'missed' }
  }, [from, today, mode, t, level])

  const tip = useCallback((d: DateKey) => {
    const i = diffDays(d, from)
    if (d > today) return formatShort(d)
    const e = t.expected[i]
    return <><b>{WEEKDAY_LONG[weekday(d)].slice(0, 3)} {formatShort(d)}</b> · {t.volume[i]} done{e > 0.01 ? ` · ${pct(Math.min(1, t.done[i] / e))} of scheduled` : ''}</>
  }, [from, today, t])

  const pick = (d: DateKey) => { setSelected(d); setMonth(startOfMonth(d)) }

  return (
    <div className="page-wide calendar">
      <header className="page-head">
        <div>
          <div className="eyebrow">The last year</div>
          <h1 className="display">Calendar</h1>
        </div>
        <Segmented label="cal-mode" value={mode} onChange={setMode} options={[{ value: 'volume', label: 'Volume' }, { value: 'consistency', label: 'Consistency' }]} />
      </header>

      <section className="card">
        <dl className="cal-stats">
          <div><dt>Completions</dt><dd>{stats.total.toLocaleString()}</dd></div>
          <div><dt>Active days</dt><dd>{stats.active}</dd></div>
          <div><dt>Active run</dt><dd>{stats.cur}<small> days</small></dd></div>
          <div><dt>Longest run</dt><dd>{stats.best}<small> days</small></dd></div>
        </dl>
        <div className="scroll-x year-map">
          <Heatmap end={today} weeks={53} cell={cell} color="var(--accent)" tip={tip} onPick={pick} selected={selected} dayLabels size={13} gap={3} today={today} fit />
        </div>
        <div className="cal-foot">
          <span className="muted small">{mode === 'volume' ? 'Everything you completed each day.' : 'Share of scheduled habits and repeating tasks done. Outlined = scheduled, none done.'}</span>
          <HeatLegend color="var(--accent)" />
        </div>
      </section>

      <div className="cal-grid">
        <section className="card">
          <div className="section-head">
            <h3>{formatMonthYear(month)}</h3>
            <div className="day-nav">
              <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
              <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month" disabled={addMonths(month, 1) > today}><ChevronRight size={18} /></button>
            </div>
          </div>
          <MonthGrid month={month} today={today} selected={selected} onPick={pick} />
        </section>
        <DayPanel day={selected} today={today} />
      </div>
    </div>
  )
}

function DayPanel({ day, today }: { day: DateKey; today: DateKey }) {
  const items = useDayItems(day, today)
  const done = items.filter((i) => i.done).length
  return (
    <section className="card day-panel">
      <div className="eyebrow">{WEEKDAY_LONG[weekday(day)]}</div>
      <h3 className="display-sm">{formatDayMonth(day)}</h3>
      <p className="muted small">
        {items.length ? `${done} done${items.length - done ? ` · ${items.length - done} not done` : ''}` : 'Nothing was planned.'}
        {day < today && items.length > 0 && ' — tap to log what you did.'}
      </p>
      {items.length > 0 && <DayList items={items} day={day} today={today} compact />}
    </section>
  )
}

/** Month at a glance: intensity = volume; dots show which areas got attention. */
export function MonthGrid({ month, today, selected, onPick, compact }: {
  month: DateKey; today: DateKey; selected?: DateKey; onPick?: (d: DateKey) => void; compact?: boolean
}) {
  const activities = useActivities()
  const index = useStore((s) => s.index)
  const { list: areas, byId } = useAreas()
  const start = startOfMonth(month)
  const end = endOfMonth(month)
  const gridStart = startOfWeek(start)
  const t = useMemo(() => dailyTotals(activities, index, gridStart, addDays(gridStart, 41), today), [activities, index, gridStart, today])
  const level = useMemo(() => volumeLevels(t.volume.slice(diffDays(start, gridStart), diffDays(end, gridStart) + 1)), [t, start, end, gridStart])
  const weeks = Math.ceil((diffDays(end, gridStart) + 1) / 7)
  const areaOrder = [...areas.map((a) => a.id as string | null), null]

  return (
    <div className={`month-grid${compact ? ' compact' : ''}`}>
      {WEEKDAY_LETTER.map((l, i) => <span key={i} className="mg-wd">{l}</span>)}
      {Array.from({ length: weeks * 7 }, (_, i) => {
        const d = addDays(gridStart, i)
        const inMonth = d >= start && d <= end
        const future = d > today
        const v = t.volume[i]
        const dots = areaOrder.flatMap((id) => Array.from({ length: Math.min(4, t.byArea.get(id)?.[i] ?? 0) }, () => areaVar(byId.get(id ?? '')?.color))).slice(0, 8)
        const e = t.expected[i]
        return (
          <button
            key={d}
            className={`mg-cell mg-l${inMonth && !future ? level(v) : 0}${inMonth ? '' : ' mg-out'}${future ? ' mg-future' : ''}${d === selected ? ' mg-sel' : ''}${d === today ? ' mg-today' : ''}`}
            onClick={onPick && !future ? () => onPick(d) : undefined}
            disabled={!onPick || future}
            onMouseEnter={(ev) => inMonth && !future && showTip(ev.currentTarget.getBoundingClientRect(), <><b>{formatShort(d)}</b> · {v} done{e > 0.01 ? ` · ${pct(Math.min(1, t.done[i] / e))} of scheduled` : ''}</>)}
            onMouseLeave={hideTip}
            aria-label={`${formatShort(d)}: ${v} completed`}
          >
            <span className="mg-num">{fromKey(d).getDate()}</span>
            {!compact && inMonth && <span className="mg-dots">{dots.map((c, k) => <i key={k} style={{ background: c }} />)}</span>}
          </button>
        )
      })}
    </div>
  )
}

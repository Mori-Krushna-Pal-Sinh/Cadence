import { Archive, Pencil } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { addDays, diffDays, formatRelative, formatShort, formatTime, maxKey, WEEKDAY_LETTER, WEEKDAY_SHORT, type DateKey } from '../domain/dates'
import { describeSchedule, isActiveOn, isScheduledOn, nextOccurrence, type CompletionIndex } from '../domain/schedule'
import { activityPeriod, activitySeries, habitTrend, rollingRate, streaks, streakLabel, timeOfDay, weekdayPattern, type DailyTotals } from '../domain/stats'
import { alive, type Activity } from '../domain/types'
import { useStore } from '../store/store'
import { openDetail, openEditor, useUI } from '../store/ui'
import { useAreas, useToday } from '../ui/hooks'
import { HeatLegend, Heatmap, RateChart, type CellState } from '../ui/charts'
import { AreaDot, areaVar, Delta, hideTip, pct, Sheet, showTip } from '../ui/primitives'

export function Detail() {
  const id = useUI((s) => s.detailId)
  const a = useStore((s) => (id ? s.data.activities[id] : undefined))
  const close = useCallback(() => openDetail(null), [])
  return (
    <Sheet open={!!id && alive(a)} onClose={close} label="Activity details" width={600}>
      {a && alive(a) && <DetailBody a={a} />}
    </Sheet>
  )
}

function DetailBody({ a }: { a: Activity }) {
  const today = useToday()
  const index = useStore((s) => s.index)
  const { byId } = useAreas()
  const area = byId.get(a.areaId ?? '')
  const color = areaVar(area?.color)
  const recurring = a.schedule.type !== 'once'

  return (
    <div className="detail">
      <div className="sheet-eyebrow">
        {area && <><AreaDot color={area.color} size={7} /> {area.name} <span className="sep">·</span></>}
        {a.kind === 'habit' ? 'Habit' : recurring ? 'Repeating task' : 'Task'}
        <span className="sep">·</span>
        {describeSchedule(a.schedule, today)}
        {a.archivedAt && <span className="tag">Archived</span>}
      </div>
      <h2 className="detail-title">{a.title}</h2>
      {a.notes && <p className="detail-notes">{a.notes}</p>}

      <div className="detail-actions">
        <button className="btn btn-ghost sm" onClick={() => openEditor({ id: a.id })}><Pencil size={14} />Edit</button>
        {a.archivedAt && <span className="muted small"><Archive size={13} /> Archived — history kept</span>}
      </div>

      {recurring ? <RecurringDetail a={a} index={index} today={today} color={color} /> : <OnceDetail a={a} index={index} today={today} />}
    </div>
  )
}

function RecurringDetail({ a, index, today, color }: { a: Activity; index: CompletionIndex; today: DateKey; color: string }) {
  const s = useMemo(() => streaks(a, index, today), [a, index, today])
  const trend = useMemo(() => habitTrend(a, index, today), [a, index, today])
  const total = index.get(a.id)?.size ?? 0
  const weekly = a.schedule.type === 'weekly'
  const habit = a.kind === 'habit'

  const cell = useCallback((d: DateKey): CellState => {
    if (d > today || d < a.startDate) return { kind: 'none' }
    const has = !!index.get(a.id)?.has(d)
    if (has) return { kind: 'level', level: weekly || isScheduledOn(a, d) ? 4 : 2 }
    if (!isActiveOn(a, d)) return { kind: 'none' }
    if (!weekly && isScheduledOn(a, d) && d !== today) return { kind: 'missed' }
    return { kind: 'off' }
  }, [a, index, today, weekly])

  const tip = useCallback((d: DateKey) => {
    const c = index.get(a.id)?.get(d)
    if (c) return <><b>{formatShort(d)}</b> · done {formatTime(c.completedAt)}</>
    if (d > today || d < a.startDate) return formatShort(d)
    return <><b>{formatShort(d)}</b> · {!weekly && isScheduledOn(a, d) ? (d === today ? 'not yet' : 'not done') : 'not scheduled'}</>
  }, [a, index, today, weekly])

  const span = Math.min(180, Math.max(30, diffDays(today, a.startDate) + 1))
  const trendFrom = addDays(today, -span + 1)
  const rates = useMemo(() => {
    const from = addDays(trendFrom, -29)
    const ser = activitySeries(a, index, from, today, today)
    const totals: DailyTotals = { from, expected: ser.expected, done: ser.done, volume: [], byArea: new Map() }
    return { r30: rollingRate(totals, 30).slice(29), r7: rollingRate(totals, 7).slice(29) }
  }, [a, index, today, trendFrom])

  const pattern = useMemo(() => weekdayPattern(a, index, maxKey(a.startDate, addDays(today, -89)), today, today), [a, index, today])
  const hours = useMemo(() => timeOfDay(a, index), [a, index])
  const allTime = useMemo(() => activityPeriod(a, index, a.startDate, today, today), [a, index, today])

  const withRate = pattern.filter((p) => p.rate !== null)
  const best = withRate.length > 1 ? pattern.indexOf(withRate.reduce((x, y) => (y.rate! > x.rate! ? y : x))) : -1
  const worst = withRate.length > 1 ? pattern.indexOf(withRate.reduce((x, y) => (y.rate! < x.rate! ? y : x))) : -1
  const peakHour = hours.some(Boolean) ? hours.indexOf(Math.max(...hours)) : -1
  const weeks = Math.min(53, Math.max(18, Math.ceil((diffDays(today, a.startDate) + 7) / 7)))

  return (
    <>
      <div className="stat-grid">
        {habit && <Stat label="Current streak" value={s.current} unit={streakLabel(s.current, a).replace(/^\d+ /, '')} />}
        {habit && <Stat label="Longest" value={s.longest} unit={streakLabel(s.longest, a).replace(/^\d+ /, '')} />}
        <Stat label="Last 30 days" value={pct(trend.now.rate)} sub={<Delta value={trend.prev.rate !== null && trend.now.rate !== null ? (trend.now.rate - trend.prev.rate) * 100 : null} suffix="vs prior 30" />} />
        <Stat label="All time" value={total} unit={`done · ${pct(allTime.rate)}`} />
      </div>

      <section className="detail-section">
        <div className="section-head">
          <h3>History</h3>
          <HeatLegend color={color} />
        </div>
        <div className="scroll-x">
          <Heatmap end={today} weeks={weeks} cell={cell} color={color} tip={tip} dayLabels today={today} size={12} fit={weeks >= 30} />
        </div>
        <p className="caption">Outlined squares were scheduled but not done{weekly ? '' : ''}. Faint ones weren't scheduled.</p>
      </section>

      {habit && s.runs.length > 0 && (
        <section className="detail-section">
          <div className="section-head"><h3>Streaks</h3><span className="muted small">current vs longest</span></div>
          <StreakTimeline runs={s.runs} start={a.startDate} today={today} color={color} a={a} current={s.current} />
        </section>
      )}

      <section className="detail-section">
        <div className="section-head">
          <h3>Consistency</h3>
          <span className="legend"><i style={{ background: color }} />30-day <i style={{ background: color, opacity: 0.45 }} />7-day</span>
        </div>
        <RateChart
          from={trendFrom}
          height={150}
          series={[
            { values: rates.r7, color, label: '7-day', faint: true },
            { values: rates.r30, color, label: '30-day' },
          ]}
          tipLabel={(d, v) => <><b>{formatShort(d)}</b> · 30-day {pct(v[1])} · 7-day {pct(v[0])}</>}
        />
      </section>

      <div className="detail-two">
        <section className="detail-section">
          <div className="section-head"><h3>By weekday</h3><span className="muted small">last 90 days</span></div>
          <div className="wd-bars">
            {pattern.map((p, i) => (
              <div key={i} className="wd-col"
                onMouseEnter={(e) => showTip(e.currentTarget.getBoundingClientRect(), p.rate === null ? `${WEEKDAY_SHORT[i]} · ${p.count} done` : `${WEEKDAY_SHORT[i]} · ${Math.round(p.done)} of ${Math.round(p.expected)} (${pct(p.rate)})`)}
                onMouseLeave={hideTip}>
                <div className="wd-track"><div className="wd-fill" style={{ height: `${(p.rate ?? (p.count ? 1 : 0)) * 100}%`, background: color, opacity: p.rate === null ? 0.35 : 1 }} /></div>
                <span>{WEEKDAY_LETTER[i]}</span>
              </div>
            ))}
          </div>
          {best >= 0 && best !== worst && <p className="caption">Most reliable on {WEEKDAY_SHORT[best]}s; {WEEKDAY_SHORT[worst]}s slip most.</p>}
        </section>
        <section className="detail-section">
          <div className="section-head"><h3>Time of day</h3></div>
          <div className="hour-strip" style={{ '--c': color } as React.CSSProperties}>
            {hours.map((h, i) => (
              <i key={i} style={{ opacity: h ? 0.25 + 0.75 * (h / Math.max(...hours)) : 1 }} className={h ? 'on' : ''}
                onMouseEnter={(e) => showTip(e.currentTarget.getBoundingClientRect(), `${String(i).padStart(2, '0')}:00 · ${h}×`)} onMouseLeave={hideTip} />
            ))}
          </div>
          <div className="hour-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
          {peakHour >= 0 && <p className="caption">Usually around {fmtHour(peakHour)}.</p>}
        </section>
      </div>
    </>
  )
}

function StreakTimeline({ runs, start, today, color, a, current }: { runs: { start: DateKey; end: DateKey; length: number }[]; start: DateKey; today: DateKey; color: string; a: Activity; current: number }) {
  const span = Math.max(1, diffDays(today, start) + 1)
  const longest = Math.max(...runs.map((r) => r.length))
  const x = (d: DateKey) => (diffDays(d, start) / span) * 100
  const last = runs[runs.length - 1]
  return (
    <div className="streak-tl">
      <div className="streak-track">
        {runs.map((r) => {
          const isLongest = r.length === longest
          const isCurrent = current > 0 && r === last
          return (
            <div
              key={r.start}
              className={`streak-run${isLongest ? ' longest' : ''}${isCurrent ? ' current' : ''}`}
              style={{ left: `${x(r.start)}%`, width: `max(3px, ${x(addDays(r.end, 1)) - x(r.start)}%)`, background: color, opacity: 0.25 + 0.75 * (r.length / longest) }}
              onMouseEnter={(e) => showTip(e.currentTarget.getBoundingClientRect(), <><b>{streakLabel(r.length, a)}</b> · {formatShort(r.start)} – {formatShort(r.end)}</>)}
              onMouseLeave={hideTip}
            />
          )
        })}
      </div>
      <div className="streak-axis"><span>{formatShort(start)}</span><span>Today</span></div>
    </div>
  )
}

function OnceDetail({ a, index, today }: { a: Activity; index: CompletionIndex; today: DateKey }) {
  const c = index.get(a.id) ? [...index.get(a.id)!.values()][0] : undefined
  const next = nextOccurrence(a, today)
  return (
    <div className="stat-grid">
      <Stat label="Planned" value={a.schedule.type === 'once' ? formatRelative(a.schedule.date, today) : '—'} serif />
      <Stat label="Status" value={c ? 'Done' : next ? 'Open' : 'Open'} serif sub={c ? <span className="muted small">{formatRelative(c.date, today)} at {formatTime(c.completedAt)}</span> : undefined} />
    </div>
  )
}

function Stat({ label, value, unit, sub, serif = true }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; serif?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${serif ? ' serif' : ''}`}>{value}{unit && <span className="stat-unit">{unit}</span>}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

const fmtHour = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`)

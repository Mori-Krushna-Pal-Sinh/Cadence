import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  addDays, addMonths, diffDays, endOfMonth, formatMonthYear, formatShort, formatWeekRange, fromKey,
  minKey, startOfMonth, startOfWeek, WEEKDAY_LONG, WEEKDAY_SHORT, weekday,
} from '../domain/dates'
import { activityPeriod, dailyTotals, rollingRate } from '../domain/stats'
import { isRecurring } from '../domain/types'
import { useStore } from '../store/store'
import { openDetail } from '../store/ui'
import { useActivities, useAreas, useToday } from '../ui/hooks'
import { DayBars, RateBar, RateChart, ShareBar } from '../ui/charts'
import { AreaDot, areaVar, Delta, pct, Segmented } from '../ui/primitives'
import { MonthGrid } from './Calendar'

type Mode = 'week' | 'month'
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function Review() {
  const today = useToday()
  const [mode, setMode] = useState<Mode>('week')
  const [anchor, setAnchor] = useState(today)
  const activities = useActivities()
  const index = useStore((s) => s.index)
  const { list: areas, byId } = useAreas()

  const from = mode === 'week' ? startOfWeek(anchor) : startOfMonth(anchor)
  const to = mode === 'week' ? addDays(from, 6) : endOfMonth(anchor)
  const inProgress = from <= today && today <= to
  const future = from > today
  const prevFrom = mode === 'week' ? addDays(from, -7) : addMonths(from, -1)
  const prevFullTo = mode === 'week' ? addDays(from, -1) : endOfMonth(prevFrom)
  // Like-for-like: an in-progress period is compared with the same number of days of the previous one
  const elapsed = diffDays(minKey(to, today), from) + 1
  const prevTo = inProgress ? minKey(addDays(prevFrom, elapsed - 1), prevFullTo) : prevFullTo
  const prevLabel = mode === 'week' ? (inProgress ? 'same point last week' : 'last week') : inProgress ? 'same point last month' : 'last month'

  const r = useMemo(() => {
    const cur = dailyTotals(activities, index, from, to, today)
    const prev = dailyTotals(activities, index, prevFrom, prevTo, today)
    const rate = (t: typeof cur) => (sum(t.expected) > 0.0001 ? sum(t.done) / sum(t.expected) : null)
    const rows = activities
      .filter((a) => isRecurring(a.schedule))
      .map((a) => ({ a, now: activityPeriod(a, index, from, to, today), prev: activityPeriod(a, index, prevFrom, prevTo, today) }))
      .filter((x) => x.now.expected > 0.01 || x.prev.expected > 0.01 || x.now.extra > 0)
      .sort((x, y) => y.now.expected - x.now.expected || x.a.order - y.a.order)
    const tasksDone = activities.filter((a) => a.schedule.type === 'once').reduce((n, a) => {
      for (const d of index.get(a.id)?.keys() ?? []) if (d >= from && d <= to) n++
      return n
    }, 0)
    const extras = rows.reduce((n, x) => n + x.now.extra, 0)
    const activeDays = cur.volume.filter((v) => v > 0).length
    const busiest = cur.volume.indexOf(Math.max(...cur.volume))
    const trendEnd = minKey(to, today)
    const trendFrom = addDays(trendEnd, -89)
    const tt = dailyTotals(activities, index, addDays(trendFrom, -29), trendEnd, today)
    return {
      cur, prev, rate: rate(cur), prevRate: rate(prev), rows, tasksDone, extras, activeDays, busiest,
      volume: sum(cur.volume), prevVolume: sum(prev.volume),
      trendFrom, r30: rollingRate(tt, 30).slice(29), r7: rollingRate(tt, 7).slice(29),
    }
  }, [activities, index, from, to, prevFrom, prevTo, today])

  const areaColor = (id: string | null) => areaVar(byId.get(id ?? '')?.color)
  const areaIds = [...areas.map((a) => a.id as string | null), null]
  const n = diffDays(to, from) + 1
  const stacks = Array.from({ length: n }, (_, i) => areaIds.map((id) => ({ value: r.cur.byArea.get(id)?.[i] ?? 0, color: areaColor(id) })))
  const share = (t: typeof r.cur) => areaIds.map((id) => ({ id, label: id ? byId.get(id)!.name : 'No area', color: areaColor(id), value: sum(t.byArea.get(id) ?? []) }))
  const curShare = share(r.cur)
  const prevShare = share(r.prev)
  const doneN = Math.round(sum(r.cur.done))
  const expN = Math.round(sum(r.cur.expected))

  const step = (dir: number) => setAnchor(mode === 'week' ? addDays(from, dir * 7) : addMonths(from, dir))

  return (
    <div className="page-wide review">
      <header className="page-head">
        <div>
          <div className="eyebrow">{mode === 'week' ? (inProgress ? 'This week' : `Week of ${formatShort(from)}`) : inProgress ? 'This month' : 'Month'}</div>
          <h1 className="display">{mode === 'week' ? formatWeekRange(from) : formatMonthYear(from)}</h1>
        </div>
        <div className="head-controls">
          <Segmented label="review-mode" value={mode} onChange={(m) => { setMode(m); setAnchor(today) }} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
          <div className="day-nav">
            <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous period"><ChevronLeft size={18} /></button>
            <button className="pill-btn" onClick={() => setAnchor(today)} disabled={inProgress}>Now</button>
            <button className="icon-btn" onClick={() => step(1)} aria-label="Next period" disabled={inProgress || future}><ChevronRight size={18} /></button>
          </div>
        </div>
      </header>

      <section className="review-hero">
        <div className="hero-main">
          <div className="hero-num">{r.rate === null ? '—' : Math.round(r.rate * 100)}<span>{r.rate === null ? '' : '%'}</span></div>
          <div className="hero-text">
            <p>{r.rate === null ? 'Nothing was scheduled in this period.' : <>of what was scheduled got done{inProgress ? ' so far' : ''} — <b>{doneN} of {expN}</b>.</>}</p>
            <p><Delta value={r.rate !== null && r.prevRate !== null ? (r.rate - r.prevRate) * 100 : null} suffix={`vs ${prevLabel}`} /></p>
          </div>
        </div>
        <dl className="hero-stats">
          <div><dt>Completions</dt><dd>{r.volume}</dd><Delta value={r.prevVolume ? ((r.volume - r.prevVolume) / r.prevVolume) * 100 : null} unit="%" /></div>
          <div><dt>Tasks done</dt><dd>{r.tasksDone}</dd></div>
          <div><dt>Active days</dt><dd>{r.activeDays}<small>/{elapsed > 0 ? Math.min(n, elapsed) : n}</small></dd></div>
          <div><dt>{mode === 'week' ? 'Busiest day' : 'Extras'}</dt><dd className="dd-text">{mode === 'week' ? (r.volume ? WEEKDAY_SHORT[weekday(addDays(from, r.busiest))] : '—') : r.extras}</dd></div>
        </dl>
      </section>

      <section className="card">
        <div className="section-head"><h3>Day by day</h3><span className="muted small">completions, coloured by area</span></div>
        <DayBars
          from={from} to={to} today={today} stacks={stacks} height={mode === 'week' ? 170 : 150}
          label={(d) => (mode === 'week' ? WEEKDAY_SHORT[weekday(d)] : fromKey(d).getDate() % 5 === 1 || n <= 7 ? String(fromKey(d).getDate()) : '')}
          tip={(d, i) => {
            const e = r.cur.expected[i]
            return <><b>{WEEKDAY_LONG[weekday(d)]} {formatShort(d)}</b> · {r.cur.volume[i]} done{e > 0.01 ? ` · ${pct(Math.min(1, r.cur.done[i] / e))} of scheduled` : ''}</>
          }}
        />
        {mode === 'week' && (
          <div className="db-rates">
            {Array.from({ length: 7 }, (_, i) => {
              const e = r.cur.expected[i]
              return <span key={i}>{addDays(from, i) > today || e < 0.01 ? '' : pct(Math.min(1, r.cur.done[i] / e))}</span>
            })}
          </div>
        )}
      </section>

      <div className="review-grid">
        <section className="card">
          <div className="section-head"><h3>Activities</h3><span className="muted small">vs {prevLabel}</span></div>
          {r.rows.length ? (
            <div className="compare">
              {r.rows.map(({ a, now, prev }) => {
                const color = areaColor(a.areaId)
                const d = now.rate !== null && prev.rate !== null ? (now.rate - prev.rate) * 100 : null
                return (
                  <button key={a.id} className="compare-row" onClick={() => openDetail(a.id)}>
                    <span className="compare-name"><AreaDot color={byId.get(a.areaId ?? '')?.color} size={7} />{a.title}</span>
                    <span className="compare-val">{now.expected > 0.01 ? `${Math.round(now.done)}/${Math.round(now.expected)}` : now.extra ? `+${now.extra}` : '—'}{now.extra > 0 && now.expected > 0.01 && <small> +{now.extra}</small>}</span>
                    <RateBar rate={now.rate} prev={prev.rate} color={color} />
                    <span className="compare-delta">{d === null ? <span className="muted">{prev.expected > 0.01 ? '' : 'new'}</span> : <Delta value={d} />}</span>
                  </button>
                )
              })}
            </div>
          ) : <p className="muted small">No habits or repeating tasks were scheduled.</p>}
          <p className="caption">Bar = this period · tick = {prevLabel}.</p>
        </section>

        <section className="card">
          <div className="section-head"><h3>Where your effort went</h3></div>
          <div className="share-compare">
            <span className="muted small">{mode === 'week' ? 'This week' : 'This month'}</span>
            <ShareBar parts={curShare} />
            <span className="muted small">{prevLabel[0].toUpperCase() + prevLabel.slice(1)}</span>
            <ShareBar parts={prevShare} thin />
          </div>
          <ul className="share-legend">
            {curShare.filter((s) => s.value > 0 || prevShare.find((p) => p.id === s.id)!.value > 0).sort((a, b) => b.value - a.value).map((s) => {
              const tot = r.volume || 1
              const ptot = r.prevVolume || 1
              const p = prevShare.find((x) => x.id === s.id)!.value
              return (
                <li key={s.label}>
                  <i style={{ background: s.color }} />
                  <span className="sl-name">{s.label}</span>
                  <span className="sl-val">{s.value}</span>
                  <span className="sl-pct">{Math.round((s.value / tot) * 100)}%</span>
                  <Delta value={r.prevVolume && r.volume ? (s.value / tot - p / ptot) * 100 : null} />
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {mode === 'month' && (
        <section className="card">
          <div className="section-head"><h3>Calendar</h3><span className="muted small">darker = more done</span></div>
          <MonthGrid month={from} today={today} compact />
        </section>
      )}

      <section className="card">
        <div className="section-head">
          <h3>Consistency trend</h3>
          <span className="legend"><i style={{ background: 'var(--accent)' }} />30-day rolling <i style={{ background: 'var(--ink-3)' }} />7-day</span>
        </div>
        <RateChart
          from={r.trendFrom}
          series={[
            { values: r.r7, color: 'var(--ink-3)', label: '7-day', faint: true },
            { values: r.r30, color: 'var(--accent)', label: '30-day' },
          ]}
          tipLabel={(d, v) => <><b>{formatShort(d)}</b> · 30-day {pct(v[1])} · 7-day {pct(v[0])}</>}
        />
        <p className="caption">Share of scheduled habits and repeating tasks done, over the 90 days ending {minKey(to, today) === today ? 'today' : formatShort(to)}.</p>
      </section>
    </div>
  )
}


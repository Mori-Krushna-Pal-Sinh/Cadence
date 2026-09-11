import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { addDays, diffDays, fromKey, MONTH_SHORT, startOfWeek, type DateKey } from '../domain/dates'
import { hideTip, showTip } from './primitives'

// ─── Heatmap ────────────────────────────────────────────────────────────────

export type CellState =
  | { kind: 'none' }                  // outside the activity's life / future
  | { kind: 'off' }                   // not scheduled
  | { kind: 'missed' }                // scheduled, not done
  | { kind: 'level'; level: number }  // 1..4 intensity (or done)

/**
 * GitHub-style week-columns grid. Weeks start Monday. `cell` decides each day's
 * appearance; the colour is one CSS colour, intensity is mixed against the paper.
 */
export function Heatmap({ end, weeks, cell, color, size = 11, gap = 3, tip, onPick, selected, monthLabels = true, dayLabels = false, today, fit }: {
  end: DateKey
  weeks: number
  cell: (d: DateKey) => CellState
  color: string
  size?: number
  gap?: number
  tip?: (d: DateKey) => ReactNode
  onPick?: (d: DateKey) => void
  selected?: DateKey | null
  monthLabels?: boolean
  dayLabels?: boolean
  today?: DateKey
  /** Scale up to fill the container width (never below natural size). */
  fit?: boolean
}) {
  const start = addDays(startOfWeek(end), -(weeks - 1) * 7)
  const top = monthLabels ? 16 : 0
  const left = dayLabels ? 26 : 0
  const step = size + gap
  const w = left + weeks * step - gap
  const h = top + 7 * step - gap

  const cells = useMemo(() => {
    const out: { d: DateKey; x: number; y: number; s: CellState }[] = []
    for (let wk = 0; wk < weeks; wk++)
      for (let dy = 0; dy < 7; dy++) {
        const d = addDays(start, wk * 7 + dy)
        if (d > end) continue
        out.push({ d, x: left + wk * step, y: top + dy * step, s: cell(d) })
      }
    return out
  }, [start, end, weeks, cell, left, top, step])

  const months = useMemo(() => {
    if (!monthLabels) return []
    const out: { x: number; label: string }[] = []
    let last = -1
    for (let wk = 0; wk < weeks; wk++) {
      const d = fromKey(addDays(start, wk * 7))
      if (d.getMonth() !== last && (wk > 0 || d.getDate() <= 7)) {
        if (!out.length || left + wk * step - out[out.length - 1].x > 28) out.push({ x: left + wk * step, label: MONTH_SHORT[d.getMonth()] })
        last = d.getMonth()
      }
    }
    return out
  }, [start, weeks, monthLabels, left, step])

  return (
    <svg className="heatmap" width={fit ? undefined : w} height={fit ? undefined : h} viewBox={`0 0 ${w} ${h}`} style={{ '--hm': color, ...(fit ? { width: '100%', minWidth: w, maxWidth: w * 1.5, height: 'auto' } : {}) } as React.CSSProperties} role="img" aria-label="Activity heatmap">
      {months.map((m) => <text key={m.x} x={m.x} y={10} className="hm-label">{m.label}</text>)}
      {dayLabels && ['Mon', 'Wed', 'Fri'].map((l, i) => <text key={l} x={0} y={top + (i * 2) * step + size - 2} className="hm-label">{l}</text>)}
      {cells.map(({ d, x, y, s }) => (
        <rect
          key={d}
          x={x} y={y} width={size} height={size}
          rx={Math.min(3, size / 3.5)}
          className={`hm-cell hm-${s.kind}${s.kind === 'level' ? ` hm-l${s.level}` : ''}${d === selected ? ' hm-sel' : ''}${d === today ? ' hm-today' : ''}`}
          onMouseEnter={tip ? (e) => showTip((e.target as SVGRectElement).getBoundingClientRect(), tip(d)) : undefined}
          onMouseLeave={tip ? hideTip : undefined}
          onClick={onPick ? () => onPick(d) : undefined}
          style={onPick ? { cursor: 'pointer' } : undefined}
        />
      ))}
    </svg>
  )
}

export function HeatLegend({ color }: { color: string }) {
  return (
    <span className="hm-legend" style={{ '--hm': color } as React.CSSProperties}>
      Less
      <svg width={5 * 13} height={10} aria-hidden>
        {[0, 1, 2, 3, 4].map((l) => <rect key={l} x={l * 13} y={0} width={10} height={10} rx={2.5} className={`hm-cell ${l ? `hm-level hm-l${l}` : 'hm-off'}`} />)}
      </svg>
      More
    </span>
  )
}

/** Quantile-ish levels for a volume series so one busy day doesn't flatten the rest. */
export function volumeLevels(values: number[]): (v: number) => number {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (!nz.length) return () => 0
  const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))]
  const t = [q(0.25), q(0.5), q(0.8)]
  return (v) => (v <= 0 ? 0 : v <= t[0] ? 1 : v <= t[1] ? 2 : v <= t[2] ? 3 : 4)
}

export const rateLevel = (r: number) => (r <= 0 ? 0 : r < 0.34 ? 1 : r < 0.67 ? 2 : r < 0.99 ? 3 : 4)

// ─── Line chart (rates 0..1) ────────────────────────────────────────────────

export function RateChart({ from, series, height = 160, tipLabel }: {
  from: DateKey
  series: { values: (number | null)[]; color: string; label: string; faint?: boolean }[]
  height?: number
  tipLabel?: (d: DateKey, vals: (number | null)[]) => ReactNode
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')
  const [W, setW] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const n = series[0]?.values.length ?? 0
  const pad = { l: 34, r: 8, t: 10, b: 22 }
  const iw = W - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * iw)
  const y = (v: number) => pad.t + (1 - v) * ih

  const paths = series.map((s) => {
    let d = ''
    let area = ''
    let run: [number, number][] = []
    const flush = () => {
      if (run.length > 1) {
        d += run.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
        area += `M${x(run[0][0])},${y(0)}` + run.map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('') + `L${x(run[run.length - 1][0])},${y(0)}Z`
      }
      run = []
    }
    s.values.forEach((v, i) => (v === null ? flush() : run.push([i, v])))
    flush()
    return { d, area }
  })

  const ticks = useMemo(() => {
    const out: { i: number; label: string }[] = []
    for (let i = 0; i < n; i++) {
      const d = fromKey(addDays(from, i))
      if (d.getDate() === 1) out.push({ i, label: MONTH_SHORT[d.getMonth()] })
    }
    return out
  }, [from, n])

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((px - pad.l) / iw) * (n - 1))
    if (i < 0 || i >= n) return
    setHover(i)
    if (tipLabel) showTip({ clientX: r.left + (x(i) / W) * r.width, clientY: r.top + 8 }, tipLabel(addDays(from, i), series.map((s) => s.values[i])))
  }

  return (
    <svg
      ref={ref}
      className="rate-chart"
      viewBox={`0 0 ${W} ${height}`}
      style={{ height }}
      onMouseMove={onMove}
      onMouseLeave={() => { setHover(null); hideTip() }}
      role="img"
      aria-label={series.map((s) => s.label).join(', ')}
    >
      <defs>
        {series.map((s, k) => (
          <linearGradient key={k} id={`rg-${uid}-${k}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={s.color} stopOpacity={0.18} />
            <stop offset="1" stopColor={s.color} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid-line" />
          <text x={pad.l - 8} y={y(v) + 3.5} className="axis-label" textAnchor="end">{v * 100}%</text>
        </g>
      ))}
      {ticks.map((t) => <text key={t.i} x={x(t.i)} y={height - 6} className="axis-label" textAnchor="middle">{t.label}</text>)}
      {paths.map((p, k) => !series[k].faint && <path key={`a${k}`} d={p.area} fill={`url(#rg-${uid}-${k})`} />)}
      {paths.map((p, k) => (
        <path key={k} d={p.d} fill="none" stroke={series[k].color} strokeWidth={series[k].faint ? 1.25 : 2} strokeOpacity={series[k].faint ? 0.45 : 1} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {hover !== null && (
        <g>
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="hover-line" vectorEffect="non-scaling-stroke" />
          {series.map((s, k) => s.values[hover] !== null && (
            <circle key={k} cx={x(hover)} cy={y(s.values[hover]!)} r={3.5} fill={s.color} className="hover-dot" />
          ))}
        </g>
      )}
    </svg>
  )
}

// ─── Stacked day bars ───────────────────────────────────────────────────────

export function DayBars({ from, to, stacks, expected, today, label, tip, height = 150 }: {
  from: DateKey
  to: DateKey
  /** per day: segments bottom → top */
  stacks: { value: number; color: string }[][]
  expected?: number[]
  today: DateKey
  label: (d: DateKey, i: number) => string
  tip?: (d: DateKey, i: number) => ReactNode
  height?: number
}) {
  const n = diffDays(to, from) + 1
  const max = Math.max(1, ...stacks.map((s) => s.reduce((a, b) => a + b.value, 0)), ...(expected ?? []))
  return (
    <div className="day-bars" style={{ height, gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {Array.from({ length: n }, (_, i) => {
        const d = addDays(from, i)
        const total = stacks[i].reduce((a, b) => a + b.value, 0)
        const future = d > today
        return (
          <div
            key={d}
            className={`db-col${future ? ' db-future' : ''}${d === today ? ' db-today' : ''}`}
            onMouseEnter={tip && !future ? (e) => showTip(e.currentTarget.getBoundingClientRect(), tip(d, i)) : undefined}
            onMouseLeave={tip ? hideTip : undefined}
          >
            <div className="db-track">
              {expected && expected[i] > 0 && <div className="db-expected" style={{ height: `${(expected[i] / max) * 100}%` }} />}
              <div className="db-stack" style={{ height: `${(total / max) * 100}%` }}>
                {stacks[i].filter((s) => s.value > 0).map((s, k) => (
                  <div key={k} className="db-seg" style={{ flexGrow: s.value, background: s.color }} />
                ))}
              </div>
            </div>
            <span className="db-label">{label(d, i)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Share bar ──────────────────────────────────────────────────────────────

export function ShareBar({ parts, thin }: { parts: { value: number; color: string; label: string }[]; thin?: boolean }) {
  const total = parts.reduce((a, b) => a + b.value, 0)
  if (!total) return <div className={`share-bar${thin ? ' thin' : ''} empty`} />
  return (
    <div className={`share-bar${thin ? ' thin' : ''}`}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div
          key={p.label}
          className="share-seg"
          style={{ flexGrow: p.value, background: p.color }}
          onMouseEnter={(e) => showTip(e.currentTarget.getBoundingClientRect(), `${p.label} · ${p.value} (${Math.round((p.value / total) * 100)}%)`)}
          onMouseLeave={hideTip}
        />
      ))}
    </div>
  )
}

/** Thin rate bar used in comparison rows. */
export function RateBar({ rate, color, prev }: { rate: number | null; color: string; prev?: number | null }) {
  return (
    <div className="rate-bar">
      <div className="rate-fill" style={{ width: `${(rate ?? 0) * 100}%`, background: color }} />
      {prev !== undefined && prev !== null && <div className="rate-prev" style={{ left: `${prev * 100}%` }} />}
    </div>
  )
}

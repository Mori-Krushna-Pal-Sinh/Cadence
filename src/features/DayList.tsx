import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, formatRelative, startOfWeek, type DateKey } from '../domain/dates'
import { describeSchedule, isActiveOn, isScheduledOn, itemsForDay, type CompletionIndex, type DayItem } from '../domain/schedule'
import { streaks, streakLabel } from '../domain/stats'
import type { Activity, Area } from '../domain/types'
import { toggleCompletion, useStore } from '../store/store'
import { openDetail, toast } from '../store/ui'
import { useActivities, useAreas } from '../ui/hooks'
import { AreaDot, areaVar, Check } from '../ui/primitives'

const keyOf = (i: DayItem) => `${i.activity.id}:${i.date}`
const isSettled = (i: DayItem) => i.done || (i.weekCount !== undefined && i.weekCount >= (i.weekTarget ?? 0))

export function useDayItems(day: DateKey, today: DateKey) {
  const activities = useActivities()
  const index = useStore((s) => s.index)
  const { byId } = useAreas()
  return useMemo(() => {
    const items = itemsForDay(activities, index, day, today)
    const order = (i: DayItem) => byId.get(i.activity.areaId ?? '')?.order ?? 99
    return items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || order(a) - order(b) || a.activity.order - b.activity.order)
  }, [activities, index, day, today, byId])
}

/**
 * Tasks and habits in one list. Finished items sink to "Done" after a short
 * pause so rapid ticking never makes rows jump under the cursor.
 */
export function DayList({ items, day, today, compact }: { items: DayItem[]; day: DateKey; today: DateKey; compact?: boolean }) {
  const index = useStore((s) => s.index)
  const { byId } = useAreas()
  const [settling, setSettling] = useState<Map<string, boolean>>(new Map())
  const timers = useRef(new Map<string, number>())
  // Animate rows that appear later (new activity), not the whole list on first paint
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true }, [])

  const onToggle = (item: DayItem) => {
    const k = keyOf(item)
    const wasSettled = settling.get(k) ?? isSettled(item)
    setSettling((m) => new Map(m).set(k, wasSettled))
    clearTimeout(timers.current.get(k))
    timers.current.set(k, window.setTimeout(() => setSettling((m) => { const n = new Map(m); n.delete(k); return n }), 700))
    const before = streaks(item.activity, index, today)
    const nowDone = toggleCompletion(item.activity.id, item.date)
    if (!nowDone) return
    const a = item.activity
    const idx = useStore.getState().index
    if (a.schedule.type === 'weekly' && item.weekCount !== undefined && item.weekCount + 1 === a.schedule.times)
      toast(`${a.title} — ${a.schedule.times} of ${a.schedule.times} this week`)
    else if (a.kind === 'habit') {
      const after = streaks(a, idx, today)
      if (after.current > before.longest && after.current >= 5) toast(`${a.title} — longest streak yet: ${streakLabel(after.current, a)}`)
    }
  }

  const sorted = useMemo(() => {
    const group = (i: DayItem) => settling.get(keyOf(i)) ?? isSettled(i)
    return [...items.filter((i) => !group(i)), ...items.filter((i) => group(i))].map((i) => ({ item: i, settled: group(i) }))
  }, [items, settling])

  const doneStart = sorted.findIndex((s) => s.settled)
  const doneCount = sorted.length - (doneStart < 0 ? sorted.length : doneStart)

  return (
    <ul className={`day-list${compact ? ' compact' : ''}`}>
      {sorted.map(({ item, settled }, i) => (
        <motion.li
          key={keyOf(item)}
          layout="position"
          initial={mounted.current ? { opacity: 0, y: -6 } : false}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', bounce: 0.1, duration: 0.45 }}
          className="day-item-wrap"
        >
          {i === doneStart && (
            <div className="done-divider"><span>Done</span><span className="count">{doneCount}</span></div>
          )}
          <Row item={item} area={byId.get(item.activity.areaId ?? '')} index={index} day={day} today={today} settled={settled} onToggle={() => onToggle(item)} compact={compact} />
        </motion.li>
      ))}
    </ul>
  )
}

function Row({ item, area, index, day, today, settled, onToggle, compact }: {
  item: DayItem; area?: Area; index: CompletionIndex; day: DateKey; today: DateKey; settled: boolean; onToggle: () => void; compact?: boolean
}) {
  const a = item.activity
  const color = areaVar(area?.color)
  const future = day > today
  const weekly = item.weekTarget !== undefined
  const met = weekly && (item.weekCount ?? 0) >= (item.weekTarget ?? 0)

  return (
    <div className="row" data-done={item.done || undefined} data-settled={settled || undefined} style={{ '--c': color } as React.CSSProperties}>
      <Check
        done={item.done}
        color={color}
        onToggle={onToggle}
        segments={weekly ? item.weekTarget : undefined}
        filled={item.weekCount}
        disabled={future}
        label={`${item.done ? 'Mark not done' : 'Complete'}: ${a.title}`}
      />
      <button className="row-body" onClick={() => openDetail(a.id)}>
        <span className="row-title">{a.title}</span>
        <span className="row-meta">
          {area && <><AreaDot color={area.color} size={6} /><span>{area.name}</span></>}
          <RowMeta item={item} index={index} today={today} asOf={day < today ? day : today} met={met} />
        </span>
      </button>
      {!compact && a.kind === 'habit' && <WeekStrip a={a} index={index} day={day} today={today} color={color} />}
    </div>
  )
}

function RowMeta({ item, index, today, asOf, met }: { item: DayItem; index: CompletionIndex; today: DateKey; asOf: DateKey; met: boolean }) {
  const a = item.activity
  // streaks() walks the activity's whole life — only recompute when its inputs change
  const current = useMemo(() => (a.kind === 'habit' && item.weekTarget === undefined ? streaks(a, index, asOf).current : 0), [a, item.weekTarget, index, asOf])
  const parts: string[] = []
  if (item.overdue && a.schedule.type !== 'once') parts.push(`from ${formatRelative(item.date, today)}`)
  if (item.overdue && a.schedule.type === 'once') parts.push(`planned ${formatRelative(a.schedule.date, today)}`)
  if (item.extra) parts.push('extra')
  if (item.weekTarget !== undefined) parts.push(met ? `${item.weekCount} of ${item.weekTarget} this week ✓` : `${item.weekCount} of ${item.weekTarget} this week`)
  else if (a.kind === 'habit') {
    if (current >= 2) parts.push(streakLabel(current, a))
    else parts.push(describeSchedule(a.schedule))
  } else if (a.schedule.type !== 'once' && !item.overdue) parts.push(describeSchedule(a.schedule))
  return <>{parts.map((p) => <span key={p} className="meta-part">{p}</span>)}</>
}

/** This week at a glance: done, missed, not scheduled, still to come. */
function WeekStrip({ a, index, day, today, color }: { a: Activity; index: CompletionIndex; day: DateKey; today: DateKey; color: string }) {
  const ws = startOfWeek(day)
  const m = index.get(a.id)
  return (
    <span className="week-strip" aria-hidden style={{ '--c': color } as React.CSSProperties}>
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(ws, i)
        const has = !!m?.has(d)
        const sched = a.schedule.type === 'weekly' ? isActiveOn(a, d) : isScheduledOn(a, d)
        const state = has ? 'done' : d > today ? 'future' : d === today ? 'today' : sched && a.schedule.type !== 'weekly' ? 'missed' : 'off'
        return <i key={d} className={`ws-dot ws-${state}${d === day ? ' ws-sel' : ''}`} />
      })}
    </span>
  )
}

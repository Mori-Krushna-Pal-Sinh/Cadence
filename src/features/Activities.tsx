import { ArchiveRestore, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { addDays, formatRelative, type DateKey } from '../domain/dates'
import { describeSchedule, isActiveOn, isScheduledOn, nextOccurrence, prevOccurrence, type CompletionIndex } from '../domain/schedule'
import { habitTrend, streaks, streakLabel, type Trend } from '../domain/stats'
import type { Activity, Area } from '../domain/types'
import { setArchived, useStore } from '../store/store'
import { openDetail, openEditor, toast } from '../store/ui'
import { useActivities, useAreas, useToday } from '../ui/hooks'
import { Heatmap, type CellState } from '../ui/charts'
import { AreaDot, areaVar, pct, Segmented } from '../ui/primitives'

type Tab = 'habits' | 'tasks' | 'archived'

const TREND_LABEL: Record<Exclude<Trend, null>, string> = { steady: 'Steady', building: 'Building', drifting: 'Drifting', new: 'New' }

export function Activities() {
  const today = useToday()
  const all = useActivities()
  const index = useStore((s) => s.index)
  const { byId } = useAreas()
  const [tab, setTab] = useState<Tab>('habits')

  const habits = all.filter((a) => a.kind === 'habit' && !a.archivedAt)
  const tasks = all.filter((a) => a.kind === 'task' && !a.archivedAt)
  const archived = all.filter((a) => a.archivedAt)

  return (
    <div className="page-wide">
      <header className="page-head">
        <div>
          <div className="eyebrow">Library</div>
          <h1 className="display">Activities</h1>
        </div>
        <button className="btn btn-primary" onClick={() => openEditor({ draft: { kind: tab === 'habits' ? 'habit' : 'task', schedule: tab === 'habits' ? { type: 'daily' } : undefined } })}>
          <Plus size={16} />New
        </button>
      </header>

      <Segmented
        label="activities-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'habits', label: <>Habits <span className="count">{habits.length}</span></> },
          { value: 'tasks', label: <>Tasks <span className="count">{tasks.length}</span></> },
          { value: 'archived', label: <>Archived <span className="count">{archived.length}</span></> },
        ]}
      />

      {tab === 'habits' && <HabitList habits={habits} index={index} today={today} areas={byId} />}
      {tab === 'tasks' && <TaskList tasks={tasks} index={index} today={today} areas={byId} />}
      {tab === 'archived' && (
        archived.length ? (
          <ul className="plain-list">
            {archived.map((a) => (
              <li key={a.id} className="plain-row">
                <button className="row-body" onClick={() => openDetail(a.id)}>
                  <span className="row-title">{a.title}</span>
                  <span className="row-meta"><span className="meta-part">{a.kind === 'habit' ? 'Habit' : 'Task'}</span><span className="meta-part">{describeSchedule(a.schedule, today)}</span></span>
                </button>
                <button className="btn btn-ghost sm" onClick={() => { setArchived(a.id, false); toast(`Restored “${a.title}”`) }}><ArchiveRestore size={14} />Restore</button>
              </li>
            ))}
          </ul>
        ) : <Empty text="Nothing archived. Archiving keeps history but stops an activity from showing up." />
      )}
    </div>
  )
}

function HabitList({ habits, index, today, areas }: { habits: Activity[]; index: CompletionIndex; today: DateKey; areas: Map<string, Area> }) {
  const rows = useMemo(() => habits.map((a) => ({ a, t: habitTrend(a, index, today), s: streaks(a, index, today) }))
    .sort((x, y) => (y.t.now.rate ?? -1) - (x.t.now.rate ?? -1)), [habits, index, today])

  if (!habits.length) return <Empty text="No habits yet. Try “Read 20 minutes every day” in Today’s quick add." />

  const sticking = rows.filter((r) => r.t.trend === 'steady' || r.t.trend === 'building')
  const drifting = rows.filter((r) => r.t.trend === 'drifting')

  return (
    <>
      {(sticking.length > 0 || drifting.length > 0) && (
        <div className="insight-line">
          {sticking.length > 0 && <p><span className="insight-k">Sticking</span>{sticking.map((r) => r.a.title).join(', ')}</p>}
          {drifting.length > 0 && <p><span className="insight-k">Drifting</span>{drifting.map((r) => r.a.title).join(', ')}</p>}
        </div>
      )}
      <div className="habit-table" role="table" aria-label="Habits">
        <div className="habit-row habit-headrow" role="row">
          <span role="columnheader">Habit</span>
          <span role="columnheader" className="hide-sm">Last 16 weeks</span>
          <span role="columnheader" className="num">30 days</span>
          <span role="columnheader" className="num">Streak</span>
        </div>
        {rows.map(({ a, t, s }) => (
          <HabitRow key={a.id} a={a} index={index} today={today} area={areas.get(a.areaId ?? '')} rate={t.now.rate} prev={t.prev.rate} trend={t.trend} current={s.current} longest={s.longest} />
        ))}
      </div>
    </>
  )
}

function HabitRow({ a, index, today, area, rate, prev, trend, current, longest }: {
  a: Activity; index: CompletionIndex; today: DateKey; area?: Area; rate: number | null; prev: number | null; trend: Trend; current: number; longest: number
}) {
  const color = areaVar(area?.color)
  const weekly = a.schedule.type === 'weekly'
  const cell = useCallback((d: DateKey): CellState => {
    if (d > today || !isActiveOn(a, d)) return { kind: 'none' }
    if (index.get(a.id)?.has(d)) return { kind: 'level', level: 4 }
    if (!weekly && isScheduledOn(a, d) && d !== today) return { kind: 'missed' }
    return { kind: 'off' }
  }, [a, index, today, weekly])
  const diff = rate !== null && prev !== null ? Math.round((rate - prev) * 100) : null

  return (
    <div className="habit-row" role="row" tabIndex={0} onClick={() => openDetail(a.id)} onKeyDown={(e) => e.key === 'Enter' && openDetail(a.id)}>
      <span className="habit-name" role="cell">
        <span className="row-title">{a.title}</span>
        <span className="row-meta">
          {area && <><AreaDot color={area.color} size={6} /><span>{area.name}</span></>}
          <span className="meta-part">{describeSchedule(a.schedule)}</span>
        </span>
      </span>
      <span className="hide-sm" role="cell"><Heatmap end={today} weeks={16} cell={cell} color={color} size={9} gap={2} monthLabels={false} /></span>
      <span className="num" role="cell">
        <span className="big-num">{pct(rate)}</span>
        <span className="trend-word" data-trend={trend ?? undefined}>
          {trend ? TREND_LABEL[trend] : diff !== null && diff !== 0 ? `${diff > 0 ? '↑' : '↓'} ${Math.abs(diff)} pts` : '—'}
        </span>
      </span>
      <span className="num" role="cell">
        <span className="big-num">{current}</span>
        <span className="trend-word">best {streakLabel(longest, a)}</span>
      </span>
    </div>
  )
}

function TaskList({ tasks, index, today, areas }: { tasks: Activity[]; index: CompletionIndex; today: DateKey; areas: Map<string, Area> }) {
  const [showAll, setShowAll] = useState(false)
  const repeating = tasks.filter((a) => a.schedule.type !== 'once')
  const once = tasks.filter((a) => a.schedule.type === 'once')
  const open = once.filter((a) => !index.get(a.id)?.size).sort((x, y) => (x.schedule as { date: string }).date.localeCompare((y.schedule as { date: string }).date))
  const done = once.filter((a) => index.get(a.id)?.size).map((a) => ({ a, c: [...index.get(a.id)!.values()][0] }))
    .sort((x, y) => y.c.completedAt.localeCompare(x.c.completedAt))

  if (!tasks.length) return <Empty text="No tasks yet. Add one from Today — “Call mom tomorrow”." />

  const Title = ({ a }: { a: Activity }) => {
    const area = areas.get(a.areaId ?? '')
    return (
      <span className="row-meta">
        {area && <><AreaDot color={area.color} size={6} /><span>{area.name}</span></>}
      </span>
    )
  }

  return (
    <div className="task-sections">
      {repeating.length > 0 && (
        <section>
          <h3 className="list-head">Repeating</h3>
          <ul className="plain-list">
            {repeating.map((a) => {
              const next = nextOccurrence(a, today)
              const prev = prevOccurrence(a, today)
              const openPrev = prev && !index.get(a.id)?.has(prev) && !isScheduledOn(a, today)
              return (
                <li key={a.id} className="plain-row" onClick={() => openDetail(a.id)}>
                  <button className="row-body">
                    <span className="row-title">{a.title}</span>
                    <Title a={a} />
                  </button>
                  <span className="plain-side">
                    <span>{describeSchedule(a.schedule)}</span>
                    <span className="muted">{openPrev ? `open since ${formatRelative(prev!, today)}` : next ? (next <= addDays(today, 1) ? `due ${formatRelative(next, today).toLowerCase()}` : `next ${formatRelative(next, today)}`) : ''}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <section>
        <h3 className="list-head">Open</h3>
        {open.length ? (
          <ul className="plain-list">
            {open.map((a) => (
              <li key={a.id} className="plain-row" onClick={() => openDetail(a.id)}>
                <button className="row-body"><span className="row-title">{a.title}</span><Title a={a} /></button>
                <span className="plain-side"><span>{dueLabel((a.schedule as { date: string }).date, today)}</span></span>
              </li>
            ))}
          </ul>
        ) : <p className="muted small pad">No open one-off tasks.</p>}
      </section>
      {done.length > 0 && (
        <section>
          <h3 className="list-head">Completed <span className="count">{done.length}</span></h3>
          <ul className="plain-list">
            {(showAll ? done : done.slice(0, 8)).map(({ a, c }) => (
              <li key={a.id} className="plain-row is-done" onClick={() => openDetail(a.id)}>
                <button className="row-body"><span className="row-title">{a.title}</span><Title a={a} /></button>
                <span className="plain-side"><span className="muted">{formatRelative(c.date, today)}</span></span>
              </li>
            ))}
          </ul>
          {done.length > 8 && <button className="link-btn pad" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${done.length}`}</button>}
        </section>
      )}
    </div>
  )
}

const dueLabel = (d: DateKey, today: DateKey) => (d < today ? `since ${formatRelative(d, today)}` : formatRelative(d, today))

export function Empty({ text }: { text: string }) {
  return <div className="empty-block"><p className="muted">{text}</p></div>
}

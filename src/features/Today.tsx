import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, ChevronLeft, ChevronRight, CircleCheck, CornerDownLeft, Plus, Repeat, Sparkles } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { addDays, diffDays, formatDayMonth, formatRelative, WEEKDAY_LONG, weekday, type DateKey } from '../domain/dates'
import { parseQuickAdd } from '../domain/parse'
import { describeSchedule } from '../domain/schedule'
import type { Kind, Schedule } from '../domain/types'
import { addActivity, addArea, liveActivities, matchArea, useStore } from '../store/store'
import { openEditor, toast, useUI } from '../store/ui'
import { useToday } from '../ui/hooks'
import { AreaDot, areaVar } from '../ui/primitives'
import { DayList, useDayItems } from './DayList'

export function Today() {
  const today = useToday()
  const stored = useUI((s) => s.day)
  const day = stored ?? today
  const setDay = (d: DateKey) => useUI.setState({ day: d === today ? null : d })
  const items = useDayItems(day, today)
  const hasAny = useStore((s) => liveActivities(s.data).length > 0)
  const offset = diffDays(day, today)

  const done = items.filter((i) => i.done || (i.weekCount ?? 0) >= (i.weekTarget ?? Infinity)).length
  const left = items.length - done

  return (
    <div className="today">
      <header className="today-head">
        <div>
          <div className="eyebrow">{offset === 0 ? WEEKDAY_LONG[weekday(day)] : `${formatRelative(day, today)} · ${WEEKDAY_LONG[weekday(day)]}`}</div>
          <h1 className="display">{formatDayMonth(day)}</h1>
        </div>
        <div className="day-nav">
          <button className="icon-btn" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
          <button className="pill-btn" onClick={() => setDay(today)} disabled={offset === 0}>Today</button>
          <button className="icon-btn" onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
        </div>
      </header>

      {hasAny && items.length > 0 && (
        <div className="today-summary">
          <span>
            {left === 0 ? <em className="serif-em">Everything done.</em> : <><strong>{left}</strong> left</>}
            <span className="sep">·</span>
            <strong>{done}</strong> done
          </span>
          <Progress items={items.map((i) => ({ done: i.done || (i.weekCount ?? 0) >= (i.weekTarget ?? Infinity), color: i.activity.areaId }))} />
        </div>
      )}

      {offset < 0 && <p className="past-note">Logging for {WEEKDAY_LONG[weekday(day)]} — completions count toward that day.</p>}
      {offset > 0 && <p className="past-note">Upcoming — you can plan, but not complete, future days.</p>}

      <QuickAdd day={day} today={today} />

      {!hasAny ? <Welcome /> : items.length === 0 ? (
        <div className="empty-day">
          <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
            <circle cx="28" cy="28" r="20" fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
            <path d="M18 34h20" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="28" cy="24" r="4" fill="var(--accent)" opacity=".8" />
          </svg>
          <p className="serif-em">Nothing planned{offset === 0 ? ' for today' : ''}.</p>
          <p className="muted">{offset < 0 ? 'Added a habit recently? Set its start date in Edit to log earlier days.' : 'A clear day. Add something above if you like.'}</p>
        </div>
      ) : (
        <DayList items={items} day={day} today={today} />
      )}
    </div>
  )
}

function Progress({ items }: { items: { done: boolean; color: string | null }[] }) {
  const areas = useStore((s) => s.data.areas)
  const ordered = [...items.filter((i) => i.done), ...items.filter((i) => !i.done)]
  return (
    <div className="progress" aria-hidden>
      {ordered.map((it, i) => (
        <span key={i} className="progress-seg" data-done={it.done || undefined} style={{ '--c': areaVar(areas[it.color ?? '']?.color) } as React.CSSProperties} />
      ))}
    </div>
  )
}

// ─── Quick add ──────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Read 20 minutes every day #mind',
  'Exercise 3x/week #health',
  'Call parents twice a week #people',
  'Water the plants every 3 days #home',
  'Weekly review every sunday #work',
]

function QuickAdd({ day, today }: { day: DateKey; today: DateKey }) {
  const [text, setText] = useState('')
  const [kindOverride, setKindOverride] = useState<Kind | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const data = useStore((s) => s.data)
  const defaultDate = day >= today ? day : today

  const parsed = useMemo(() => {
    const p = parseQuickAdd(text, today, defaultDate)
    let kind = kindOverride ?? p.kind
    let schedule: Schedule = p.schedule
    if (kind === 'habit' && schedule.type === 'once') schedule = { type: 'daily' }
    if (kindOverride === 'task' && !p.explicit) kind = 'task'
    const area = p.areaTag ? matchArea(data, p.areaTag) : null
    return { ...p, kind, schedule, area }
  }, [text, today, defaultDate, kindOverride, data])

  const reset = () => { setText(''); setKindOverride(null) }

  const submit = () => {
    if (!parsed.title) return
    const areaId = parsed.area?.id ?? (parsed.areaTag ? addArea(cap(parsed.areaTag)) : null)
    const id = addActivity({ title: parsed.title, kind: parsed.kind, schedule: parsed.schedule, areaId })
    const when = parsed.schedule.type === 'once' ? formatRelative(parsed.schedule.date, today) : describeSchedule(parsed.schedule)
    toast(`Added “${parsed.title}” · ${when}`, { label: 'Edit', run: () => openEditor({ id }) })
    reset()
  }

  const more = () => {
    const areaId = parsed.area?.id ?? null
    openEditor({ draft: { title: parsed.title, kind: parsed.kind, schedule: parsed.schedule, areaId } })
    reset()
  }

  return (
    <div className="quick-add-wrap">
      <div className="quick-add" data-active={text ? true : undefined}>
        <Plus size={18} className="qa-icon" />
        <input
          id="quick-add"
          ref={ref}
          value={text}
          onChange={(e) => { setText(e.target.value); if (!e.target.value) setKindOverride(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); more() }
            else if (e.key === 'Enter') { e.preventDefault(); submit() }
            else if (e.key === 'Escape') { reset(); ref.current?.blur() }
          }}
          placeholder="Add a task or habit…"
          aria-label="Quick add"
          autoComplete="off"
          spellCheck={false}
        />
        {!text && <kbd className="qa-kbd">N</kbd>}
        {text && (
          <button className="qa-submit" onClick={submit} disabled={!parsed.title} aria-label="Add">
            <CornerDownLeft size={15} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {text && (
          <motion.div
            className="qa-preview"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="qa-chips">
              <button
                className="chip chip-kind"
                onClick={() => { setKindOverride(parsed.kind === 'habit' ? 'task' : 'habit'); ref.current?.focus() }}
                title="Switch between task and habit"
              >
                {parsed.kind === 'habit' ? <Sparkles size={13} /> : parsed.schedule.type === 'once' ? <CircleCheck size={13} /> : <Repeat size={13} />}
                {parsed.kind === 'habit' ? 'Habit' : parsed.schedule.type === 'once' ? 'Task' : 'Repeating task'}
              </button>
              <span className="chip">
                {parsed.schedule.type === 'once' ? formatRelative(parsed.schedule.date, today) : describeSchedule(parsed.schedule)}
              </span>
              {parsed.areaTag && (
                <span className="chip">
                  <AreaDot color={parsed.area?.color} size={7} />
                  {parsed.area ? parsed.area.name : <>New area “{cap(parsed.areaTag)}”</>}
                </span>
              )}
            </div>
            <div className="qa-hint">
              <span><kbd>↵</kbd> add</span>
              <button className="link-btn" onClick={more}><kbd>⇧↵</kbd> more options</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Welcome() {
  const fill = (s: string) => {
    const input = document.querySelector<HTMLInputElement>('#quick-add')
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, s)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
  }
  return (
    <motion.section className="welcome" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
      <h2 className="display-sm">Start with one thing.</h2>
      <p className="muted">
        Type it the way you'd say it. Say how often and Cadence treats it as a habit; give it a day and it's a task.
        Use <code>#area</code> to file it under an area of your life.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="suggestion" onClick={() => fill(s)}>
            {s.split(' #')[0]}
            <span className="muted"> #{s.split(' #')[1]}</span>
          </button>
        ))}
      </div>
      <a className="link-arrow" href={`?demo${location.hash}`}>Or look around with sample data <ArrowRight size={14} /></a>
    </motion.section>
  )
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

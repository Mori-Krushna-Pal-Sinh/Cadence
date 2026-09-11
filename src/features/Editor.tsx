import { Archive, ArchiveRestore, Minus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { addDays, startOfWeek, WEEKDAY_LETTER, WEEKDAY_SHORT, type DateKey } from '../domain/dates'
import type { ID, Kind, Schedule } from '../domain/types'
import { addActivity, addArea, deleteActivity, setArchived, updateActivity, useStore } from '../store/store'
import { openDetail, openEditor, toast, useUI } from '../store/ui'
import { useAreas, useToday } from '../ui/hooks'
import { AreaDot, Segmented, Sheet } from '../ui/primitives'

type SType = Schedule['type']

interface Form {
  title: string
  kind: Kind
  type: SType
  date: DateKey
  days: number[]
  every: number
  times: number
  areaId: ID | null
  notes: string
  startDate: DateKey
}

function toForm(today: DateKey, v: { title?: string; kind?: Kind; schedule?: Schedule; areaId?: ID | null; notes?: string; startDate?: DateKey }): Form {
  const s = v.schedule ?? { type: 'once', date: today }
  return {
    title: v.title ?? '',
    kind: v.kind ?? 'task',
    type: s.type,
    date: s.type === 'once' ? s.date : today,
    days: s.type === 'weekdays' ? s.days : [0, 2, 4],
    every: s.type === 'interval' ? s.every : 2,
    times: s.type === 'weekly' ? s.times : 3,
    areaId: v.areaId ?? null,
    notes: v.notes ?? '',
    startDate: v.startDate ?? today,
  }
}

function toSchedule(f: Form): Schedule {
  switch (f.type) {
    case 'once': return { type: 'once', date: f.date }
    case 'daily': return { type: 'daily' }
    case 'weekdays': return f.days.length === 7 ? { type: 'daily' } : { type: 'weekdays', days: [...f.days].sort() }
    case 'interval': return { type: 'interval', every: f.every }
    case 'weekly': return { type: 'weekly', times: f.times }
  }
}

export function Editor() {
  const editor = useUI((s) => s.editor)
  const close = () => openEditor(null)
  return (
    <Sheet open={!!editor} onClose={close} label="Edit activity" width={480}>
      {editor && <EditorForm key={'id' in editor ? editor.id : 'new'} editor={editor} onClose={close} />}
    </Sheet>
  )
}

function EditorForm({ editor, onClose }: { editor: NonNullable<ReturnType<typeof useUI.getState>['editor']>; onClose: () => void }) {
  const today = useToday()
  const existing = useStore((s) => ('id' in editor ? s.data.activities[editor.id] : undefined))
  const { list: areas } = useAreas()
  const [f, setF] = useState<Form>(() => toForm(today, existing ?? ('draft' in editor ? editor.draft : {})))
  const [newArea, setNewArea] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }))

  useEffect(() => { if (f.kind === 'habit' && f.type === 'once') set({ type: 'daily' }) }, [f.kind, f.type])

  const valid = f.title.trim().length > 0 && (f.type !== 'weekdays' || f.days.length > 0)

  const save = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!valid) return
    const payload = {
      title: f.title.trim(), kind: f.kind, schedule: toSchedule(f), areaId: f.areaId, notes: f.notes.trim() || undefined,
      ...(f.type !== 'once' ? { startDate: f.startDate } : {}),
    }
    if (existing) {
      updateActivity(existing.id, payload)
      toast('Saved')
    } else {
      addActivity(payload)
      toast(`Added “${payload.title}”`)
    }
    onClose()
  }

  const commitArea = () => {
    if (newArea?.trim()) set({ areaId: addArea(newArea) })
    setNewArea(null)
  }

  const scheduleOptions: { value: SType; label: string }[] = [
    ...(f.kind === 'task' ? [{ value: 'once' as SType, label: 'Once' }] : []),
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Days' },
    { value: 'interval', label: 'Every N' },
    { value: 'weekly', label: '× / week' },
  ]

  return (
    <form className="editor" onSubmit={save}>
      <div className="sheet-eyebrow">{existing ? 'Edit' : 'New'} {f.kind === 'habit' ? 'habit' : 'task'}</div>
      <input
        className="editor-title"
        value={f.title}
        onChange={(e) => set({ title: e.target.value })}
        placeholder={f.kind === 'habit' ? 'e.g. Read 20 minutes' : 'e.g. Renew passport'}
        data-autofocus
        aria-label="Title"
      />

      <div className="field">
        <label className="field-label">Type</label>
        <Segmented label="kind" value={f.kind} onChange={(kind) => set({ kind })} options={[{ value: 'task', label: 'Task' }, { value: 'habit', label: 'Habit' }]} />
        <p className="field-help">
          {f.kind === 'habit'
            ? 'Something you want to do consistently. Tracks streaks and how it’s sticking.'
            : 'Something to get done. Repeating tasks stay open until you finish them.'}
        </p>
      </div>

      <div className="field">
        <label className="field-label">When</label>
        <Segmented label="schedule" value={f.type} onChange={(type) => set({ type })} options={scheduleOptions} size="sm" />
        <div className="schedule-detail">
          {f.type === 'once' && (
            <div className="row-gap">
              <input type="date" className="input" value={f.date} onChange={(e) => e.target.value && set({ date: e.target.value })} aria-label="Date" />
              {[['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', addDays(startOfWeek(today), 7)]].map(([l, d]) => (
                <button type="button" key={l} className="chip" data-on={f.date === d || undefined} onClick={() => set({ date: d })}>{l}</button>
              ))}
            </div>
          )}
          {f.type === 'daily' && <p className="field-help">Every day.</p>}
          {f.type === 'weekdays' && (
            <div className="day-picker" role="group" aria-label="Days of week">
              {WEEKDAY_LETTER.map((l, i) => (
                <button
                  type="button"
                  key={i}
                  className="day-pill"
                  aria-pressed={f.days.includes(i)}
                  aria-label={WEEKDAY_SHORT[i]}
                  onClick={() => set({ days: f.days.includes(i) ? f.days.filter((d) => d !== i) : [...f.days, i] })}
                >{l}</button>
              ))}
            </div>
          )}
          {f.type === 'interval' && <Stepper prefix="Every" value={f.every} min={2} max={60} onChange={(every) => set({ every })} suffix="days" />}
          {f.type === 'weekly' && (
            <>
              <Stepper value={f.times} min={1} max={7} onChange={(times) => set({ times })} suffix={f.times === 1 ? 'time a week' : 'times a week'} />
              <p className="field-help">Any days you like. Missed only once the week can no longer reach it.</p>
            </>
          )}
        </div>
      </div>

      {f.type !== 'once' && (
        <div className="field">
          <label className="field-label" htmlFor="start">Started</label>
          <input id="start" type="date" className="input" value={f.startDate} max={today} onChange={(e) => e.target.value && set({ startDate: e.target.value })} />
          <p className="field-help">Set it earlier to log days before you added it. Nothing before this date counts.</p>
        </div>
      )}

      <div className="field">
        <label className="field-label">Area</label>
        <div className="area-picker">
          <button type="button" className="chip" data-on={f.areaId === null || undefined} onClick={() => set({ areaId: null })}>None</button>
          {areas.map((a) => (
            <button type="button" key={a.id} className="chip" data-on={f.areaId === a.id || undefined} onClick={() => set({ areaId: a.id })}>
              <AreaDot color={a.color} size={7} />{a.name}
            </button>
          ))}
          {newArea === null ? (
            <button type="button" className="chip chip-ghost" onClick={() => setNewArea('')}><Plus size={12} />New</button>
          ) : (
            <input
              className="input input-sm"
              autoFocus
              value={newArea}
              placeholder="Area name"
              onChange={(e) => setNewArea(e.target.value)}
              onBlur={commitArea}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitArea() } if (e.key === 'Escape') { e.stopPropagation(); setNewArea(null) } }}
            />
          )}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="notes">Notes</label>
        <textarea id="notes" className="input textarea" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" />
      </div>

      <div className="editor-foot">
        {existing && (
          <div className="row-gap">
            <button type="button" className="icon-btn" title={existing.archivedAt ? 'Restore' : 'Archive'} aria-label={existing.archivedAt ? 'Restore' : 'Archive'}
              onClick={() => { setArchived(existing.id, !existing.archivedAt); toast(existing.archivedAt ? 'Restored' : 'Archived — history kept'); onClose() }}>
              {existing.archivedAt ? <ArchiveRestore size={17} /> : <Archive size={17} />}
            </button>
            {confirmDelete ? (
              <button type="button" className="btn btn-danger" onClick={() => { deleteActivity(existing.id); openDetail(null); toast('Deleted'); onClose() }}>Delete forever?</button>
            ) : (
              <button type="button" className="icon-btn" title="Delete" aria-label="Delete" onClick={() => setConfirmDelete(true)}><Trash2 size={17} /></button>
            )}
          </div>
        )}
        <div className="row-gap push">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>{existing ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </form>
  )
}

function Stepper({ value, min, max, onChange, prefix, suffix }: { value: number; min: number; max: number; onChange: (n: number) => void; prefix?: string; suffix?: string }) {
  return (
    <div className="stepper">
      {prefix && <span>{prefix}</span>}
      <button type="button" className="icon-btn sm" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease"><Minus size={14} /></button>
      <span className="stepper-value">{value}</span>
      <button type="button" className="icon-btn sm" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase"><Plus size={14} /></button>
      {suffix && <span>{suffix}</span>}
    </div>
  )
}

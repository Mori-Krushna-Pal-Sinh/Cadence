import { Download, HardDrive, LogIn, LogOut, Mail, Plus, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { todayKey } from '../domain/dates'
import { activitiesCSV, completionsCSV, download, toJSON } from '../domain/export'
import { AREA_COLORS, alive, type Area } from '../domain/types'
import { signInWithGoogle, signInWithMagicLink, signOut, useAuth } from '../store/auth'
import { importData, isDemo, storageStatus } from '../store/persist'
import { addArea, deleteArea, setTheme, updateArea, useStore, type Theme } from '../store/store'
import { toast } from '../store/ui'
import { useAreas } from '../ui/hooks'
import { areaVar, Segmented } from '../ui/primitives'

export function Settings() {
  const theme = useStore((s) => s.theme)
  const data = useStore((s) => s.data)
  const authStatus = useAuth((s) => s.status)
  const { list: areas } = useAreas()
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<{ persisted: boolean; usage: number | null } | null>(null)
  const [newArea, setNewArea] = useState('')

  useEffect(() => { storageStatus().then(setStatus) }, [data])

  const counts = {
    activities: Object.values(data.activities).filter(alive).length,
    completions: Object.values(data.completions).filter(alive).length,
  }
  const stamp = todayKey()

  const onImport = async (file: File) => {
    try {
      const { mode } = importData(JSON.parse(await file.text()))
      toast(mode === 'replaced' ? 'Imported your data' : 'Merged — newer records won')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that file')
    }
  }

  return (
    <div className="page-narrow settings">
      <header className="page-head">
        <div>
          <div className="eyebrow">Preferences</div>
          <h1 className="display">Settings</h1>
        </div>
      </header>

      <Account />

      <section className="set-section">
        <h3>Appearance</h3>
        <Segmented<Theme> label="theme" value={theme} onChange={setTheme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </section>

      <section className="set-section">
        <h3>Areas of life</h3>
        <p className="muted small">Areas colour everything — heatmaps, bars, the progress line. Type <code>#name</code> in quick add to use one.</p>
        <ul className="area-list">
          {areas.map((a) => <AreaRow key={a.id} area={a} />)}
        </ul>
        <form className="row-gap" onSubmit={(e) => { e.preventDefault(); if (newArea.trim()) { addArea(newArea); setNewArea('') } }}>
          <input className="input" value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="New area" aria-label="New area name" />
          <button className="btn btn-ghost" disabled={!newArea.trim()}><Plus size={15} />Add</button>
        </form>
      </section>

      <section className="set-section">
        <h3>Your data</h3>
        <p className="muted small">
          {authStatus === 'signedIn'
            ? 'Signed in, but cloud sync isn\u2019t on yet — this data still lives only in this browser.'
            : 'Everything lives in this browser — no account, no server.'}{' '}
          {counts.activities} activities and {counts.completions.toLocaleString()} completions.
          Export regularly if it matters to you; a JSON export can be imported back here or on another device.
        </p>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => download(`cadence-${stamp}.json`, toJSON(data), 'application/json')}><Download size={15} />JSON backup</button>
          <button className="btn btn-ghost" onClick={() => download(`cadence-completions-${stamp}.csv`, completionsCSV(data), 'text/csv')}><Download size={15} />Completions CSV</button>
          <button className="btn btn-ghost" onClick={() => download(`cadence-activities-${stamp}.csv`, activitiesCSV(data), 'text/csv')}><Download size={15} />Activities CSV</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={15} />Import JSON</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} />
        </div>
        {status && (
          <p className="storage-line">
            <HardDrive size={14} />
            {isDemo ? 'Sample data is stored separately from your real data.' : status.persisted ? 'Storage is persistent — the browser won’t clear it under pressure.' : 'Storage is best-effort. The browser may ask to make it persistent after your first change.'}
            {status.usage !== null && <span className="muted"> · {(status.usage / 1024).toFixed(0)} KB used</span>}
          </p>
        )}
      </section>

      <section className="set-section">
        <h3>Sample data</h3>
        <p className="muted small">See Cadence with seven months of history. It opens in a separate sandbox and never mixes with your data.</p>
        {isDemo
          ? <a className="btn btn-ghost" href={location.pathname + '#/settings'}>Back to my data</a>
          : <a className="btn btn-ghost" href={'?demo#/today'}>Open sample data</a>}
      </section>

      <p className="colophon">Cadence · local-first · v0.1</p>
    </div>
  )
}

function Account() {
  const status = useAuth((s) => s.status)
  const email = useAuth((s) => s.email)
  const [emailInput, setEmailInput] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  if (status === 'loading') return null

  const onGoogle = async () => {
    setBusy(true)
    try { await signInWithGoogle() } catch { toast('Could not start Google sign-in') } finally { setBusy(false) }
  }

  const onMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await signInWithMagicLink(emailInput.trim())
      setSent(true)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send the link')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="set-section">
      <h3>Account</h3>
      {status === 'signedIn' ? (
        <>
          <p className="muted small">Signed in as {email}.</p>
          <button className="btn btn-ghost" onClick={() => signOut()}><LogOut size={15} />Sign out</button>
        </>
      ) : (
        <>
          <p className="muted small">Optional for now — signing in prepares your account for cloud sync in a later update. Your local data isn&rsquo;t touched by signing in.</p>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={onGoogle} disabled={busy}><LogIn size={15} />Sign in with Google</button>
          </div>
          {sent ? (
            <p className="muted small">Link sent to {emailInput} — check your inbox.</p>
          ) : (
            <form className="row-gap" onSubmit={onMagicLink}>
              <input
                className="input"
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
                aria-label="Email for magic link"
              />
              <button className="btn btn-ghost" disabled={busy || !emailInput.trim()}><Mail size={15} />Send magic link</button>
            </form>
          )}
        </>
      )}
    </section>
  )
}

function AreaRow({ area }: { area: Area }) {
  const [name, setName] = useState(area.name)
  const [confirm, setConfirm] = useState(false)
  return (
    <li className="area-row">
      <div className="swatches" role="radiogroup" aria-label={`${area.name} colour`}>
        {AREA_COLORS.map((c) => (
          <button key={c} className="swatch" role="radio" aria-checked={area.color === c} aria-label={c} style={{ background: areaVar(c) }} onClick={() => updateArea(area.id, { color: c })} />
        ))}
      </div>
      <input className="input input-inline" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== area.name && updateArea(area.id, { name: name.trim() })} aria-label="Area name" />
      {confirm
        ? <button className="btn btn-danger sm" onClick={() => deleteArea(area.id)} onBlur={() => setConfirm(false)}>Remove?</button>
        : <button className="icon-btn" onClick={() => setConfirm(true)} aria-label={`Remove ${area.name}`}><Trash2 size={15} /></button>}
    </li>
  )
}

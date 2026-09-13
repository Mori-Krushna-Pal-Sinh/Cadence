import { useState } from 'react'
import { acceptMigration, declineMigration, useMigration } from '../store/migration'
import { Sheet } from '../ui/primitives'

/**
 * Shown at most once per account, only when persist.ts detects a genuine
 * guest → signed-in transition with meaningful local data and an empty cloud
 * account (see migration.ts's maybeOfferMigration). Renders nothing otherwise.
 * Mounted once at the app root (App.tsx), so it can appear regardless of
 * which page the person is on when they sign in.
 */
export function MigrationPrompt() {
  const pending = useMigration((s) => s.pending)
  const busy = useMigration((s) => s.busy)
  const counts = useMigration((s) => s.counts)
  const [error, setError] = useState<string | null>(null)

  const onAccept = async () => {
    setError(null)
    try {
      await acceptMigration()
    } catch {
      setError('Something went wrong copying your data. Nothing was changed — you can try again.')
    }
  }

  const onDecline = () => {
    setError(null)
    declineMigration()
  }

  // Dismissing (Escape, clicking outside, the close button) counts as "Not now" —
  // but only when nothing is in flight, so an upload can't be interrupted mid-write.
  const onClose = () => { if (!busy) onDecline() }

  return (
    <Sheet open={pending} onClose={onClose} label="Copy your local data to this account?" width={440}>
      <div className="migration-prompt">
        <div className="sheet-eyebrow">Local data found</div>
        <h2 className="detail-title">Copy it to your account?</h2>
        <p className="muted small">
          This browser has planner data from before you signed in. You can copy it into your new
          account now, or leave it — either way, it stays exactly where it is on this device.
        </p>

        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Areas</div>
            <div className="stat-value">{counts.areas}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Activities</div>
            <div className="stat-value">{counts.activities}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Completions</div>
            <div className="stat-value">{counts.completions}</div>
          </div>
        </div>

        {error && <p className="muted small" role="alert">{error}</p>}

        <div className="btn-row">
          <button className="btn btn-primary" onClick={onAccept} disabled={busy} data-autofocus>
            {busy ? 'Copying…' : 'Copy to my account'}
          </button>
          <button className="btn btn-ghost" onClick={onDecline} disabled={busy}>
            Not now
          </button>
        </div>
      </div>
    </Sheet>
  )
}
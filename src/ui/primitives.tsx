import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import type { AreaColor } from '../domain/types'
import { dismissToast, useUI } from '../store/ui'
import { useMediaQuery } from './hooks'

export const areaVar = (c: AreaColor | undefined) => (c ? `var(--${c})` : 'var(--ink-3)')

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      {[0.35, 0.6, 0.85].map((o, i) => (
        <rect key={i} x={6 + i * 5.5} y="13" width="4" height="6" rx="1.5" fill="var(--bg)" opacity={o} />
      ))}
      <rect x="22.5" y="13" width="4" height="6" rx="1.5" fill="var(--accent)" />
    </svg>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', label }: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  label?: string
}) {
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="seg-opt"
          onClick={() => onChange(o.value)}
        >
          {o.value === value && <motion.span layoutId={`seg-${label}`} className="seg-pill" transition={{ type: 'spring', bounce: 0.18, duration: 0.4 }} />}
          <span className="seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Sheet({ open, onClose, children, label, width = 520 }: {
  open: boolean
  onClose: () => void
  children: ReactNode
  label: string
  width?: number
}) {
  const mobile = useMediaQuery('(max-width: 720px)')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    addEventListener('keydown', onKey)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus() ?? ref.current?.focus())
    return () => { removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <div className="sheet-root">
          <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className="sheet"
            style={mobile ? undefined : { width }}
            initial={mobile ? { y: '100%' } : { x: 40, opacity: 0 }}
            animate={mobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={mobile ? { y: '100%' } : { x: 40, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.38 }}
          >
            <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ─── Check ──────────────────────────────────────────────────────────────────

/** The one-tap completion control. Weekly habits show their target as ring segments. */
export function Check({ done, color, onToggle, segments, filled = 0, disabled, label }: {
  done: boolean
  color: string
  onToggle: () => void
  segments?: number
  filled?: number
  disabled?: boolean
  label: string
}) {
  // Burst only when the user completes it — not when an already-done row mounts
  const [burst, setBurst] = useState(false)
  const prev = useRef(done)
  useEffect(() => {
    if (done && !prev.current) { setBurst(true); const t = setTimeout(() => setBurst(false), 600); prev.current = done; return () => clearTimeout(t) }
    prev.current = done
  }, [done])
  const r = 10
  const c = 2 * Math.PI * r
  const gap = segments && segments > 1 ? 3.2 : 0
  const seg = segments ? c / segments - gap : c
  return (
    <button
      type="button"
      className="check"
      data-done={done || undefined}
      data-burst={burst || undefined}
      aria-pressed={done}
      aria-label={label}
      disabled={disabled}
      style={{ '--c': color } as React.CSSProperties}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
        <circle className="check-fill" cx="12" cy="12" r={r} />
        {segments && segments > 1 ? (
          Array.from({ length: segments }, (_, i) => (
            <circle
              key={i}
              className="check-ring"
              data-on={i < filled || undefined}
              cx="12" cy="12" r={r}
              strokeDasharray={`${seg} ${c - seg}`}
              strokeDashoffset={-(i * (seg + gap)) + c / 4}
            />
          ))
        ) : (
          <circle className="check-ring" cx="12" cy="12" r={r} />
        )}
        <path className="check-mark" d="M7.6 12.3l3 3 5.8-6.2" pathLength={1} />
      </svg>
      <span className="check-burst" />
    </button>
  )
}

export function AreaDot({ color, size = 8 }: { color?: AreaColor; size?: number }) {
  return <span className="area-dot" style={{ background: areaVar(color), width: size, height: size }} />
}

// ─── Tooltip (one shared floating tooltip for all charts) ───────────────────

interface Tip { x: number; y: number; content: ReactNode }
export const useTip = create<{ tip: Tip | null }>(() => ({ tip: null }))
export const showTip = (e: { clientX: number; clientY: number } | DOMRect, content: ReactNode) => {
  const r = 'width' in e ? e : null
  useTip.setState({ tip: { x: r ? r.left + r.width / 2 : (e as MouseEvent).clientX, y: r ? r.top : (e as MouseEvent).clientY, content } })
}
export const hideTip = () => useTip.setState({ tip: null })

export function TooltipLayer() {
  const tip = useTip((s) => s.tip)
  if (!tip) return null
  const left = Math.min(Math.max(tip.x, 90), innerWidth - 90)
  return (
    <div className="tip" style={{ left, top: tip.y }} role="tooltip">
      {tip.content}
    </div>
  )
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
          >
            <span>{t.text}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { t.action!.run(); dismissToast(t.id) }}>{t.action.label}</button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function Delta({ value, unit = 'pts', suffix }: { value: number | null; unit?: string; suffix?: string }) {
  if (value === null || !isFinite(value)) return null
  const v = Math.round(value)
  if (v === 0) return <span className="delta delta-flat">no change{suffix ? ` ${suffix}` : ''}</span>
  return (
    <span className={`delta ${v > 0 ? 'delta-up' : 'delta-down'}`}>
      {v > 0 ? '↑' : '↓'} {Math.abs(v)}{unit === '%' ? '%' : ` ${unit}`}{suffix ? ` ${suffix}` : ''}
    </span>
  )
}

export const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`)
export const fmtNum = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, ''))

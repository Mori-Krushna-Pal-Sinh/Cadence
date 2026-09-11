import { create } from 'zustand'
import type { DateKey } from '../domain/dates'
import type { ID } from '../domain/types'
import type { NewActivity } from './store'

// Ephemeral UI state (never persisted).

export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

interface UIState {
  detailId: ID | null
  /** null = closed; { id } = edit; { draft } = create with prefilled values. */
  editor: null | { id: ID } | { draft: Partial<NewActivity> }
  toasts: Toast[]
  /** Day shown in Today (for logging past days). */
  day: DateKey | null
}

export const useUI = create<UIState>(() => ({ detailId: null, editor: null, toasts: [], day: null }))

export const openDetail = (id: ID | null) => useUI.setState({ detailId: id })
export const openEditor = (e: UIState['editor']) => useUI.setState({ editor: e })

let tid = 0
export function toast(text: string, action?: Toast['action']) {
  const id = ++tid
  useUI.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action }] }))
  setTimeout(() => dismissToast(id), 4200)
}
export const dismissToast = (id: number) => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))

import type { DateKey } from './dates'

export type ID = string

/**
 * One model for everything you do. Behaviour comes from `kind` + `schedule`:
 *   task  + once       → one-off task
 *   task  + recurring  → repeating task (an open occurrence carries forward until done)
 *   habit + recurring  → habit (consistency + streak semantics; misses stay misses)
 */
export type Kind = 'task' | 'habit'

export type Schedule =
  | { type: 'once'; date: DateKey }
  | { type: 'daily' }
  /** Specific weekdays, 0 = Monday … 6 = Sunday. */
  | { type: 'weekdays'; days: number[] }
  /** Every N days, anchored at the activity's startDate. */
  | { type: 'interval'; every: number }
  /** Flexible: any days, N times per ISO week. */
  | { type: 'weekly'; times: number }

/** Every record carries sync metadata so a future sync layer can merge per record (LWW + tombstones). */
export interface Meta {
  id: ID
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export const AREA_COLORS = ['sage', 'ocean', 'ember', 'plum', 'ochre', 'rose', 'teal', 'slate'] as const
export type AreaColor = (typeof AREA_COLORS)[number]

export interface Area extends Meta {
  name: string
  color: AreaColor
  order: number
}

export interface Activity extends Meta {
  title: string
  notes?: string
  kind: Kind
  schedule: Schedule
  areaId: ID | null
  /** First day the activity exists; nothing before it counts as missed. */
  startDate: DateKey
  archivedAt?: string | null
  /** Reserved for goals (V2): a goal will aggregate activities. */
  goalId?: ID | null
  order: number
}

export interface Completion extends Meta {
  activityId: ID
  /** The occurrence this completion counts for (supports logging a past day). */
  date: DateKey
  /** When the user actually marked it done. */
  completedAt: string
}

export interface Data {
  version: 1
  areas: Record<ID, Area>
  activities: Record<ID, Activity>
  completions: Record<ID, Completion>
}

export const isRecurring = (s: Schedule) => s.type !== 'once'
export const alive = <T extends Meta>(r: T | undefined): r is T => !!r && !r.deletedAt

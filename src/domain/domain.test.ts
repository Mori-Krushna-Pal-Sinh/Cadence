import { describe, expect, it } from 'vitest'
import { addDays, diffDays, startOfWeek, weekday } from './dates'
import { parseQuickAdd } from './parse'
import { buildIndex, itemsForDay, isScheduledOn } from './schedule'
import { activityPeriod, streaks } from './stats'
import type { Activity, Completion, Data, Schedule } from './types'

// 2026-09-10 is a Thursday
const TODAY = '2026-09-10'

function act(schedule: Schedule, over: Partial<Activity> = {}): Activity {
  return {
    id: 'a', title: 'T', kind: 'habit', schedule, areaId: null, startDate: '2026-08-01', order: 0,
    createdAt: '', updatedAt: '', ...over,
  }
}

function idx(activityId: string, dates: string[], completedAt?: (d: string) => string) {
  const completions: Data['completions'] = {}
  dates.forEach((d, i) => {
    const c: Completion = {
      id: `c${i}`, activityId, date: d, completedAt: completedAt?.(d) ?? `${d}T08:00:00`, createdAt: '', updatedAt: '',
    }
    completions[c.id] = c
  })
  return buildIndex(completions)
}

describe('dates', () => {
  it('weekday is ISO (Mon = 0)', () => {
    expect(weekday(TODAY)).toBe(3)
    expect(startOfWeek(TODAY)).toBe('2026-09-07')
  })
  it('diffDays across DST-free local keys', () => {
    expect(diffDays('2026-03-30', '2026-03-28')).toBe(2)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('schedule', () => {
  it('interval anchors at startDate', () => {
    const a = act({ type: 'interval', every: 3 }, { startDate: '2026-09-01' })
    expect(isScheduledOn(a, '2026-09-01')).toBe(true)
    expect(isScheduledOn(a, '2026-09-04')).toBe(true)
    expect(isScheduledOn(a, '2026-09-05')).toBe(false)
    expect(isScheduledOn(a, '2026-08-29')).toBe(false)
  })
  it('weekdays', () => {
    const a = act({ type: 'weekdays', days: [0, 2, 4] })
    expect(isScheduledOn(a, '2026-09-07')).toBe(true) // Mon
    expect(isScheduledOn(a, '2026-09-08')).toBe(false) // Tue
  })
})

describe('streaks', () => {
  it('daily: today pending does not break the streak', () => {
    const a = act({ type: 'daily' })
    const i = idx('a', ['2026-09-07', '2026-09-08', '2026-09-09'])
    expect(streaks(a, i, TODAY).current).toBe(3)
  })
  it('daily: a missed yesterday resets current, keeps longest', () => {
    const a = act({ type: 'daily' })
    const i = idx('a', ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08', TODAY])
    const s = streaks(a, i, TODAY)
    expect(s.current).toBe(1)
    expect(s.longest).toBe(4)
  })
  it('weekdays: unscheduled days neither break nor extend', () => {
    const a = act({ type: 'weekdays', days: [0, 2, 4] }) // Mon Wed Fri
    const i = idx('a', ['2026-09-02', '2026-09-04', '2026-09-06', '2026-09-07', '2026-09-09'])
    expect(streaks(a, i, TODAY).current).toBe(4)
  })
  it('weekly: counts consecutive weeks meeting target; current week in progress is grace', () => {
    const a = act({ type: 'weekly', times: 2 }, { startDate: '2026-08-17' })
    const i = idx('a', ['2026-08-17', '2026-08-19', '2026-08-25', '2026-08-27', '2026-09-01', '2026-09-03'])
    const s = streaks(a, i, TODAY)
    expect(s.unit).toBe('week')
    expect(s.current).toBe(3)
  })
})

describe('period stats', () => {
  it('weekly target is only missed once it is unreachable', () => {
    const a = act({ type: 'weekly', times: 3 })
    // Thu, 0 done this week, 4 days left (Thu..Sun) → nothing missed yet
    expect(activityPeriod(a, idx('a', []), '2026-09-07', '2026-09-13', TODAY).expected).toBe(0)
    // 5x/week with 4 days left → 1 already unreachable
    const b = act({ type: 'weekly', times: 5 })
    expect(activityPeriod(b, idx('a', []), '2026-09-07', '2026-09-13', TODAY).expected).toBe(1)
  })
  it('extras beyond weekly target are counted separately', () => {
    const a = act({ type: 'weekly', times: 2 })
    const p = activityPeriod(a, idx('a', ['2026-08-31', '2026-09-01', '2026-09-02']), '2026-08-31', '2026-09-06', TODAY)
    expect(p).toMatchObject({ expected: 2, done: 2, extra: 1, rate: 1 })
  })
  it('daily rate excludes today while pending', () => {
    const a = act({ type: 'daily' }, { startDate: '2026-09-07' })
    const p = activityPeriod(a, idx('a', ['2026-09-07', '2026-09-09']), '2026-09-07', '2026-09-13', TODAY)
    expect(p).toMatchObject({ expected: 3, done: 2 })
  })
})

describe('day items', () => {
  it('repeating task carries forward an open occurrence to today', () => {
    const a = act({ type: 'weekdays', days: [1] }, { kind: 'task' }) // Tue
    const items = itemsForDay([a], idx('a', []), TODAY, TODAY)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ date: '2026-09-08', overdue: true, done: false })
  })
  it('habits do not carry forward', () => {
    const a = act({ type: 'weekdays', days: [1] })
    expect(itemsForDay([a], idx('a', []), TODAY, TODAY)).toHaveLength(0)
  })
  it('overdue one-off task shows today; completion lands on the day it was done', () => {
    const a = act({ type: 'once', date: '2026-09-05' }, { kind: 'task' })
    expect(itemsForDay([a], idx('a', []), TODAY, TODAY)[0]).toMatchObject({ overdue: true, date: TODAY })
    expect(itemsForDay([a], idx('a', [TODAY]), TODAY, TODAY)[0]).toMatchObject({ done: true })
  })
  it('weekly habit shows progress this week', () => {
    const a = act({ type: 'weekly', times: 3 })
    const it0 = itemsForDay([a], idx('a', ['2026-09-07', '2026-09-08']), TODAY, TODAY)[0]
    expect(it0).toMatchObject({ weekCount: 2, weekTarget: 3, done: false })
  })
})

describe('quick add parser', () => {
  const p = (s: string) => parseQuickAdd(s, TODAY)
  it('daily habit with area', () => {
    expect(p('Read 20 min every day #mind')).toMatchObject({ title: 'Read 20 min', kind: 'habit', schedule: { type: 'daily' }, areaTag: 'mind' })
  })
  it('times per week', () => {
    expect(p('gym 3x/week').schedule).toEqual({ type: 'weekly', times: 3 })
    expect(p('Run 2 times a week').schedule).toEqual({ type: 'weekly', times: 2 })
    expect(p('Call grandma twice a week').schedule).toEqual({ type: 'weekly', times: 2 })
  })
  it('specific weekdays', () => {
    expect(p('Yoga every mon, wed and fri')).toMatchObject({ title: 'Yoga', schedule: { type: 'weekdays', days: [0, 2, 4] } })
    expect(p('Piano on tuesdays').schedule).toEqual({ type: 'weekdays', days: [1] })
    expect(p('Stretch weekdays').schedule).toEqual({ type: 'weekdays', days: [0, 1, 2, 3, 4] })
  })
  it('every N days', () => {
    expect(p('Water plants every 3 days').schedule).toEqual({ type: 'interval', every: 3 })
    expect(p('Floss every other day').schedule).toEqual({ type: 'interval', every: 2 })
  })
  it('one-off dates', () => {
    expect(p('Call mom tomorrow')).toMatchObject({ title: 'Call mom', kind: 'task', schedule: { type: 'once', date: '2026-09-11' } })
    expect(p('Dentist on friday').schedule).toEqual({ type: 'once', date: '2026-09-11' })
    expect(p('Pay rent 15 sep').schedule).toEqual({ type: 'once', date: '2026-09-15' })
    expect(p('Buy milk')).toMatchObject({ kind: 'task', schedule: { type: 'once', date: TODAY }, explicit: false })
  })
  it('does not eat ordinary words', () => {
    expect(p('Sun salutations').title).toBe('Sun salutations')
    expect(p('Plan weekend trip').title).toBe('Plan weekend trip')
  })
})

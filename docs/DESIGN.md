# Cadence — design notes

## Product principle

Help the user understand their own behaviour; never judge it. Numbers always carry their denominator ("3 of 5 this week"), deltas are neutral in colour (down is grey, not red), misses are outlined squares rather than red crosses, and there is no confetti — only a quiet toast when a weekly target is met or a longest-ever streak is passed.

## One model: Activity

```ts
Activity   { id, title, kind: 'task' | 'habit', schedule, areaId, startDate, archivedAt, goalId?, order, …meta }
Schedule = once{date} | daily | weekdays{days[]} | interval{every} | weekly{times}
Completion { id, activityId, date, completedAt, …meta }
Area       { id, name, color, order, …meta }
meta     = createdAt, updatedAt, deletedAt   // per-record LWW + tombstones → sync-ready
```

| | kind | schedule | behaviour |
|---|---|---|---|
| One-off task | task | once | Rolls into Today while overdue; completion lands on the day it was actually done |
| Repeating task | task | recurring | An unfinished occurrence carries forward to Today until done or superseded by the next one |
| Habit | habit | recurring | Consistency + streaks; a miss stays a miss (no carry-forward) |

`goalId` is reserved: a goal will be a set of activities, and every stats function already takes an activity set.

## Semantics decisions

- **Occurrence date vs timestamp.** `date` is the occurrence a completion counts for; `completedAt` is when it was logged. Backfilling yesterday doesn't fake a timestamp, and the time-of-day chart ignores late logs.
- **Today is never a miss.** A pending occurrence today doesn't count against rates and doesn't break a streak until the day ends.
- **Weekly targets ("3× a week")** are missed only once they become unreachable. Streaks for them are counted in weeks.
- **Extras.** Completing a habit on an unscheduled day is logged and shown, but neither breaks nor extends the streak.
- **Rates** only include recurring activities. One-off tasks count toward volume ("what did I do") but not consistency.
- **Comparisons are like-for-like.** An in-progress week is compared with the same number of days of last week.
- **Start date.** Nothing before an activity's start counts. Setting it earlier in the editor is how you log days before you added it.
- **Archive** stops an activity counting from the archive day and keeps its history. Delete tombstones it and its completions.
- **Known V1 limit:** editing a schedule applies retroactively. The proper fix is versioned schedules (`scheduleHistory[]`), deferred.

## Architecture

```
src/domain/   pure TS — dates, schedule engine, streaks, stats, quick-add parser, export (unit-tested)
src/store/    zustand store (all data in memory) + IndexedDB persistence + sample data
src/ui/       primitives (Check, Sheet, Segmented, Tooltip) + hand-built SVG charts
src/features/ Today, Activities, Detail, Editor, Review, Calendar, Settings
```

- **Local-first.** The whole dataset lives in memory (10 years × 20 habits ≈ 70k completions — small), so every derived stat is synchronous. Writes are debounced to IndexedDB, flushed on tab hide, and other tabs reload via BroadcastChannel. `navigator.storage.persist()` is requested after the first write.
- **Sync later** can merge per record by `updatedAt` with tombstones. `merge()` in `store/persist.ts` is exactly that rule and is already used by JSON import.
- **No chart library.** Hand-built SVG keeps the look coherent and the bundle small.
- **No backend, no Next.js, no Electron.** Nothing here needs a server. If file-system backups matter later, wrap it in Tauri.

## Visual direction: Almanac

Three directions were considered:

1. **Almanac** (chosen) — warm paper, ink, Instrument Serif numerals, earthy area palette, heatmaps as ink density. Dark mode is warm lamplight charcoal.
2. **Instrument** — Linear/Raycast-style dark precision tool. Fast but cold, and drifts toward dashboard.
3. **Soft Glass** — pastel gradients and frosted panels. Friendly but risks childish, and gradients fight the data.

Almanac fits "understand, don't judge": serif numerals make "3 of 5 this week" read like a journal entry rather than a KPI, and neutral paper lets area colours carry the information. From Instrument it borrows keyboard speed and tabular figures.

Tokens live in `src/styles/tokens.css`. Fonts are self-hosted via fontsource (no network calls).

## Next

1. Versioned schedules (so schedule edits don't rewrite history)
2. PWA manifest + service worker (installable, offline)
3. Goals as activity sets with progress
4. Optional sync (per-record LWW over any backend)

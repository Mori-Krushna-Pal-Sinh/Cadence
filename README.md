# Cadence

A local-first personal productivity app built around one **Activity** model. Tasks and habits live in the same Today list; what differs is their behaviour, not their data structure.

```
npm install
npm run dev        # http://localhost:5188
npm test           # domain unit tests (vitest)
npm run build      # typecheck + production build
```

Open `http://localhost:5188/?demo` to explore with ~7 months of sample history. Sample data is stored under a separate key and never touches your real data.

## What it answers

| Question | Where |
|---|---|
| What do I need to do today? | **Today** — tasks + habits in one list, one-tap completion, natural-language quick add (`N`) |
| What have I actually been doing? | **Calendar** — year heatmap (volume / consistency), month grid, click a day to see or log it |
| How consistent am I? Am I improving? | **Review** — scheduled-vs-done for the week/month, delta vs the same point last period, rolling 7/30-day trend |
| Which habits are sticking? | **Activities** — 16-week strip per habit, 30-day rate, trend word (Steady / Building / Drifting) |
| Where is my effort going? | **Review** — area share this period vs last |
| Longer-term behaviour of one habit | **Detail sheet** — year heatmap, streak history, weekday pattern, time of day |

## Quick add syntax

```
Read 20 minutes every day #mind      → habit, daily, area Mind
Gym 3x/week #health                  → habit, 3 times a week (any days)
Yoga every mon, wed and fri          → habit, specific weekdays
Water the plants every 3 days        → habit, every N days
Call mom tomorrow #people            → task, one-off, tomorrow
Pay rent 15 sep                      → task, one-off, 15 Sep
```

Recurring text defaults to a habit; click the chip in the preview to make it a repeating task. `⇧↵` opens the full editor.

## Keyboard

`N` or `/` quick add · `1`–`4` switch views · `Esc` close sheets · `←` / `→` buttons step days in Today.

## Data

Everything is stored in this browser's IndexedDB. Settings → **JSON backup** (restorable via **Import JSON**), **Completions CSV**, **Activities CSV**. See [docs/DESIGN.md](docs/DESIGN.md) for the model and the decisions behind it.

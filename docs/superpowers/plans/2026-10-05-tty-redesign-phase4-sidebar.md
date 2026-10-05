# TTY Redesign — Phase 4 (Sidebar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Activity Bar sidebar with the TTY design from the sidebar mockup: a colour carrot header, the streak, today against the target with a meter and a 24-cell day tape, lines, a 7-day eighth-block column graph with project keys, today's projects as a split bar and list, and "open dashboard", with hover focus on a project. Also change the status bar text to `$(rabbithole-carrot) 3h40m / 20m`.

**Architecture:** `miniPanel.ts` becomes a thin shell: static markup, the dashboard's CSP, and `style.css` plus a small `mini.css`. A second webview bundle, `src/webview/mini.ts`, draws everything. Every number comes from one pure module, `miniModel.ts`, built on `model.ts` (`daySlice`, `seriesFor`, `targetMetAt`). It reuses the dashboard's `tape.ts`, `crt.ts`, `tooltip.ts`, `focus.ts` and `carrot.ts` unchanged. The host sends one `mini` message: the `year` payload and today's log for every project. It rebuilds that message on every 10-second tick while the sidebar is visible, and on `ready`, on becoming visible, and on a settings change. Because the sidebar never merges updates itself, a wipe, an import or midnight can't leave it stale for longer than one tick.

**Tech Stack:** TypeScript, VS Code `WebviewViewProvider`, esbuild (second entry point), `node:test` + `node:assert` through `scripts/test.js`, Martian Mono (the bundled variable woff2).

**Spec:** `docs/superpowers/specs/2026-10-04-tty-redesign-design.md`. Phase 4 covers §4.1 (sidebar) and §4.2 (status bar). The visual reference for every detail this plan doesn't spell out is `docs/design/mockups/sidebar.html` (v2). Read both before starting. Phases 1–3 built the modules this one reuses; their plans are in `docs/superpowers/plans/`.

## Global Constraints

- No new runtime dependencies.
- Never import `vscode` or `src/shared/config.ts` from `src/webview/*`. Type-only imports from `src/shared/types.ts` are fine.
- **No webview module touches `document` or `window` at import time.** Only the entry points (`main.ts`, `mini.ts`) run code on load.
- Day keys are local time: use `dayKey()` (`model.ts`) and `addDaysKey()` / `fromKey()` (`format.ts`). Never use `toISOString().slice(0, 10)` or `new Date("YYYY-MM-DD")`.
- The sidebar's CSP is the dashboard's: `default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};`. No nonce and no inline scripts.
- One font: Martian Mono, bundled. No network at runtime.
- Palettes are the dashboard's fixed tokens: phosphor (dark), paper (light) and high contrast, keyed on VS Code's body classes in `style.css`. Projects take `--c1…--c6` by registry order (`projectColor`). There is no host-hue tinting.
- CRT: the same layers, the same `rabbithole.crt.*` settings and the same rules as the dashboard (light themes get half the strength, high contrast gets none).
- Narrow sidebars (below 230 px) show 7 streak days instead of 14, drop the graph axis, hide every other hour label and drop the percentages.
- Status bar: `$(rabbithole-carrot) <today> / <target>` for all projects against the global target, green (`#22c55e`) while actively tracking. Times are floored, never rounded up. The 🥕 emoji is removed.
- House style: TypeScript, 2-space indent, no semicolons, double quotes. Comments say why, not what.
- Tests run through `scripts/test.js`, and new suites are registered in its `SUITES` array. Every task ends with `npm test`, `npm run typecheck` and `npm run build` passing.
- Commit messages are plain sentence case, with no `feat:`-style prefix and **no `Co-Authored-By` lines**. This is the user's rule and overrides any harness default.
- A negative control is required wherever a task changes existing behaviour, per `CLAUDE.md`. That means running the new test against the pre-change source and seeing it fail. The temp copy lives inside `src/`, next to the original, and is deleted afterwards.

## Deviations from the spec, decided while planning

1. **The whole year plus today's logs every 10 s, and no live merge.** The spec says the sidebar's data is "`year` plus today's per-project logs, refreshed every 10 s". This plan does exactly that and nothing cleverer: one `mini` message, rebuilt each tick, sent only while the view is visible. The dashboard merges `live` ticks into a cached year. The sidebar doesn't need to, so it can't drift after a wipe, an import, a target change or midnight.
2. **The status bar names `$(rabbithole-carrot)` now, but the icon arrives in phase 5.** Phase 5 registers the icon font (`contributes.icons`). Until then VS Code draws an unknown icon id as an empty glyph, so on this branch the status bar shows a blank space before the time for one phase.
3. **The sidebar's tape is coloured by project, as in the mockup.** The dashboard's tape is coloured by language. The sidebar is about where today's time went across projects.
4. **The sidebar loads `style.css` plus `mini.css`.** The theme tokens, panels, tape, tooltip and CRT layers are shared rather than copied. `mini.css` holds only the sidebar's layout.
5. **The brand line shows the current project, without a git branch.** The mockup shows `rabbit-hole · accurate-line-counts`, but no payload carries the branch. The dashboard dropped it for the same reason (phase 2, deviation 4).
6. **Today's streak mark follows the dashboard: `◆` when today's target is met, `◇` before.** The mockup always draws `◆`.
7. **The narrow rules are `@media (max-width: 230px)`, not container queries.** A webview's viewport *is* the sidebar.
8. **The phase 2 leftovers go:** `miniTheme.ts`, `derivePalette.ts`, `PressStart2P.woff2`, `UnicaOne-Regular.woff2`, `Electrolize-Regular.ttf` and its licence `OFL.txt`. `storage.getGlobalActiveSeries` becomes unused but stays, because this redesign makes no storage changes.
9. **`Mark` and `recentMarks` move into `model.ts`.** The export card and the sidebar both draw the last 14 days, so `exportModel.ts` now uses the shared function.

## Review Focus

1. **A brand-new install.** With no projects, an all-zero year and no logs, the sidebar must show zeros and "no activity yet today", never `NaN` or a throw. Test in Task 2.
2. **A focused project that disappears.** If the project is cleared, or a refresh no longer lists it, the sidebar falls back to all projects rather than showing a nameless project. Test in Task 2.
3. **The same day everywhere in one message.** The year's `today` and the date of every log in a `mini` payload must be the same day, even across midnight. Test in Task 3.
4. **A hidden sidebar costs nothing, and a shown one is current.** No `mini` is built while the view is collapsed or covered. Showing it again sends fresh data at once. This is wiring in `extension.ts` and `miniPanel.ts`, checked by hand in Task 4 and listed for the Extension Development Host pass.
5. **Narrow and long.** At 200 px, the narrow rules apply. A 60-character project name ellipsizes in the list, the keys and the brand line instead of widening the sidebar. Checked in the sidebar harness in Task 4.

---

## File map

| File | Status | Job |
|---|---|---|
| `src/shared/statusText.ts` | create | the status bar text (pure) |
| `src/extension.ts` | modify | status bar text, sidebar wiring, ticks only while visible |
| `src/webview/model.ts` | modify | `Mark`, `recentMarks` |
| `src/webview/exportModel.ts` | modify | uses `recentMarks` |
| `src/webview/miniModel.ts` | create | every sidebar number (pure) |
| `src/shared/types.ts` | modify | `MiniPayload`, `MiniMessage`, the `mini` message |
| `src/dashboard/payloads.ts` | modify | `buildMini` |
| `src/dashboard/messageHandler.ts` | modify | `Poster`; `sendSettings` takes any poster |
| `src/dashboard/miniHandler.ts` | create | `handleMiniMessage`, `postMini`, `onMiniConfigChanged` |
| `src/dashboard/miniPanel.ts` | replace | the thin shell |
| `src/webview/mini.ts` | create | the sidebar's entry point: wiring and drawing |
| `src/webview/mini.css` | create | the sidebar's layout |
| `src/webview/miniTheme.ts`, `derivePalette.ts`, `fonts/PressStart2P.woff2`, `fonts/UnicaOne-Regular.woff2`, `fonts/Electrolize-Regular.ttf`, `fonts/OFL.txt` | delete | replaced |
| `package.json`, `scripts/copy-assets.js`, `scripts/watch.js`, `scripts/test.js` | modify | the `mini.ts` entry, the `mini.css` copy, new suites |
| `test/helpers/exportFixtures.ts` | modify | `todayLogs()` |
| `test/shared.statusText.test.ts`, `test/webview.mini.test.ts`, `test/dashboard.mini.test.ts` | create | suites |
| `test/dashboard.payloads.test.ts` | modify | the `buildMini` test |
| `test/harness/sidebar.js`, `test/harness/sidebarStub.ts` | create | the sidebar in a browser |

---

### Task 1: Status bar text

**Files:**
- Create: `src/shared/statusText.ts`
- Modify: `src/extension.ts` (`formatDuration` and the `refreshStatusBar` body), `scripts/test.js`
- Test: `test/shared.statusText.test.ts`

**Interfaces:**
- Produces: `statusText(activeMs: number, targetMs: number): string`.

- [ ] **Step 1: Write the failing test**

Register in `scripts/test.js` (append to `SUITES`):

```js
  {
    name: "status",
    entry: "test/shared.statusText.test.ts",
    alias: { statusText: "src/shared/statusText.ts" },
  },
```

Create `test/shared.statusText.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/shared/statusText.ts
import { statusText } from "statusText"

const MIN = 60_000

describe("status bar text", () => {
  it("shows today's active time against the target, behind the carrot", () => {
    assert.strictEqual(statusText(220 * MIN + 59_000, 20 * MIN), "$(rabbithole-carrot) 3h40m / 20m")
  })

  it("never rounds up to time not yet reached", () => {
    assert.strictEqual(statusText(59_999, 20 * MIN), "$(rabbithole-carrot) 0m / 20m")
    assert.strictEqual(statusText(61 * MIN, 90 * MIN), "$(rabbithole-carrot) 1h01m / 1h30m")
  })
})
```

Run: `node scripts/test.js --suite status`
Expected: FAIL. `src/shared/statusText.ts` can't be resolved.

- [ ] **Step 2: Write `src/shared/statusText.ts`**

```ts
// The status bar item: all projects' active time today against the global
// target. $(rabbithole-carrot) is the carrot from the icon font that phase 5
// registers; until then VS Code draws it as an empty glyph. Pure: no vscode.

// Floored: the status bar must never claim a minute that hasn't happened yet.
const dur = (ms: number): string => {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`
}

export function statusText(activeMs: number, targetMs: number): string {
  return `$(rabbithole-carrot) ${dur(activeMs)} / ${dur(targetMs)}`
}
```

Run: `node scripts/test.js --suite status`
Expected: PASS, 2 tests.

- [ ] **Step 3: Use it in `extension.ts`**

Add `import { statusText } from "./shared/statusText"`, delete the local `formatDuration` function, and replace the body of `refreshStatusBar`:

```ts
  const refreshStatusBar = () => {
    statusBar.text = statusText(storage.getGlobalToday().activeTime, getDailyTargetMs())
    statusBar.color = tracker.isActivelyTracking ? "#22c55e" : undefined
  }
```

Run: `grep -n "formatDuration\|🥕" src/extension.ts`
Expected: no hits.

- [ ] **Step 4: Gate and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add src/shared/statusText.ts src/extension.ts test/shared.statusText.test.ts scripts/test.js
git commit -m "Show the status bar as the carrot icon and today's time against the target, without the emoji"
```

---

### Task 2: The sidebar model

**Files:**
- Create: `src/webview/miniModel.ts`
- Modify: `src/webview/model.ts` (add `Mark`, `recentMarks`), `src/webview/exportModel.ts` (use them), `test/helpers/exportFixtures.ts` (add `todayLogs`), `scripts/test.js`
- Test: `test/webview.mini.test.ts`; `test/webview.exportData.test.ts` (unchanged, guards the refactor)

**Interfaces:**
- Consumes: `daySlice`, `seriesFor`, `storedStreak`, `targetMetAt`, `Series`, `ActivitySession` (model.ts); `meter` (layout.ts); `HOUR`, `weekday` (format.ts).
- Produces:

```ts
// model.ts
export type Mark = "met" | "miss" | "today"
export function recentMarks(s: Series, n: number): Mark[]
// miniModel.ts
export const EIGHTHS = " ▁▂▃▄▅▆▇█"
export interface MiniDay { date: string; label: string; ms: number; total: number; today: boolean; rows: string[] }
export interface MiniProject { id: string; name: string; ms: number; share: number }
export interface MiniView {
  focus: string | null; who: string; streak: number; marks: Mark[]; todayMet: boolean
  todayMs: number; targetMs: number; meter: [number, number]; metAt: number | null; remainingMs: number
  sessions: ActivitySession[]; baseSessions: ActivitySession[]; added: number; deleted: number
  week: MiniDay[]; weekMax: number; projects: MiniProject[]; keys: { id: string; name: string }[]
}
export function eighthRows(ms: number, max: number): string[]
export function miniView(year: YearPayload, logs: Record<string, DailyLog>, focus: string | null, now: number): MiniView
// test/helpers/exportFixtures.ts
export function todayLogs(w: { range: any }): Record<string, any>
```

- [ ] **Step 1: Add the fixture helper**

Append to `test/helpers/exportFixtures.ts`:

```ts
// Today's log per project, as the host's sidebar payload carries them.
export function todayLogs(w: { range: any }): Record<string, any> {
  return Object.fromEntries(Object.entries(w.range.logs).map(([id, list]: [string, any]) => [id, list[list.length - 1]]))
}
```

- [ ] **Step 2: Write the failing test**

Register in `scripts/test.js`:

```js
  {
    name: "mini",
    entry: "test/webview.mini.test.ts",
    alias: { miniModel: "src/webview/miniModel.ts" },
  },
```

Create `test/webview.mini.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/miniModel.ts
import { eighthRows, miniView } from "miniModel"
import { MIN, TODAY, addDays, at, todayLogs, world } from "./helpers/exportFixtures"

const HOUR = 60 * MIN
const NOW = at(TODAY, 18)

// alpha: today 50m (two sessions), yesterday 25m, the day before 10m; beta: today 30m.
const w = world({
  alpha: {
    [TODAY]: {
      ms: 50 * MIN,
      langs: { typescript: [40 * MIN, 100, 20], markdown: [10 * MIN, 5, 0] },
      files: [["/work/alpha/src/a.ts", 100, 20], ["/work/alpha/README.md", 5, 0]],
      sessions: [[9 * 60, 60, 40, { typescript: 40 * MIN }], [14 * 60, 15, 10, { markdown: 10 * MIN }]],
    },
    [addDays(TODAY, -1)]: { ms: 25 * MIN },
    [addDays(TODAY, -2)]: { ms: 10 * MIN },
  },
  beta: { [TODAY]: { ms: 30 * MIN, langs: { go: [30 * MIN, 10, 2] }, files: [["/work/beta/main.go", 10, 2]], sessions: [[11 * 60, 40, 30, { go: 30 * MIN }]] } },
}, { globalStreak: 3 })
const view = (focus: string | null, ww: any = w) => miniView(ww.year, todayLogs(ww), focus, NOW)

describe("sidebar: all projects", () => {
  const v = view(null)

  it("shows today across projects against the global target, and when it was met", () => {
    assert.strictEqual(v.who, "all projects")
    assert.strictEqual(v.todayMs, 80 * MIN)
    assert.strictEqual(v.targetMs, 20 * MIN)
    assert.deepStrictEqual(v.meter, [10, 0])
    assert.strictEqual(v.metAt, at(TODAY, 9, 30))
    assert.deepStrictEqual([v.added, v.deleted], [115, 22])
  })

  it("takes the streak from storage and marks the last 14 days", () => {
    assert.strictEqual(v.streak, 3)
    assert.deepStrictEqual(v.marks.slice(-3), ["miss", "met", "today"])
    assert.strictEqual(v.todayMet, true)
  })

  it("lists today's projects by time with their share, and the week's projects as keys", () => {
    assert.deepStrictEqual(v.projects.map((p: any) => [p.id, p.ms, p.share]), [["alpha", 50 * MIN, 0.625], ["beta", 30 * MIN, 0.375]])
    assert.deepStrictEqual(v.keys.map((k: any) => k.id), ["alpha", "beta"])
  })

  it("draws the last seven days on a scale of whole hours, today last", () => {
    assert.strictEqual(v.week.length, 7)
    assert.strictEqual(v.week.map((d: any) => d.label).join(""), "TWTFSSM")
    assert.ok(v.week[6].today && !v.week[5].today)
    assert.strictEqual(v.weekMax, 2 * HOUR)
    assert.deepStrictEqual(v.week[6].rows, [" ", "▅", "█", "█"])
  })
})

describe("sidebar: focus on one project", () => {
  const v = view("beta")

  it("narrows today, lines and the tape to the project, against its own target", () => {
    assert.strictEqual(v.who, "beta only")
    assert.strictEqual(v.todayMs, 30 * MIN)
    assert.deepStrictEqual([v.added, v.deleted], [10, 2])
    assert.strictEqual(v.sessions.length, 1)
    assert.strictEqual(v.baseSessions.length, 3)
    assert.strictEqual(v.metAt, at(TODAY, 11) + 1_600_000)
  })

  it("keeps the week's scale, so the project shows as its share of each day", () => {
    assert.strictEqual(v.weekMax, 2 * HOUR)
    assert.deepStrictEqual(v.week[6].rows, [" ", " ", " ", "█"])
    assert.strictEqual(v.week[6].total, 80 * MIN)
  })

  it("leaves the streak and today's project list as they are", () => {
    assert.strictEqual(v.streak, 3)
    assert.strictEqual(v.projects.length, 2)
  })

  it("a project that no longer exists falls back to all projects", () => {
    const g = view("gone")
    assert.strictEqual(g.focus, null)
    assert.strictEqual(g.who, "all projects")
    assert.strictEqual(g.todayMs, 80 * MIN)
  })
})

describe("sidebar: nothing to show", () => {
  it("a brand-new install shows zeros and no projects, never NaN", () => {
    const v = view(null, world({}, { ids: [] }))
    for (const k of ["todayMs", "targetMs", "remainingMs", "weekMax", "added", "deleted", "streak"]) {
      assert.ok(Number.isFinite(v[k]), `${k} = ${v[k]}`)
    }
    assert.strictEqual(v.todayMs, 0)
    assert.deepStrictEqual(v.meter, [0, 10])
    assert.strictEqual(v.metAt, null)
    assert.deepStrictEqual([v.projects, v.keys, v.sessions], [[], [], []])
    assert.strictEqual(v.weekMax, HOUR)
  })
})

describe("eighth-block columns", () => {
  it("nothing is blank, any activity shows a step, the maximum fills all four rows", () => {
    assert.deepStrictEqual(eighthRows(0, HOUR), [" ", " ", " ", " "])
    assert.deepStrictEqual(eighthRows(1, HOUR), [" ", " ", " ", "▁"])
    assert.deepStrictEqual(eighthRows(HOUR, HOUR), ["█", "█", "█", "█"])
  })
})
```

Run: `node scripts/test.js --suite mini`
Expected: FAIL. `src/webview/miniModel.ts` can't be resolved.

- [ ] **Step 3: Move the marks into `model.ts`**

In `src/webview/model.ts`, directly after the `streakInfo` function, add:

```ts
export type Mark = "met" | "miss" | "today"

// The last n days against each day's own target. Today is still being earned,
// so it gets its own mark; callers show whether it is met yet.
export function recentMarks(s: Series, n: number): Mark[] {
  const len = s.days.length
  const out: Mark[] = []
  for (let i = Math.max(0, len - n); i < len; i++) out.push(i === len - 1 ? "today" : s.active[i] >= s.targetMs[i] ? "met" : "miss")
  return out
}
```

In `src/webview/exportModel.ts`:
- add `Mark` and `recentMarks` to the `./model` import;
- replace `export type Mark = "met" | "miss" | "today"` with `export type { Mark }`;
- replace the marks loop in `exportData`:

```ts
  const marks: Mark[] = []
  for (let i = Math.max(0, n - 14); i < n; i++) {
    marks.push(i === n - 1 ? "today" : series.active[i] >= series.targetMs[i] ? "met" : "miss")
  }
```

with:

```ts
  const marks = recentMarks(series, 14)
```

Run: `node scripts/test.js --suite exportdata`
Expected: PASS, 17 tests. This is the refactor's guard: the export card's marks are unchanged.

- [ ] **Step 4: Write `src/webview/miniModel.ts`**

```ts
// The sidebar's numbers, from the year payload and today's log per project
// that the host sends every 10 s. Pure, like model.ts: mini.ts only draws.
import type { ActivitySession, DailyLog, YearPayload } from "../shared/types"
import { HOUR, weekday } from "./format"
import { meter } from "./layout"
import { Mark, daySlice, recentMarks, seriesFor, storedStreak, targetMetAt } from "./model"

export const EIGHTHS = " ▁▂▃▄▅▆▇█"
const ROWS = 4

export interface MiniDay { date: string; label: string; ms: number; total: number; today: boolean; rows: string[] }
export interface MiniProject { id: string; name: string; ms: number; share: number }
export interface MiniView {
  focus: string | null               // the focused project, if it still exists
  who: string                        // "all projects" or "<name> only"
  streak: number                     // storage's global streak; a focus doesn't narrow it
  marks: Mark[]                      // the last 14 days, today last
  todayMet: boolean
  todayMs: number                    // narrowed to the focus
  targetMs: number                   // the focus's own target, else the global one
  meter: [number, number]
  metAt: number | null
  remainingMs: number
  sessions: ActivitySession[]        // narrowed to the focus
  baseSessions: ActivitySession[]    // every project's: they set the tape's window
  added: number
  deleted: number
  week: MiniDay[]                    // the last 7 days, today last
  weekMax: number                    // whole hours, from the unfocused week, so a focus shows a share
  projects: MiniProject[]            // today's, most time first
  keys: { id: string; name: string }[]   // projects active this week, registry order
}

// Four rows of eighth blocks, top first: 32 steps from nothing to max. Any
// activity shows at least one step.
export function eighthRows(ms: number, max: number): string[] {
  let steps = Math.round(ms / Math.max(1, max) * ROWS * 8)
  if (ms > 0 && steps === 0) steps = 1
  return Array.from({ length: ROWS }, (_, i) => EIGHTHS[Math.max(0, Math.min(8, steps - (ROWS - 1 - i) * 8))])
}

export function miniView(year: YearPayload, logs: Record<string, DailyLog>, focus: string | null, now: number): MiniView {
  const today = year.today
  const range = { from: today, to: today, logs: Object.fromEntries(Object.entries(logs).map(([id, l]) => [id, [l]])) }
  // a project cleared since the pointer landed on it no longer narrows anything
  const known = focus !== null && year.projects.some(p => p.id === focus) ? focus : null
  const whole = daySlice(range, today, "all", null)
  const shown = known ? daySlice(range, today, "all", { kind: "project", id: known }) : whole
  const all = seriesFor(year, "all")
  const series = known ? seriesFor(year, known) : all
  const n = series.days.length
  const targetMs = n ? series.targetMs[n - 1] : year.globalTargetMs
  const name = (id: string) => year.projects.find(p => p.id === id)?.name ?? "unknown project"

  const first = Math.max(0, n - 7)
  const totals = all.active.slice(first)
  const weekMax = Math.max(1, Math.ceil(Math.max(0, ...totals) / HOUR)) * HOUR
  const week: MiniDay[] = series.days.slice(first).map((date, i) => {
    const ms = series.active[first + i]
    return { date, label: weekday(date).slice(0, 1), ms, total: totals[i], today: date === today, rows: eighthRows(ms, weekMax) }
  })

  const active = Object.entries(logs).filter(([, l]) => l.activeTime > 0)
  const total = active.reduce((t, [, l]) => t + l.activeTime, 0)
  const projects = active
    .map(([id, l]) => ({ id, name: name(id), ms: l.activeTime, share: total ? l.activeTime / total : 0 }))
    .sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name))

  return {
    focus: known,
    who: known ? `${name(known)} only` : "all projects",
    streak: storedStreak(year, "all"),
    marks: recentMarks(all, 14),
    todayMet: n > 0 && all.active[n - 1] >= all.targetMs[n - 1],
    todayMs: shown.activeMs,
    targetMs,
    meter: meter(shown.activeMs, targetMs),
    metAt: targetMetAt(shown.sessions, targetMs, now),
    remainingMs: Math.max(0, targetMs - shown.activeMs),
    sessions: shown.sessions,
    baseSessions: whole.sessions,
    added: shown.linesAdded,
    deleted: shown.linesDeleted,
    week,
    weekMax,
    projects,
    keys: year.projects.filter(p => p.active.slice(first).some(v => v > 0)).map(p => ({ id: p.id, name: p.name })),
  }
}
```

- [ ] **Step 5: Run the suites**

Run: `node scripts/test.js --suite mini`
Expected: PASS, 10 tests.

Run: `node scripts/test.js --suite exportdata` and `node scripts/test.js --suite fonts`
Expected: both PASS. The fonts suite scans `exportModel.ts`, which still has no characters outside the font.

- [ ] **Step 6: Gate and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add src/webview/model.ts src/webview/exportModel.ts src/webview/miniModel.ts test/helpers/exportFixtures.ts test/webview.mini.test.ts scripts/test.js
git commit -m "Compute the sidebar's numbers from the year and today's logs, sharing the streak marks with the export card"
```

---

### Task 3: The sidebar's messages on the host

**Files:**
- Create: `src/dashboard/miniHandler.ts`
- Modify: `src/shared/types.ts`, `src/dashboard/payloads.ts`, `src/dashboard/messageHandler.ts` (`Poster`, `sendSettings`), `scripts/test.js`
- Test: `test/dashboard.mini.test.ts`, `test/dashboard.payloads.test.ts`

**Interfaces:**
- Produces (types.ts):

```ts
export interface MiniPayload {
  year: YearPayload
  logs: Record<string, DailyLog>   // today's log for every registered project
  here: string | null              // the name of the project this window works in
}
export type MiniMessage = { type: "ready" } | { type: "openDashboard" }
// ExtensionMessage gains: | ({ type: "mini" } & MiniPayload)
```

- Produces: `buildMini(storage: StorageService, now: Date, globalTargetMs: number): MiniPayload` (payloads.ts); `interface Poster { postMessage(message: ExtensionMessage): void }`, with `sendSettings(storage, panel: Poster)` (messageHandler.ts); `postMini(storage, view: Poster): void`, `handleMiniMessage(msg: MiniMessage, storage, view: Poster, openDashboard: () => void): void` and `onMiniConfigChanged(affects: (section: string) => boolean, storage, view: Poster): void` (miniHandler.ts).

- [ ] **Step 1: Write the failing tests**

Add `buildMini` to the payloads import in `test/dashboard.payloads.test.ts`:

```ts
import { MAX_RANGE_DAYS, buildLive, buildMini, buildRange, buildYear, yearStart } from "payloads"
```

and append:

```ts
// The sidebar redraws everything from one message, so its parts must agree on the day.
describe("sidebar payload", () => {
  it("carries the year and today's log for every project, all for the same day", () => {
    const m = buildMini(store(), new Date(), TARGET)
    assert.strictEqual(m.year.today, today)
    assert.deepStrictEqual(Object.keys(m.logs).sort(), ["alpha", "beta"])
    assert.ok(Object.values(m.logs).every((l: any) => l.date === today))
    assert.strictEqual(m.logs.alpha.activeTime, 30 * MIN)
    assert.strictEqual(m.logs.beta.activeTime, 0)
  })

  it("names the project this window works in", () => {
    assert.strictEqual(buildMini(store(), new Date(), TARGET).here, "alpha")
  })
})
```

Register the new suite in `scripts/test.js`:

```js
  {
    name: "minihandler",
    entry: "test/dashboard.mini.test.ts",
    alias: {
      vscode: "test/stubs/vscodeHost.ts",
      storage: "src/tracker/storageService.ts",
      miniHandler: "src/dashboard/miniHandler.ts",
    },
  },
```

Create `test/dashboard.mini.test.ts`:

```ts
import { after, beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
import * as vscode from "vscode"
import { MIN, PROJECTS_KEY, cleanupStorageRoot, log, makeStore, proj, today } from "./helpers/store"
// @ts-ignore — esbuild alias to src/dashboard/miniHandler.ts
import { handleMiniMessage, onMiniConfigChanged } from "miniHandler"

const v = vscode as any
after(cleanupStorageRoot)

let posted: any[]
const view = { postMessage: (m: any) => posted.push(m) }
const types = () => posted.map(m => m.type)
const store = () => makeStore({
  [PROJECTS_KEY]: [proj("alpha"), proj("beta")],
  [`rabbithole:log:alpha:${today}`]: log(30 * MIN),
  [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 1 },
}).s

beforeEach(() => { posted = []; v.__reset() })

describe("sidebar messages", () => {
  it("ready sends the settings (for the CRT), then everything the sidebar draws", () => {
    handleMiniMessage({ type: "ready" }, store(), view, () => assert.fail("not asked to open"))
    assert.deepStrictEqual(types(), ["settings", "mini"])
    assert.strictEqual(posted[1].logs.alpha.activeTime, 30 * MIN)
  })

  it("open dashboard opens it and sends nothing", () => {
    let opened = 0
    handleMiniMessage({ type: "openDashboard" }, store(), view, () => { opened++ })
    assert.strictEqual(opened, 1)
    assert.deepStrictEqual(types(), [])
  })

  it("a message it doesn't know does nothing", () => {
    handleMiniMessage({ type: "export" } as any, store(), view, () => assert.fail("not asked to open"))
    assert.deepStrictEqual(types(), [])
  })
})

describe("settings changed while the sidebar is open", () => {
  it("a Rabbit Hole setting sends the settings and fresh data", () => {
    onMiniConfigChanged((s: string) => s === "rabbithole" || s === "rabbithole.crt.mask", store(), view)
    assert.deepStrictEqual(types(), ["settings", "mini"])
  })

  it("another extension's setting sends nothing", () => {
    onMiniConfigChanged(() => false, store(), view)
    assert.deepStrictEqual(types(), [])
  })
})
```

Run: `node scripts/test.js --suite payloads` and `node scripts/test.js --suite minihandler`
Expected: FAIL. `buildMini` is not a function, and `src/dashboard/miniHandler.ts` can't be resolved.

- [ ] **Step 2: Add the types**

In `src/shared/types.ts`, before `// ── CRT display`:

```ts
// ── The Activity Bar sidebar ──────────────────────────────────────────────
// Rebuilt whole on every 10 s tick while the sidebar is visible: it never
// merges updates, so a wipe, an import or midnight can't leave it stale.
export interface MiniPayload {
  year: YearPayload
  logs: Record<string, DailyLog>   // today's log for every registered project
  here: string | null              // the name of the project this window works in
}
export type MiniMessage = { type: "ready" } | { type: "openDashboard" }
```

and add to `ExtensionMessage`:

```ts
  | ({ type: "mini" } & MiniPayload)
```

- [ ] **Step 3: `buildMini`**

In `src/dashboard/payloads.ts`, add `MiniPayload` to the types import and append:

```ts
export function buildMini(storage: StorageService, now: Date, globalTargetMs: number): MiniPayload {
  const today = dateKey(now)
  const logs: Record<string, DailyLog> = {}
  for (const p of storage.getProjects()) logs[p.id] = storage.getRangeByDates(today, today, p.id)[0]
  const here = storage.getProjects().find(p => p.id === storage.getCurrentProjectId())?.name ?? null
  return { year: buildYear(storage, now, globalTargetMs), logs, here }
}
```

- [ ] **Step 4: `Poster` and the sidebar handler**

In `src/dashboard/messageHandler.ts`, change the types import to `import { ExtensionMessage, WebviewMessage } from "../shared/types"`, add above `sendSettings`:

```ts
// Anything a message can be posted to: the dashboard panel or the sidebar view.
export interface Poster { postMessage(message: ExtensionMessage): void }
```

and change `sendSettings`'s signature to `export function sendSettings(storage: StorageService, panel: Poster): void`. The body is unchanged.

Create `src/dashboard/miniHandler.ts`:

```ts
// The Activity Bar sidebar's side of the protocol. It asks for nothing but
// "ready" and "open dashboard"; everything it draws arrives in one message.
import { getDailyTargetMs } from "../shared/config"
import type { MiniMessage } from "../shared/types"
import type { StorageService } from "../tracker/storageService"
import { Poster, sendSettings } from "./messageHandler"
import { buildMini } from "./payloads"

export function postMini(storage: StorageService, view: Poster): void {
  view.postMessage({ type: "mini", ...buildMini(storage, new Date(), getDailyTargetMs()) })
}

export function handleMiniMessage(msg: MiniMessage, storage: StorageService, view: Poster, openDashboard: () => void): void {
  switch (msg?.type) {
    case "ready":
      // settings first: the CRT layers are drawn from them
      sendSettings(storage, view)
      postMini(storage, view)
      break
    case "openDashboard":
      openDashboard()
      break
  }
}

// Settings edited anywhere reach the sidebar too: the CRT look and, for a new
// daily target, streaks re-judged against it.
export function onMiniConfigChanged(affects: (section: string) => boolean, storage: StorageService, view: Poster): void {
  if (!affects("rabbithole")) return
  if (affects("rabbithole.dailyTargetMinutes")) {
    storage.updateStreak()
    storage.updateProjectStreak(storage.getCurrentProjectId())
  }
  sendSettings(storage, view)
  postMini(storage, view)
}
```

- [ ] **Step 5: Run the suites**

Run: `node scripts/test.js --suite payloads`, `node scripts/test.js --suite minihandler` and `node scripts/test.js --suite handler`
Expected: all PASS. The handler suite proves `sendSettings` still serves the dashboard.

- [ ] **Step 6: Gate and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add src/shared/types.ts src/dashboard/payloads.ts src/dashboard/messageHandler.ts src/dashboard/miniHandler.ts test/dashboard.payloads.test.ts test/dashboard.mini.test.ts scripts/test.js
git commit -m "Give the sidebar one message with the year and today's logs, and a handler for its ready and open-dashboard requests"
```

---

### Task 4: The sidebar webview, its shell, and the old sidebar removed

**Files:**
- Create: `src/webview/mini.ts`, `src/webview/mini.css`, `test/harness/sidebar.js`, `test/harness/sidebarStub.ts`
- Replace: `src/dashboard/miniPanel.ts`
- Modify: `src/extension.ts`, `package.json` (`build:webview`), `scripts/copy-assets.js`, `scripts/watch.js`
- Delete: `src/webview/miniTheme.ts`, `src/webview/derivePalette.ts`, `src/webview/fonts/PressStart2P.woff2`, `src/webview/fonts/UnicaOne-Regular.woff2`, `src/webview/fonts/Electrolize-Regular.ttf`, `src/webview/fonts/OFL.txt`
- Test: visual, in the sidebar harness. The numbers are tested in Task 2 and the messages in Task 3.

**Interfaces:**
- Consumes: `miniView`, `MiniView` (Task 2); `MiniMessage`, `MiniPayload`, `handleMiniMessage`, `postMini`, `onMiniConfigChanged` (Task 3); `setTape`, `initTape` (tape.ts: needs `#tape-wrap`, `#tape`, `#ticks`); `applyCrt`, `initCrt` (crt.ts: needs `#mask` and the `.crt` layers); `initTooltip`, `bindTip`, `tipLine` (tooltip.ts: needs `#tip`); `wireFocus`, `keepFocus` (focus.ts: reads `data-hl="p:<id>"`); `carrotSvg` (carrot.ts); `projectColor` (colors.ts); `keyBox`, `el`, `$` (dom.ts).
- Produces: `class MiniPanel implements vscode.WebviewViewProvider` with `static viewId`, `constructor(extensionUri, onMessage: (m: MiniMessage) => void)`, `get visible(): boolean` and `postMessage(m: ExtensionMessage): void`.

- [ ] **Step 1: The shell**

Replace `src/dashboard/miniPanel.ts` with:

```ts
import * as vscode from "vscode"
import type { ExtensionMessage, MiniMessage } from "../shared/types"

// The Activity Bar sidebar: static markup around the mini bundle
// (src/webview/mini.ts), which draws everything from the host's `mini`
// message. The panels are fixed here; mini.ts fills them.
export class MiniPanel implements vscode.WebviewViewProvider {
  static readonly viewId = "rabbithole.miniView"
  private view?: vscode.WebviewView

  constructor(private readonly extensionUri: vscode.Uri, private readonly onMessage: (msg: MiniMessage) => void) {}

  // Nothing is built or sent while the sidebar is collapsed or covered.
  get visible(): boolean {
    return !!this.view?.visible
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")] }
    view.webview.html = this.html(view.webview)
    view.webview.onDidReceiveMessage(m => this.onMessage(m as MiniMessage))
    // shown again: the last tick it saw may be long gone
    view.onDidChangeVisibility(() => { if (view.visible) this.onMessage({ type: "ready" }) })
  }

  postMessage(message: ExtensionMessage): void {
    void this.view?.webview.postMessage(message)
  }

  private html(webview: vscode.Webview): string {
    const asset = (...path: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webview", ...path))
    const csp = webview.cspSource
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${csp}; style-src ${csp} 'unsafe-inline'; font-src ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @font-face { font-family: "Martian Mono"; src: url("${asset("fonts", "MartianMono-VF.woff2")}") format("woff2"); font-weight: 100 800; font-stretch: 75% 112.5%; font-display: block; }
  </style>
  <link rel="stylesheet" href="${asset("style.css")}">
  <link rel="stylesheet" href="${asset("mini.css")}">
  <title>Rabbit Hole</title>
</head>
<body>
<div class="screen mini" id="mini">
  <div class="brand"><span id="brand"></span><div><div class="word">rabbit hole</div><div class="proj" id="here"></div></div></div>

  <fieldset class="streak">
    <legend><b>streak</b></legend>
    <div class="row"><span class="big" id="st-n">0</span><span class="k">days</span></div>
    <div class="days" id="st-days" aria-label="The last 14 days against the target"></div>
  </fieldset>

  <fieldset>
    <legend><b>today</b> <span id="td-who">all projects</span></legend>
    <div class="row"><span class="big" id="td-t">0m</span><span class="k" id="td-k"></span></div>
    <div class="meter" id="td-meter"></div>
    <div class="tape-wrap" id="tape-wrap">
      <div class="tape" id="tape" role="img" aria-label="Active time across the day"></div>
      <div class="ticks" id="ticks" aria-hidden="true"></div>
    </div>
  </fieldset>

  <fieldset>
    <legend><b>lines</b> <span id="ln-who">today · all projects</span></legend>
    <div class="row"><span class="mid add" id="ln-a">+0</span><span class="mid del" id="ln-d">−0</span></div>
  </fieldset>

  <fieldset>
    <legend><b>7 days</b> <span id="wk-who">all projects</span></legend>
    <div class="cols" id="wk-cols" role="img" aria-label="Active time for the last seven days"></div>
    <div class="dlabels" id="wk-labels" aria-hidden="true"></div>
    <div class="pkeys" id="wk-keys"></div>
  </fieldset>

  <fieldset>
    <legend><b>projects</b> today</legend>
    <div class="split" id="pj-split" aria-hidden="true"></div>
    <div class="plist" id="pj-list"></div>
  </fieldset>

  <button class="open" id="open" type="button">open dashboard</button>
</div>
<div id="tip" hidden></div>
<canvas class="crt" id="mask" aria-hidden="true"></canvas>
<div class="crt crt-scan" aria-hidden="true"></div>
<div class="crt crt-roll" aria-hidden="true"></div>
<div class="crt crt-glass" aria-hidden="true"></div>
<script src="${asset("mini.js")}"></script>
</body>
</html>`
  }
}
```

- [ ] **Step 2: The styles**

Create `src/webview/mini.css`:

```css
/* The Activity Bar sidebar: the TTY dashboard folded into one column. Loaded
   after style.css, whose theme tokens, panels, tape, tooltip and CRT layers it
   reuses; only the sidebar's own layout lives here. A webview's viewport is the
   sidebar itself, so the width rules are plain media queries. */
body { padding: 12px 12px 18px; }
.mini { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; max-width: none; }
.mini fieldset { padding: 6px 10px 10px; }
/* the dashboard's rounded glass would show bezel-coloured corners in a narrow column */
.crt-glass { border-radius: 0; }

.brand { display: flex; align-items: center; gap: 10px; padding-bottom: 2px; }
.brand svg { display: block; flex: none; filter: var(--carrot-glow); }
.brand > div { min-width: 0; }
.brand .word { font-weight: 700; font-size: 14px; line-height: 1.1; color: var(--ink); }
.brand .proj { color: var(--ink-dim); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.mini .row { display: flex; flex-wrap: wrap; gap: 2px 14px; align-items: baseline; }
.mini .big { font-size: 30px; line-height: 1.05; font-weight: 600; font-variation-settings: "wdth" 75; }
.mini .mid { font-size: 22px; line-height: 1.1; font-weight: 600; font-variation-settings: "wdth" 75; }
.mini .k { color: var(--ink-dim); }
.mini .streak .big { color: var(--add); }
.mini .add { color: var(--add); }
.mini .del { color: var(--del); }

.days { display: grid; grid-template-columns: repeat(14, 1fr); margin-top: 6px; font-size: 12px; text-align: center; }
.days .hit { color: var(--add); }
.days .miss { color: var(--ink-mute); }
.days .now { color: var(--chrome); }
.meter { margin-top: 4px; color: var(--ink-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meter .on { color: var(--add); }
.meter .off { color: var(--ink-mute); }
.mini .tape { padding-top: 12px; }
.mini .ticks { font-size: 10px; }

/* 7 days: four rows of eighth blocks, like btop */
.cols { display: grid; grid-template-columns: 2.6em repeat(7, minmax(0, 1fr)); gap: 0 4px; align-items: end; margin-top: 4px; }
.cols .axis { display: grid; grid-template-rows: repeat(4, 1fr); height: 64px; color: var(--ink-mute); font-size: 10px; text-align: right; }
.cols .axis span:first-child { align-self: start; }
.cols .axis span:last-child { align-self: end; }
.col { display: grid; grid-template-rows: repeat(4, 16px); font-size: 18px; line-height: 16px; color: var(--add); cursor: default; overflow: hidden; }
.col span { display: block; height: 16px; text-align: center; overflow: hidden; }
.col.now { color: var(--chrome); }
.col:hover, .col:focus-visible { background: color-mix(in srgb, var(--ink) 8%, transparent); }
.dlabels { display: grid; grid-template-columns: 2.6em repeat(7, minmax(0, 1fr)); gap: 0 4px; color: var(--ink-mute); font-size: 10px; text-align: center; margin-top: 3px; }
.dlabels .now { color: var(--chrome); }
.pkeys { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 8px; color: var(--ink-dim); font-size: 11px; }
.pkeys span { display: inline-flex; gap: 6px; align-items: center; padding: 0 2px; cursor: default; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pkeys span:hover, .pkeys span:focus-visible { color: var(--ink); }

/* projects today: one split bar, then the list that carries the numbers */
.split { display: flex; gap: 2px; height: 10px; margin: 6px 0 8px; }
.split span { height: 100%; min-width: 2px; }
.plist { display: grid; gap: 3px; }
.plist .p { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 1px 2px; cursor: default; }
.plist .p:hover, .plist .p:focus-visible { background: color-mix(in srgb, var(--ink) 8%, transparent); }
.plist .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plist .t { color: var(--ink-dim); font-variant-numeric: tabular-nums; }
.mini .dim { opacity: .32; }

.open { font: inherit; font-weight: 600; width: 100%; padding: 6px 8px; border: 0; cursor: pointer; background: var(--chrome); color: var(--chrome-ink); text-shadow: none; }
.open:hover { filter: brightness(1.08); }

/* narrow sidebars drop what stops being readable */
@media (max-width: 230px) {
  body { padding-inline: 8px; }
  .brand .proj { display: none; }
  .days { grid-template-columns: repeat(7, 1fr); }
  .days span:nth-child(-n+7) { display: none; }
  .mini .ticks span:nth-child(even) { visibility: hidden; }
  .cols, .dlabels { grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .cols .axis, .dlabels .gap { display: none; }
  .plist .pct { display: none; }
}
```

- [ ] **Step 3: The webview entry point**

Create `src/webview/mini.ts`:

```ts
// The Activity Bar sidebar's entry point: wiring and drawing only. Every
// number comes from miniModel.ts.
import type { DailyLog, ExtensionMessage, MiniMessage, YearPayload } from "../shared/types"
import { carrotSvg } from "./carrot"
import { projectColor } from "./colors"
import { applyCrt, initCrt } from "./crt"
import { $, el, keyBox } from "./dom"
import { keepFocus, wireFocus } from "./focus"
import { HOUR, clock, fmt, weekday } from "./format"
import { MiniView, miniView } from "./miniModel"
import { initTape, setTape } from "./tape"
import { bindTip, initTooltip, tipLine } from "./tooltip"

declare function acquireVsCodeApi(): { postMessage(m: MiniMessage): void }

const vscode = acquireVsCodeApi()
let year: YearPayload | null = null
let logs: Record<string, DailyLog> = {}
let focus: string | null = null

const colorOf = (id: string): string => projectColor(year, id)
const nameOf = (id: string): string => year?.projects.find(p => p.id === id)?.name ?? "unknown project"
const dimmed = (id: string): string => (focus && focus !== id ? "dim" : "")

function streak(v: MiniView): void {
  $("st-n").textContent = String(v.streak)
  $("st-days").replaceChildren(...v.marks.map(m => (m === "today"
    ? el("span", "now", v.todayMet ? "◆" : "◇")
    : el("span", m === "met" ? "hit" : "miss", m === "met" ? "■" : "□"))))
}

function today(v: MiniView, now: number): void {
  $("td-who").textContent = v.who
  $("td-t").textContent = fmt(v.todayMs)
  $("td-k").textContent = `of ${fmt(v.targetMs)}`
  $("td-meter").replaceChildren(
    el("span", "on", "█".repeat(v.meter[0])),
    el("span", "off", "░".repeat(v.meter[1])),
    document.createTextNode(v.metAt !== null ? ` met ${clock(v.metAt)}` : ` ${fmt(v.remainingMs)} to go`),
  )
  setTape({
    sessions: v.sessions,
    base: v.baseSessions,
    perDays: 1,
    now,
    // the sidebar asks where today went across projects, so cells take the project's colour
    color: c => (c.projectId ? colorOf(c.projectId) : null),
    label: c => (c.projectId ? nameOf(c.projectId) : null),
  })
}

function lines(v: MiniView): void {
  $("ln-who").textContent = `today · ${v.who}`
  $("ln-a").textContent = `+${v.added}`
  $("ln-d").textContent = `−${v.deleted}`
}

function week(v: MiniView): void {
  $("wk-who").textContent = v.who
  const axis = el("div", "axis")
  axis.append(el("span", null, `${v.weekMax / HOUR}h`), el("span"), el("span"), el("span", null, "0"))
  $("wk-cols").replaceChildren(axis, ...v.week.map((d, i) => {
    const col = el("div", d.today && !v.focus ? "col now" : "col")
    col.dataset.i = String(i)
    if (v.focus) col.style.color = colorOf(v.focus)
    col.append(...d.rows.map(g => el("span", null, g)))
    const when = d.today ? "today" : weekday(d.date)
    bindTip(col, () => [tipLine(d.ms ? fmt(d.ms) : "no activity", v.focus ? `${when} · ${nameOf(v.focus)}, of ${fmt(d.total)}` : when)])
    return col
  }))
  $("wk-labels").replaceChildren(el("span", "gap"), ...v.week.map(d => el("span", d.today ? "now" : null, d.label)))
  $("wk-keys").replaceChildren(...v.keys.map(k => {
    const s = el("span", dimmed(k.id))
    s.dataset.hl = `p:${k.id}`
    s.tabIndex = 0
    s.append(keyBox(colorOf(k.id)), k.name)
    return s
  }))
}

function projects(v: MiniView): void {
  $("pj-split").replaceChildren(...v.projects.map(p => {
    const s = el("span", dimmed(p.id))
    s.dataset.hl = `p:${p.id}`
    s.style.flex = String(p.ms)
    s.style.background = colorOf(p.id)
    return s
  }))
  $("pj-list").replaceChildren(...(v.projects.length
    ? v.projects.map(p => {
      const row = el("div", `p ${dimmed(p.id)}`.trim())
      row.dataset.hl = `p:${p.id}`
      row.tabIndex = 0
      const t = el("span", "t", fmt(p.ms))
      t.append(el("span", "pct", ` ${Math.round(p.share * 100)}%`))
      row.append(keyBox(colorOf(p.id)), el("span", "n", p.name), t)
      return row
    })
    : [el("div", "hint", "no activity yet today")]))
}

function render(): void {
  if (!year) return
  const now = Date.now()
  const v = miniView(year, logs, focus, now)
  keepFocus(() => {
    streak(v)
    today(v, now)
    lines(v)
    week(v)
    projects(v)
  })
}

window.addEventListener("message", (e: MessageEvent<ExtensionMessage>) => {
  const m = e.data
  if (m.type === "settings") applyCrt(m.crt)
  else if (m.type === "mini") {
    year = m.year
    logs = m.logs
    $("here").textContent = m.here ?? ""
    render()
  }
})

initTooltip($("tip"))
initCrt()
initTape()
$("brand").append(carrotSvg(3))
wireFocus($("mini"), {
  allowProject: () => true,
  current: () => (focus ? { kind: "project", id: focus } : null),
  set: f => {
    focus = f && f.kind === "project" ? f.id : null
    render()
  },
})
$("open").addEventListener("click", () => vscode.postMessage({ type: "openDashboard" }))
vscode.postMessage({ type: "ready" })
```

- [ ] **Step 4: Build entry points and asset copies**

In `package.json`, `build:webview` builds `mini.ts` in place of `miniTheme.ts`:

```json
    "build:webview": "esbuild src/webview/main.ts src/webview/mini.ts --bundle --outdir=out/webview --platform=browser --loader:.ttf=base64 --sourcemap && node scripts/copy-assets.js",
```

In `scripts/copy-assets.js`, replace the three CSS lines (`const cssSrc = …` through the `console.log("Copied style.css …")`) with:

```js
// CSS: the dashboard's styles, and the sidebar's, which load on top of them
for (const css of ["style.css", "mini.css"]) {
  const from = path.join(__dirname, "..", "src", "webview", css)
  fs.copyFileSync(from, path.join(destDir, css))
  console.log(`Copied ${css} →`, path.join(destDir, css))
}
```

In `scripts/watch.js`, replace lines 6–18 (from `const cssSrc` through the `fs.watch(...)` block) with:

```js
const CSS = ["style.css", "mini.css"]

function copyCss(name) {
  const out = path.join(root, "out", "webview", name)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.copyFileSync(path.join(root, "src", "webview", name), out)
}

for (const name of CSS) {
  copyCss(name)
  fs.watch(path.join(root, "src", "webview", name), () => {
    try { copyCss(name); console.log(`[css] ${name} updated`) }
    catch (e) { console.error(`[css] ${name} copy failed:`, e.message) }
  })
}
```

and change the webview context's `entryPoints` to `["src/webview/main.ts", "src/webview/mini.ts"]`.

- [ ] **Step 5: Wire the extension**

In `src/extension.ts`:
- add `import { handleMiniMessage, onMiniConfigChanged, postMini } from "./dashboard/miniHandler"` (the `dateKey` import stays: `yearDay` still uses it);
- delete the whole `refreshMiniPanel` function;
- replace the mini panel registration (`const miniPanel = new MiniPanel(...)` through its `registerWebviewViewProvider` push) with:

```ts
  // Activity Bar sidebar: it sends "ready" when it loads or is shown again
  const miniPanel: MiniPanel = new MiniPanel(context.extensionUri, msg =>
    handleMiniMessage(msg, storage, miniPanel, () => { void vscode.commands.executeCommand("rabbithole.openDashboard") }))
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(MiniPanel.viewId, miniPanel))
```

- in the 10 s interval, replace `refreshMiniPanel()` with:

```ts
    if (miniPanel.visible) postMini(storage, miniPanel)
```

- in the `onDidChangeConfiguration` listener, after the dashboard branch, add:

```ts
      if (miniPanel.visible) onMiniConfigChanged(section => e.affectsConfiguration(section), storage, miniPanel)
```

Run: `grep -n "refreshMiniPanel\|getGlobalActiveSeries\|MiniUpdateData" src/extension.ts`
Expected: no hits.

- [ ] **Step 6: Delete the old sidebar**

```bash
git rm src/webview/miniTheme.ts src/webview/derivePalette.ts src/webview/fonts/PressStart2P.woff2 src/webview/fonts/UnicaOne-Regular.woff2 src/webview/fonts/Electrolize-Regular.ttf src/webview/fonts/OFL.txt
grep -rn "miniTheme\|derivePalette\|PressStart\|UnicaOne\|Electrolize" src scripts package.json
```

Expected: no hits from the `grep` (DESIGN.md still mentions them; phase 5 rewrites it). If `out/webview` still holds the deleted files from earlier builds, that is harmless, but `rm -rf out && npm run build` gives a clean package.

- [ ] **Step 7: Gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green. `out/webview/` now holds `mini.js` and `mini.css`, and no `miniTheme.js`.

- [ ] **Step 8: The sidebar harness**

Create `test/harness/sidebarStub.ts`:

```ts
// A stand-in for VS Code's webview API that answers the sidebar from fixture data.
import { MIN, sampleWorld, todayLogs } from "../helpers/exportFixtures"

const w = sampleWorld()
const settings = {
  type: "settings", dailyTargetMs: 20 * MIN, dailyTargetMinutes: 20, idleThresholdMinutes: 5, storagePath: "/harness",
  crt: { mask: "slot", pitch: "fine", strength: 23, vignette: 35, effects: ["scanlines", "bloom"] },
}
const send = (m: unknown) => setTimeout(() => window.postMessage(m, "*"), 30)

;(window as any).acquireVsCodeApi = () => ({
  postMessage: (m: any) => {
    console.log("[harness] sidebar →", m.type)
    if (m.type === "ready") {
      send(settings)
      send({ type: "mini", year: w.year, logs: todayLogs(w), here: "rabbit-hole" })
    }
  },
})
```

Create `test/harness/sidebar.js`:

```js
// Writes test/.out/harness/sidebar.html: the real sidebar markup without its
// CSP, loading the built webview and a stub VS Code API serving fixture data.
// Run `npm run build` first, then `node test/harness/sidebar.js`, serve the
// repo root (python -m http.server 8123) and open
// http://localhost:8123/test/.out/harness/sidebar.html at sidebar widths
// (300 px, then 200 px for the narrow rules).
const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const out = path.join(root, "test", ".out", "harness")
fs.mkdirSync(out, { recursive: true })

const vscodeStub = path.join(out, "vscode-view-stub.js")
fs.writeFileSync(vscodeStub, `
let html = ""
module.exports = {
  html: () => html,
  Uri: { joinPath: (_base, ...parts) => ({ rel: parts.join("/") }) },
  view: () => ({
    visible: true,
    onDidChangeVisibility() {},
    webview: { options: {}, cspSource: "", asWebviewUri: u => "/" + u.rel, set html(v) { html = v }, onDidReceiveMessage() {}, postMessage() {} },
  }),
}`)

esbuild.buildSync({
  stdin: {
    contents: `const v = require("vscode"); const { MiniPanel } = require("./src/dashboard/miniPanel"); new MiniPanel({}, () => {}).resolveWebviewView(v.view()); module.exports = v.html()`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", outfile: path.join(out, "sidebar-panel.js"), alias: { vscode: vscodeStub }, logLevel: "warning",
})
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "sidebarStub.ts")],
  bundle: true, platform: "browser", outfile: path.join(out, "sidebar-stub.js"), logLevel: "warning",
})

const html = require(path.join(out, "sidebar-panel.js"))
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
  .replace("<script src=", `<script src="sidebar-stub.js"></script>\n<script src=`)
fs.writeFileSync(path.join(out, "sidebar.html"), html)
console.log("wrote", path.join(out, "sidebar.html"))
```

- [ ] **Step 9: Look at it**

```bash
npm run build && node test/harness/sidebar.js
python -m http.server 8123
```

Run the server in the background. Open `http://localhost:8123/test/.out/harness/sidebar.html` at 300 px wide, next to `docs/design/mockups/sidebar.html`. Expected:
- the 3× colour carrot with "rabbit hole" and "rabbit-hole" under it;
- the streak (12, with 14 marks and the last one amber);
- today 3h40m "of 20m", with a full meter and "met 08:…";
- a 24-cell tape coloured by project, with hour ticks;
- lines +392 −159;
- 7 eighth-block columns with an hour axis, "TWTFSSM" labels with today amber, and two project keys;
- the split bar and list with percentages;
- "open dashboard";
- the faint CRT mask and scanlines.

Hover "rabbithole-cli" in the list: today, the meter, the tape, lines and the week narrow to it ("rabbithole-cli only"), the other row dims, and nothing under the pointer moves. Move the pointer off and everything returns. Resize to 200 px: 7 marks, no axis, every other tick label, no percentages, no project line under the brand. Add `class="vscode-light"` to `<body>` in devtools: the paper palette appears. Add `vscode-high-contrast`: no CRT. Edit a project's name in the stub to 60 characters, rebuild, and check that it ellipsizes everywhere. Stop the server.

- [ ] **Step 10: Commit**

```bash
git add -A src/dashboard/miniPanel.ts src/webview/mini.ts src/webview/mini.css src/extension.ts package.json scripts/copy-assets.js scripts/watch.js test/harness/sidebar.js test/harness/sidebarStub.ts
git commit -m "Rebuild the Activity Bar sidebar in the TTY design on the dashboard's modules, and remove the old sidebar and its fonts"
```

(`git rm` in Step 6 already staged the deletions.)

---

### Task 5: Phase wrap-up

**Files:**
- Modify: `CLAUDE.md` (gitignored: edit it, don't commit it)

- [ ] **Step 1: Update `CLAUDE.md`**

- Add a section after "TTY redesign — phase 3 exports":

```markdown
### TTY redesign — phase 4 sidebar (branch `tty-redesign`)
Plan `docs/superpowers/plans/2026-10-05-tty-redesign-phase4-sidebar.md`.
- `miniPanel.ts` is a thin shell (static markup, the dashboard's CSP, `style.css` + `mini.css`) around the `mini.ts` bundle. Every number comes from `miniModel.ts` (pure, tested); `tape.ts`, `crt.ts`, `tooltip.ts`, `focus.ts`, `carrot.ts` are the dashboard's own modules.
- One message, `mini` (`year` + today's log per project + the current project's name), rebuilt whole on every 10 s tick **only while the view is visible**, and on `ready` / becoming visible / a settings change (`miniHandler.ts`). The sidebar never merges updates, so wipes, imports and midnight can't leave it stale beyond one tick.
- Hover or keyboard focus on a project (list rows, split segments, week keys: `data-hl="p:<id>"`) narrows today, the meter, the tape, lines and the week to it, against its own target; the week keeps the unfocused scale. A project that disappears falls back to all projects.
- The sidebar's tape is coloured by project (the dashboard's by language). Below 230 px (plain media queries: the webview viewport is the sidebar) it shows 7 streak marks, no week axis, every other tick, no percentages.
- Status bar: `statusText()` in `src/shared/statusText.ts`, `$(rabbithole-carrot) 3h40m / 20m`, floored. The glyph appears once phase 5 registers the icon font.
- `Mark` / `recentMarks` live in `model.ts`, shared by the export card and the sidebar.
- Gone: `miniTheme.ts`, `derivePalette.ts`, Press Start 2P, Unica One, Electrolize (+ its OFL). `storage.getGlobalActiveSeries` is unused now and kept (no storage changes in this redesign).
- Harness: `test/harness/sidebar.js` (see its header).
```

- In "Relevant files": replace the `miniPanel.ts` row with "Activity Bar sidebar: thin shell (markup, CSP) around the `mini.ts` bundle"; replace the `miniTheme.ts / derivePalette.ts` row with rows for `mini.ts` ("sidebar entry point: wiring and drawing"), `miniModel.ts` ("every sidebar number — pure, tested"), `mini.css` ("sidebar layout on top of `style.css`"), `src/dashboard/miniHandler.ts` ("the sidebar's messages: ready, open dashboard, settings changes") and `src/shared/statusText.ts` ("status bar text — pure"). In the fonts row, drop Electrolize, Press Start 2P and Unica One. In the `extension.ts` row, say "sidebar wiring" instead of "mini panel refresh".
- In "Tests": update the suite count and the total (`npm test` prints both, and summing `ℹ tests` gives the total), and add rows for `status`, `mini` and `minihandler`; add the `buildMini` test to the payloads row.
- In "Status bar" under "What's done", replace "shows top language + session count in mini panel" with the TTY sidebar description.

- [ ] **Step 2: Final gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green; report the suite and test counts.

- [ ] **Step 3: Hand the Extension Development Host pass to the user**

This needs a person at VS Code. List for them:
- **Sidebar in dark, light and high-contrast themes:** the phosphor, paper and no-CRT looks.
- **Updates:** it updates every 10 s while you type; collapse the Rabbit Hole view, wait a minute, expand it, and the numbers are current at once.
- **Width:** drag the sidebar narrow (below 230 px) and wide; nothing scrolls sideways.
- **Focus:** hover and Tab through the project rows and keys and check that focus narrows and clears.
- **"open dashboard"** opens it.
- **Settings:** change `rabbithole.crt.mask` and `rabbithole.dailyTargetMinutes` in `settings.json`; the sidebar follows both within a tick.
- **Clear or import a project from the dashboard:** the sidebar reflects it within 10 s.
- **Status bar:** `3h40m / 20m`, green while tracking, with a blank where the carrot goes until phase 5.

- [ ] **Step 4: Commit**

Nothing to commit if only `CLAUDE.md` changed (it is gitignored). Otherwise:

```bash
git status --short
```

Expected: clean.

# TTY Redesign — Phase 2 (Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard webview with the TTY design from mockup v8 — top bar with carrot, project and range pickers; overview (single day and range), activity, projects and settings tabs; hover focus; the CRT layers — rendered from phase 1's `year` / `range` / `live` payloads, with Chart.js and d3 removed.

**Architecture:** The host side stays as phase 1 left it, minus the old `init` / `update` / `requestRange` / `selectProjects` protocol, plus a `requestYear` message and validated CRT writes. The webview is rebuilt as small modules. Everything that can be computed without a DOM (formatting, layout arithmetic, colours, the calendar, the view state and message cache, CRT parameters, focus parsing, stepper validation, the carrot grid) lives in pure modules with `node:test` suites. DOM modules only render what those give them, and are checked by a manual Extension Development Host pass at the end. The panel shell in `dashboardPanel.ts` holds static markup (every `fieldset` is fixed), and the modules re-render only the inside of their panel.

**Tech Stack:** TypeScript, VS Code webview API, esbuild, `node:test` + `node:assert` through `scripts/test.js`, Martian Mono (variable woff2, OFL). jsPDF stays for the interim exports.

**Spec:** `docs/superpowers/specs/2026-10-04-tty-redesign-design.md` (phase 2 = §2, §3's webview side, and the dashboard half of §1.2). The visual reference for every detail this plan does not spell out is `docs/design/mockups/dashboard.html` (v8). Read both before starting.

Phase 1's plan (`docs/superpowers/plans/2026-10-04-tty-redesign-phase1-data.md`) defined the payloads and `src/webview/model.ts` this plan consumes. Phases 3 (exports), 4 (sidebar) and 5 (icons) follow with their own plans.

## Global Constraints

- No new runtime dependencies. This phase **removes** `chart.js`, `d3` and `@types/d3`; `jspdf` stays.
- Never import `vscode` or `src/shared/config.ts` from `src/webview/*`. Type-only imports from `src/shared/types.ts` are fine.
- **No webview module touches `document` or `window` at import time.** Only `main.ts` runs code on load; every other module does DOM work inside functions. That rule is what lets the pure exports of a module be tested in node even when the same file also renders.
- Day keys are local time. Webview code uses `dayKey()` from `model.ts` and `fromKey()` / `addDaysKey()` / `dayDiff()` from `format.ts`. Never `toISOString().slice(0, 10)` and never `new Date("YYYY-MM-DD")` (UTC parsing).
- CSP stays exactly `default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};`. No `img-src`: the CRT mask is a canvas, the carrot is inline SVG.
- One font: Martian Mono, bundled. No network at runtime.
- Palettes are fixed (no host-hue tinting). Phosphor (dark) languages/projects: `#1fa866 #2a8fd0 #b87e00 #d0508f #8a6fe0 #9a9420`, other `#4f6459`. Paper (light): `#0f8a4e #1673b8 #b06a00 #c2357a #6a4fd0 #7a7400`, other `#8b968f`.
- CRT defaults are phase 1's (`slot`, `fine`, 30, `["scanlines", "bloom"]`). Light themes get half the strength; high contrast and `forced-colors` get no CRT at all; `prefers-reduced-motion` stops roll and flicker.
- Responsive: one column below 860 px; tape at most 24 cells below 620 px wide (48 otherwise); heatmap 26 weeks below 600 px (53 otherwise); `+`/`-` runs and diff-stat graphs measure their width; no horizontal page scroll at 420 px.
- House style: TypeScript, 2-space indent, no semicolons, double quotes. Comments say why, not what.
- Tests run through `scripts/test.js`. New suites are registered in its `SUITES` array.
- Every task ends with `npm test` and `npm run typecheck` passing; from Task 5 on, `npm run build` too.
- Commit messages: plain sentence case, no `feat:`-style prefix, and **no `Co-Authored-By` lines** (user rule, overrides any harness default).
- A negative control (the new test run against the pre-change source, and seen to fail) is required wherever a task changes existing behaviour, per `CLAUDE.md`. The temp copy lives inside `src/` and is deleted afterwards.

## Deviations from the spec, decided while planning

1. **Old export and sidebar files survive this phase.** `exportShared.ts`, `jpgExport.ts`, `pdfExport.ts` and `fonts/Electrolize-Regular.ttf` are still what writes a share card or report until phase 3 replaces them. `derivePalette.ts`, `miniTheme.ts`, `fonts/PressStart2P.woff2`, `fonts/UnicaOne-Regular.woff2` and the Electrolize font are what the sidebar still loads until phase 4. The spec's §2.2 deletions of those files move to those phases. Deleted here: `charts.ts`, the d3 `heatmap.ts` (replaced), `theme.ts`.
2. **The export dialog is interim.** Settings → export opens a TTY dialog (format, range, project) that drives the *existing* generators: share card for today only, report for today / 30d / 90d, CSV and JSON for today / 7d / 30d / 90d through phase 1's ranged `export`. Phase 3 replaces the generators, adds the live card preview and the wider card ranges.
3. **More, smaller modules than §2.2 lists.** Added: `format.ts`, `layout.ts`, `colors.ts`, `calendar.ts` (pure, tested), `overview.ts` and `activityTab.ts` (each tab's composition, so `main.ts` stays wiring only) and `stepper.ts` (the `−`/`+`/apply controls shared by Settings and Projects).
4. **No git branch in the top bar.** The mockup showed one; no payload carries it.
5. **Colour assignment.** Projects take `--c1…--c6` by registry order (wrapping after six). Languages take `--c1…--c6` by rank in the *unfocused* view (`View.wholeLanguages`), so a hover never recolours anything; the seventh language onward is the muted `--c-other`.
6. **A single-day view also fetches the six days before it.** The lines panel shows that day's week. `fetchSpan()` in `state.ts` widens every request to at least seven days.
7. **New `requestYear` message.** A `live` update can name a project the cached year doesn't have yet (the first edit in a new folder); the webview asks for a fresh year once.
8. **The tape's cell length adapts.** Phase 1's `tapeWindow` widens 07:00–19:00 to cover night work, which made 48 equal cells uneven (16.25 min). `layout.tapeCellCount()` picks the finest of 5/10/15/20/30/60 minutes that fits the width's cell budget: 15 min for a normal day, 30 when narrow, coarser for a 24-hour window.
9. **Deferred phase 1 minors folded in:** `updateCrtSetting` is validated and its failure reported (Task 5); `seriesFor` clamps a project target to 1–1440 (Task 3); `mergeLive` no longer writes a `""` project key and reports an unknown project (Task 3). Still deferred: `live` refreshes only the working project's today log (other projects aren't being worked in this window), and DST days draw an hour off on the tape.

## Review Focus

1. **A brand-new install** — no projects, an all-zero year, an empty range — must render every tab with "no activity" text and no `NaN`, `Infinity` or thrown error. Tests in Task 1 (empty inputs to every layout helper) and Task 3 (store with an empty year).
2. **Midnight with the dashboard open.** A view on "today" must move to the new day; a view on "7d" must move with it; a picked range must stay put. Test in Task 3.
3. **Out-of-order replies.** Clicking 7d then 30d quickly must never show 7d's data under the 30d label. Test in Task 3.
4. **Project ids containing colons** (git remote ids like `git@github.com:me/x.git`) inside a `data-hl="p:<id>"` focus attribute must round-trip intact. Test in Task 4.
5. **Narrow widths.** `+`/`-` runs must never exceed the measured columns, and the tape must fit a 24-hour window in 24 cells. Tests in Task 1.

---

## File map

| File | Status | Job |
|---|---|---|
| `src/webview/format.ts` | create | durations, dates, paths as text (pure) |
| `src/webview/layout.ts` | create | tape/heatmap/column/run arithmetic (pure) |
| `src/webview/colors.ts` | create | project and language colours, project names (pure) |
| `src/webview/calendar.ts` | create | presets, range picking rules, month grids (pure) |
| `src/webview/carrot.ts` | create | the 14×10 carrot grid and its SVG |
| `src/webview/state.ts` | create | `Store`: view state, message cache, request rules (pure) |
| `src/webview/model.ts` | modify | clamp in `seriesFor`; `mergeLive` returns whether the project is known |
| `src/webview/dom.ts` | create | element helpers, width observer |
| `src/webview/tooltip.ts` | create | the one tooltip |
| `src/webview/crt.ts` | create | CRT parameters (pure) and layers |
| `src/webview/focus.ts` | create | hover/keyboard focus, height locking |
| `src/webview/projectPicker.ts`, `datePicker.ts` | create | top-bar pickers and range buttons |
| `src/webview/tape.ts`, `streak.ts`, `rangeColumns.ts`, `lines.ts`, `languages.ts`, `files.ts`, `sessionLog.ts` | create | overview panels |
| `src/webview/overview.ts` | create | overview composition |
| `src/webview/heatmap.ts` | replace | block-glyph heatmap |
| `src/webview/activityTab.ts` | create | activity composition |
| `src/webview/stepper.ts` | create | `−`/`+`/apply controls |
| `src/webview/projectCards.ts` | create | projects tab |
| `src/webview/settingsTab.ts` | create | settings tab and console |
| `src/webview/exportDialog.ts` | create | interim export dialog |
| `src/webview/main.ts` | replace | wiring only |
| `src/webview/style.css` | replace | TTY styles |
| `src/webview/fonts/MartianMono-VF.woff2`, `MartianMono-OFL.txt` | add | the font and its licence |
| `src/webview/charts.ts`, `theme.ts` | delete | |
| `src/dashboard/dashboardPanel.ts` | modify | new shell markup |
| `src/dashboard/messageHandler.ts` | modify | old protocol out, `requestYear` in, CRT validation |
| `src/shared/config.ts` | modify | `crtSettingValue()` |
| `src/shared/types.ts` | modify | message unions |
| `src/extension.ts` | modify | stop posting `update` |
| `package.json` | modify | dependencies |
| `test/webview.view.test.ts`, `webview.carrot.test.ts`, `webview.state.test.ts`, `webview.display.test.ts`, `webview.stepper.test.ts` | create | |
| `test/webview.model2.test.ts`, `dashboard.handler.test.ts`, `config.crt.test.ts` | modify | |

---

### Task 1: Pure helpers — format, layout, colours, calendar

**Files:**
- Create: `src/webview/format.ts`, `src/webview/layout.ts`, `src/webview/colors.ts`, `src/webview/calendar.ts`
- Create: `test/webview.view.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Consumes: `dayKey`, `TapeWindow`, `LangRow` from `model.ts`; `YearPayload` from `types.ts`.
- Produces:
  - `format.ts`: `MIN`, `HOUR`, `MON`, `WD`, `pad2(n)`, `fromKey(key): Date`, `addDaysKey(key, n): string`, `dayDiff(a, b): number`, `fmt(ms)`, `hours(ms)`, `hhmm(minutes)`, `clock(unixMs)`, `dstr(key)`, `shortDate(key)`, `weekday(key)`, `signed(n)`, `plural(n, word)`, `pct(part, whole)`, `ago(then | undefined, now)`, `splitPath(path, root | undefined): { dir; name }`.
  - `layout.ts`: `TAPE_GLYPHS: string[]`, `SPARK`, `SEG = 12`, `tapeMaxCells(width): 24 | 48`, `heatWeeksFor(width): 26 | 53`, `tapeCellCount(windowMin, maxCells): number`, `tapeTicks(win: TapeWindow, maxCells): string[]`, `tapeKey(win, average): string`, `runs(added, deleted, max, cols): [number, number]`, `colSegments(ms, max): number[]`, `colGap(n): number`, `AxisLabel { text; cls; col; span }`, `colAxis(dates, today): AxisLabel[]`, `heatLevel(ms): 0|1|2|3|4`, `heatCells(total, weeks): (number | null)[]`, `heatMonths(days, weeks): { text; col }[]`, `sparkGlyphs(values): { glyph; zero }[]`, `meter(ms, targetMs): [number, number]`.
  - `colors.ts`: `PALETTE_SIZE = 6`, `OTHER = "var(--c-other)"`, `projectColor(year | null, id): string`, `languageColors(rows: LangRow[]): Map<string, string>`, `langColor(map, name): string`, `Names { project(id); color(id); root(id) }`, `namesFor(year): Names`.
  - `calendar.ts`: `MAX_SPAN = 92`, `RangeId = "today" | "yday" | "7d" | "30d"`, `PRESETS`, `presetRange(id, today): { from; to }`, `presetOf(from, to, today): RangeId | null`, `Pick { start: string | null; end: string | null }`, `pickDay(p, day): Pick`, `dayDisabled(p, day, first, today): boolean`, `monthDays(year, month): (string | null)[]`, `pickLabel(p): string`, `rangeLabel(from, to): string`.

- [ ] **Step 1: Register the suite and write the failing tests**

Add to `SUITES` in `scripts/test.js`, after the `model2` entry:

```js
  {
    name: "view",
    entry: "test/webview.view.test.ts",
    alias: {
      format: "src/webview/format.ts",
      layout: "src/webview/layout.ts",
      colors: "src/webview/colors.ts",
      calendar: "src/webview/calendar.ts",
    },
  },
```

Create `test/webview.view.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/format.ts
import { addDaysKey, ago, dayDiff, dstr, fmt, hhmm, hours, signed, splitPath } from "format"
// @ts-ignore — esbuild alias to src/webview/layout.ts
import { colAxis, colSegments, heatCells, heatLevel, heatMonths, heatWeeksFor, meter, runs, sparkGlyphs, tapeCellCount, tapeMaxCells, tapeTicks } from "layout"
// @ts-ignore — esbuild alias to src/webview/colors.ts
import { OTHER, languageColors, namesFor, projectColor } from "colors"
// @ts-ignore — esbuild alias to src/webview/calendar.ts
import { dayDisabled, monthDays, pickDay, pickLabel, presetOf, presetRange } from "calendar"

const MIN = 60_000
const HOUR = 60 * MIN

describe("format", () => {
  it("durations read like a terminal: 0m, <1m, 45m, 1h05m", () => {
    assert.strictEqual(fmt(0), "0m")
    assert.strictEqual(fmt(-5), "0m")
    assert.strictEqual(fmt(20_000), "<1m")
    assert.strictEqual(fmt(45 * MIN), "45m")
    assert.strictEqual(fmt(65 * MIN), "1h05m")
    assert.strictEqual(fmt(220 * MIN), "3h40m")
  })

  it("long totals drop the minutes", () => {
    assert.strictEqual(hours(12.4 * HOUR), "12h")
    assert.strictEqual(hours(9 * HOUR), "9h00m")
  })

  it("clock text rounds without reaching :60", () => {
    assert.strictEqual(hhmm(7 * 60 + 5), "07:05")
    assert.strictEqual(hhmm(59.6), "01:00")
  })

  it("day arithmetic is on calendar days, across month ends and DST", () => {
    assert.strictEqual(addDaysKey("2026-01-31", 1), "2026-02-01")
    assert.strictEqual(addDaysKey("2026-03-01", -1), "2026-02-28")
    assert.strictEqual(dayDiff("2026-03-28", "2026-03-30"), 2)
    assert.strictEqual(dayDiff("2026-10-31", "2026-11-02"), 2)
    assert.strictEqual(dayDiff("2026-10-03", "2026-10-03"), 0)
  })

  it("dates and signs", () => {
    assert.strictEqual(dstr("2026-10-03"), "Sat 3 Oct")
    assert.strictEqual(signed(-12), "−12")
    assert.strictEqual(signed(0), "+0")
  })

  it("ago", () => {
    const now = new Date(2026, 9, 3, 12).getTime()
    assert.strictEqual(ago(undefined, now), "never")
    assert.strictEqual(ago(now - 30_000, now), "just now")
    assert.strictEqual(ago(now - 5 * MIN, now), "5 min ago")
    assert.strictEqual(ago(now - 3 * HOUR, now), "3 h ago")
    assert.strictEqual(ago(now - 50 * HOUR, now), "2 days ago")
  })

  it("paths show relative to the project, else their last three segments", () => {
    assert.deepStrictEqual(splitPath("C:\\Users\\me\\rh\\src\\a.ts", "C:\\Users\\me\\rh"), { dir: "src/", name: "a.ts" })
    assert.deepStrictEqual(splitPath("/x/y/z/w/file.ts", "/other"), { dir: "z/w/", name: "file.ts" })
    assert.deepStrictEqual(splitPath("/repo/README.md", "/repo"), { dir: "", name: "README.md" })
  })
})

describe("layout", () => {
  it("width breakpoints", () => {
    assert.strictEqual(tapeMaxCells(619), 24)
    assert.strictEqual(tapeMaxCells(620), 48)
    assert.strictEqual(heatWeeksFor(599), 26)
    assert.strictEqual(heatWeeksFor(600), 53)
  })

  it("tape cells are whole minutes that divide an hour, within the budget", () => {
    assert.strictEqual(tapeCellCount(720, 48), 48)    // 12 h at 15 min
    assert.strictEqual(tapeCellCount(780, 48), 39)    // 13 h at 20 min, not 52 at 15
    assert.strictEqual(tapeCellCount(1440, 48), 48)   // 24 h at 30 min
    assert.strictEqual(tapeCellCount(720, 24), 24)
    assert.strictEqual(tapeCellCount(1080, 24), 18)   // 18 h at 60 min
    assert.strictEqual(tapeCellCount(1440, 24), 24)
  })

  it("hour ticks thin out on a long, narrow tape", () => {
    const day = { startMin: 420, endMin: 1140, cells: 48, cellMin: 15 }
    const ticks = tapeTicks(day, 48)
    assert.strictEqual(ticks.length, 12)
    assert.strictEqual(ticks[0], "07")
    const all = tapeTicks({ startMin: 0, endMin: 1440, cells: 24, cellMin: 60 }, 24)
    assert.strictEqual(all.length, 24)
    assert.strictEqual(all[0], "00")
    assert.strictEqual(all[1], "")
  })

  it("+/- runs never exceed the columns and show both sides when both changed", () => {
    for (const cols of [2, 3, 6, 40]) {
      for (const [a, r] of [[1, 1], [1000, 1], [1, 1000], [500, 500], [0, 7], [7, 0]]) {
        const [na, nr] = runs(a, r, 1000, cols)
        assert.ok(na + nr <= cols, `${a}/${r} in ${cols} cols gave ${na}+${nr}`)
        if (a) assert.ok(na >= 1)
        if (r) assert.ok(nr >= 1)
      }
    }
    assert.deepStrictEqual(runs(0, 0, 0, 10), [0, 0])
  })

  it("column segments", () => {
    assert.deepStrictEqual(colSegments(0, 100), new Array(12).fill(0))
    assert.deepStrictEqual(colSegments(100, 100), new Array(12).fill(1))
    assert.strictEqual(colSegments(1, 1000)[0], 0.25)   // a sliver still shows
  })

  it("column axis labels by range length", () => {
    const week = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]
    const a = colAxis(week, "2026-10-03")
    assert.strictEqual(a.length, 7)
    assert.strictEqual(a[6].text, "sat 3")
    assert.strictEqual(a[6].cls, "now")
    const month = Array.from({ length: 30 }, (_: unknown, i: number) => addDaysKey("2026-09-04", i))
    assert.ok(colAxis(month, "2026-10-03").every((l: any) => l.cls === "mon"))
    assert.deepStrictEqual(colAxis([], "2026-10-03"), [])
  })

  it("heatmap levels, cells and month labels", () => {
    assert.deepStrictEqual([0, 29 * MIN, 30 * MIN, 90 * MIN, 180 * MIN].map(heatLevel), [0, 1, 2, 3, 4])
    assert.strictEqual(heatCells(371, 53).length, 371)
    const short = heatCells(365, 53)
    assert.strictEqual(short.length, 371)
    assert.strictEqual(short[364], 364)
    assert.strictEqual(short[365], null)
    assert.strictEqual(heatCells(365, 26)[0], 189)
    assert.deepStrictEqual(heatCells(0, 53), [])
    // 2025-09-29 is a Monday; September only shows two days at the left edge, so its label is skipped
    const days = Array.from({ length: 371 }, (_: unknown, i: number) => addDaysKey("2025-09-29", i))
    assert.deepStrictEqual(heatMonths(days, 53)[0], { text: "oct", col: 2 })
    assert.deepStrictEqual(heatMonths([], 53), [])
  })

  it("sparklines and the target meter", () => {
    const s = sparkGlyphs([0, 5, 10])
    assert.deepStrictEqual(s.map((g: any) => g.glyph), ["▁", "▄", "█"])
    assert.deepStrictEqual(s.map((g: any) => g.zero), [true, false, false])
    assert.deepStrictEqual(sparkGlyphs([]), [])
    assert.deepStrictEqual(meter(10, 20), [5, 5])
    assert.deepStrictEqual(meter(50, 20), [10, 0])
    assert.deepStrictEqual(meter(5, 0), [10, 0])
  })
})

describe("colours", () => {
  const year: any = { projects: ["a", "b", "c", "d", "e", "f", "g"].map(id => ({ id, name: id.toUpperCase(), path: "/" + id })) }

  it("projects keep their registry colour and wrap after six", () => {
    assert.strictEqual(projectColor(year, "a"), "var(--c1)")
    assert.strictEqual(projectColor(year, "f"), "var(--c6)")
    assert.strictEqual(projectColor(year, "g"), "var(--c1)")
    assert.strictEqual(projectColor(year, "zzz"), OTHER)
    assert.strictEqual(projectColor(null, "a"), OTHER)
  })

  it("languages are coloured by rank; the seventh is other", () => {
    const rows = ["ts", "md", "go", "css", "json", "sh", "lua"].map(name => ({ name, ms: 1, added: 0, deleted: 0 }))
    const m = languageColors(rows)
    assert.strictEqual(m.get("ts"), "var(--c1)")
    assert.strictEqual(m.get("sh"), "var(--c6)")
    assert.strictEqual(m.has("lua"), false)
  })

  it("names fall back for a project the year doesn't know", () => {
    const n = namesFor(year)
    assert.strictEqual(n.project("a"), "A")
    assert.strictEqual(n.project("gone"), "unknown project")
    assert.strictEqual(n.root("b"), "/b")
  })
})

describe("calendar", () => {
  const today = "2026-10-03"

  it("presets and back", () => {
    assert.deepStrictEqual(presetRange("7d", today), { from: "2026-09-27", to: today })
    assert.deepStrictEqual(presetRange("yday", today), { from: "2026-10-02", to: "2026-10-02" })
    assert.strictEqual(presetOf("2026-09-04", today, today), "30d")
    assert.strictEqual(presetOf("2026-09-05", today, today), null)
  })

  it("click a start, then an end; an earlier click becomes the start", () => {
    let p = pickDay({ start: null, end: null }, "2026-09-10")
    p = pickDay(p, "2026-09-20")
    assert.deepStrictEqual(p, { start: "2026-09-10", end: "2026-09-20" })
    p = pickDay(pickDay(p, "2026-09-15"), "2026-09-12")
    assert.deepStrictEqual(p, { start: "2026-09-12", end: "2026-09-15" })
    // too far back to keep the old start as the end
    p = pickDay({ start: "2026-09-15", end: null }, "2026-05-01")
    assert.deepStrictEqual(p, { start: "2026-05-01", end: null })
  })

  it("days past today, before the year and beyond 92 days are disabled", () => {
    const first = "2025-09-29"
    assert.strictEqual(dayDisabled({ start: null, end: null }, "2026-10-04", first, today), true)
    assert.strictEqual(dayDisabled({ start: null, end: null }, "2025-09-28", first, today), true)
    const p = { start: "2026-07-01", end: null }
    assert.strictEqual(dayDisabled(p, addDaysKey("2026-07-01", 91), first, today), false)
    assert.strictEqual(dayDisabled(p, addDaysKey("2026-07-01", 92), first, today), true)
  })

  it("month grids start on Monday", () => {
    const oct = monthDays(2026, 9)   // 1 Oct 2026 is a Thursday
    assert.deepStrictEqual(oct.slice(0, 4), [null, null, null, "2026-10-01"])
    assert.strictEqual(oct.length, 3 + 31)
  })

  it("selection text", () => {
    assert.strictEqual(pickLabel({ start: null, end: null }), "no range")
    assert.strictEqual(pickLabel({ start: "2026-09-10", end: null }), "10 Sep – …")
    assert.strictEqual(pickLabel({ start: "2026-09-10", end: "2026-09-12" }), "10 Sep – 12 Sep · 3 days")
  })
})
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node scripts/test.js --suite view`
Expected: FAIL — esbuild cannot resolve `src/webview/format.ts` (`Could not resolve`).

- [ ] **Step 3: Write `src/webview/format.ts`**

```ts
// Text and date formatting shared by every panel. Pure: no DOM, no vscode.
import { dayKey } from "./model"

export const MIN = 60_000
export const HOUR = 60 * MIN
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const pad2 = (n: number): string => String(n).padStart(2, "0")

// A "YYYY-MM-DD" key as a local date. new Date("YYYY-MM-DD") parses as UTC,
// which is the previous day everywhere west of Greenwich.
export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function addDaysKey(key: string, n: number): string {
  const d = fromKey(key)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

// Whole days from a to b, counted on UTC midnights so a 23- or 25-hour DST day is still one day.
export function dayDiff(a: string, b: string): number {
  const utc = (k: string) => {
    const [y, m, d] = k.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(b) - utc(a)) / 86_400_000)
}

// 0m, <1m, 45m, 1h05m, 3h40m
export function fmt(ms: number): string {
  if (ms <= 0) return "0m"
  const m = Math.round(ms / MIN)
  if (m === 0) return "<1m"
  return m >= 60 ? `${Math.floor(m / 60)}h${pad2(m % 60)}m` : `${m}m`
}

// Past ten hours the minutes are noise.
export const hours = (ms: number): string => (ms >= 10 * HOUR ? `${Math.round(ms / HOUR)}h` : fmt(ms))

// Minutes since midnight as HH:MM, rounded first so 59.6 is 01:00, never 00:60.
export function hhmm(minutes: number): string {
  const m = Math.round(minutes)
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

export function clock(unixMs: number): string {
  const d = new Date(unixMs)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function dstr(key: string): string {
  const d = fromKey(key)
  return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`
}

export function shortDate(key: string): string {
  const d = fromKey(key)
  return `${d.getDate()} ${MON[d.getMonth()]}`
}

export const weekday = (key: string): string => WD[fromKey(key).getDay()]
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`)
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`
export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round(part / whole * 100) : 0)

export function ago(then: number | undefined, now: number): string {
  if (then === undefined) return "never"
  const m = Math.floor((now - then) / MIN)
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${plural(Math.floor(h / 24), "day")} ago`
}

// A recorded (absolute) file path as git would show it: relative to the project
// when it is inside it, otherwise its last three segments.
export function splitPath(path: string, root: string | undefined): { dir: string; name: string } {
  const p = path.replace(/\\/g, "/")
  const r = (root ?? "").replace(/\\/g, "/").replace(/\/+$/, "")
  const rel = r && p.toLowerCase().startsWith(r.toLowerCase() + "/")
    ? p.slice(r.length + 1)
    : p.split("/").filter(Boolean).slice(-3).join("/")
  const i = rel.lastIndexOf("/")
  return i < 0 ? { dir: "", name: rel } : { dir: rel.slice(0, i + 1), name: rel.slice(i + 1) }
}
```

- [ ] **Step 4: Write `src/webview/layout.ts`**

```ts
// Layout arithmetic for the text charts. Pure, so the width rules are tested
// without a browser.
import { MIN, MON, WD, fromKey, pad2 } from "./format"
import type { TapeWindow } from "./model"

export const TAPE_GLYPHS = ["·", "░", "▒", "▓", "█"]
export const SPARK = "▁▂▃▄▅▆▇█"
export const SEG = 12

export const tapeMaxCells = (width: number): 24 | 48 => (width < 620 ? 24 : 48)
export const heatWeeksFor = (width: number): 26 | 53 => (width < 600 ? 26 : 53)

// Cells are whole minutes that divide an hour, as fine as the budget allows:
// 15 min for a 12-hour day when wide, 30 when narrow, coarser when night work
// widens the window. Uneven cells (16.25 min) would make the tooltips lie.
const CELL_MINUTES = [5, 10, 15, 20, 30, 60]
export function tapeCellCount(windowMin: number, maxCells: number): number {
  for (const c of CELL_MINUTES) if (windowMin / c <= maxCells) return windowMin / c
  return windowMin / 60
}

// One label per hour; every other one when a long window meets a narrow tape.
export function tapeTicks(win: TapeWindow, maxCells: number): string[] {
  const n = Math.round((win.endMin - win.startMin) / 60)
  const step = n > (maxCells <= 24 ? 12 : 18) ? 2 : 1
  const first = win.startMin / 60
  return Array.from({ length: n }, (_, i) => (i % step === 0 ? pad2(first + i) : ""))
}

export function tapeKey(win: TapeWindow, average: boolean): string {
  const c = win.cellMin
  return average
    ? `each cell is ${c} min; █ marks the busiest slots`
    : `each cell is ${c} min: █ ${Math.ceil(c * 0.75)}m+ active … ░ under ${Math.ceil(c * 0.25)}m`
}

// Lengths of the + and - runs for a row, scaled to the biggest row. Both sides
// stay visible when both changed, and together they never pass `cols`.
export function runs(added: number, deleted: number, max: number, cols: number): [number, number] {
  const scale = (v: number) => Math.round(v / Math.max(1, max) * cols)
  const na = added ? Math.max(0, Math.min(Math.max(1, scale(added)), cols - (deleted ? 1 : 0))) : 0
  const nr = deleted ? Math.max(0, Math.min(Math.max(1, scale(deleted)), cols - na)) : 0
  return [na, nr]
}

// How full each of a range column's SEG segments is (0–1), bottom first. A day
// with any activity shows at least a quarter segment.
export function colSegments(ms: number, max: number): number[] {
  const h = ms > 0 ? Math.max(0.25, ms / Math.max(1, max) * SEG) : 0
  return Array.from({ length: SEG }, (_, s) => Math.max(0, Math.min(1, h - s)))
}

export const colGap = (n: number): number => (n > 45 ? 1 : n > 20 ? 2 : 5)

export interface AxisLabel { text: string; cls: string; col: number; span: number }

// A week names its days, two weeks number them, longer ranges label Mondays.
export function colAxis(dates: string[], today: string): AxisLabel[] {
  const n = dates.length
  const out: AxisLabel[] = []
  dates.forEach((key, i) => {
    const d = fromKey(key)
    const cls = key === today ? "now" : ""
    if (n <= 7) out.push({ text: `${WD[d.getDay()].toLowerCase()} ${d.getDate()}`, cls, col: i + 1, span: 1 })
    else if (n <= 16) out.push({ text: String(d.getDate()), cls, col: i + 1, span: 1 })
    else if (d.getDay() === 1 && n - i >= 3) {
      out.push({ text: `${d.getDate()} ${MON[d.getMonth()].toLowerCase()}`, cls: "mon", col: i + 1, span: Math.min(7, n - i) })
    }
  })
  return out
}

export function heatLevel(ms: number): 0 | 1 | 2 | 3 | 4 {
  if (ms <= 0) return 0
  if (ms < 30 * MIN) return 1
  if (ms < 90 * MIN) return 2
  if (ms < 180 * MIN) return 3
  return 4
}

// Indices into the year's days for the last `weeks` whole weeks, Monday first
// (the year starts on a Monday); null for the days after today.
export function heatCells(total: number, weeks: number): (number | null)[] {
  const all = Math.ceil(total / 7)
  const first = Math.max(0, all - weeks) * 7
  const out: (number | null)[] = []
  for (let i = first; i < all * 7; i++) out.push(i < total ? i : null)
  return out
}

export function heatMonths(days: string[], weeks: number): { text: string; col: number }[] {
  const all = Math.ceil(days.length / 7)
  const first = Math.max(0, all - weeks)
  const out: { text: string; col: number }[] = []
  let last = -1
  for (let w = first; w < all; w++) {
    const m = fromKey(days[w * 7]).getMonth()
    if (m === last) continue
    last = m
    // a month showing only its last days at the left edge would collide with the next label
    if (w === first && fromKey(days[Math.min(days.length - 1, (first + 2) * 7)]).getMonth() !== m) continue
    out.push({ text: MON[m].toLowerCase(), col: w - first + 1 })
  }
  return out
}

export function sparkGlyphs(values: number[]): { glyph: string; zero: boolean }[] {
  const max = Math.max(1, ...values)
  return values.map(v => (v > 0
    ? { glyph: SPARK[Math.min(7, Math.floor(v / max * 7.999))], zero: false }
    : { glyph: SPARK[0], zero: true }))
}

// Ten cells of progress toward the target: [filled, empty].
export function meter(ms: number, targetMs: number): [number, number] {
  const filled = targetMs > 0 ? Math.min(10, Math.round(ms / targetMs * 10)) : 10
  return [filled, 10 - filled]
}
```

- [ ] **Step 5: Write `src/webview/colors.ts`**

```ts
// Colours and names for projects and languages. Pure: the CSS custom
// properties --c1…--c6 and --c-other hold the per-theme values.
import type { YearPayload } from "../shared/types"
import type { LangRow } from "./model"

export const PALETTE_SIZE = 6
export const OTHER = "var(--c-other)"
const slot = (i: number): string => `var(--c${(i % PALETTE_SIZE) + 1})`

// By registry order, which never reorders, so a project keeps its colour everywhere.
export function projectColor(year: YearPayload | null, id: string): string {
  const i = year ? year.projects.findIndex(p => p.id === id) : -1
  return i < 0 ? OTHER : slot(i)
}

// By rank in the unfocused view, so hovering never recolours anything. Past
// six languages the rest share the muted "other".
export function languageColors(rows: LangRow[]): Map<string, string> {
  const m = new Map<string, string>()
  rows.slice(0, PALETTE_SIZE).forEach((r, i) => m.set(r.name, slot(i)))
  return m
}

export const langColor = (m: Map<string, string>, name: string): string => m.get(name) ?? OTHER

export interface Names {
  project(id: string): string
  color(id: string): string
  root(id: string): string | undefined
}

export function namesFor(year: YearPayload): Names {
  return {
    project: id => year.projects.find(p => p.id === id)?.name ?? "unknown project",
    color: id => projectColor(year, id),
    root: id => year.projects.find(p => p.id === id)?.path,
  }
}
```

- [ ] **Step 6: Write `src/webview/calendar.ts`**

```ts
// Range presets and the two-month picker's rules. Pure.
import { addDaysKey, dayDiff, plural, shortDate } from "./format"
import { dayKey } from "./model"

export const MAX_SPAN = 92   // the host's limit (payloads.MAX_RANGE_DAYS)

export type RangeId = "today" | "yday" | "7d" | "30d"
export const PRESETS: Record<RangeId, [number, number]> = { today: [0, 0], yday: [-1, -1], "7d": [-6, 0], "30d": [-29, 0] }

export function presetRange(id: RangeId, today: string): { from: string; to: string } {
  const [a, z] = PRESETS[id]
  return { from: addDaysKey(today, a), to: addDaysKey(today, z) }
}

export function presetOf(from: string, to: string, today: string): RangeId | null {
  for (const id of Object.keys(PRESETS) as RangeId[]) {
    const r = presetRange(id, today)
    if (r.from === from && r.to === to) return id
  }
  return null
}

export interface Pick { start: string | null; end: string | null }

// Click a start day, then an end day. A click before the start becomes the
// start, keeping the old start as the end while the span still fits.
export function pickDay(p: Pick, day: string): Pick {
  if (!p.start || p.end) return { start: day, end: null }
  if (day < p.start) return { start: day, end: dayDiff(day, p.start) < MAX_SPAN ? p.start : null }
  if (dayDiff(p.start, day) >= MAX_SPAN) return p
  return { start: p.start, end: day }
}

export function dayDisabled(p: Pick, day: string, first: string, today: string): boolean {
  if (day < first || day > today) return true
  return !!p.start && !p.end && day >= p.start && dayDiff(p.start, day) >= MAX_SPAN
}

// One month, Monday first, with nulls for the blanks before the 1st.
export function monthDays(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1)
  const out: (string | null)[] = new Array<string | null>((first.getDay() + 6) % 7).fill(null)
  for (const d = new Date(first); d.getMonth() === month; d.setDate(d.getDate() + 1)) out.push(dayKey(d))
  return out
}

export function pickLabel(p: Pick): string {
  if (!p.start) return "no range"
  if (!p.end) return `${shortDate(p.start)} – …`
  return `${shortDate(p.start)} – ${shortDate(p.end)} · ${plural(dayDiff(p.start, p.end) + 1, "day")}`
}

// The calendar button's text once a range that isn't a preset is showing.
export const rangeLabel = (from: string, to: string): string =>
  (from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`).toLowerCase()
```

- [ ] **Step 7: Run the suite to verify it passes**

Run: `node scripts/test.js --suite view`
Expected: PASS, 23 tests in the `view` suite.

- [ ] **Step 8: Typecheck, full run, commit**

Run: `npm run typecheck && npm test`
Expected: both pass.

```bash
git add src/webview/format.ts src/webview/layout.ts src/webview/colors.ts src/webview/calendar.ts test/webview.view.test.ts scripts/test.js
git commit -m "Add the pure formatting, layout, colour and calendar helpers for the TTY dashboard"
```

---

### Task 2: The carrot

**Files:**
- Create: `src/webview/carrot.ts`
- Create: `test/webview.carrot.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Produces: `CARROT: string[]` (10 rows of 14 characters; `.` empty, `O` orange, `B` brown, `G` green), `CARROT_COLORS: Record<string, string>`, `CARROT_W = 14`, `CARROT_H = 10`, `carrotPixels(): { x; y; c }[]`, `carrotSvg(scale): SVGSVGElement` (DOM, call-time only). Phases 4 and 5 reuse all of these.

- [ ] **Step 1: Register the suite and write the failing test**

Add to `SUITES` after `view`:

```js
  {
    name: "carrot",
    entry: "test/webview.carrot.test.ts",
    alias: { carrot: "src/webview/carrot.ts" },
  },
```

Create `test/webview.carrot.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
// @ts-ignore — esbuild alias to src/webview/carrot.ts
import { CARROT, CARROT_H, CARROT_W, carrotPixels } from "carrot"

// The cells resources/icon.svg fills. It is 48×34 for 14×10 cells, drawn as
// single-cell <rect>s and a few merged "M x y H x2 V y2 H x V y Z" paths.
function iconCells(svg: string): Set<string> {
  const cw = 48 / 14
  const ch = 3.4
  const out = new Set<string>()
  const add = (x: number, y: number, w: number, h: number) => {
    for (let c = Math.round(x / cw); c < Math.round((x + w) / cw); c++) {
      for (let r = Math.round(y / ch); r < Math.round((y + h) / ch); r++) out.add(`${c},${r}`)
    }
  }
  const attr = (tag: string, k: string) => {
    const m = new RegExp(`\\s${k}="([\\d.]+)"`).exec(tag)
    return m ? Number(m[1]) : 0
  }
  for (const m of svg.matchAll(/<rect[^>]*>/g)) add(attr(m[0], "x"), attr(m[0], "y"), attr(m[0], "width"), attr(m[0], "height"))
  for (const m of svg.matchAll(/<path d="M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+V[\d.]+Z"/g)) {
    const [x1, y1, x2, y2] = m.slice(1, 5).map(Number)
    add(x1, y1, x2 - x1, y2 - y1)
  }
  return out
}

describe("carrot", () => {
  it("is 14 by 10 with only known colours", () => {
    assert.strictEqual(CARROT.length, CARROT_H)
    for (const row of CARROT) assert.match(row, new RegExp(`^[.OBG]{${CARROT_W}}$`))
  })

  it("has exactly the shape of resources/icon.svg, including row 8's first pixel", () => {
    const want = iconCells(fs.readFileSync("resources/icon.svg", "utf8"))
    const got = new Set(carrotPixels().map((p: any) => `${p.x},${p.y}`))
    assert.deepStrictEqual([...got].sort(), [...want].sort())
    assert.ok(got.has("0,8"))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test.js --suite carrot`
Expected: FAIL — `Could not resolve` `src/webview/carrot.ts`.

- [ ] **Step 3: Write `src/webview/carrot.ts`**

```ts
// The Rabbit Hole carrot, one character per pixel. Its shape is
// resources/icon.svg's (the carrot suite fails if they drift), including the
// brown pixel at row 8, column 0 that resources/rabbithole-icon.svg is still
// missing — phase 5 adds it there.
export const CARROT = [
  ".........G....",
  ".........G..G.",
  "......BBBG.G..",
  ".....BOOOBG...",
  "....BBOOOOBGGG",
  "...BOOBOOOB...",
  "..BOOOOOOOB...",
  ".BOOOOBOOB....",
  "BOOOOOOBB.....",
  "BBBBBBBB......",
]
export const CARROT_W = 14
export const CARROT_H = 10
export const CARROT_COLORS: Record<string, string> = { O: "#FF8B00", B: "#A5510C", G: "#01FF00" }

export function carrotPixels(): { x: number; y: number; c: string }[] {
  const out: { x: number; y: number; c: string }[] = []
  CARROT.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") out.push({ x, y, c: CARROT_COLORS[ch] }) }))
  return out
}

const SVG_NS = "http://www.w3.org/2000/svg"

// Crisp at any whole-number scale; the CSS glow goes on the <svg>.
export function carrotSvg(scale: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("width", String(CARROT_W * scale))
  svg.setAttribute("height", String(CARROT_H * scale))
  svg.setAttribute("viewBox", `0 0 ${CARROT_W} ${CARROT_H}`)
  svg.setAttribute("shape-rendering", "crispEdges")
  svg.setAttribute("role", "img")
  svg.setAttribute("aria-label", "Rabbit Hole")
  for (const p of carrotPixels()) {
    const r = document.createElementNS(SVG_NS, "rect")
    r.setAttribute("x", String(p.x))
    r.setAttribute("y", String(p.y))
    r.setAttribute("width", "1")
    r.setAttribute("height", "1")
    r.setAttribute("fill", p.c)
    svg.append(r)
  }
  return svg
}
```

- [ ] **Step 4: Run it to verify it passes, and prove the shape test bites**

Run: `node scripts/test.js --suite carrot`
Expected: PASS, 2 tests.

Negative control: copy `src/webview/carrot.ts` to `src/webview/_negcontrol.ts`, change its row 8 to `".OOOOOOBB....."` (the mockup's old shape), then run
`node scripts/test.js --suite carrot --alias carrot=src/webview/_negcontrol.ts`
Expected: FAIL in "has exactly the shape of resources/icon.svg". Delete `src/webview/_negcontrol.ts`.

- [ ] **Step 5: Typecheck, full run, commit**

Run: `npm run typecheck && npm test`

```bash
git add src/webview/carrot.ts test/webview.carrot.test.ts scripts/test.js
git commit -m "Add the carrot grid, checked against icon.svg"
```

---
### Task 3: Model fixes and the store

**Files:**
- Modify: `src/webview/model.ts` (`seriesFor`, `mergeLive`)
- Modify: `test/webview.model2.test.ts`
- Create: `src/webview/state.ts`
- Create: `test/webview.state.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Consumes: `RangeId`, `presetRange` (Task 1); `addDaysKey` (Task 1); `Focus`, `Selection`, `mergeLive` from `model.ts`; `ExtensionMessage`, `WebviewMessage`, `YearPayload`, `RangePayload`, `CrtSettings`, `DailyLog` from `types.ts`.
- Produces:
  - `model.ts`: `mergeLive(year, range, live): boolean` — `false` when `live.projectId` is a project the year doesn't list. `seriesFor` clamps a project's own target to 1–1440 minutes.
  - `state.ts`: `Tab = "overview" | "activity" | "projects" | "settings"`, `Settings { dailyTargetMs; dailyTargetMinutes; idleThresholdMinutes; storagePath; crt }`, `Back { from; to; preset }`, `ViewState { sel; from; to; preset: RangeId | null; back: Back | null; focus }`, `ConsoleLine { cls: "cmd" | "ok" | "bad" | ""; text }`, `Change = "year" | "days" | "focus" | "settings" | "console"`, `subRange(range, from, to): RangePayload | null`, `fetchSpan(from, to): { from; to }`, and `class Store` with fields `year`, `settings`, `here`, `refused`, `console`, `view` and methods `on(fn)`, `days(from?, to?)`, `setView(from, to, preset, back?)`, `setSelection(sel)`, `setFocus(focus)`, `note(cls, text)`, `receive(msg)`.
  - `WebviewMessage` gains `{ type: "requestYear" }` in Task 5; the store posts it here already, so this task adds that one union member now (Step 5).

- [ ] **Step 1: Write the failing model tests**

Append to `test/webview.model2.test.ts` (it already imports `mergeLive` and `seriesFor`, and defines `MIN` and `year()`):

```ts
describe("phase 2 fixes", () => {
  const liveFor = (projectId: string): any => ({
    today: "2026-10-03", projectId,
    log: { date: "2026-10-03", totalTime: 0, activeTime: 0, streak: 0, languages: {}, agents: {}, files: [], sessions: [] },
    todayActive: {}, globalToday: 0, globalStreak: 0, streaks: {},
  })

  it("a hand-edited project target is clamped the way the host clamps it", () => {
    const y = year()
    y.projects[0].dailyTargetMinutes = 0
    let s = seriesFor(y, "alpha")
    assert.strictEqual(s.targetMs[s.targetMs.length - 1], MIN)
    y.projects[0].dailyTargetMinutes = 5000
    s = seriesFor(y, "alpha")
    assert.strictEqual(s.targetMs[s.targetMs.length - 1], 1440 * MIN)
  })

  it("a live update with no project leaves no empty key in the range", () => {
    const range: any = { from: "2026-10-03", to: "2026-10-03", logs: {} }
    assert.strictEqual(mergeLive(year(), range, liveFor("")), true)
    assert.deepStrictEqual(Object.keys(range.logs), [])
  })

  it("says when the live project isn't in the year yet", () => {
    assert.strictEqual(mergeLive(year(), null, liveFor("newcomer")), false)
    assert.strictEqual(mergeLive(year(), null, liveFor("alpha")), true)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node scripts/test.js --suite model2`
Expected: FAIL — the clamp test gets `0` instead of `60000`, the empty-key test finds `[""]`, the unknown-project test gets `undefined`.

- [ ] **Step 3: Fix `model.ts`**

In `seriesFor`, replace the line

```ts
  const current = p?.dailyTargetMinutes !== undefined ? p.dailyTargetMinutes * 60_000 : year.globalTargetMs
```

with

```ts
  // settings.json takes any number; the host clamps a project target the same way
  const own = p?.dailyTargetMinutes
  const current = own !== undefined ? Math.min(1440, Math.max(1, Math.round(own))) * 60_000 : year.globalTargetMs
```

Replace `mergeLive` with:

```ts
// Fold a 10-second live update into the cached payloads. It replaces today's
// values and never adds to them, so leaving the dashboard open can't inflate today.
// Returns false when the update names a project the year doesn't list yet (the
// first edit in a new folder), so the caller can ask for a fresh year.
export function mergeLive(year: YearPayload, range: RangePayload | null, live: LivePayload): boolean {
  // Streaks move when today's target is met, which can happen while the dashboard is open.
  year.global.streak = live.globalStreak
  for (const p of year.projects) {
    if (live.streaks[p.id] !== undefined) p.streak = live.streaks[p.id]
  }
  const i = year.days.indexOf(live.today)
  if (i >= 0) {
    for (const p of year.projects) {
      if (live.todayActive[p.id] !== undefined) p.active[i] = live.todayActive[p.id]
    }
    year.global.active[i] = live.globalToday
  }
  // no project open (an empty window) means no log to file under one
  if (range && live.projectId && live.today >= range.from && live.today <= range.to) {
    const logs: DailyLog[] = range.logs[live.projectId] ?? (range.logs[live.projectId] = [])
    const j = logs.findIndex(l => l.date === live.today)
    if (j >= 0) logs[j] = live.log
    else logs.push(live.log)
  }
  return !live.projectId || year.projects.some(p => p.id === live.projectId)
}
```

- [ ] **Step 4: Run them to verify they pass, with a negative control**

Run: `node scripts/test.js --suite model2`
Expected: PASS (22 tests).

Negative control: `git show HEAD:src/webview/model.ts > src/webview/_negcontrol.ts`, then
`node scripts/test.js --suite model2 --alias model=src/webview/_negcontrol.ts`
Expected: the three "phase 2 fixes" tests FAIL, the other 19 pass. Delete `src/webview/_negcontrol.ts`.

- [ ] **Step 5: Add `requestYear` to the protocol type**

In `src/shared/types.ts`, add a member to `WebviewMessage` directly after `{ type: "ready" }`:

```ts
  | { type: "requestYear" }        // a live update named a project the cached year doesn't have
```

(The host handles it in Task 5; until then an unknown type falls through the handler's `switch` harmlessly.)

- [ ] **Step 6: Register the store suite and write its failing tests**

Add to `SUITES` after `carrot`:

```js
  {
    name: "state",
    entry: "test/webview.state.test.ts",
    alias: { state: "src/webview/state.ts" },
  },
```

Create `test/webview.state.test.ts`:

```ts
import { beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/state.ts
import { Store, fetchSpan, subRange } from "state"

const MIN = 60_000
const blankLog = (date: string): any => ({ date, totalTime: 0, activeTime: 0, streak: 0, languages: {}, agents: {}, files: [], sessions: [] })

function year(today: string, days: string[], ids = ["alpha"]): any {
  const zeros = () => days.map(() => 0)
  const nulls = () => days.map(() => null)
  return {
    type: "year", today, days, globalTargetMs: 20 * MIN,
    global: { streak: 0, active: zeros(), targetMs: nulls() },
    projects: ids.map(id => ({ id, name: id, path: "/" + id, streak: 0, active: zeros(), targetMs: nulls() })),
  }
}
const OCT3 = ["2026-10-01", "2026-10-02", "2026-10-03"]
const OCT4 = ["2026-10-02", "2026-10-03", "2026-10-04"]

function rangeMsg(from: string, to: string, ids = ["alpha"]): any {
  return { type: "range", from, to, logs: Object.fromEntries(ids.map(id => [id, []])) }
}
function live(projectId: string): any {
  return { type: "live", today: "2026-10-03", projectId, log: blankLog("2026-10-03"), todayActive: {}, globalToday: 0, globalStreak: 0, streaks: {} }
}

let posts: any[]
let s: any
const requests = () => posts.filter(m => m.type === "requestDays")
beforeEach(() => {
  posts = []
  s = new Store((m: any) => posts.push(m))
})

describe("store: what it asks the host for", () => {
  it("opens on today and fetches the week ending today", () => {
    s.receive(year("2026-10-03", OCT3))
    assert.strictEqual(s.view.from, "2026-10-03")
    assert.strictEqual(s.view.to, "2026-10-03")
    assert.strictEqual(s.view.preset, "today")
    assert.deepStrictEqual(requests(), [{ type: "requestDays", from: "2026-09-27", to: "2026-10-03" }])
  })

  it("a view inside the fetched days needs no request", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(rangeMsg("2026-09-27", "2026-10-03"))
    posts = []
    s.setView("2026-10-01", "2026-10-03", null)
    assert.deepStrictEqual(requests(), [])
    assert.strictEqual(s.days().from, "2026-10-01")
  })

  it("a view outside them asks", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(rangeMsg("2026-09-27", "2026-10-03"))
    posts = []
    s.setView("2026-09-04", "2026-10-03", "30d")
    assert.deepStrictEqual(requests(), [{ type: "requestDays", from: "2026-09-04", to: "2026-10-03" }])
    assert.strictEqual(s.days(), null)
  })

  it("a reply to an older request never shows under a newer view", () => {
    s.receive(year("2026-10-03", OCT3))
    s.setView("2026-09-27", "2026-10-03", "7d")
    s.setView("2026-09-04", "2026-10-03", "30d")
    s.receive(rangeMsg("2026-09-27", "2026-10-03"))
    assert.strictEqual(s.days(), null)
    s.receive(rangeMsg("2026-09-04", "2026-10-03"))
    assert.strictEqual(s.days().from, "2026-09-04")
  })

  it("a refused range is reported for the view that asked", () => {
    s.receive(year("2026-10-03", OCT3))
    s.setView("2026-01-01", "2026-10-03", null)
    s.receive({ type: "rangeRefused", from: "2026-01-01", to: "2026-10-03" })
    assert.strictEqual(s.refused, true)
    s.setView("2026-10-03", "2026-10-03", "today")
    assert.strictEqual(s.refused, false)
  })
})

describe("store: when the year changes", () => {
  it("midnight moves a today view and a 7d view with the date", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(year("2026-10-04", OCT4))
    assert.strictEqual(s.view.from, "2026-10-04")
    s.setView("2026-09-28", "2026-10-04", "7d")
    s.receive(year("2026-10-05", ["2026-10-03", "2026-10-04", "2026-10-05"]))
    assert.deepStrictEqual([s.view.from, s.view.to], ["2026-09-29", "2026-10-05"])
  })

  it("a picked range stays put at midnight", () => {
    s.receive(year("2026-10-03", OCT3))
    s.setView("2026-09-01", "2026-09-10", null)
    s.receive(year("2026-10-04", OCT4))
    assert.deepStrictEqual([s.view.from, s.view.to], ["2026-09-01", "2026-09-10"])
  })

  it("every year after the first refetches the shown days (data may have been wiped or imported)", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(rangeMsg("2026-09-27", "2026-10-03"))
    posts = []
    s.receive(year("2026-10-03", OCT3))
    assert.strictEqual(requests().length, 1)
  })

  it("a selected project that no longer exists falls back to all projects", () => {
    s.receive(year("2026-10-03", OCT3))
    s.setSelection("alpha")
    s.receive(year("2026-10-03", OCT3, []))
    assert.strictEqual(s.view.sel, "all")
  })

  it("an empty install still gives a view", () => {
    s.receive(year("2026-10-03", OCT3, []))
    s.receive(rangeMsg("2026-09-27", "2026-10-03", []))
    assert.deepStrictEqual(s.days().logs, {})
  })
})

describe("store: live updates", () => {
  it("asks for the year once when live names a project it doesn't know", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(live("newcomer"))
    s.receive(live("newcomer"))
    assert.strictEqual(posts.filter(m => m.type === "requestYear").length, 1)
    assert.strictEqual(s.here, "newcomer")
  })

  it("is ignored before the first year", () => {
    s.receive(live("alpha"))
    assert.deepStrictEqual(posts, [])
  })
})

describe("store: helpers", () => {
  it("fetchSpan widens a short view to a week and leaves longer ones alone", () => {
    assert.deepStrictEqual(fetchSpan("2026-10-03", "2026-10-03"), { from: "2026-09-27", to: "2026-10-03" })
    assert.deepStrictEqual(fetchSpan("2026-09-04", "2026-10-03"), { from: "2026-09-04", to: "2026-10-03" })
  })

  it("subRange only answers inside what was fetched", () => {
    const r: any = { from: "2026-09-27", to: "2026-10-03", logs: { a: [blankLog("2026-09-27"), blankLog("2026-10-03")] } }
    assert.deepStrictEqual(subRange(r, "2026-10-03", "2026-10-03").logs.a.map((l: any) => l.date), ["2026-10-03"])
    assert.strictEqual(subRange(r, "2026-09-26", "2026-10-03"), null)
  })

  it("the console keeps the last nine lines", () => {
    for (let i = 0; i < 12; i++) s.note("", `line ${i}`)
    assert.strictEqual(s.console.length, 9)
    assert.strictEqual(s.console[0].text, "line 3")
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `node scripts/test.js --suite state`
Expected: FAIL — `Could not resolve` `src/webview/state.ts`.

- [ ] **Step 8: Write `src/webview/state.ts`**

```ts
// View state and the message cache for the dashboard. No DOM: the webview's
// postMessage is injected, so the request rules are tested in node.
import type { CrtSettings, DailyLog, ExtensionMessage, RangePayload, WebviewMessage, YearPayload } from "../shared/types"
import { RangeId, presetRange } from "./calendar"
import { addDaysKey } from "./format"
import { Focus, Selection, mergeLive } from "./model"

export type Tab = "overview" | "activity" | "projects" | "settings"
export interface Settings {
  dailyTargetMs: number
  dailyTargetMinutes: number
  idleThresholdMinutes: number
  storagePath: string
  crt: CrtSettings
}
export interface Back { from: string; to: string; preset: RangeId | null }
export interface ViewState {
  sel: Selection
  from: string
  to: string
  preset: RangeId | null        // the pressed range button; null = a picked range
  back: Back | null             // set while a day opened from a range is shown
  focus: Focus
}
export interface ConsoleLine { cls: "cmd" | "ok" | "bad" | ""; text: string }
export type Change = "year" | "days" | "focus" | "settings" | "console"

const CONSOLE_LINES = 9

export function subRange(range: RangePayload, from: string, to: string): RangePayload | null {
  if (from < range.from || to > range.to) return null
  const logs: Record<string, DailyLog[]> = {}
  for (const [id, list] of Object.entries(range.logs)) logs[id] = list.filter(l => l.date >= from && l.date <= to)
  return { from, to, logs }
}

// A single day still needs the six before it: the lines panel shows its week.
export function fetchSpan(from: string, to: string): { from: string; to: string } {
  const weekStart = addDaysKey(to, -6)
  return { from: from < weekStart ? from : weekStart, to }
}

export class Store {
  year: YearPayload | null = null
  settings: Settings | null = null
  here: string | null = null    // the project this window is working in, from live updates
  refused = false
  console: ConsoleLine[] = []
  view: ViewState = { sel: "all", from: "", to: "", preset: "today", back: null, focus: null }
  private range: RangePayload | null = null
  private askedYear = false
  private readonly listeners: ((c: Change) => void)[] = []

  constructor(private readonly post: (m: WebviewMessage) => void) {}

  on(fn: (c: Change) => void): void { this.listeners.push(fn) }
  private emit(c: Change): void { for (const fn of this.listeners) fn(c) }

  // Logs for from..to (the view by default), or null while they are being fetched.
  days(from = this.view.from, to = this.view.to): RangePayload | null {
    return this.range && from ? subRange(this.range, from, to) : null
  }

  setView(from: string, to: string, preset: RangeId | null, back: Back | null = null): void {
    this.view = { ...this.view, from, to, preset, back, focus: null }
    this.refused = false
    const span = fetchSpan(from, to)
    if (!this.range || !subRange(this.range, span.from, span.to)) this.post({ type: "requestDays", ...span })
    this.emit("days")
  }

  setSelection(sel: Selection): void {
    if (sel === this.view.sel) return
    this.view = { ...this.view, sel, focus: null }
    this.emit("year")
  }

  setFocus(focus: Focus): void {
    this.view = { ...this.view, focus }
    this.emit("focus")
  }

  note(cls: ConsoleLine["cls"], text: string): void {
    this.console.push({ cls, text })
    while (this.console.length > CONSOLE_LINES) this.console.shift()
    this.emit("console")
  }

  receive(msg: ExtensionMessage): void {
    switch (msg.type) {
      case "year": {
        const { type: _type, ...year } = msg
        const prev = this.year
        this.year = year
        this.askedYear = false
        if (this.view.sel !== "all" && !year.projects.some(p => p.id === this.view.sel)) this.view = { ...this.view, sel: "all" }
        // A year arrives on open, and again whenever stored data changed (a
        // wipe, an import, a new target) or the date did. A preset view moves
        // with the date; a picked range stays put. Either way it is refetched.
        const moved = !prev || prev.today !== year.today
        const preset = prev ? this.view.preset : "today"
        const r = moved && preset ? presetRange(preset, year.today) : { from: this.view.from, to: this.view.to }
        this.view = { ...this.view, from: r.from, to: r.to, preset, back: moved ? null : this.view.back, focus: null }
        this.post({ type: "requestDays", ...fetchSpan(r.from, r.to) })
        this.emit("year")
        break
      }
      case "range": {
        // a reply to an older request is dropped unless it still covers the view
        const span = fetchSpan(this.view.from, this.view.to)
        if (msg.from > span.from || msg.to < span.to) break
        this.range = { from: msg.from, to: msg.to, logs: msg.logs }
        this.emit("days")
        break
      }
      case "rangeRefused": {
        const span = fetchSpan(this.view.from, this.view.to)
        if (msg.from === span.from && msg.to === span.to) {
          this.refused = true
          this.emit("days")
        }
        break
      }
      case "live": {
        const { type: _type, ...live } = msg
        this.here = live.projectId || null
        if (!this.year) break
        if (!mergeLive(this.year, this.range, live) && !this.askedYear) {
          this.askedYear = true
          this.post({ type: "requestYear" })
        }
        this.emit("year")
        break
      }
      case "settings": {
        const { type: _type, ...settings } = msg
        this.settings = settings
        this.emit("settings")
        break
      }
      case "actionResult":
        for (const line of msg.lines) this.note(msg.ok ? "ok" : "bad", line)
        break
    }
  }
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `node scripts/test.js --suite state`
Expected: PASS, 15 tests.

- [ ] **Step 10: Typecheck, full run, commit**

Run: `npm run typecheck && npm test`
Expected: both pass. (The old dashboard's `main.ts` is untouched and still compiles: `requestYear` is only an added union member.)

```bash
git add src/webview/model.ts src/webview/state.ts src/shared/types.ts test/webview.model2.test.ts test/webview.state.test.ts scripts/test.js
git commit -m "Add the dashboard store, clamp project targets and report unknown live projects"
```

---

### Task 4: DOM helpers, tooltip, CRT and focus

**Files:**
- Create: `src/webview/dom.ts`, `src/webview/tooltip.ts`, `src/webview/crt.ts`, `src/webview/focus.ts`
- Create: `test/webview.display.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Consumes: `CrtSettings` from `types.ts`; `Focus` from `model.ts`.
- Produces:
  - `dom.ts`: `$<T>(id): T` (throws if the shell lacks the id), `el(tag, cls?, text?)`, `kv(k, v)`, `keyBox(color | null)`, `charWidth(host)`, `onWidth(node, fn)`, `press(group, on)`.
  - `tooltip.ts`: `initTooltip(node)`, `showTip(x, y, nodes)`, `hideTip()`, `bindTip(node, build)`, `delegateTip(host, build)` (cells carry `data-i`), `tipLine(strong, sub?)`, `tipSub(text)`.
  - `crt.ts`: `Theme = "dark" | "light" | "hc"`, `themeOf(classes: string): Theme`, `CrtParams`, `crtParams(settings, theme): CrtParams`, `applyCrt(settings | null)` (null re-applies the last settings), `initCrt()`.
  - `focus.ts`: `parseHl(v): Focus`, `hlOf(f): string`, `sameFocus(a, b): boolean`, `lockHeights(root, on)`, `FocusWiring { allowProject; current; set }`, `wireFocus(root, wiring)`.

- [ ] **Step 1: Register the suite and write the failing tests**

Add to `SUITES` after `state`:

```js
  {
    name: "display",
    entry: "test/webview.display.test.ts",
    alias: { crt: "src/webview/crt.ts", focus: "src/webview/focus.ts" },
  },
```

Create `test/webview.display.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/crt.ts
import { crtParams, themeOf } from "crt"
// @ts-ignore — esbuild alias to src/webview/focus.ts
import { hlOf, parseHl, sameFocus } from "focus"

const C = (o: any = {}): any => ({ mask: "slot", pitch: "fine", strength: 30, effects: ["scanlines", "bloom"], ...o })

describe("crt parameters", () => {
  it("the default is a subtle slot mask with scanlines and bloom", () => {
    const p = crtParams(C(), "dark")
    assert.strictEqual(p.off, false)
    assert.strictEqual(p.s, 0.3)
    assert.strictEqual(p.boost, 1.255)
    assert.strictEqual(p.line, 3)
    assert.deepStrictEqual(p.fx, { scan: true, roll: false, flicker: false, conv: false, glow: true })
  })

  it("paper screens get half the mask", () => {
    assert.strictEqual(crtParams(C(), "light").s, 0.15)
  })

  it("high contrast gets nothing at all", () => {
    const p = crtParams(C({ effects: ["scanlines", "bloom", "convergence", "roll", "flicker"] }), "hc")
    assert.strictEqual(p.off, true)
    assert.strictEqual(p.boost, 1)
    assert.deepStrictEqual(p.fx, { scan: false, roll: false, flicker: false, conv: false, glow: false })
  })

  it("mask off or zero strength gives the light back", () => {
    assert.strictEqual(crtParams(C({ mask: "off" }), "dark").boost, 1)
    assert.strictEqual(crtParams(C({ strength: 0 }), "dark").off, true)
  })

  it("pitch scales the cells and the scanline period", () => {
    const p = crtParams(C({ pitch: "coarse" }), "dark")
    assert.strictEqual(p.unit, 3)
    assert.strictEqual(p.line, 9)
  })

  it("a shadow mask removes more light, so it gives more back", () => {
    assert.ok(crtParams(C({ mask: "shadow" }), "dark").boost > crtParams(C(), "dark").boost)
  })

  it("themes come from VS Code's body classes", () => {
    assert.strictEqual(themeOf("vscode-dark"), "dark")
    assert.strictEqual(themeOf("vscode-light"), "light")
    assert.strictEqual(themeOf("vscode-high-contrast"), "hc")
    assert.strictEqual(themeOf("vscode-high-contrast-light vscode-high-contrast"), "hc")
    assert.strictEqual(themeOf(""), "dark")
  })
})

describe("focus attributes", () => {
  it("project ids keep their colons", () => {
    assert.deepStrictEqual(parseHl("p:git@github.com:me/x.git"), { kind: "project", id: "git@github.com:me/x.git" })
    assert.strictEqual(hlOf({ kind: "project", id: "git@github.com:me/x.git" }), "p:git@github.com:me/x.git")
  })

  it("languages, and anything malformed", () => {
    assert.deepStrictEqual(parseHl("l:typescript"), { kind: "language", id: "typescript" })
    for (const bad of [undefined, "", "p:", "x:1", "nocolon"]) assert.strictEqual(parseHl(bad), null)
  })

  it("sameFocus", () => {
    assert.strictEqual(sameFocus(null, null), true)
    assert.strictEqual(sameFocus({ kind: "language", id: "go" }, { kind: "language", id: "go" }), true)
    assert.strictEqual(sameFocus({ kind: "language", id: "go" }, { kind: "project", id: "go" }), false)
    assert.strictEqual(sameFocus(null, { kind: "project", id: "a" }), false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test.js --suite display`
Expected: FAIL — `Could not resolve` `src/webview/crt.ts`.

- [ ] **Step 3: Write `src/webview/dom.ts`**

```ts
// Small element helpers. DOM work happens only inside these functions.

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const n = document.getElementById(id)
  if (!n) throw new Error(`#${id} is missing from the dashboard shell`)
  return n as T
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | number | null): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined && text !== null) n.textContent = String(text)
  return n
}

export function kv(k: string, v: string | number): HTMLElement {
  const s = el("span", "kv", k + " ")
  s.append(el("b", null, v))
  return s
}

// The 8px colour square; hollow stands for "all projects".
export function keyBox(color: string | null): HTMLElement {
  const k = el("i", color ? "key" : "key hollow")
  if (color) k.style.background = color
  return k
}

// Width of one monospace character in this element's font, for the +/- runs.
export function charWidth(host: HTMLElement): number {
  const probe = el("span", null, "+".repeat(40))
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre"
  host.append(probe)
  const w = probe.getBoundingClientRect().width / 40
  probe.remove()
  return w || 8
}

// Calls fn when the node's width changes. Height is ignored on purpose: a panel
// that grows taller as it redraws must not trigger itself again.
export function onWidth(node: HTMLElement, fn: (width: number) => void): void {
  let last = -1
  new ResizeObserver(() => {
    const w = node.clientWidth
    if (w !== last) {
      last = w
      fn(w)
    }
  }).observe(node)
}

export function press(group: HTMLElement, on: (b: HTMLButtonElement) => boolean): void {
  group.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.setAttribute("aria-pressed", String(on(b))))
}
```

- [ ] **Step 4: Write `src/webview/tooltip.ts`**

```ts
// One tooltip for the whole dashboard: the same text on hover and on keyboard focus.
import { el } from "./dom"

let tip: HTMLElement | null = null

export function initTooltip(node: HTMLElement): void { tip = node }

export function hideTip(): void { if (tip) tip.hidden = true }

export function showTip(x: number, y: number, nodes: Node[]): void {
  if (!tip) return
  tip.replaceChildren(...nodes)
  tip.hidden = false
  const r = tip.getBoundingClientRect()
  tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - r.width - 8))}px`
  tip.style.top = `${Math.max(8, y - r.height - 10)}px`
}

export function bindTip(node: HTMLElement, build: () => Node[]): void {
  node.tabIndex = 0
  node.addEventListener("pointermove", e => showTip(e.clientX, e.clientY, build()))
  node.addEventListener("pointerleave", hideTip)
  node.addEventListener("focus", () => {
    const r = node.getBoundingClientRect()
    showTip(r.left, r.top, build())
  })
  node.addEventListener("blur", hideTip)
}

// Dense marks (heatmap cells, sparklines, range columns) share one listener and
// no tab stop per cell. Cells carry data-i; build returns null for "no tip".
export function delegateTip(host: HTMLElement, build: (cell: HTMLElement) => Node[] | null): void {
  host.addEventListener("pointermove", e => {
    const c = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-i]") : null
    const nodes = c && host.contains(c) ? build(c) : null
    if (nodes) showTip(e.clientX, e.clientY, nodes)
    else hideTip()
  })
  host.addEventListener("pointerleave", hideTip)
}

export function tipLine(strong: string, sub?: string): HTMLElement {
  const d = el("div")
  d.append(el("strong", null, strong))
  if (sub) d.append(el("span", "sub", " " + sub))
  return d
}

export const tipSub = (text: string): HTMLElement => el("div", "sub", text)
```

- [ ] **Step 5: Write `src/webview/crt.ts`**

```ts
// The CRT: a phosphor mask (canvas, multiplied over the page), scanlines, a
// refresh roll and the glass, all fixed layers that take no pointer events.
// crtParams is pure; the rest draws.
import type { CrtMask, CrtSettings } from "../shared/types"

export type Theme = "dark" | "light" | "hc"

export function themeOf(classes: string): Theme {
  if (/\bvscode-high-contrast/.test(classes)) return "hc"
  return /\bvscode-light\b/.test(classes) ? "light" : "dark"
}

export interface CrtParams {
  off: boolean
  s: number        // mask strength, 0–1
  unit: number     // one phosphor column, in CSS px before devicePixelRatio
  boost: number    // brightness given back for what the mask removes
  line: number     // scanline period, px
  fx: { scan: boolean; roll: boolean; flicker: boolean; conv: boolean; glow: boolean }
}

const PITCH = { fine: 1, medium: 2, coarse: 3 }

export function crtParams(c: CrtSettings, theme: Theme): CrtParams {
  const unit = PITCH[c.pitch] ?? 1
  // paper screens get about half the mask (the mockup's .28 against .55)
  const s = theme === "hc" ? 0 : Math.max(0, Math.min(100, c.strength)) / 100 * (theme === "light" ? 0.5 : 1)
  const off = theme === "hc" || c.mask === "off" || s === 0
  const on = (e: CrtSettings["effects"][number]) => theme !== "hc" && c.effects.includes(e)
  return {
    off,
    s,
    unit,
    boost: off ? 1 : Number((1 + s * (c.mask === "shadow" ? 1.1 : 0.85)).toFixed(3)),
    line: 3 * unit,
    fx: { scan: on("scanlines"), roll: on("roll"), flicker: on("flicker"), conv: on("convergence"), glow: on("bloom") },
  }
}

let current: CrtSettings | null = null

export function applyCrt(next: CrtSettings | null): void {
  if (next) current = next
  if (!current) return
  const p = crtParams(current, themeOf(document.body.className))
  const root = document.documentElement
  const body = document.body
  root.classList.toggle("fx-scan", p.fx.scan)
  root.classList.toggle("fx-roll", p.fx.roll)
  root.classList.toggle("fx-flicker", p.fx.flicker)
  root.classList.toggle("mask-off", p.off)
  // set on body: the theme tokens live on body classes, and inline beats them
  body.style.setProperty("--boost", String(p.boost))
  body.style.setProperty("--line", `${p.line}px`)
  body.style.setProperty("--conv", p.fx.conv ? "-.6px 0 0 rgba(255,40,70,.32), .6px 0 0 rgba(40,150,255,.32)" : "0 0 0 transparent")
  if (p.fx.glow) body.style.removeProperty("--glow")
  else body.style.setProperty("--glow", "0 0 0 transparent")
  drawMask(current.mask, p)
}

function drawMask(mask: CrtMask, p: CrtParams): void {
  const c = document.getElementById("mask") as HTMLCanvasElement | null
  if (!c || p.off) return
  const dpr = window.devicePixelRatio || 1
  c.width = Math.round(innerWidth * dpr)
  c.height = Math.round(innerHeight * dpr)
  const ctx = c.getContext("2d")
  if (!ctx) return
  const hi = 255
  const lo = Math.round(255 * (1 - p.s))
  const dark = Math.round(255 * (1 - p.s * 0.9))
  const R = `rgb(${hi},${lo},${lo})`
  const G = `rgb(${lo},${hi},${lo})`
  const B = `rgb(${lo},${lo},${hi})`
  const K = `rgb(${dark},${dark},${dark})`
  const u = Math.max(1, Math.round(p.unit * dpr))   // drawn per device pixel
  const t = document.createElement("canvas")
  const x = t.getContext("2d")
  if (!x) return
  if (mask === "grille") {
    t.width = 3 * u
    t.height = 1
    ;[R, G, B].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * u, 0, u, 1) })
  } else if (mask === "slot") {
    const P = 4 * u
    t.width = 6 * u
    t.height = P
    ;[R, G, B, R, G, B].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * u, 0, u, P) })
    x.fillStyle = K
    x.fillRect(0, 0, 3 * u, u)            // staggered slot breaks
    x.fillRect(3 * u, P / 2, 3 * u, u)
  } else {
    // shadow mask: delta triads
    const cell = 2 * u
    t.width = 3 * cell
    t.height = 2 * cell
    x.fillStyle = K
    x.fillRect(0, 0, t.width, t.height)
    const dot = (cx: number, cy: number, col: string) => {
      x.fillStyle = col
      x.beginPath()
      x.arc(cx, cy, cell * 0.46, 0, Math.PI * 2)
      x.fill()
    }
    ;[R, G, B].forEach((col, i) => dot(i * cell + cell / 2, cell / 2, col))
    ;[B, R, G].forEach((col, i) => {
      const cx = (i + 1) * cell
      dot(cx % t.width, cell * 1.5, col)
      if (cx === t.width) dot(t.width, cell * 1.5, col)
    })
  }
  const pattern = ctx.createPattern(t, "repeat")
  if (!pattern) return
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, c.width, c.height)
}

export function initCrt(): void {
  window.addEventListener("resize", () => applyCrt(null))
  // VS Code swaps the body class on a theme change; only "class" is watched,
  // so the style writes above can't retrigger it.
  new MutationObserver(() => applyCrt(null)).observe(document.body, { attributes: true, attributeFilter: ["class"] })
}
```

- [ ] **Step 6: Write `src/webview/focus.ts`**

```ts
// Hover focus: pointing at a project or a language (anything carrying
// data-hl="p:<id>" or "l:<name>") narrows the other panels to it. The panel
// under the pointer keeps its rows; panels hold their height while a focus is
// shown, so nothing moves under the pointer.
import type { Focus } from "./model"

export function parseHl(v: string | undefined): Focus {
  if (!v) return null
  const i = v.indexOf(":")
  if (i < 0) return null
  const k = v.slice(0, i)
  const id = v.slice(i + 1)   // project ids can contain colons themselves
  if (!id) return null
  if (k === "p") return { kind: "project", id }
  if (k === "l") return { kind: "language", id }
  return null
}

export const hlOf = (f: NonNullable<Focus>): string => `${f.kind === "project" ? "p" : "l"}:${f.id}`

export const sameFocus = (a: Focus, b: Focus): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id)

export function lockHeights(root: HTMLElement, on: boolean): void {
  root.querySelectorAll<HTMLElement>(".grid > fieldset").forEach(f => { f.style.minHeight = on ? `${f.offsetHeight}px` : "" })
}

export interface FocusWiring {
  allowProject: () => boolean   // a project focus only means something with all projects shown
  current: () => Focus
  set: (f: Focus) => void
}

export function wireFocus(root: HTMLElement, w: FocusWiring): void {
  let src: HTMLElement | null = null
  const read = (t: EventTarget | null): { f: NonNullable<Focus>; src: HTMLElement | null } | null => {
    const h = t instanceof Element ? t.closest<HTMLElement>("[data-hl]") : null
    if (!h || !root.contains(h)) return null
    const f = parseHl(h.dataset.hl)
    if (!f || (f.kind === "project" && !w.allowProject())) return null
    return { f, src: h.closest<HTMLElement>("fieldset") }
  }
  const apply = (f: Focus, from: HTMLElement | null) => {
    src = from
    const cur = w.current()
    if (sameFocus(cur, f)) return
    // measure before the focused render changes anything
    if (f && !cur) lockHeights(root, true)
    if (!f) lockHeights(root, false)
    w.set(f)
  }
  root.addEventListener("pointerover", e => {
    const hit = read(e.target)
    if (hit) return apply(hit.f, hit.src)
    // leaving the source panel clears the focus; moving within it does not
    if (w.current() && !(src && e.target instanceof Node && src.contains(e.target))) apply(null, null)
  })
  root.addEventListener("pointerleave", () => apply(null, null))
  root.addEventListener("focusin", e => {
    const hit = read(e.target)
    apply(hit ? hit.f : null, hit ? hit.src : null)
  })
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `node scripts/test.js --suite display`
Expected: PASS, 10 tests.

- [ ] **Step 8: Typecheck, full run, commit**

Run: `npm run typecheck && npm test`

```bash
git add src/webview/dom.ts src/webview/tooltip.ts src/webview/crt.ts src/webview/focus.ts test/webview.display.test.ts scripts/test.js
git commit -m "Add the dashboard's DOM helpers, tooltip, CRT layers and hover focus"
```

---
### Task 5: Swap the shell — protocol, font, markup, styles, wiring

This is the task where the old dashboard goes. Until it is finished the extension does not build, so work through the steps in order and commit only at the end.

**Files:**
- Modify: `src/shared/config.ts` (add `crtSettingValue`)
- Modify: `src/dashboard/messageHandler.ts`
- Modify: `src/shared/types.ts` (message unions)
- Modify: `src/extension.ts` (the 10 s tick)
- Modify: `test/dashboard.handler.test.ts`, `test/config.crt.test.ts`
- Add: `src/webview/fonts/MartianMono-VF.woff2`, `src/webview/fonts/MartianMono-OFL.txt`
- Modify: `src/dashboard/dashboardPanel.ts` (`getHtmlContent`)
- Replace: `src/webview/style.css`, `src/webview/main.ts`
- Delete: `src/webview/charts.ts`, `src/webview/theme.ts`, `src/webview/heatmap.ts`
- Modify: `package.json`, `package-lock.json` (dependencies)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `config.ts`: `crtSettingValue(key: string, value: unknown): CrtMask | CrtPitch | number | CrtEffect[] | null`.
  - Host: `requestYear` → `year`; `ready` → `settings`, `year` (no `init`); `updateProjectSetting` → `year`; `updateCrtSetting` writes only a valid, normalised value and reports a failed write with a failed `actionResult`.
  - Types: `ExtensionMessage` loses `init` and `update`; `WebviewMessage` loses `requestRange` and `selectProjects`; `RangePreset` is deleted. `pdfData` / `exportPdfRequest` / `writePdf` / `writeJpg` stay for the interim exports.
  - Shell element ids every later task relies on (all present in the markup in Step 9): `brand`, `proj-btn`, `proj-key`, `proj-name`, `pmenu`, `tabs`, `range`, `r-cal`, `picker`, `pk-prev`, `pk-next`, `pk-months`, `pk-sel`, `pk-cancel`, `pk-apply`, `ov`, `ov-status`, `hero-k`, `hero-when`, `hero-head`, `cols-wrap`, `cols`, `cols-axis`, `tod-k`, `tape-wrap`, `tape`, `ticks`, `target`, `tape-legend`, `streak-n`, `streak-big`, `days`, `streak-long`, `streak-range`, `lines-when`, `ln-add`, `ln-del`, `ln-net`, `week`, `lang-when`, `lang`, `files-when`, `stat`, `log-k`, `log-when`, `log`, `act-filter`, `ystats-who`, `ystats`, `heat-range`, `heat-wrap`, `months`, `heat`, `split`, `prows`, `prows-box`, `sort`, `pcards`, `set-tracking`, `pref-target`, `pref-idle`, `osd`, `strength`, `strength-out`, `spath`, `clear-proj`, `clear-proj-confirm`, `clear-proj-btn`, `clear-all-confirm`, `clear-all-btn`, `console`, `xd`, `xd-format`, `xd-range`, `xd-project`, `xd-what`, `xd-cancel`, `xd-go`, `tip`, `mask`.
  - `main.ts`: the registration points later tasks fill — `tabs: Partial<Record<Tab, Render>>`, `bar: Render[]`, `extra: ((msg: ExtensionMessage) => void)[]`, `showTab(tab)`, `store`, `post`, and the `// ── panels ──` marker under which later tasks add their wiring.

- [ ] **Step 1: Write the failing host tests**

Append to `test/dashboard.handler.test.ts`:

```ts
// The redesigned webview builds every panel from the year and the range; the
// old init/update messages are gone.
describe("phase 2 protocol", () => {
  it("ready sends settings then the year, and no init", () => {
    handleMessage({ type: "ready" } as any, store(), panel)
    assert.deepStrictEqual(types(), ["settings", "year"])
  })

  it("requestYear sends a year", () => {
    handleMessage({ type: "requestYear" } as any, store(), panel)
    assert.deepStrictEqual(types(), ["year"])
  })

  it("a project target change sends the year, and no init", () => {
    handleMessage({ type: "updateProjectSetting", projectId: "alpha", key: "dailyTargetMinutes", value: 30 } as any, store(), panel)
    assert.deepStrictEqual(types(), ["year"])
  })
})

// The webview is not trusted with settings.json: VS Code would store whatever it sent.
describe("CRT writes", () => {
  const cfg = () => v.workspace.getConfiguration("rabbithole")

  it("a value the manifest would reject is never written", async () => {
    handleMessage({ type: "updateCrtSetting", key: "mask", value: "glitter" } as any, store(), panel)
    await settle()
    assert.strictEqual(cfg().get("crt.mask"), undefined)
    assert.deepStrictEqual(types(), [])
  })

  it("strength is clamped and effects filtered before writing", async () => {
    handleMessage({ type: "updateCrtSetting", key: "strength", value: 250 } as any, store(), panel)
    handleMessage({ type: "updateCrtSetting", key: "effects", value: ["roll", "sparkle", "scanlines"] } as any, store(), panel)
    await settle()
    assert.strictEqual(cfg().get("crt.strength"), 100)
    assert.deepStrictEqual(cfg().get("crt.effects"), ["scanlines", "roll"])
    assert.ok(types().includes("settings"))
  })
})
```

In `test/config.crt.test.ts`, add next to the existing imports:

```ts
// @ts-ignore — esbuild alias to src/shared/config.ts
import { crtSettingValue } from "cfg"
```

and append:

```ts
describe("CRT values written from the dashboard", () => {
  it("are normalised, or refused when the manifest would reject them", () => {
    assert.strictEqual(crtSettingValue("mask", "grille"), "grille")
    assert.strictEqual(crtSettingValue("mask", "glitter"), null)
    assert.strictEqual(crtSettingValue("pitch", "coarse"), "coarse")
    assert.strictEqual(crtSettingValue("strength", 42.6), 43)
    assert.strictEqual(crtSettingValue("strength", -5), 0)
    assert.strictEqual(crtSettingValue("strength", "50"), null)
    assert.deepStrictEqual(crtSettingValue("effects", ["flicker", "bloom", "bogus"]), ["bloom", "flicker"])
    assert.strictEqual(crtSettingValue("effects", "bloom"), null)
    assert.strictEqual(crtSettingValue("colour", "red"), null)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node scripts/test.js --suite handler` then `node scripts/test.js --suite crt`
Expected: `handler` FAILS (ready sends `["settings", "init", "year"]`; `requestYear` sends nothing; a project change sends `init`; `glitter` is written). `crt` FAILS (`crtSettingValue` is not a function).

- [ ] **Step 3: Add `crtSettingValue` to `src/shared/config.ts`**

Change the type import to `import type { CrtEffect, CrtMask, CrtPitch, CrtSettings } from "./types"` (already so) and append:

```ts
// What the dashboard may write for one CRT key: the value normalised the way
// getCrtSettings reads it, or null when the manifest would reject it.
export function crtSettingValue(key: string, value: unknown): CrtMask | CrtPitch | number | CrtEffect[] | null {
  switch (key) {
    case "mask":
      return CRT_MASKS.includes(value as CrtMask) ? (value as CrtMask) : null
    case "pitch":
      return CRT_PITCHES.includes(value as CrtPitch) ? (value as CrtPitch) : null
    case "strength":
      return typeof value === "number" && isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null
    case "effects":
      return Array.isArray(value) ? CRT_EFFECTS.filter(e => value.includes(e)) : null
    default:
      return null
  }
}
```

- [ ] **Step 4: Update `src/dashboard/messageHandler.ts`**

1. Add `crtSettingValue` to the `../shared/config` import.
2. Delete the module-level view state (the `// Module-level view state` comment and `currentStartDate`, `currentEndDate`, `currentProjectIds`). Keep `todayStr`, `offsetDateStr` and `presetToDates` — the interim report export still uses them.
3. Replace the `ready` case and add `requestYear` after it:

```ts
    case "ready": {
      // Settings first: the webview needs the target before it draws a streak.
      sendSettings(storage, panel)
      postYear(storage, panel)
      break
    }

    case "requestYear":
      postYear(storage, panel)
      break
```

4. Delete the `requestRange` and `selectProjects` cases.
5. In `exportPdfRequest`, replace `const exportPid = msg.exportProjectId ?? currentProjectIds[0] ?? "all"` with `const exportPid = msg.exportProjectId ?? "all"`.
6. Replace the `updateCrtSetting` case:

```ts
    case "updateCrtSetting": {
      // a value the manifest would reject never reaches settings.json
      const value = crtSettingValue(msg.key, msg.value)
      if (value === null) break
      vscode.workspace.getConfiguration("rabbithole")
        .update(`crt.${msg.key}`, value, vscode.ConfigurationTarget.Global)
        .then(
          () => sendSettings(storage, panel),
          err => tell(panel, false, `Rabbit Hole: Couldn't save the display setting (${err instanceof Error ? err.message : String(err)}).`),
        )
      break
    }
```

7. In `updateProjectSetting`, delete the `sendInit(storage, panel)` line.
8. Replace `refreshAfterWipe` and its comment:

```ts
// Settings before the year: the webview needs the target before it draws a streak.
function refreshAfterWipe(storage: StorageService, panel: DashboardPanel): void {
  sendSettings(storage, panel)
  postYear(storage, panel)
}
```

9. Delete the whole `sendInit` function.
10. If `DailyLog` is no longer used in the file, drop it from the `../shared/types` import.

- [ ] **Step 5: Update the message types and the tick**

In `src/shared/types.ts`:
- delete the `init` and `update` members of `ExtensionMessage`;
- delete the `requestRange` and `selectProjects` members of `WebviewMessage`;
- delete `export type RangePreset = …`.

In `src/extension.ts`, inside the 10-second `setInterval`, delete the block that posts `type: "update"`:

```ts
      DashboardPanel.currentPanel.postMessage({
        type: "update",
        data: storage.getToday(),
        projectId: storage.getCurrentProjectId(),
        globalToday: storage.getGlobalToday(),
      })
```

(The `live` post and the date-change `postYear` below it stay.)

Check nothing else sends or reads them:

Run: `git grep -n -e '"init"' -e '"update"' -e requestRange -e selectProjects -e RangePreset -- src/dashboard src/shared src/extension.ts`
Expected: no output.

- [ ] **Step 6: Run the host tests, with a negative control**

Run: `node scripts/test.js --suite handler` and `node scripts/test.js --suite crt`
Expected: PASS (handler 11 tests, crt 7 tests).

Negative control: `git show HEAD:src/dashboard/messageHandler.ts > src/dashboard/_negcontrol.ts`, then
`node scripts/test.js --suite handler --alias handler=src/dashboard/_negcontrol.ts`
Expected: all five new tests FAIL (the three "phase 2 protocol" tests and both "CRT writes" tests); the six earlier ones pass. Delete `src/dashboard/_negcontrol.ts`.

(`npm run typecheck` still fails at this point — the old `src/webview/main.ts` reads `init`/`update`. Steps 8–12 replace it.)

- [ ] **Step 7: Bundle Martian Mono**

The font is Evil Martians' Martian Mono (SIL OFL 1.1), from the official release on GitHub. One file, the variable woff2 (axes `wdth` 75–112.5 and `wght` 100–800), is all the dashboard loads.

Run: `gh release view --repo evilmartians/mono --json tagName,assets --jq '.tagName, (.assets[].name)'`

Download the release's zip assets into a scratch folder and look for the variable webfont:

```bash
mkdir -p "$TMPDIR/mm" && gh release download --repo evilmartians/mono --pattern '*.zip' --dir "$TMPDIR/mm"
cd "$TMPDIR/mm" && for z in *.zip; do unzip -oq "$z" -d "${z%.zip}"; done
find . -iname '*.woff2' | grep -iE 'vf|wdth|variable'
find . -iname 'OFL*' -o -iname 'LICENSE*'
```

Pick the single variable `.woff2` (its name contains `VF` or `[wdth,wght]`; the static files are one per weight, like `MartianMono-Regular.woff2`). If the release ships no variable woff2, take it from the repository tree instead: `gh api 'repos/evilmartians/mono/git/trees/main?recursive=1' --jq '.tree[].path' | grep -i woff2` and download that path from `https://raw.githubusercontent.com/evilmartians/mono/main/<path>`.

Copy it and the licence into the repo:

```bash
cp "<the variable woff2>" src/webview/fonts/MartianMono-VF.woff2
cp "<OFL.txt from the same release>" src/webview/fonts/MartianMono-OFL.txt
node -e "const b=require('fs').readFileSync('src/webview/fonts/MartianMono-VF.woff2');console.log(b.subarray(0,4).toString(),b.length)"
```

Expected: `wOF2` and a size between 50 000 and 400 000 bytes. Note the release tag: phase 3 takes the static Regular and Bold TTFs for the PDF from the same tag.

`scripts/copy-assets.js` already copies everything in `src/webview/fonts/` to `out/webview/fonts/`, so no build change is needed. The old fonts stay (the sidebar and the PDF still use them, see Deviation 1).

- [ ] **Step 8: Replace `getHtmlContent` in `src/dashboard/dashboardPanel.ts`**

Replace the whole `getHtmlContent` method (the old markup, the `#rh-phosphor` SVG filter and the old export modal all go) with:

```ts
  private getHtmlContent(): string {
    const webview = this.panel.webview
    const asset = (...path: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webview", ...path))
    const scriptUri = asset("main.js")
    const styleUri = asset("style.css")
    const fontUri = asset("fonts", "MartianMono-VF.woff2")
    const cspSource = webview.cspSource

    // Every fieldset is static: modules re-render only what is inside them, so
    // hover focus can keep track of the panel under the pointer.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @font-face { font-family: "Martian Mono"; src: url("${fontUri}") format("woff2"); font-weight: 100 800; font-stretch: 75% 112.5%; font-display: block; }
  </style>
  <link rel="stylesheet" href="${styleUri}">
  <title>Rabbit Hole</title>
</head>
<body>
<div class="screen">
  <header class="bar">
    <span class="brand" id="brand" title="Rabbit Hole"></span>
    <div class="projpick">
      <button class="proj" id="proj-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Project shown"><i class="key hollow" id="proj-key"></i><span id="proj-name">all projects</span><span class="caret">▾</span></button>
      <div class="pmenu" id="pmenu" role="listbox" aria-label="Project" hidden></div>
    </div>
    <nav class="tabs" id="tabs" aria-label="Dashboard sections">
      <button data-tab="overview" aria-pressed="true">overview</button><button data-tab="activity" aria-pressed="false">activity</button><button data-tab="projects" aria-pressed="false">projects</button><button data-tab="settings" aria-pressed="false">settings</button>
    </nav>
    <span class="spacer"></span>
    <div class="range" id="range" role="group" aria-label="Date range">
      <button data-range="today" aria-pressed="true">today</button><button data-range="yday" aria-pressed="false">yesterday</button><button data-range="7d" aria-pressed="false">7d</button><button data-range="30d" aria-pressed="false">30d</button><button id="r-cal" aria-haspopup="dialog" aria-expanded="false" aria-pressed="false">pick…</button>
    </div>
    <div class="picker" id="picker" role="dialog" aria-label="Pick a date range" hidden>
      <div class="pk-head">
        <button class="btn step" id="pk-prev" aria-label="Earlier months">‹</button>
        <span class="hint">click a start day, then an end day</span>
        <span class="spacer"></span>
        <button class="btn step" id="pk-next" aria-label="Later months">›</button>
      </div>
      <div class="pk-months" id="pk-months"></div>
      <div class="pk-foot">
        <span id="pk-sel"></span><span class="spacer"></span>
        <button class="btn" id="pk-cancel">cancel</button><button class="btn" id="pk-apply" disabled>apply</button>
      </div>
    </div>
  </header>

  <section class="tab" data-tab="overview" id="ov">
    <p class="status" id="ov-status">loading…</p>
    <div class="grid">
      <fieldset class="span-8">
        <legend><b id="hero-k">day</b> <span id="hero-when"></span></legend>
        <div class="tape-head" id="hero-head"></div>
        <div id="cols-wrap" hidden>
          <div class="cols" id="cols" role="img" aria-label="Active time per day in the range"></div>
          <div class="cols-axis" id="cols-axis" aria-hidden="true"></div>
        </div>
        <div class="tod-k" id="tod-k" hidden>time of day <span>· where an average active day's time lands</span></div>
        <div class="tape-wrap" id="tape-wrap">
          <div class="tape" id="tape" role="img" aria-label="Active time across the day"></div>
          <div class="ticks" id="ticks" aria-hidden="true"></div>
        </div>
        <div class="target" id="target"></div>
        <div class="legend" id="tape-legend"></div>
      </fieldset>

      <fieldset class="span-4 streak">
        <legend><b>streak</b></legend>
        <div class="big" id="streak-big"><span id="streak-n">0</span><small>days</small></div>
        <div class="days" id="days"></div>
        <p id="streak-long"></p>
        <p id="streak-range" hidden></p>
      </fieldset>

      <fieldset class="span-7">
        <legend><b>lines</b> <span id="lines-when"></span></legend>
        <div class="diff">
          <span class="big add" id="ln-add">+0</span>
          <span class="big del" id="ln-del">−0</span>
          <span class="kv">net <b id="ln-net">+0</b></span>
        </div>
        <div class="week" id="week" aria-label="Lines added and removed"></div>
      </fieldset>

      <fieldset class="span-5">
        <legend><b>languages</b> <span id="lang-when"></span></legend>
        <div class="lang" id="lang"></div>
      </fieldset>

      <fieldset class="span-7">
        <legend><b>files</b> <span id="files-when">git diff --stat</span></legend>
        <table class="stat" id="stat"></table>
      </fieldset>

      <fieldset class="span-5">
        <legend><b id="log-k">sessions</b> <span id="log-when"></span></legend>
        <ul class="log" id="log"></ul>
      </fieldset>
    </div>
  </section>

  <section class="tab" data-tab="activity" hidden>
    <div class="filters">
      <span>project</span>
      <div class="opts" role="group" aria-label="Project filter" id="act-filter"></div>
    </div>
    <div class="grid">
      <fieldset class="span-12">
        <legend><b>year</b> past 12 months<span id="ystats-who"></span></legend>
        <div class="ystats" id="ystats"></div>
      </fieldset>
      <fieldset class="span-12">
        <legend><b>activity</b> <span id="heat-range">daily active time, past 12 months</span></legend>
        <div class="heat-wrap" id="heat-wrap">
          <div class="heat-inner">
            <span></span>
            <div class="months" id="months"></div>
            <div class="wd" aria-hidden="true"><span>mon</span><span></span><span>wed</span><span></span><span>fri</span><span></span><span>sun</span></div>
            <div class="heat" id="heat" role="img" aria-label="Active time per day for the past year, one cell per day"></div>
          </div>
        </div>
        <div class="legend heat-key">
          <span><b class="z">·</b> none</span><span><b>░</b> under 30m</span><span><b>▒</b> under 1h30</span><span><b>▓</b> under 3h</span><span><b>█</b> 3h or more</span><span><b class="now">█</b> today</span>
        </div>
      </fieldset>
      <fieldset class="span-12" id="prows-box">
        <legend><b>projects</b> share of active time, past 12 months</legend>
        <div class="split" id="split" aria-hidden="true"></div>
        <div class="prows" id="prows"></div>
      </fieldset>
    </div>
  </section>

  <section class="tab" data-tab="projects" hidden>
    <div class="filters">
      <span>sort</span>
      <div class="opts" role="group" aria-label="Sort projects by" id="sort">
        <button data-v="time" aria-pressed="true">active today</button><button data-v="last" aria-pressed="false">last active</button><button data-v="name" aria-pressed="false">name</button>
      </div>
    </div>
    <div class="grid" id="pcards"></div>
  </section>

  <section class="tab" data-tab="settings" hidden>
    <div class="grid">
      <fieldset class="span-12" id="set-tracking">
        <legend><b>tracking</b></legend>
        <div class="set">
          <div><label class="name" for="pref-target">daily target</label><div class="desc">Streak target across all projects. Projects can override it on the projects tab.</div></div>
          <div class="ctl">
            <button class="btn step" data-for="pref-target" data-step="-5" aria-label="Decrease daily target">−</button>
            <input class="tin" id="pref-target" type="number" min="1" max="1440" step="5" data-saved="">
            <button class="btn step" data-for="pref-target" data-step="5" aria-label="Increase daily target">+</button>
            <span class="unit">min</span>
            <button class="btn" data-apply="pref-target" data-label="daily target" disabled>apply</button>
          </div>
        </div>
        <div class="set">
          <div><label class="name" for="pref-idle">pause after</label><div class="desc">Minutes with no activity before the active timer pauses. Logged time is kept.</div></div>
          <div class="ctl">
            <button class="btn step" data-for="pref-idle" data-step="-1" aria-label="Decrease pause threshold">−</button>
            <input class="tin" id="pref-idle" type="number" min="1" max="60" step="1" data-saved="">
            <button class="btn step" data-for="pref-idle" data-step="1" aria-label="Increase pause threshold">+</button>
            <span class="unit">min</span>
            <button class="btn" data-apply="pref-idle" data-label="pause after" disabled>apply</button>
          </div>
        </div>
      </fieldset>

      <fieldset class="span-12">
        <legend><b>display</b> crt</legend>
        <div class="osd" id="osd">
          <span class="k">mask</span>
          <div class="opts" role="group" aria-label="Phosphor mask" data-key="mask">
            <button data-v="slot">slot mask</button><button data-v="grille">aperture grille</button><button data-v="shadow">shadow mask</button><button data-v="off">off</button>
          </div>
          <span class="k">pitch</span>
          <div class="opts" role="group" aria-label="Mask pitch" data-key="pitch">
            <button data-v="fine">fine</button><button data-v="medium">medium</button><button data-v="coarse">coarse</button>
          </div>
          <span class="k"><label for="strength">strength</label></span>
          <div class="opts"><input id="strength" type="range" min="0" max="100" step="1"><output id="strength-out" for="strength"></output></div>
          <span class="k">effects</span>
          <div class="opts" role="group" aria-label="Effects" data-key="effects">
            <button data-v="scanlines">scanlines</button><button data-v="bloom">bloom</button><button data-v="convergence">convergence</button><button data-v="roll">refresh roll</button><button data-v="flicker">flicker</button>
          </div>
          <p class="why">Slot mask: staggered RGB slots, as on most consumer TVs and terminals. Aperture grille: unbroken vertical stripes (Trinitron). Shadow mask: round dot triads. Light themes get half the strength; high contrast turns the CRT off. Refresh roll and flicker stop when your system asks for reduced motion.</p>
        </div>
      </fieldset>

      <fieldset class="span-12">
        <legend><b>your data</b> stored on this machine only</legend>
        <div class="set">
          <div><span class="name">storage location</span><div class="desc">Everything Rabbit Hole records lives here. Nothing is sent anywhere.</div><div class="spath" id="spath"></div></div>
          <div class="ctl"><button class="btn" data-act="reveal">reveal</button></div>
        </div>
        <div class="set">
          <div><span class="name">export</span><div class="desc">Save a share card or a report, or the raw data as CSV or JSON.</div></div>
          <div class="ctl"><button class="btn" data-act="export">export…</button></div>
        </div>
        <div class="set">
          <div><span class="name">back up everything</span><div class="desc">Writes a complete, restorable copy of all your data to the backups folder.</div></div>
          <div class="ctl"><button class="btn" data-act="backup-all">create backup</button></div>
        </div>
        <div class="set">
          <div><span class="name">back up some projects</span><div class="desc">A backup with only the projects you pick. Useful for moving one project to another machine.</div></div>
          <div class="ctl"><button class="btn" data-act="backup-some">choose projects…</button></div>
        </div>
        <div class="set">
          <div><span class="name">restore some projects</span><div class="desc">Pick projects out of a backup to undo a clear or bring one over. Projects you don't pick are left untouched.</div></div>
          <div class="ctl"><button class="btn" data-act="restore-some">choose projects…</button></div>
        </div>
        <div class="set">
          <div><span class="name">restore everything</span><div class="desc">Replaces this machine's history with every project in a backup. Projects not in the backup are kept. A backup is written first.</div></div>
          <div class="ctl"><button class="btn" data-act="restore-all">restore all…</button></div>
        </div>
      </fieldset>

      <fieldset class="span-12 danger">
        <legend><b>danger</b> a backup is written before either of these runs</legend>
        <div class="set">
          <div><label class="name" for="clear-proj">clear a project's history</label><div class="desc">Deletes every logged day for one project. Type its exact name to confirm.</div></div>
          <div class="ctl">
            <select class="tin" id="clear-proj"></select>
            <input class="tin wide" id="clear-proj-confirm" type="text" placeholder="project name" spellcheck="false" autocomplete="off" aria-label="Type the project name to confirm">
            <button class="btn danger" id="clear-proj-btn" disabled>clear</button>
          </div>
        </div>
        <div class="set">
          <div><label class="name" for="clear-all-confirm">clear everything</label><div class="desc">Deletes all projects and all logged history. Type DELETE to confirm.</div></div>
          <div class="ctl">
            <input class="tin wide" id="clear-all-confirm" type="text" placeholder="DELETE" spellcheck="false" autocomplete="off">
            <button class="btn danger" id="clear-all-btn" disabled>delete all</button>
          </div>
        </div>
      </fieldset>

      <fieldset class="span-12">
        <legend><b>output</b></legend>
        <div class="console" id="console" aria-live="polite"></div>
      </fieldset>
    </div>
  </section>
</div>

<div class="xd-back" id="xd" hidden>
  <div class="xd" role="dialog" aria-modal="true" aria-labelledby="xd-title">
    <fieldset>
      <legend><b id="xd-title">export</b></legend>
      <div class="osd">
        <span class="k">format</span>
        <div class="opts" id="xd-format" role="group" aria-label="Format"><button data-v="card">share card</button><button data-v="report">report</button><button data-v="csv">csv</button><button data-v="json">json</button></div>
        <span class="k">range</span>
        <div class="opts" id="xd-range" role="group" aria-label="Range"></div>
        <span class="k"><label for="xd-project">project</label></span>
        <div class="opts"><select class="tin" id="xd-project"></select></div>
        <p class="why" id="xd-what"></p>
      </div>
      <div class="xd-foot"><button class="btn" id="xd-cancel">cancel</button><button class="btn" id="xd-go">export</button></div>
    </fieldset>
  </div>
</div>

<div id="tip" hidden></div>
<canvas class="crt" id="mask" aria-hidden="true"></canvas>
<div class="crt crt-scan" aria-hidden="true"></div>
<div class="crt crt-roll" aria-hidden="true"></div>
<div class="crt crt-glass" aria-hidden="true"></div>
<script src="${scriptUri}"></script>
</body>
</html>`
  }
```

- [ ] **Step 9: Replace `src/webview/style.css`**

The rules are the mockup's (`docs/design/mockups/dashboard.html`, `<style>`), with the theme tokens moved onto VS Code's body classes and the mockup-only parts (notes, branch) dropped:

```css
/* Rabbit Hole, TTY. Ported from docs/design/mockups/dashboard.html (v8): one
   terminal screen of box-drawn fieldsets with the title cut into the top rule,
   block-glyph charts, git's own diff --stat as the file list, amber for
   "you can click this". Theme tokens live on VS Code's body classes. */

:root {
  --conv: 0 0 0 transparent;   /* convergence error, set by crt.ts */
  --boost: 1;                  /* brightness the mask removes, given back */
  --line: 3px;                 /* scanline period */
  --mono: "Martian Mono", "Cascadia Mono", Consolas, monospace;
}

/* phosphor: dark themes (and the fallback) */
body {
  --bg: #050b08; --panel: #08110d; --rule: #22392d;
  --ink: #cfeedd; --ink-dim: #86a596; --ink-mute: #56705f;
  --chrome: #ffb703; --chrome-ink: #1a1300;
  --add: #39d98a; --del: #ff6b6b;
  --c1: #1fa866; --c2: #2a8fd0; --c3: #b87e00; --c4: #d0508f; --c5: #8a6fe0; --c6: #9a9420; --c-other: #4f6459;
  --glow: 0 0 1px color-mix(in srgb, currentColor 80%, transparent), 0 0 7px color-mix(in srgb, currentColor 50%, transparent), 0 0 18px color-mix(in srgb, currentColor 18%, transparent);
  --scan: rgba(0,0,0,.42); --bezel: #010201; --vig: rgba(0,0,0,.62);
  --glare: rgba(190,255,220,.05); --roll: rgba(150,255,190,.035);
  --carrot-glow: drop-shadow(0 0 3px rgba(255,139,0,.55)) drop-shadow(0 0 9px rgba(255,139,0,.22));
  color-scheme: dark;
}
/* paper: light themes */
body.vscode-light {
  --bg: #eef0e9; --panel: #f6f7f2; --rule: #b9c2b2;
  --ink: #12261b; --ink-dim: #4c6356; --ink-mute: #7b8e82;
  --chrome: #8a5a00; --chrome-ink: #fff8e6;
  --add: #0f7a43; --del: #b4232f;
  --c1: #0f8a4e; --c2: #1673b8; --c3: #b06a00; --c4: #c2357a; --c5: #6a4fd0; --c6: #7a7400; --c-other: #8b968f;
  --glow: 0 0 0 transparent;
  --scan: rgba(20,40,30,.10); --bezel: #c9cdbf; --vig: rgba(40,50,40,.22);
  --glare: rgba(255,255,255,.35); --roll: rgba(255,255,255,0);
  --carrot-glow: none;
  color-scheme: light;
}
/* high contrast: VS Code's own colours and borders, no glow, no CRT */
body.vscode-high-contrast {
  --bg: var(--vscode-editor-background, #000); --panel: var(--vscode-editor-background, #000);
  --rule: var(--vscode-contrastBorder, #6fc3df);
  --ink: var(--vscode-editor-foreground, #fff); --ink-dim: var(--vscode-editor-foreground, #fff);
  --ink-mute: var(--vscode-descriptionForeground, #ccc);
  --chrome: var(--vscode-contrastActiveBorder, #f38518); --chrome-ink: var(--vscode-editor-background, #000);
  --add: #39d98a; --del: #ff6b6b;
  --c1: #1fa866; --c2: #2a8fd0; --c3: #b87e00; --c4: #d0508f; --c5: #8a6fe0; --c6: #9a9420; --c-other: #8b968f;
  --glow: 0 0 0 transparent; --carrot-glow: none;
  color-scheme: dark;
}
body.vscode-high-contrast-light {
  --bg: var(--vscode-editor-background, #fff); --panel: var(--vscode-editor-background, #fff);
  --rule: var(--vscode-contrastBorder, #0f4a85);
  --ink: var(--vscode-editor-foreground, #000); --ink-dim: var(--vscode-editor-foreground, #000);
  --ink-mute: var(--vscode-descriptionForeground, #333);
  --chrome: var(--vscode-contrastActiveBorder, #0f4a85); --chrome-ink: var(--vscode-editor-background, #fff);
  --add: #0f7a43; --del: #b4232f;
  --c1: #0f8a4e; --c2: #1673b8; --c3: #b06a00; --c4: #c2357a; --c5: #6a4fd0; --c6: #7a7400; --c-other: #4c6356;
  --glow: 0 0 0 transparent; --carrot-glow: none;
  color-scheme: light;
}

* { box-sizing: border-box; }
table { font-size: inherit; }
[hidden] { display: none !important; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 400 12.5px/1.55 var(--mono); font-variation-settings: "wdth" 87.5;
  padding: 20px 16px 40px;
  text-shadow: var(--conv), var(--glow);
}
.screen { max-width: 1120px; margin-inline: auto; position: relative; filter: brightness(var(--boost)); }

/* CRT stack, back to front: phosphor mask (canvas), scanlines, rolling refresh band, glass */
.crt { position: fixed; inset: 0; pointer-events: none; }
#mask { z-index: 50; width: 100vw; height: 100vh; mix-blend-mode: multiply; }
.crt-scan { z-index: 51;
  background: repeating-linear-gradient(to bottom,
    transparent 0, transparent calc(var(--line) * .35),
    var(--scan) calc(var(--line) * .62), transparent calc(var(--line) * .92), transparent var(--line)); }
.crt-roll { z-index: 52; overflow: hidden; }
.crt-roll::before { content: ""; position: absolute; left: 0; right: 0; height: 28vh; top: -28vh;
  background: linear-gradient(to bottom, transparent, var(--roll) 70%, transparent); mix-blend-mode: screen; }
.crt-glass { z-index: 53; border-radius: 34px / 28px;
  box-shadow: 0 0 0 80px var(--bezel), inset 0 0 18px var(--vig), inset 0 0 120px var(--vig);
  background:
    radial-gradient(ellipse 60% 35% at 28% 4%, var(--glare), transparent 70%),
    radial-gradient(ellipse at 50% 50%, transparent 58%, var(--vig) 125%); }
html:not(.fx-scan) .crt-scan, html:not(.fx-roll) .crt-roll, html.mask-off #mask { display: none; }
@media (prefers-reduced-motion: no-preference) {
  html.fx-roll .crt-roll::before { animation: roll 7.5s linear infinite; }
  @keyframes roll { to { transform: translateY(156vh); } }
  html.fx-flicker .screen { animation: flicker .11s steps(2) infinite; }
  @keyframes flicker { 50% { opacity: .965; } }
}
body.vscode-high-contrast .crt, body.vscode-high-contrast-light .crt { display: none; }
body.vscode-high-contrast .screen, body.vscode-high-contrast-light .screen { filter: none; }
@media (forced-colors: active) { .crt { display: none; } .screen { filter: none; } body { text-shadow: none; } }

/* top status line, like a tmux bar */
.bar { position: relative; display: flex; flex-wrap: wrap; gap: 4px 18px; align-items: baseline; padding: 6px 2px 14px; color: var(--ink-dim); }
.bar .spacer { flex: 1; }
.bar .brand { display: inline-flex; align-self: center; margin-right: 2px; }
.bar .brand svg { display: block; filter: var(--carrot-glow); }
.tabs, .range { display: flex; gap: 2px; flex-wrap: wrap; }
.tabs button, .range button {
  font: inherit; color: var(--ink-dim); background: none; border: 0; padding: 2px 8px; cursor: pointer; text-shadow: inherit;
}
.tabs button[aria-pressed="true"], .range button[aria-pressed="true"] { background: var(--chrome); color: var(--chrome-ink); text-shadow: none; }
.tabs button:hover:not([aria-pressed="true"]), .range button:hover:not([aria-pressed="true"]) { color: var(--chrome); }
button:focus-visible, [tabindex]:focus-visible, select:focus-visible, input:focus-visible { outline: 1px solid var(--chrome); outline-offset: 2px; }
.hint { color: var(--ink-mute); }
.status { color: var(--ink-dim); margin: 0 2px 14px; }

/* project picker */
.projpick { position: relative; display: flex; gap: 4px 18px; align-items: baseline; flex-wrap: wrap; }
.bar .proj { font: inherit; font-weight: 600; color: var(--ink); background: none; border: 0; padding: 2px 6px 2px 0; cursor: pointer; text-shadow: inherit; display: inline-flex; gap: 7px; align-items: center; }
.bar .proj:hover, .bar .proj[aria-expanded="true"] { color: var(--chrome); }
.bar .proj .caret { color: var(--chrome); font-weight: 400; }
.key { width: 8px; height: 8px; flex: none; display: inline-block; }
.key.hollow { background: transparent !important; outline: 1px solid var(--ink-mute); outline-offset: -1px; }
.pmenu { position: absolute; left: 0; top: calc(100% + 4px); z-index: 20; width: min(380px, calc(100vw - 32px)); background: var(--panel); border: 1px solid var(--chrome);
  padding: 6px 0; box-shadow: 0 10px 30px rgba(0,0,0,.28); max-height: 70vh; overflow-y: auto; }
.pm-h { color: var(--ink-mute); font-size: 10.5px; text-align: right; padding: 0 12px 2px; }
.pm-item { font: inherit; color: var(--ink); background: none; border: 0; width: 100%; text-align: left; cursor: pointer; text-shadow: inherit;
  display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; padding: 5px 12px; }
.pm-item small { display: block; color: var(--ink-mute); font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm-item .pm-t { font-variant-numeric: tabular-nums; color: var(--ink-dim); }
.pm-item .pm-t.z { color: var(--ink-mute); }
.pm-item:hover, .pm-item:focus-visible { background: color-mix(in srgb, var(--ink) 8%, transparent); outline: none; }
.pm-item[aria-selected="true"] { background: var(--chrome); color: var(--chrome-ink); text-shadow: none; }
.pm-item[aria-selected="true"] small, .pm-item[aria-selected="true"] .pm-t { color: var(--chrome-ink); }

/* range picker: a two-month calendar */
.picker { position: absolute; right: 0; top: calc(100% - 8px); z-index: 20; background: var(--panel); border: 1px solid var(--chrome);
  padding: 10px 14px 12px; box-shadow: 0 10px 30px rgba(0,0,0,.28); max-width: calc(100vw - 32px); color: var(--ink); }
.pk-head, .pk-foot { display: flex; align-items: center; gap: 8px; }
.pk-head { margin-bottom: 8px; }
.pk-head .spacer, .pk-foot .spacer { flex: 1; }
.pk-months { display: flex; gap: 26px; flex-wrap: wrap; }
.pk-title { color: var(--ink-dim); margin-bottom: 4px; text-align: center; }
.pk-grid { display: grid; grid-template-columns: repeat(7, 3.4ch); gap: 2px 0; }
.pk-wd { color: var(--ink-mute); font-size: 10.5px; text-align: center; }
.pk-d { font: inherit; background: none; border: 0; color: var(--ink); padding: 3px 0; cursor: pointer; text-shadow: inherit; text-align: center; }
.pk-d.z { color: var(--ink-mute); }
.pk-d.today { text-decoration: underline; text-underline-offset: 3px; }
.pk-d.in { background: color-mix(in srgb, var(--chrome) 22%, transparent); }
.pk-d.end { background: var(--chrome); color: var(--chrome-ink); text-shadow: none; }
.pk-d:disabled { opacity: .3; cursor: default; }
.pk-d:hover:not(:disabled):not(.end) { color: var(--chrome); }
.pk-foot { flex-wrap: wrap; gap: 6px 12px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--rule); }
#pk-sel { color: var(--ink-dim); }

/* box-drawn panels: fieldset/legend gives the btop "title in the border" for free */
.grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
fieldset { margin: 0; min-width: 0; border: 1px solid var(--rule); background: var(--panel); padding: 10px 14px 14px; border-radius: 0; }
legend { padding: 0 6px; color: var(--ink-dim); margin-left: -2px; }
legend b { color: var(--chrome); font-weight: 600; }
.span-12 { grid-column: span 12; } .span-8 { grid-column: span 8; } .span-4 { grid-column: span 4; }
.span-7 { grid-column: span 7; } .span-5 { grid-column: span 5; } .span-6 { grid-column: span 6; }
@media (max-width: 860px) { .grid > * { grid-column: span 12; } }

/* hero: the day tape */
.tape-head { display: flex; flex-wrap: wrap; gap: 6px 28px; align-items: baseline; margin-bottom: 10px; }
.tape-head .btn { margin-left: auto; }
.big { font-size: 40px; line-height: 1; font-weight: 600; font-variation-settings: "wdth" 75; letter-spacing: -.01em; }
.big small { font-size: 15px; font-weight: 400; color: var(--ink-dim); margin-left: 2px; }
.kv { color: var(--ink-dim); }
.kv b { color: var(--ink); font-weight: 600; }
.tape-wrap { overflow-x: auto; container-type: inline-size; }
/* glyph size follows the cell width so every cell fits; scaleY makes the tape tall without widening it */
.tape { display: grid; grid-template-columns: repeat(var(--cells, 48), minmax(0, 1fr)); line-height: 1; padding-top: 22px;
  font-size: min(26px, calc(100cqi / var(--cells, 48) / .66)); }
.tape span { text-align: center; cursor: default; overflow: hidden; display: block; transform: scaleY(2.2); transform-origin: bottom; }
.tape span:hover, .tape span:focus-visible { background: color-mix(in srgb, var(--ink) 10%, transparent); }
.tape .off { color: var(--ink-mute); opacity: .55; transform: none; }
.ticks { display: grid; color: var(--ink-mute); font-size: 10.5px; margin-top: 4px; }
.target { margin-top: 12px; color: var(--ink-dim); }
.target .meter { color: var(--add); letter-spacing: 1px; }
.target .meter i { font-style: normal; color: var(--ink-mute); }
.tod-k { margin-top: 18px; color: var(--ink-dim); }
.tod-k span { color: var(--ink-mute); }

/* range view: one segmented column per day, like a VU meter */
.cols { display: grid; grid-template-columns: repeat(var(--n, 7), minmax(0, 1fr)); gap: var(--gap, 4px); height: 128px; margin-top: 4px; }
.cols .c { display: flex; flex-direction: column-reverse; gap: 2px; cursor: pointer; min-width: 0; }
.cols .c i { flex: 1; background: color-mix(in srgb, var(--ink) 7%, transparent); }
.cols .c i.on { background: currentColor; }
.cols .c i.part { background: linear-gradient(to top, currentColor var(--f), color-mix(in srgb, var(--ink) 7%, transparent) var(--f)); }
.cols .c.met { color: var(--add); } .cols .c.under { color: var(--ink-mute); } .cols .c.now { color: var(--chrome); }
.cols .c:hover i:not(.on):not(.part) { background: color-mix(in srgb, var(--ink) 14%, transparent); }
.cols-axis { display: grid; grid-template-columns: repeat(var(--n, 7), minmax(0, 1fr)); gap: var(--gap, 4px); color: var(--ink-mute); font-size: 10.5px; margin-top: 4px; }
.cols-axis span { text-align: center; white-space: nowrap; }
.cols-axis span.mon { text-align: left; }
.cols-axis span.now { color: var(--chrome); }

/* streak: a numeral and a row of day marks, no decoration */
.streak .big { color: var(--add); }
.streak .big.zero { color: var(--ink-mute); }
.days { display: grid; grid-template-columns: repeat(14, 1fr); gap: 3px; margin: 12px 0 6px; font-size: 15px; }
.days span { text-align: center; }
.days .hit { color: var(--add); } .days .miss { color: var(--ink-mute); } .days .now { color: var(--chrome); }
.streak p { margin: 8px 0 0; color: var(--ink-dim); }

/* lines */
.diff { display: flex; gap: 22px; align-items: baseline; flex-wrap: wrap; }
.add { color: var(--add); } .del { color: var(--del); }
.week { margin-top: 14px; display: grid; gap: 3px; }
.week .row { display: grid; grid-template-columns: 3.2em 1fr 7.5em; gap: 10px; align-items: center; cursor: default; }
.week.wide .row { grid-template-columns: 5.6em 1fr 8.6em; }
.week .row:hover, .week .row:focus-visible { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.week .d { color: var(--ink-dim); }
.week .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink-dim); white-space: nowrap; }
.week .now .d { color: var(--chrome); }
.week .bars { white-space: nowrap; overflow: hidden; }

/* languages */
.lang { display: grid; gap: 6px; }
.lang .row { display: grid; grid-template-columns: 8em 1fr 4.4em 6.4em; gap: 10px; align-items: center; cursor: default; }
.lang.wide .row { grid-template-columns: 8em 1fr 4.4em 10.5em; }
.lang .row:hover, .lang .row:focus-visible { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.lang .name { display: flex; gap: 6px; align-items: center; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lang .track { height: 10px; background: color-mix(in srgb, var(--ink) 8%, transparent); }
.lang .fill { height: 100%; display: block; }
.lang .t, .lang .l { text-align: right; font-variant-numeric: tabular-nums; }
.lang .t { color: var(--ink); } .lang .l { color: var(--ink-dim); white-space: nowrap; }
.lang .hdr { color: var(--ink-mute); font-size: 10.5px; }
.lang .hdr:hover { background: none; }

/* git diff --stat */
.stat { width: 100%; table-layout: fixed; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.stat td { padding: 1px 0; white-space: nowrap; }
.stat td.path { color: var(--ink); padding-right: 12px; overflow: hidden; text-overflow: ellipsis; max-width: 0; }
.stat td.path .dir { color: var(--ink-mute); }
.stat td.sep { color: var(--ink-mute); padding-right: 8px; }
.stat td.num { text-align: right; padding-right: 10px; color: var(--ink-dim); }
.stat td.g { overflow: hidden; }
.stat tr:hover td { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.stat tfoot td { color: var(--ink-dim); padding-top: 8px; white-space: normal; }

/* sessions and days as a log */
.log { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.log li { display: grid; grid-template-columns: 7.6em 4.2em minmax(0, 1fr); gap: 10px; }
.log.multi li { grid-template-columns: 7.6em 4.2em minmax(0, 1fr) 7.5em; }
.log .when { color: var(--ink-dim); }
.log .dur { text-align: right; font-variant-numeric: tabular-nums; }
.log .dur.z { color: var(--ink-mute); }
.log .langs { display: flex; height: 8px; align-self: center; gap: 2px; }
.log .langs span { height: 100%; }
.log .pj { color: var(--ink-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; gap: 6px; align-items: center; }
.log .dtrack { align-self: center; height: 8px; display: block; min-width: 0; }
.log .dbar { display: flex; gap: 2px; height: 100%; }
.log .dbar span { height: 100%; min-width: 2px; }
/* the days card scrolls on its own, with a scrollbar that belongs to the terminal */
.log.daylog { max-height: 19.5em; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--rule) transparent; padding-right: 6px; }
.log.daylog::-webkit-scrollbar { width: 8px; }
.log.daylog::-webkit-scrollbar-track { background: transparent; }
.log.daylog::-webkit-scrollbar-thumb { background: var(--rule); }
.log.daylog::-webkit-scrollbar-thumb:hover { background: var(--ink-mute); }

.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 12px; color: var(--ink-dim); font-size: 11px; }
.legend span { display: inline-flex; gap: 6px; align-items: center; }
.legend i { width: 8px; height: 8px; display: inline-block; }
.legend i.met { background: var(--add); } .legend i.under { background: var(--ink-mute); } .legend i.now { background: var(--chrome); }
.legend [data-hl] { padding: 0 3px; }
.legend [data-hl]:hover, .legend [data-hl]:focus-visible, .legend .focus { color: var(--ink); }

/* reactive focus */
[data-hl] { cursor: default; }
.dim { opacity: .32; }
.prows .prow, .split span { transition: opacity .12s; }
@media (prefers-reduced-motion: reduce) { .prows .prow, .split span { transition: none; } }

#tip {
  position: fixed; pointer-events: none; z-index: 60; background: var(--panel); color: var(--ink);
  border: 1px solid var(--chrome); padding: 6px 9px; font-size: 11.5px; line-height: 1.45; max-width: 260px; text-shadow: none;
}
#tip strong { font-weight: 600; }
#tip .sub { color: var(--ink-dim); }

/* shared controls: option groups and bracketed command buttons */
.filters { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin-bottom: 14px; color: var(--ink-dim); }
.opts { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
.opts button, .btn { font: inherit; color: var(--ink-dim); background: none; border: 0; padding: 2px 8px; cursor: pointer; text-shadow: inherit; }
.opts button[aria-pressed="true"] { background: var(--chrome); color: var(--chrome-ink); text-shadow: none; }
.opts button:hover:not([aria-pressed="true"]), .btn:hover:not(:disabled) { color: var(--chrome); }
.btn { color: var(--ink); padding-inline: 2px; }
.btn::before { content: "[ "; color: var(--ink-mute); }
.btn::after { content: " ]"; color: var(--ink-mute); }
.btn.step::before, .btn.step::after { content: none; }
.btn.step { padding-inline: 6px; color: var(--ink-dim); }
.btn:disabled { color: var(--ink-mute); cursor: default; }
.btn.ok { color: var(--add); }
.btn.danger { color: var(--del); }
.btn.danger:hover:not(:disabled) { background: var(--del); color: var(--bg); text-shadow: none; }
.btn.danger:disabled { color: var(--ink-mute); }
.tin {
  font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--rule); padding: 1px 6px;
  width: 7ch; text-align: right; text-shadow: inherit; -moz-appearance: textfield; border-radius: 0;
}
.tin::-webkit-inner-spin-button, .tin::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.tin:focus { border-color: var(--chrome); outline: none; }
.tin.wide { width: 16ch; text-align: left; }
select.tin { width: auto; max-width: 100%; text-align: left; }
.tin::placeholder { color: var(--ink-mute); }
.unit { color: var(--ink-dim); }

/* the CRT controls, styled like a monitor OSD; also the export dialog */
.osd { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 18px; align-items: center; }
.osd .k { color: var(--ink-dim); }
.osd input[type=range] { accent-color: var(--chrome); width: min(260px, 100%); }
.osd output { color: var(--ink); min-width: 4ch; margin-left: 10px; font-variant-numeric: tabular-nums; }
.osd .why { grid-column: 1 / -1; color: var(--ink-mute); margin: 4px 0 0; max-width: 80ch; }

/* activity: year stats */
.ystats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px 24px; }
.ystat .v { font-size: 30px; line-height: 1.1; font-weight: 600; font-variation-settings: "wdth" 75; }
.ystat .k { color: var(--ink-dim); }
.ystat .s { color: var(--ink-mute); font-size: 11.5px; }
@media (max-width: 760px) { .ystats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* activity: heatmap of block glyphs; one hue, density carries the magnitude */
.heat-wrap { overflow-x: auto; }
.heat-inner { display: grid; grid-template-columns: 3em minmax(0, 1fr); gap: 4px 8px; }
.months { display: grid; grid-template-columns: repeat(var(--weeks, 53), minmax(0, 1fr)); color: var(--ink-mute); font-size: 10.5px; }
.months span { white-space: nowrap; }
.wd { display: grid; grid-template-rows: repeat(7, 1fr); gap: 2px; color: var(--ink-mute); font-size: 10.5px; }
.wd span { display: flex; align-items: center; }
.heat { display: grid; grid-template-rows: repeat(7, auto); grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; color: var(--add); }
.heat span { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; line-height: 1; cursor: default; }
.heat span:hover { outline: 1px solid var(--ink); outline-offset: 0; }
.heat .z, .heat-key .z { color: var(--ink-mute); }
.heat .now, .heat-key .now { color: var(--chrome); }
.heat .fut { visibility: hidden; }
.heat-key b { font-weight: 400; color: var(--add); }

/* activity: project split */
.split { display: flex; gap: 2px; height: 14px; margin-bottom: 14px; }
.split span { height: 100%; min-width: 2px; }
.prows { display: grid; gap: 6px; }
.prow { display: grid; grid-template-columns: 12em minmax(0, 1fr) 4.6em 4em 7.5em; gap: 10px; align-items: center; }
.prow:hover, .prow:focus-visible { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.prow .name { display: flex; gap: 6px; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prow .track { height: 10px; background: color-mix(in srgb, var(--ink) 8%, transparent); }
.prow .fill { height: 100%; display: block; }
.prow .t, .prow .pct, .prow .dd { text-align: right; font-variant-numeric: tabular-nums; }
.prow .pct, .prow .dd { color: var(--ink-dim); }
.prow.hdr { color: var(--ink-mute); font-size: 10.5px; }
.prow.hdr:hover { background: none; }
.prow.sel .name { color: var(--chrome); }
@media (max-width: 700px) { .prow { grid-template-columns: 11.5em minmax(0, 1fr) 4.6em; } .prow .pct, .prow .dd { display: none; } }

/* projects: cards */
.pcard legend .ago { color: var(--ink-mute); }
.pcard .path { color: var(--ink-mute); overflow-wrap: anywhere; margin-bottom: 10px; }
.pcard .stats { display: flex; flex-wrap: wrap; gap: 4px 28px; align-items: baseline; }
.pcard .v { font-size: 26px; line-height: 1.1; font-weight: 600; font-variation-settings: "wdth" 75; }
.pcard .v.zero { color: var(--ink-mute); }
.pcard .k { color: var(--ink-dim); }
.pcard .risk { color: var(--chrome); }
.spark { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); font-size: 22px; line-height: 1; margin-top: 12px; max-width: 360px; }
.spark span { text-align: center; cursor: default; }
.spark span:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
.spark .z { color: var(--ink-mute); opacity: .6; }
.spark-axis { display: flex; justify-content: space-between; max-width: 360px; color: var(--ink-mute); font-size: 10.5px; margin-top: 3px; }
.pcard .target { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--rule); }
.pcard .target .lbl { color: var(--ink-dim); margin-right: 4px; }
.pcard .target .hint { color: var(--ink-mute); flex-basis: 100%; }
.pcard .foot { margin-top: 10px; }

/* settings */
.set { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 24px; align-items: center; padding-block: 10px; }
.set + .set { border-top: 1px dashed var(--rule); }
.set .name { color: var(--ink); font-weight: 600; }
.set .desc { color: var(--ink-dim); max-width: 64ch; }
.set .spath { color: var(--ink); overflow-wrap: anywhere; margin-top: 4px; user-select: text; }
.set .ctl { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-end; }
@media (max-width: 700px) { .set { grid-template-columns: minmax(0, 1fr); } .set .ctl { justify-content: flex-start; } }
fieldset.danger { border-color: color-mix(in srgb, var(--del) 55%, var(--rule)); }
fieldset.danger legend b { color: var(--del); }
.console { min-height: 5.5em; color: var(--ink-dim); white-space: pre-wrap; overflow-wrap: anywhere; }
.console .cmd { color: var(--ink); }
.console .cmd::before { content: "$ "; color: var(--chrome); }
.console .ok { color: var(--add); }
.console .bad { color: var(--del); }
.console .cursor::after { content: "█"; color: var(--add); }
@media (prefers-reduced-motion: no-preference) { .console .cursor::after { animation: blink 1.1s steps(1) infinite; } @keyframes blink { 50% { opacity: 0; } } }

/* export dialog */
.xd-back { position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,.45); display: grid; place-items: center; padding: 16px; }
.xd { width: min(560px, 100%); }
.xd-foot { display: flex; justify-content: flex-end; gap: 12px; margin-top: 14px; }
```

- [ ] **Step 10: Replace `src/webview/main.ts`**

```ts
// Dashboard entry point: wiring only. Every panel renders from the store, and
// nothing here computes a number.
import type { ExtensionMessage, WebviewMessage } from "../shared/types"
import { carrotSvg } from "./carrot"
import { applyCrt, initCrt } from "./crt"
import { $ } from "./dom"
import { Change, Store, Tab } from "./state"
import { hideTip, initTooltip } from "./tooltip"

declare function acquireVsCodeApi(): {
  postMessage(m: WebviewMessage): void
  getState(): unknown
  setState(s: unknown): void
}

const vscode = acquireVsCodeApi()
const post = (m: WebviewMessage): void => vscode.postMessage(m)
const store = new Store(post)
const TABS: Tab[] = ["overview", "activity", "projects", "settings"]
let tab: Tab = "overview"

type Render = (change: Change | "tab") => void
// Each tab registers its renderer below; the top bar renders on every change.
const tabs: Partial<Record<Tab, Render>> = {}
const bar: Render[] = []
// Messages the store doesn't handle (the interim export's data) go to whoever asked.
const extra: ((msg: ExtensionMessage) => void)[] = []

function render(change: Change | "tab"): void {
  for (const r of bar) r(change)
  tabs[tab]?.(change)
}

function showTab(next: Tab): void {
  tab = next
  document.querySelectorAll<HTMLElement>("section.tab").forEach(s => { s.hidden = s.dataset.tab !== next })
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === next)))
  $("range").hidden = next !== "overview"
  hideTip()
  try { vscode.setState({ tab: next }) } catch { /* only a convenience */ }
  render("tab")
}

// ── panels ──

// ── start ──
initTooltip($("tip"))
initCrt()
$("brand").append(carrotSvg(2))
store.on(change => {
  if (change === "settings" && store.settings) applyCrt(store.settings.crt)
  render(change)
})
window.addEventListener("message", (e: MessageEvent<ExtensionMessage>) => {
  for (const fn of extra) fn(e.data)
  store.receive(e.data)
})
document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach(b =>
  b.addEventListener("click", () => showTab((b.dataset.tab as Tab) ?? "overview")))
const saved = vscode.getState() as { tab?: Tab } | null
showTab(saved?.tab && TABS.includes(saved.tab) ? saved.tab : "overview")
post({ type: "ready" })
```

(`tabs` and `extra` are filled by Tasks 6–10. Until then the tabs show their static markup.)

- [ ] **Step 11: Remove the old renderers and their dependencies**

```bash
git rm src/webview/charts.ts src/webview/theme.ts src/webview/heatmap.ts
npm uninstall chart.js d3 @types/d3
```

Run: `git grep -n -e "chart.js" -e '"d3"' -e "./theme" -e "./charts" -- src package.json`
Expected: no output.

- [ ] **Step 12: Build, typecheck, test**

Run: `npm run build && npm run typecheck && npm test`
Expected: all three pass.

- [ ] **Step 13: Smoke-check in the Extension Development Host**

Press F5 (or "Run Extension"), run **Rabbit Hole: Open Dashboard**. Expected: the carrot (with an orange glow in a dark theme) heads a status line with "all projects ▾", the four tabs and the range buttons; the font is Martian Mono (a narrow, squarish mono — compare with the mockup); the four tabs switch; the CRT mask and scanlines are faintly visible; the overview shows its empty boxed panels. Open the webview developer tools (**Developer: Open Webview Developer Tools**) and confirm no CSP or 404 errors. Switch to a light theme and a high-contrast theme: paper palette with a fainter mask, then no CRT at all.

- [ ] **Step 14: Commit**

```bash
git add -A src/webview src/dashboard src/shared src/extension.ts test package.json package-lock.json
git commit -m "Replace the dashboard shell with the TTY one and retire the old protocol

The webview now loads Martian Mono, the TTY styles and a wiring-only main.ts.
The host stops sending init and update, answers requestYear, and validates CRT
writes before they reach settings.json. Chart.js and d3 are gone."
```

---
### Task 6: Top bar — project picker, range buttons, calendar

**Files:**
- Create: `src/webview/projectPicker.ts`, `src/webview/datePicker.ts`
- Modify: `src/webview/main.ts`

**Interfaces:**
- Consumes: `Store` (Task 3); `calendar.ts`, `format.ts`, `colors.ts` (Task 1); `dom.ts` (Task 4).
- Produces: `renderProjectButton(store)`, `openMenu(store)`, `closeMenu()`, `initProjectPicker(store)`; `renderRangeButtons(store)`, `closePicker()`, `initDatePicker(store)`.

The calendar's rules are already tested (Task 1); this task is DOM only and is checked by hand in Step 4.

- [ ] **Step 1: Write `src/webview/projectPicker.ts`**

```ts
// The project name in the status line opens every project with today's time.
// One choice, shared by the overview, the activity tab and the streak.
import { projectColor } from "./colors"
import { closePicker } from "./datePicker"
import { $, el, keyBox } from "./dom"
import { fmt, plural } from "./format"
import type { Store } from "./state"

export function renderProjectButton(store: Store): void {
  const year = store.year
  const p = year?.projects.find(q => q.id === store.view.sel)
  $("proj-name").textContent = p ? p.name : "all projects"
  const k = $("proj-key")
  k.style.background = p && year ? projectColor(year, p.id) : ""
  k.classList.toggle("hollow", !p)
}

function renderMenu(store: Store): void {
  const year = store.year
  if (!year) return
  const last = year.days.length - 1
  const items = [
    { id: "all", name: "all projects", color: null as string | null, sub: plural(year.projects.length, "project"), ms: year.global.active[last] ?? 0 },
    ...year.projects.map(p => ({
      id: p.id,
      name: p.name,
      color: projectColor(year, p.id) as string | null,
      sub: p.path + (p.id === store.here ? "  · open here" : ""),
      ms: p.active[last] ?? 0,
    })),
  ]
  $("pmenu").replaceChildren(el("div", "pm-h", "today"), ...items.map(it => {
    const b = el("button", "pm-item")
    b.setAttribute("role", "option")
    b.setAttribute("aria-selected", String(it.id === store.view.sel))
    const name = el("span", "pm-name")
    name.append(el("span", null, it.name), el("small", null, it.sub))
    b.append(keyBox(it.color), name, el("span", it.ms ? "pm-t" : "pm-t z", it.ms ? fmt(it.ms) : "·"))
    b.addEventListener("click", () => {
      closeMenu()
      store.setSelection(it.id)
      $("proj-btn").focus()
    })
    return b
  }))
}

export function openMenu(store: Store): void {
  closePicker()
  renderMenu(store)
  $("pmenu").hidden = false
  $("proj-btn").setAttribute("aria-expanded", "true")
  const first = $("pmenu").querySelector<HTMLElement>('[aria-selected="true"]') ?? $("pmenu").querySelector<HTMLElement>(".pm-item")
  first?.focus()
}

export function closeMenu(): void {
  $("pmenu").hidden = true
  $("proj-btn").setAttribute("aria-expanded", "false")
}

export function initProjectPicker(store: Store): void {
  $("proj-btn").addEventListener("click", () => ($("pmenu").hidden ? openMenu(store) : closeMenu()))
  $("pmenu").addEventListener("keydown", e => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const items = Array.from($("pmenu").querySelectorAll<HTMLElement>(".pm-item"))
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus()
  })
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("pmenu").hidden) {
      closeMenu()
      $("proj-btn").focus()
    }
  })
  window.addEventListener("pointerdown", e => {
    const t = e.target as Node
    if (!$("pmenu").hidden && !$("pmenu").contains(t) && !$("proj-btn").contains(t)) closeMenu()
  })
}
```

- [ ] **Step 2: Write `src/webview/datePicker.ts`**

```ts
// Range buttons and the two-month calendar dropped from the status line.
// The rules (presets, 92-day limit, click order) are calendar.ts's.
import { Pick, RangeId, dayDisabled, monthDays, pickDay, pickLabel, presetOf, presetRange, rangeLabel } from "./calendar"
import { $, el, press } from "./dom"
import { MON, dstr, fmt, fromKey } from "./format"
import { closeMenu } from "./projectPicker"
import type { Store } from "./state"

let pick: Pick = { start: null, end: null }
let hover: string | null = null
let right = 0   // the right-hand month, as year * 12 + month

const ym = (key: string): number => {
  const d = fromKey(key)
  return d.getFullYear() * 12 + d.getMonth()
}

export function renderRangeButtons(store: Store): void {
  const v = store.view
  const picked = v.preset === null && !!v.from
  press($("range"), b => (b.dataset.range ? b.dataset.range === v.preset : picked))
  $("r-cal").textContent = picked ? rangeLabel(v.from, v.to) : "pick…"
}

export function closePicker(): void {
  $("picker").hidden = true
  $("r-cal").setAttribute("aria-expanded", "false")
}

function openPicker(store: Store): void {
  const year = store.year
  if (!year || !store.view.from) return
  closeMenu()
  pick = { start: store.view.from, end: store.view.to }
  hover = null
  right = Math.min(ym(year.today), Math.max(ym(year.days[0]) + 1, ym(store.view.to)))
  $("picker").hidden = false
  $("r-cal").setAttribute("aria-expanded", "true")
  renderMonths(store)
}

function renderMonths(store: Store): void {
  const year = store.year
  if (!year) return
  const active = new Map(year.days.map((d, i) => [d, year.global.active[i]] as [string, number]))
  $("pk-months").replaceChildren(...[right - 1, right].map(k => {
    const y = Math.floor(k / 12)
    const m = k % 12
    const box = el("div")
    box.append(el("div", "pk-title", `${MON[m].toLowerCase()} ${y}`))
    const grid = el("div", "pk-grid")
    for (const w of ["mo", "tu", "we", "th", "fr", "sa", "su"]) grid.append(el("span", "pk-wd", w))
    for (const key of monthDays(y, m)) {
      if (!key) {
        grid.append(el("span"))
        continue
      }
      const b = el("button", "pk-d", fromKey(key).getDate())
      b.dataset.key = key
      const ms = active.get(key)
      if (ms === 0) b.classList.add("z")
      if (key === year.today) b.classList.add("today")
      b.setAttribute("aria-label", dstr(key) + (ms === undefined ? "" : ms ? `, ${fmt(ms)} active` : ", no activity"))
      grid.append(b)
    }
    box.append(grid)
    return box
  }))
  $<HTMLButtonElement>("pk-prev").disabled = right - 1 <= ym(year.days[0])
  $<HTMLButtonElement>("pk-next").disabled = right >= ym(year.today)
  paint(store)
}

function paint(store: Store): void {
  const year = store.year
  if (!year) return
  const a = pick.start
  const z = pick.end ?? (hover && a && hover >= a ? hover : null)
  $("pk-months").querySelectorAll<HTMLButtonElement>(".pk-d").forEach(b => {
    const d = b.dataset.key ?? ""
    b.disabled = dayDisabled(pick, d, year.days[0], year.today)
    b.classList.toggle("end", !!a && (d === a || d === z))
    b.classList.toggle("in", !!a && !!z && d > a && d < z)
  })
  $("pk-sel").textContent = pickLabel(pick)
  $<HTMLButtonElement>("pk-apply").disabled = !(pick.start && pick.end)
}

const dayButton = (t: EventTarget | null): HTMLButtonElement | null =>
  t instanceof Element ? t.closest<HTMLButtonElement>(".pk-d") : null

export function initDatePicker(store: Store): void {
  $("range").addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button") : null
    if (!b || !store.year) return
    if (b.id === "r-cal") {
      if ($("picker").hidden) openPicker(store)
      else closePicker()
      return
    }
    const id = b.dataset.range as RangeId | undefined
    if (!id) return
    closePicker()
    const r = presetRange(id, store.year.today)
    store.setView(r.from, r.to, id)
  })
  $("pk-months").addEventListener("click", e => {
    const b = dayButton(e.target)
    if (!b || b.disabled || !b.dataset.key) return
    pick = pickDay(pick, b.dataset.key)
    paint(store)
  })
  $("pk-months").addEventListener("pointerover", e => {
    const b = dayButton(e.target)
    if (!b || pick.end || !b.dataset.key) return
    hover = b.dataset.key
    paint(store)
  })
  $("pk-prev").addEventListener("click", () => { right--; renderMonths(store) })
  $("pk-next").addEventListener("click", () => { right++; renderMonths(store) })
  $("pk-cancel").addEventListener("click", closePicker)
  $("pk-apply").addEventListener("click", () => {
    const { start, end } = pick
    if (!store.year || !start || !end) return
    closePicker()
    store.setView(start, end, presetOf(start, end, store.year.today))
  })
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("picker").hidden) {
      closePicker()
      $("r-cal").focus()
    }
  })
  window.addEventListener("pointerdown", e => {
    const t = e.target as Node
    if (!$("picker").hidden && !$("picker").contains(t) && t !== $("r-cal")) closePicker()
  })
}
```

- [ ] **Step 3: Wire them in `src/webview/main.ts`**

Add to the imports:

```ts
import { initDatePicker, renderRangeButtons } from "./datePicker"
import { initProjectPicker, renderProjectButton } from "./projectPicker"
```

Add directly under `// ── panels ──`:

```ts
initProjectPicker(store)
initDatePicker(store)
bar.push(() => {
  renderProjectButton(store)
  renderRangeButtons(store)
})
```

- [ ] **Step 4: Build, test, and check by hand**

Run: `npm run build && npm run typecheck && npm test`
Expected: all pass.

In the Extension Development Host (reload the dashboard with **Developer: Reload Webviews** or close and reopen it):
- "all projects ▾" opens the list with today's time per project, "open here" on the current one, arrow keys move through it, Escape and an outside click close it; choosing a project changes the button's name and colour key.
- today / yesterday / 7d / 30d press as you click them.
- "pick…" opens two months ending in the shown month; days with no activity are dimmed, today is underlined, future days and days before the year are disabled; after a start click, days 92 or more days on are disabled; apply on a preset's dates presses that preset, on other dates shows "3 sep – 12 sep" on the button.

- [ ] **Step 5: Commit**

```bash
git add src/webview/projectPicker.ts src/webview/datePicker.ts src/webview/main.ts
git commit -m "Add the dashboard's project picker, range buttons and calendar"
```

---

### Task 7: The overview

**Files:**
- Create: `src/webview/tape.ts`, `src/webview/streak.ts`, `src/webview/rangeColumns.ts`, `src/webview/lines.ts`, `src/webview/languages.ts`, `src/webview/files.ts`, `src/webview/sessionLog.ts`, `src/webview/overview.ts`
- Modify: `src/webview/main.ts`

**Interfaces:**
- Consumes: `buildView`, `lineRows`, `seriesFor`, `storedStreak`, `streakInfo`, `tapeWindow`, `tapeCells`, `targetMetAt`, `TapeCell`, `DayView`, `FileRow`, `LangRow`, `Focus`, `Selection` from `model.ts`; Task 1's helpers; Task 4's `dom`, `tooltip`, `focus`; `Store` (Task 3).
- Produces:
  - `tape.ts`: `TapeSource { sessions; base; perDays; now; color(c); label(c) }`, `setTape(src)`, `initTape()`.
  - `streak.ts`: `renderStreak(year, sel)` (the activity tab does not use it; the overview does).
  - `rangeColumns.ts`: `ColDay`, `ColOpts`, `renderCols(days, opts)`, `initCols()`.
  - `lines.ts`: `LineItem`, `setLineTotals(added, deleted)`, `renderLines(items, wide)`, `initLines()`.
  - `languages.ts`: `renderLangs(values, base, totalMs, scope, focusLang, colors)`.
  - `files.ts`: `renderFiles(rows, multi, names)`, `initFiles()`.
  - `sessionLog.ts`: `LogOpts`, `DaysOpts`, `renderSessions(sessions, opts)`, `renderDays(days, opts)`.
  - `overview.ts`: `renderOverview(store, openDay, back)`.

Every number here comes from `model.ts` (tested in phase 1) and Task 1's layout helpers; this task is rendering and is checked by hand in Step 11.

- [ ] **Step 1: Write `src/webview/tape.ts`**

```ts
// The day tape: block glyphs across the day, one cell per few minutes, coloured
// by the cell's main language. For a range it is the average active day.
import type { ActivitySession } from "../shared/types"
import { $, el, onWidth } from "./dom"
import { fmt, hhmm } from "./format"
import { TAPE_GLYPHS, tapeCellCount, tapeKey, tapeMaxCells, tapeTicks } from "./layout"
import { TapeCell, tapeCells, tapeWindow } from "./model"
import { bindTip, tipLine, tipSub } from "./tooltip"

export interface TapeSource {
  sessions: ActivitySession[]   // what is drawn (narrowed to the focus)
  base: ActivitySession[]       // the unfocused sessions: they set the window and, for averages, the scale
  perDays: number               // 1 = a single day; more = the average active day of a range
  now: number
  color: (c: TapeCell) => string | null
  label: (c: TapeCell) => string | null
}

let src: TapeSource | null = null
let drawnFor = -1

export function setTape(next: TapeSource): void {
  src = next
  drawnFor = -1
  drawTape()
}

// Redraws only when the cell budget changes; between breakpoints the glyphs
// scale with the container (style.css).
function drawTape(): void {
  const width = $("tape-wrap").clientWidth
  if (!src || !width) return
  const maxCells = tapeMaxCells(width)
  if (maxCells === drawnFor) return
  drawnFor = maxCells
  const s = src
  const first = tapeWindow(s.base, 1, s.now)
  const win = tapeWindow(s.base, tapeCellCount(first.endMin - first.startMin, maxCells), s.now)
  const average = s.perDays > 1
  const cells = tapeCells(s.sessions, win, s.now, { perDays: s.perDays, base: s.base })
  const tape = $("tape")
  tape.style.setProperty("--cells", String(win.cells))
  tape.setAttribute("aria-label", `Active time across the day in ${win.cellMin}-minute blocks, ${hhmm(win.startMin)} to ${hhmm(win.endMin)}`)
  tape.replaceChildren(...cells.map(c => {
    const span = el("span", c.level ? null : "off", TAPE_GLYPHS[c.level])
    const color = c.level ? s.color(c) : null
    if (color) span.style.color = color
    const what = s.label(c)
    bindTip(span, () => (c.level
      ? [tipLine(`${fmt(c.ms)} active`, average ? `of ${win.cellMin}m, average day` : `of ${win.cellMin}m`), tipSub(hhmm(c.startMin) + (what ? ` · mostly ${what}` : ""))]
      : [tipSub(`${hhmm(c.startMin)} · idle`)]))
    return span
  }))
  const ticks = tapeTicks(win, maxCells)
  const row = $("ticks")
  row.style.gridTemplateColumns = `repeat(${ticks.length}, minmax(0, 1fr))`
  row.replaceChildren(...ticks.map(t => el("span", null, t)))
  const key = document.getElementById("tape-key")
  if (key) key.textContent = tapeKey(win, average)
}

export function initTape(): void {
  onWidth($("tape-wrap"), drawTape)
}
```

- [ ] **Step 2: Write `src/webview/streak.ts`**

```ts
// The streak: storage's count, fourteen day marks, the longest run. No decoration.
import type { YearPayload } from "../shared/types"
import { $, el } from "./dom"
import { MIN, dstr, fmt, shortDate } from "./format"
import { Selection, seriesFor, storedStreak, streakInfo } from "./model"
import { bindTip, tipLine } from "./tooltip"

export function renderStreak(year: YearPayload, sel: Selection): void {
  const s = seriesFor(year, sel)
  const info = streakInfo(s, storedStreak(year, sel))
  const n = s.days.length
  $("streak-n").textContent = String(info.current)
  $("streak-big").classList.toggle("zero", info.current === 0)
  const from = Math.max(0, n - 14)
  $("days").replaceChildren(...s.days.slice(from).map((day, k) => {
    const i = from + k
    const now = i === n - 1
    const hit = s.active[i] >= s.targetMs[i]
    const mark = el("span", now ? "now" : hit ? "hit" : "miss", now ? (hit ? "◆" : "◇") : hit ? "■" : "□")
    bindTip(mark, () => [tipLine(
      now ? (hit ? "today, target met" : `today, ${fmt(info.todayRemainingMs)} to go`) : hit ? "target met" : "missed",
      dstr(day),
    )])
    return mark
  }))
  const target = n ? s.targetMs[n - 1] : year.globalTargetMs
  const mins = Math.round(target / MIN)
  $("days").setAttribute("aria-label", `Last 14 days against the ${mins} minute target`)
  const parts = [info.longest && info.longestEnd ? `Longest run ${info.longest} days, ended ${shortDate(info.longestEnd)}.` : "No streak yet."]
  if (info.atRisk) parts.push(`At risk today: ${fmt(info.todayRemainingMs)} to go.`)
  if (sel !== "all" && target !== year.globalTargetMs) parts.push(`Uses this project's ${mins}m target.`)
  $("streak-long").textContent = parts.join(" ")
}
```

- [ ] **Step 3: Write `src/webview/rangeColumns.ts`**

```ts
// A range's hero: one segmented column per day, like a VU meter. Green when the
// day met its target; under a focus, the focused project's or language's colour.
// Clicking a column opens that day.
import { $, el } from "./dom"
import { MIN, dstr, fmt, pct, plural } from "./format"
import { colAxis, colGap, colSegments } from "./layout"
import { delegateTip, hideTip, tipLine, tipSub } from "./tooltip"

export interface ColDay {
  date: string
  shownMs: number                 // narrowed to the focus
  wholeMs: number
  targetMs: number
  sessions: number
  added: number
  deleted: number
  byProject: [string, number][]   // filled for all projects without a focus, for the tooltip
}
export interface ColOpts {
  today: string
  focusColor: string | null
  focusName: string | null
  projName: (id: string) => string
  onOpen: (date: string) => void
}

let list: ColDay[] = []
let opts: ColOpts | null = null

export function renderCols(days: ColDay[], o: ColOpts): void {
  list = days
  opts = o
  const n = days.length
  const max = Math.max(1, ...days.map(d => d.wholeMs))
  const cols = $("cols")
  const axis = $("cols-axis")
  for (const h of [cols, axis]) {
    h.style.setProperty("--n", String(n))
    h.style.setProperty("--gap", `${colGap(n)}px`)
  }
  cols.replaceChildren(...days.map((d, i) => {
    const c = el("span", "c " + (o.focusColor ? "hl" : d.date === o.today ? "now" : d.wholeMs >= d.targetMs ? "met" : "under"))
    if (o.focusColor) c.style.color = o.focusColor
    c.dataset.i = String(i)
    // scaled to the whole day's peak, so a focused column reads as a share
    for (const f of colSegments(d.shownMs, max)) {
      const seg = el("i", f >= 1 ? "on" : f > 0 ? "part" : "")
      if (f > 0 && f < 1) seg.style.setProperty("--f", `${Math.round(f * 100)}%`)
      c.append(seg)
    }
    return c
  }))
  axis.replaceChildren(...colAxis(days.map(d => d.date), o.today).map(a => {
    const s = el("span", a.cls || null, a.text)
    s.style.gridColumn = `${a.col} / span ${a.span}`
    return s
  }))
}

export function initCols(): void {
  const cols = $("cols")
  delegateTip(cols, c => {
    const d = list[Number(c.dataset.i)]
    const o = opts
    if (!d || !o) return null
    const out = [tipLine(d.shownMs ? fmt(d.shownMs) : "no activity", (o.focusName ? o.focusName + " · " : "") + dstr(d.date))]
    if (o.focusName && d.wholeMs) out.push(tipSub(`of ${fmt(d.wholeMs)} that day (${pct(d.shownMs, d.wholeMs)}%)`))
    if (d.shownMs) out.push(tipSub(`${plural(d.sessions, "session")} · +${d.added} −${d.deleted}`))
    for (const [id, ms] of d.byProject) out.push(tipSub(`${o.projName(id)} ${fmt(ms)}`))
    if (d.shownMs && d.wholeMs < d.targetMs && !o.focusName) out.push(tipSub(`under the ${Math.round(d.targetMs / MIN)}m target`))
    out.push(tipSub("click to open this day"))
    return out
  })
  cols.addEventListener("click", e => {
    const c = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-i]") : null
    const d = c ? list[Number(c.dataset.i)] : undefined
    if (d && opts) {
      hideTip()
      opts.onOpen(d.date)
    }
  })
}
```

- [ ] **Step 4: Write `src/webview/lines.ts`**

```ts
// Lines: the totals, and one +/- row per day (or per week), the runs scaled to
// the biggest row and to the width the row actually has.
import { $, charWidth, el, onWidth } from "./dom"
import { signed } from "./format"
import { runs } from "./layout"
import { bindTip, tipLine, tipSub } from "./tooltip"

export interface LineItem { label: string; added: number; deleted: number; now: boolean; sub: string }

let bars: { node: HTMLElement; added: number; deleted: number }[] = []
let max = 1

export function setLineTotals(added: number, deleted: number): void {
  $("ln-add").textContent = `+${added}`
  $("ln-del").textContent = `−${deleted}`
  $("ln-net").textContent = signed(added - deleted)
}

export function renderLines(items: LineItem[], wide: boolean): void {
  const host = $("week")
  max = Math.max(1, ...items.map(r => r.added + r.deleted))
  host.classList.toggle("wide", wide)
  bars = []
  host.replaceChildren(...items.map(r => {
    const row = el("div", r.now ? "row now" : "row")
    const node = el("span", "bars")
    row.append(el("span", "d", r.label), node, el("span", "n", `+${r.added} −${r.deleted}`))
    bindTip(row, () => [tipLine(`+${r.added}  −${r.deleted}`, r.sub), tipSub(`net ${signed(r.added - r.deleted)}`)])
    bars.push({ node, added: r.added, deleted: r.deleted })
    return row
  }))
  fillLines()
}

function fillLines(): void {
  if (!bars.length) return
  const w = bars[0].node.clientWidth
  if (!w) return
  const cols = Math.max(6, Math.floor(w / charWidth(bars[0].node)) - 1)
  for (const b of bars) {
    const [na, nr] = runs(b.added, b.deleted, max, cols)
    b.node.replaceChildren(el("span", "add", "+".repeat(na)), el("span", "del", "-".repeat(nr)))
  }
}

export function initLines(): void {
  onWidth($("week"), fillLines)
}
```

- [ ] **Step 5: Write `src/webview/languages.ts`**

```ts
// Languages: the unfocused view's rows, always in the same order, so a hover
// never moves anything. Under a language focus the other rows dim; under a
// project focus each row shows that project's share.
import { langColor } from "./colors"
import { $, el, keyBox } from "./dom"
import { HOUR, fmt, hours, pct } from "./format"
import type { LangRow } from "./model"
import { bindTip, tipLine, tipSub } from "./tooltip"

const LANG_ROWS = 10

export function renderLangs(values: LangRow[], base: LangRow[], totalMs: number, scope: string, focusLang: string | null, colors: Map<string, string>): void {
  const host = $("lang")
  const shown = base.slice(0, LANG_ROWS)
  const maxMs = Math.max(1, ...shown.map(l => l.ms))
  const many = totalMs >= 10 * HOUR
  const rows = shown.map(b => values.find(v => v.name === b.name) ?? { name: b.name, ms: 0, added: 0, deleted: 0 })
  host.classList.toggle("wide", rows.some(l => l.added >= 1000 || l.deleted >= 1000))
  const hdr = el("div", "row hdr")
  hdr.append(el("span", null, "language"), el("span"), el("span", "t", "time"), el("span", "l", "lines"))
  host.replaceChildren(hdr, ...rows.map(l => {
    const row = el("div", focusLang && focusLang !== l.name ? "row dim" : "row")
    row.dataset.hl = "l:" + l.name
    const color = langColor(colors, l.name)
    const name = el("span", "name")
    name.append(keyBox(color), l.name)
    const track = el("span", "track")
    const fill = el("span", "fill")
    fill.style.width = `${l.ms / maxMs * 100}%`
    fill.style.background = color
    track.append(fill)
    row.append(name, track, el("span", "t", l.ms ? (many ? hours(l.ms) : fmt(l.ms)) : "·"), el("span", "l", l.ms ? `+${l.added} −${l.deleted}` : ""))
    bindTip(row, () => [tipLine(fmt(l.ms), l.name), tipSub(`${pct(l.ms, totalMs)}% of ${scope} · +${l.added} −${l.deleted} lines`)])
    return row
  }))
  if (!rows.length) host.append(el("div", "hint", "no activity"))
  if (base.length > LANG_ROWS) host.append(el("div", "hint", `${base.length - LANG_ROWS} more languages`))
}
```

- [ ] **Step 6: Write `src/webview/files.ts`**

```ts
// Files as git diff --stat: path, |, count, and a +/- graph that gets whatever
// width the other columns leave.
import type { Names } from "./colors"
import { $, charWidth, el, onWidth } from "./dom"
import { plural, splitPath } from "./format"
import { runs } from "./layout"
import type { FileRow } from "./model"

const SHOW_FILES = 9

let graphs: { g: HTMLElement; added: number; deleted: number }[] = []
let max = 1

export function renderFiles(rows: FileRow[], multi: boolean, names: Names): void {
  const shown = rows.slice(0, SHOW_FILES)
  max = Math.max(1, ...shown.map(f => f.added + f.deleted))
  const body = el("tbody")
  graphs = shown.map(f => {
    const { dir, name } = splitPath(f.path, names.root(f.projectId))
    const tr = el("tr")
    const path = el("td", "path")
    // with all projects shown, the same path in two repos must read differently
    const prefix = (multi ? names.project(f.projectId) + "/" : "") + dir
    if (prefix) path.append(el("span", "dir", prefix))
    path.append(name)
    path.title = f.path
    const g = el("td", "g")
    tr.append(path, el("td", "sep", "|"), el("td", "num", f.added + f.deleted), g)
    body.append(tr)
    return { g, added: f.added, deleted: f.deleted }
  })
  const added = rows.reduce((s, f) => s + f.added, 0)
  const deleted = rows.reduce((s, f) => s + f.deleted, 0)
  const foot = el("tfoot")
  const footRow = el("tr")
  const cell = el("td", null, rows.length
    ? `${plural(rows.length, "file")} changed, ${added} insertions(+), ${deleted} deletions(-)` + (rows.length > SHOW_FILES ? ` · ${rows.length - SHOW_FILES} smaller not shown` : "")
    : "no changes")
  cell.colSpan = 4
  footRow.append(cell)
  foot.append(footRow)
  const cols = el("colgroup")
  for (const w of ["55%", "2ch", "6.5ch", ""]) {
    const c = el("col")
    if (w) c.style.width = w
    cols.append(c)
  }
  $("stat").replaceChildren(cols, body, foot)
  fillFiles()
}

function fillFiles(): void {
  if (!graphs.length) return
  for (const x of graphs) x.g.replaceChildren()
  const w = graphs[0].g.clientWidth
  if (!w) return
  const cols = Math.max(4, Math.floor(w / charWidth(graphs[0].g)) - 1)
  for (const x of graphs) {
    const [na, nr] = runs(x.added, x.deleted, max, cols)
    x.g.append(el("span", "add", "+".repeat(na)), el("span", "del", "-".repeat(nr)))
  }
}

export function initFiles(): void {
  onWidth($("stat"), fillFiles)
}
```

- [ ] **Step 7: Write `src/webview/sessionLog.ts`**

```ts
// Sessions for a single day; one line per day for a range (the "days" card,
// which scrolls on its own).
import type { ActivitySession } from "../shared/types"
import { Names, langColor } from "./colors"
import { $, el, keyBox } from "./dom"
import { clock, dstr, fmt, plural, shortDate, weekday } from "./format"
import type { DayView, Focus } from "./model"
import { bindTip, tipLine, tipSub } from "./tooltip"

export interface LogOpts {
  multi: boolean
  focus: Focus
  focusName: string
  colors: Map<string, string>
  names: Names
  now: number
}
export interface DaysOpts extends LogOpts { byProject: (date: string) => [string, number][] }

function sessionBar(s: ActivitySession, o: LogOpts): HTMLElement {
  const bar = el("span", "langs")
  const langs = Object.entries(s.languages ?? {}).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1])
  if (!langs.length) {
    // recorded before per-session languages: the project's colour stands in
    const b = el("span")
    b.style.flex = "1"
    b.style.background = o.names.color(s.projectId ?? "")
    bar.append(b)
    return bar
  }
  for (const [name, ms] of langs) {
    const b = el("span")
    b.dataset.hl = "l:" + name
    b.style.flex = String(ms)
    b.style.background = langColor(o.colors, name)
    if (o.focus?.kind === "language" && o.focus.id !== name) b.style.opacity = ".15"
    bar.append(b)
  }
  return bar
}

export function renderSessions(sessions: ActivitySession[], o: LogOpts): void {
  const host = $("log")
  host.classList.remove("daylog")
  host.classList.toggle("multi", o.multi)
  const f = o.focus
  host.replaceChildren(...sessions.map(s => {
    const off = !!f && (f.kind === "project" ? s.projectId !== f.id : !s.languages?.[f.id])
    const li = el("li", off ? "dim" : null)
    const end = s.endTime ?? o.now
    li.append(el("span", "when", `${clock(s.startTime)}–${clock(end)}`), el("span", "dur", fmt(s.activeTime)), sessionBar(s, o))
    if (o.multi && s.projectId) {
      const pj = el("span", "pj")
      pj.dataset.hl = "p:" + s.projectId
      pj.append(keyBox(o.names.color(s.projectId)), o.names.project(s.projectId))
      li.append(pj)
    }
    const langs = Object.entries(s.languages ?? {}).sort((a, b) => b[1] - a[1])
    bindTip(li, () => [
      tipLine(`${fmt(s.activeTime)} active`, `${clock(s.startTime)}–${clock(end)}` + (o.multi && s.projectId ? ` · ${o.names.project(s.projectId)}` : "")),
      ...langs.map(([name, ms]) => tipSub(`${name} ${fmt(ms)}`)),
    ])
    return li
  }))
  if (!sessions.length) host.append(el("li", "hint", "no sessions"))
}

export function renderDays(days: DayView[], o: DaysOpts): void {
  const host = $("log")
  host.classList.add("daylog")
  host.classList.remove("multi")
  const f = o.focus
  const maxDay = Math.max(1, ...days.map(d => d.whole.activeMs))
  host.replaceChildren(...days.slice().reverse().map(d => {
    const ms = d.shown.activeMs
    const li = el("li")
    // one bar per day, as long as the day; split by project (all projects) or by language
    const segs: [string, number, string][] = o.multi && (!f || f.kind === "project")
      ? o.byProject(d.date).filter(([id]) => !f || id === f.id).map(([id, v]) => ["p:" + id, v, o.names.color(id)] as [string, number, string])
      : d.shown.languages.map(l => ["l:" + l.name, l.ms, langColor(o.colors, l.name)] as [string, number, string])
    const track = el("span", "dtrack")
    const bar = el("span", "dbar")
    bar.style.width = `${segs.reduce((n, s) => n + s[1], 0) / maxDay * 100}%`
    for (const [hl, v, color] of segs) {
      const seg = el("span")
      seg.dataset.hl = hl
      seg.style.flex = String(v)
      seg.style.background = color
      bar.append(seg)
    }
    track.append(bar)
    li.append(el("span", "when", `${weekday(d.date)} ${shortDate(d.date)}`), el("span", ms ? "dur" : "dur z", ms ? fmt(ms) : "·"), ms ? track : el("span"))
    bindTip(li, () => {
      if (!ms) return [tipLine("no activity", dstr(d.date))]
      const ss = d.shown.sessions
      const out = [tipLine(`${fmt(ms)} active`, (f ? `${o.focusName} · ` : "") + dstr(d.date))]
      if (ss.length) out.push(tipSub(`${plural(ss.length, "session")}, ${clock(ss[0].startTime)}–${clock(ss[ss.length - 1].endTime ?? o.now)}`))
      if (o.multi) for (const [id, v] of o.byProject(d.date)) out.push(tipSub(`${o.names.project(id)} ${fmt(v)}`))
      else for (const l of d.shown.languages.slice(0, 3)) out.push(tipSub(`${l.name} ${fmt(l.ms)}`))
      return out
    })
    return li
  }))
}
```

- [ ] **Step 8: Write `src/webview/overview.ts`**

```ts
// The overview tab: one day or a range, every panel narrowed by the hover focus.
// It reads the store and hands each panel numbers from model.ts.
import type { ActivitySession } from "../shared/types"
import { langColor, languageColors, namesFor } from "./colors"
import { $, el, keyBox, kv } from "./dom"
import { renderFiles } from "./files"
import { hlOf, lockHeights } from "./focus"
import { MIN, addDaysKey, clock, dstr, fmt, fromKey, hours, pct, shortDate, weekday } from "./format"
import { renderLangs } from "./languages"
import { meter } from "./layout"
import { renderLines, setLineTotals } from "./lines"
import { TapeCell, buildView, lineRows, seriesFor, targetMetAt } from "./model"
import { renderCols } from "./rangeColumns"
import { renderDays, renderSessions } from "./sessionLog"
import type { Store } from "./state"
import { renderStreak } from "./streak"
import { setTape } from "./tape"

function hlKey(hl: string, color: string, label: string): HTMLElement {
  const s = el("span")
  s.dataset.hl = hl
  s.tabIndex = 0
  s.append(keyBox(color), label)
  return s
}

export function renderOverview(store: Store, openDay: (date: string) => void, back: () => void): void {
  const year = store.year
  const range = store.days()
  const status = $("ov-status")
  if (!year || !range) {
    status.hidden = false
    status.textContent = store.refused ? "That range can't be shown: pick at most 92 days." : "loading…"
    return
  }
  status.hidden = true

  const { sel, focus, from, to } = store.view
  const now = Date.now()
  const names = namesFor(year)
  const view = buildView(range, sel, focus)
  const n = view.days.length
  const single = n === 1
  const multi = sel === "all"
  const isToday = single && from === year.today
  const series = seriesFor(year, sel)
  const targetOn = (date: string): number => {
    const i = series.days.indexOf(date)
    return i >= 0 ? series.targetMs[i] : series.targetMs[series.targetMs.length - 1] ?? year.globalTargetMs
  }
  const colors = languageColors(view.wholeLanguages)
  const focusName = !focus ? "" : focus.kind === "project" ? names.project(focus.id) : focus.id
  const focusColor = !focus ? null : focus.kind === "project" ? names.color(focus.id) : langColor(colors, focus.id)
  const yearIndex = new Map(year.days.map((d, i) => [d, i] as [string, number]))
  // per-project active ms on a date, from the year: what the columns and the streak count
  const byProject = (date: string): [string, number][] => {
    const i = yearIndex.get(date)
    if (i === undefined) return []
    return year.projects.filter(p => (multi || p.id === sel) && p.active[i] > 0).map(p => [p.id, p.active[i]] as [string, number])
  }
  const metDays = view.days.filter(d => d.whole.activeMs >= targetOn(d.date)).length

  if (!focus) lockHeights($("ov"), false)
  renderStreak(year, sel)

  $("hero-k").textContent = single ? "day" : "range"
  $("hero-when").textContent = (single ? dstr(from) : `${dstr(from)} – ${dstr(to)} · ${n} days`)
    + (multi ? " · all projects" : "") + (focus ? ` · ${focusName} only` : "")
  $("cols-wrap").hidden = single
  $("tod-k").hidden = single
  const head = $("hero-head")
  const target = $("target")
  const leg = $("tape-legend")
  leg.replaceChildren()
  let tapeSessions: ActivitySession[]
  let tapeBase: ActivitySession[]
  let perDays = 1

  if (single) {
    const day = view.days[0]
    const ss = day.whole.sessions
    head.replaceChildren(el("div", "big", fmt(day.shown.activeMs)))
    if (ss.length) {
      const lastSession = ss[ss.length - 1]
      head.append(kv("sessions", ss.length), kv("first keystroke", clock(ss[0].startTime)), kv("last", clock(lastSession.endTime ?? now)))
    } else {
      head.append(el("span", "kv", multi ? "no activity this day" : `no activity in ${names.project(sel)} this day`))
    }
    const active = byProject(day.date)
    if (multi && active.length) head.append(kv("projects", active.length))
    if (store.view.back) {
      const b = el("button", "btn", "back to range")
      b.addEventListener("click", back)
      head.append(b)
    }
    if (focus) {
      target.replaceChildren(`${focusName}: `, el("b", null, fmt(day.shown.activeMs)),
        ` of ${fmt(day.whole.activeMs)} that day (${pct(day.shown.activeMs, day.whole.activeMs)}%)`)
    } else {
      const T = targetOn(day.date)
      const [on, off] = meter(day.whole.activeMs, T)
      const bar = el("span", "meter", "█".repeat(on))
      bar.append(el("i", null, "░".repeat(off)))
      const metAt = targetMetAt(ss, T, now)
      target.replaceChildren(`target ${Math.round(T / MIN)}m `, bar, metAt !== null ? ` met at ${clock(metAt)}` : ` ${fmt(T - day.whole.activeMs)} short`)
    }
    tapeSessions = day.shown.sessions
    tapeBase = ss
  } else {
    const activeDays = view.days.filter(d => d.shown.activeMs > 0)
    const best = view.days.reduce((b, d) => (d.shown.activeMs > b.shown.activeMs ? d : b), view.days[0])
    head.replaceChildren(
      el("div", "big", hours(view.totalMs)),
      kv("active days", `${activeDays.length}/${n}`),
      kv("per active day", fmt(view.totalMs / Math.max(1, activeDays.length))),
      kv("best", best.shown.activeMs ? `${weekday(best.date)} ${shortDate(best.date)}, ${fmt(best.shown.activeMs)}` : "—"),
    )
    renderCols(view.days.map(d => ({
      date: d.date,
      shownMs: d.shown.activeMs,
      wholeMs: d.whole.activeMs,
      targetMs: targetOn(d.date),
      sessions: d.shown.sessions.length,
      added: d.shown.linesAdded,
      deleted: d.shown.linesDeleted,
      byProject: multi && !focus ? byProject(d.date) : [],
    })), { today: year.today, focusColor, focusName: focus ? focusName : null, projName: names.project, onOpen: openDay })
    if (focus) {
      target.replaceChildren(`${focusName}: `, el("b", null, hours(view.totalMs)),
        ` of ${hours(view.wholeMs)} in the range (${pct(view.totalMs, view.wholeMs)}%)`)
    } else {
      target.replaceChildren(`target ${Math.round(targetOn(to) / MIN)}m · met on `, el("b", null, String(metDays)), ` of ${n} days`)
      for (const [cls, text] of [["met", "target met"], ["under", "under target"], ["now", "today"]]) {
        if (cls === "now" && to !== year.today) continue
        const s = el("span")
        s.append(el("i", cls), text)
        leg.append(s)
      }
    }
    const wholeActive = view.days.filter(d => d.whole.activeMs > 0)
    tapeSessions = activeDays.flatMap(d => d.shown.sessions)
    tapeBase = wholeActive.flatMap(d => d.whole.sessions)
    perDays = Math.max(1, wholeActive.length)
  }

  // legend: projects (all projects only), the three biggest languages, the tape's key
  if (multi) {
    for (const p of year.projects) {
      if (view.days.some(d => byProject(d.date).some(([id]) => id === p.id))) leg.append(hlKey("p:" + p.id, names.color(p.id), p.name))
    }
  }
  for (const l of view.wholeLanguages.slice(0, 3)) leg.append(hlKey("l:" + l.name, langColor(colors, l.name), l.name))
  if (focus) {
    leg.querySelectorAll<HTMLElement>("[data-hl]").forEach(s => {
      const on = s.dataset.hl === hlOf(focus)
      s.classList.toggle("dim", !on)
      s.classList.toggle("focus", on)
    })
  }
  const keyNode = el("span")
  keyNode.id = "tape-key"
  leg.append(keyNode)
  const cellColor = (c: TapeCell): string | null => {
    if (focus?.kind === "project") return names.color(focus.id)
    if (c.language) return langColor(colors, c.language)
    return c.projectId ? names.color(c.projectId) : null   // sessions recorded before per-session languages
  }
  setTape({
    sessions: tapeSessions,
    base: tapeBase,
    perDays,
    now,
    color: cellColor,
    label: c => c.language ?? (c.projectId ? names.project(c.projectId) : null),
  })

  setLineTotals(view.linesAdded, view.linesDeleted)
  if (single) {
    const week = store.days(addDaysKey(to, -6), to)
    const days = week ? buildView(week, sel, focus).days : view.days
    $("lines-when").textContent = `net per file, ${isToday ? "today" : dstr(from)}`
    renderLines(days.map(d => ({ label: weekday(d.date), added: d.shown.linesAdded, deleted: d.shown.linesDeleted, now: d.date === to, sub: dstr(d.date) })), false)
  } else if (n <= 14) {
    $("lines-when").textContent = `net per file, ${n} days`
    renderLines(view.days.map(d => ({
      label: `${weekday(d.date)} ${fromKey(d.date).getDate()}`,
      added: d.shown.linesAdded,
      deleted: d.shown.linesDeleted,
      now: d.date === year.today,
      sub: dstr(d.date),
    })), true)
  } else {
    $("lines-when").textContent = `net per file, ${n} days · one row per week`
    renderLines(lineRows(view.days).map(r => ({
      label: shortDate(r.from), added: r.added, deleted: r.deleted, now: false, sub: `${shortDate(r.from)} – ${shortDate(r.to)}`,
    })), true)
  }

  $("lang-when").textContent = single ? "" : `${n} days`
  const langFocus = focus?.kind === "language" ? focus.id : null
  renderLangs(langFocus ? view.wholeLanguages : view.languages, view.wholeLanguages, langFocus ? view.wholeMs : view.totalMs,
    single ? (isToday ? "today" : "the day") : "the range", langFocus, colors)

  $("files-when").textContent = single ? "git diff --stat" : `git diff --stat ${shortDate(from).toLowerCase()}..${shortDate(to).toLowerCase()}`
  renderFiles(view.files, multi, names)

  const logOpts = { multi, focus, focusName, colors, names, now }
  if (single) {
    $("log-k").textContent = "sessions"
    $("log-when").textContent = ""
    renderSessions(view.days[0].whole.sessions, logOpts)
  } else {
    $("log-k").textContent = "days"
    $("log-when").textContent = "newest first"
    renderDays(view.days, { ...logOpts, byProject })
  }

  const sr = $("streak-range")
  sr.hidden = single
  if (!single) sr.textContent = `In this range the target was met on ${metDays} of ${n} days.`
}
```

- [ ] **Step 9: Wire the overview and hover focus in `src/webview/main.ts`**

Add to the imports:

```ts
import type { RangeId } from "./calendar"
import { wireFocus } from "./focus"
import { addDaysKey } from "./format"
import { initFiles } from "./files"
import { initLines } from "./lines"
import { renderOverview } from "./overview"
import { initCols } from "./rangeColumns"
import { initTape } from "./tape"
```

Add under the top-bar wiring (below `// ── panels ──`):

```ts
// a column opens its day; "back to range" returns to where it came from
function openDay(date: string): void {
  const v = store.view
  const today = store.year?.today ?? date
  const preset: RangeId | null = date === today ? "today" : date === addDaysKey(today, -1) ? "yday" : null
  store.setView(date, date, preset, { from: v.from, to: v.to, preset: v.preset })
}
function backToRange(): void {
  const b = store.view.back
  if (b) store.setView(b.from, b.to, b.preset)
}
initTape()
initLines()
initFiles()
initCols()
wireFocus($("ov"), {
  allowProject: () => store.view.sel === "all",
  current: () => store.view.focus,
  set: f => store.setFocus(f),
})
tabs.overview = () => renderOverview(store, openDay, backToRange)
```

- [ ] **Step 10: Build, typecheck, test**

Run: `npm run build && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 11: Check the overview by hand against the mockup**

Open `docs/design/mockups/dashboard.html` in a browser next to the Extension Development Host, and in the host:
- **Today, all projects:** active time, sessions, first keystroke/last, projects count; the tape spans 07:00–19:00 (or wider if you worked at night) in 15-minute cells, coloured by language, idle cells as `·`; the target meter says "met at HH:MM" or "Nm short"; the streak shows storage's count and 14 marks with today as ◆/◇; lines show seven weekday rows; languages, files (`git diff --stat` with paths relative to each project, prefixed by the project name) and sessions (with project labels) fill in.
- **7d and 30d:** segmented columns (green met, grey under, amber today); the axis names days for a week, numbers them up to 16, labels Mondays beyond; the tape becomes the average active day with "time of day" above it; lines go per day (≤ 14) or per week; the sessions card becomes "days", newest first, and scrolls inside its box with a thin terminal-coloured scrollbar.
- **Click a column:** that day opens with "back to range" in the hero; it returns to the range.
- **Hover focus:** hovering a project key in the legend, a project segment in a day's bar or a session's project label narrows columns, tape (all in the project's colour), lines, languages, files and the days card to that project; hovering a language key, a language row or a session's language segment does the same for the language; the panel under the pointer keeps its rows and dims the rest; no panel changes height while the focus shows; moving out of the source panel clears it. Tab through the legend keys: keyboard focus does the same. Picking a single project disables project focus (language focus still works).
- **Live:** leave it open on today for a minute while typing in another editor; the active time, tape and session update every 10 s and the focus survives the update.
- **Widths:** drag the editor split narrower: one column below 860 px, a 24-cell tape below 620 px, `+`/`-` runs shrink with their rows, no horizontal scrollbar at about 420 px.

- [ ] **Step 12: Commit**

```bash
git add src/webview/tape.ts src/webview/streak.ts src/webview/rangeColumns.ts src/webview/lines.ts src/webview/languages.ts src/webview/files.ts src/webview/sessionLog.ts src/webview/overview.ts src/webview/main.ts
git commit -m "Build the overview: day tape, range columns, lines, languages, files, sessions and hover focus"
```

---
### Task 8: The activity tab

**Files:**
- Create: `src/webview/heatmap.ts` (the old d3 file was deleted in Task 5), `src/webview/activityTab.ts`
- Modify: `src/webview/main.ts`

**Interfaces:**
- Consumes: `seriesFor`, `yearStats`, `Selection` (model); `heatCells`, `heatLevel`, `heatMonths`, `heatWeeksFor`, `TAPE_GLYPHS` (Task 1); `namesFor`, `projectColor`; `Store`.
- Produces: `HeatData`, `renderHeat(data)`, `initHeat()`; `renderActivity(store)`, `initActivity(store)`.

- [ ] **Step 1: Write `src/webview/heatmap.ts`**

```ts
// The year as block glyphs in one hue: density carries the magnitude.
// 53 weeks, or 26 when narrow; glyphs size to the cell width.
import { $, el, onWidth } from "./dom"
import { MIN, dstr, fmt } from "./format"
import { TAPE_GLYPHS, heatCells, heatLevel, heatMonths, heatWeeksFor } from "./layout"
import { delegateTip, tipLine, tipSub } from "./tooltip"

export interface HeatData {
  days: string[]
  active: number[]
  targetMs: number[]
  today: string
  who: string | null                             // the hovered project, when narrowed to one
  breakdown: (i: number) => [string, number][]   // per-project time on a day, for all projects
}

let data: HeatData | null = null
let weeks = 0

export function renderHeat(d: HeatData): void {
  data = d
  weeks = 0
  sizeHeat()
}

function sizeHeat(): void {
  const wrap = $("heat-wrap")
  if (!data || !wrap.clientWidth) return   // hidden tab: drawn when it is shown
  const want = heatWeeksFor(wrap.clientWidth)
  if (want !== weeks) {
    weeks = want
    draw(data)
  }
  const heat = $("heat")
  const cw = (heat.clientWidth - (weeks - 1) * 2) / weeks
  heat.style.fontSize = `${Math.max(4, Math.min(24, cw / 0.6))}px`
}

function draw(d: HeatData): void {
  $("heat-range").textContent = `daily active time, past ${weeks === 53 ? "12" : "6"} months` + (d.who ? ` · ${d.who} only` : "")
  $("heat").replaceChildren(...heatCells(d.days.length, weeks).map(i => {
    if (i === null) return el("span", "fut", "█")
    const ms = d.active[i]
    const c = el("span", d.days[i] === d.today ? "now" : ms > 0 ? null : "z", TAPE_GLYPHS[heatLevel(ms)])
    c.dataset.i = String(i)
    return c
  }))
  const months = $("months")
  months.style.setProperty("--weeks", String(weeks))
  months.replaceChildren(...heatMonths(d.days, weeks).map(m => {
    const s = el("span", null, m.text)
    s.style.gridColumn = `${m.col} / span 4`
    return s
  }))
}

export function initHeat(): void {
  onWidth($("heat-wrap"), sizeHeat)
  delegateTip($("heat"), c => {
    const d = data
    if (!d) return null
    const i = Number(c.dataset.i)
    const ms = d.active[i]
    const out = [tipLine(ms ? fmt(ms) : "no activity", (d.who ? `${d.who} · ` : "") + dstr(d.days[i]))]
    for (const [name, v] of d.breakdown(i)) out.push(tipSub(`${name} ${fmt(v)}`))
    if (ms && ms < d.targetMs[i]) out.push(tipSub(`under the ${Math.round(d.targetMs[i] / MIN)}m target`))
    return out
  })
}
```

- [ ] **Step 2: Write `src/webview/activityTab.ts`**

```ts
// The activity tab: the year's stats, the heatmap and each project's share.
// Hovering (or tabbing to) a project row narrows the stats and the heatmap to it.
import type { YearPayload } from "../shared/types"
import { namesFor, projectColor } from "./colors"
import { $, el, keyBox, press } from "./dom"
import { MIN, dstr, fmt, hours, pct, shortDate } from "./format"
import { renderHeat } from "./heatmap"
import { Selection, seriesFor, yearStats } from "./model"
import type { Store } from "./state"
import { bindTip, tipLine, tipSub } from "./tooltip"

let hover: string | null = null

function renderYear(year: YearPayload, sel: Selection): void {
  const who = hover ?? sel
  const names = namesFor(year)
  const s = seriesFor(year, who)
  const st = yearStats(s)
  const target = s.targetMs.length ? s.targetMs[s.targetMs.length - 1] : year.globalTargetMs
  const cells: [string, string, string][] = [
    [String(st.activeDays), "active days", `of ${Math.min(365, s.days.length)}`],
    [hours(st.totalMs), "total time", `${fmt(st.totalMs / Math.max(1, st.activeDays))} per active day`],
    [`${st.longest}d`, "longest streak", st.longestEnd ? `ended ${shortDate(st.longestEnd)}, target ${Math.round(target / MIN)}m` : "no streak yet"],
    [st.best ? fmt(st.best.ms) : "0m", "most active day", st.best ? dstr(st.best.date) : "—"],
  ]
  $("ystats").replaceChildren(...cells.map(([v, k, sub]) => {
    const d = el("div", "ystat")
    d.append(el("div", "v", v), el("div", "k", k), el("div", "s", sub))
    return d
  }))
  $("ystats-who").textContent = hover ? ` · ${names.project(hover)} only` : ""
  renderHeat({
    days: s.days,
    active: s.active,
    targetMs: s.targetMs,
    today: year.today,
    who: hover ? names.project(hover) : null,
    breakdown: i => (who === "all" ? year.projects.filter(p => p.active[i] > 0).map(p => [p.name, p.active[i]] as [string, number]) : []),
  })
}

function dimRows(): void {
  $("prows-box").querySelectorAll<HTMLElement>("[data-ap]").forEach(n => n.classList.toggle("dim", !!hover && n.dataset.ap !== hover))
}

export function renderActivity(store: Store): void {
  const year = store.year
  if (!year) return
  const sel = store.view.sel
  const filter = $("act-filter")
  filter.replaceChildren(...[{ id: "all", name: "all projects" }, ...year.projects].map(p => {
    const b = el("button", null, p.name)
    b.dataset.v = p.id
    b.addEventListener("click", () => store.setSelection(p.id))
    return b
  }))
  press(filter, b => b.dataset.v === sel)
  renderYear(year, sel)

  const from = Math.max(0, year.days.length - 365)
  const totals = year.projects.map(p => {
    let t = 0
    let d = 0
    for (let i = from; i < p.active.length; i++) {
      t += p.active[i]
      if (p.active[i] > 0) d++
    }
    return { p, t, d }
  })
  const all = totals.reduce((s, r) => s + r.t, 0)
  const max = Math.max(1, ...totals.map(r => r.t))
  $("split").replaceChildren(...totals.filter(r => r.t > 0).map(r => {
    const s = el("span")
    s.dataset.ap = r.p.id
    s.style.flex = String(r.t)
    s.style.background = projectColor(year, r.p.id)
    return s
  }))
  const hdr = el("div", "prow hdr")
  hdr.append(el("span", null, "project"), el("span"), el("span", "t", "time"), el("span", "pct", "share"), el("span", "dd", "active days"))
  $("prows").replaceChildren(hdr, ...totals.map(r => {
    const color = projectColor(year, r.p.id)
    const row = el("div", sel === r.p.id ? "prow sel" : "prow")
    row.dataset.ap = r.p.id
    const name = el("span", "name")
    name.append(keyBox(color), r.p.name)
    const track = el("span", "track")
    const fill = el("span", "fill")
    fill.style.width = `${r.t / max * 100}%`
    fill.style.background = color
    track.append(fill)
    row.append(name, track, el("span", "t", hours(r.t)), el("span", "pct", `${pct(r.t, all)}%`), el("span", "dd", r.d))
    bindTip(row, () => [tipLine(hours(r.t), r.p.name), tipSub(`${pct(r.t, all)}% of all time · active on ${r.d} days`)])
    return row
  }))
  if (!totals.length) $("prows").append(el("div", "hint", "no projects yet"))
  dimRows()
}

export function initActivity(store: Store): void {
  const box = $("prows-box")
  const set = (id: string | null) => {
    if (id === hover) return
    hover = id
    if (store.year) renderYear(store.year, store.view.sel)
    dimRows()
  }
  const apOf = (t: EventTarget | null): string | null =>
    (t instanceof Element ? t.closest<HTMLElement>("[data-ap]")?.dataset.ap ?? null : null)
  box.addEventListener("pointerover", e => {
    const id = apOf(e.target)
    if (id) set(id)
  })
  box.addEventListener("pointerleave", () => set(null))
  box.addEventListener("focusin", e => set(apOf(e.target)))
  box.addEventListener("focusout", e => { if (!box.contains(e.relatedTarget as Node | null)) set(null) })
}
```

- [ ] **Step 3: Wire it in `src/webview/main.ts`**

Imports:

```ts
import { initActivity, renderActivity } from "./activityTab"
import { initHeat } from "./heatmap"
```

Under the overview wiring:

```ts
initHeat()
initActivity(store)
tabs.activity = () => renderActivity(store)
```

- [ ] **Step 4: Build, test, and check by hand**

Run: `npm run build && npm run typecheck && npm test`
Expected: all pass.

In the Extension Development Host, activity tab:
- the filter buttons and the top-bar project picker are one choice (changing either changes both);
- four year stats (active days of 365, total time and per active day, longest streak with its end date and target, most active day);
- the heatmap fills its width with 53 weeks, `·░▒▓█` by 30m/1h30/3h thresholds, today amber, the days after today blank, month labels without a collision at the left edge; below 600 px it shows 26 weeks and says "past 6 months"; the tooltip names the day, the time, each project's share (all projects) and "under the target" when it was;
- the project split bar and rows (time, share, active days); hovering or tabbing to a row dims the others and narrows the stats and heatmap to that project ("· name only"), and leaving the box restores them.

- [ ] **Step 5: Commit**

```bash
git add src/webview/heatmap.ts src/webview/activityTab.ts src/webview/main.ts
git commit -m "Build the activity tab: year stats, block heatmap and project shares"
```

---

### Task 9: The projects tab and the shared steppers

**Files:**
- Create: `src/webview/stepper.ts`, `src/webview/projectCards.ts`
- Create: `test/webview.stepper.test.ts`
- Modify: `scripts/test.js`, `src/webview/main.ts`

**Interfaces:**
- Consumes: `seriesFor`, `streakInfo` (model); `sparkGlyphs` (Task 1); `ago`, `fmt`, `dstr` (Task 1); `Store`.
- Produces:
  - `stepper.ts`: `validFor(value, min, max, optional): boolean`, `stepValue(value, placeholder, step, min, max): string`, `syncApply(input)`, `setSaved(input, value)`, `OnApply`, `wireSteppers(root, onApply)`. Settings (Task 10) uses the same module.
  - `projectCards.ts`: `renderCards(store, openInOverview)`, `initCards(store, post, rerender)`.

- [ ] **Step 1: Register the suite and write the failing test**

Add to `SUITES` after `display`:

```js
  {
    name: "stepper",
    entry: "test/webview.stepper.test.ts",
    alias: { stepper: "src/webview/stepper.ts" },
  },
```

Create `test/webview.stepper.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/stepper.ts
import { stepValue, validFor } from "stepper"

describe("target inputs", () => {
  it("accept whole minutes within the bounds", () => {
    assert.strictEqual(validFor("20", 1, 1440, false), true)
    assert.strictEqual(validFor(" 1440 ", 1, 1440, false), true)
    for (const bad of ["0", "1441", "12.5", "-5", "abc", "1e3"]) assert.strictEqual(validFor(bad, 1, 1440, false), false, bad)
  })

  it("empty is valid only where it means 'use the global target'", () => {
    assert.strictEqual(validFor("", 1, 1440, true), true)
    assert.strictEqual(validFor("  ", 1, 1440, false), false)
  })

  it("steppers start from the placeholder and stay in bounds", () => {
    assert.strictEqual(stepValue("", "20", 5, 1, 1440), "25")
    assert.strictEqual(stepValue("1438", "", 5, 1, 1440), "1440")
    assert.strictEqual(stepValue("3", "", -5, 1, 1440), "1")
    assert.strictEqual(stepValue("", "", 5, 1, 1440), "5")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test.js --suite stepper`
Expected: FAIL — `Could not resolve` `src/webview/stepper.ts`.

- [ ] **Step 3: Write `src/webview/stepper.ts`**

```ts
// − / + / apply controls for a minutes input, shared by Settings and the
// project cards. Markup:
//   <button data-for="ID" data-step="-5">
//   <input id="ID" type="number" min max data-saved="20" [data-optional]>
//   <button data-apply="ID" data-label="daily target">
// data-optional means empty is valid: a project falling back to the global target.

export function validFor(value: string, min: number, max: number, optional: boolean): boolean {
  const v = value.trim()
  if (v === "") return optional
  if (!/^\d+$/.test(v)) return false
  const n = Number(v)
  return n >= min && n <= max
}

export function stepValue(value: string, placeholder: string, step: number, min: number, max: number): string {
  const raw = value.trim() === "" ? Number(placeholder) : Number(value)
  const base = isFinite(raw) ? raw : 0
  return String(Math.min(max, Math.max(min, base + step)))
}

// apply lights up only for a valid value that differs from the saved one
export function syncApply(inp: HTMLInputElement): void {
  const ap = document.querySelector<HTMLButtonElement>(`[data-apply="${inp.id}"]`)
  if (!ap) return
  const ok = validFor(inp.value, Number(inp.min), Number(inp.max), inp.dataset.optional !== undefined)
  ap.disabled = !ok || inp.value.trim() === (inp.dataset.saved ?? "")
}

// A value being typed is kept; only an untouched input follows the saved one.
export function setSaved(inp: HTMLInputElement, value: string): void {
  if (document.activeElement !== inp && inp.value.trim() === (inp.dataset.saved ?? "")) inp.value = value
  inp.dataset.saved = value
  syncApply(inp)
}

export type OnApply = (inp: HTMLInputElement, value: number | null, was: string, button: HTMLButtonElement) => void

export function wireSteppers(root: HTMLElement, onApply: OnApply): void {
  root.addEventListener("click", e => {
    const t = e.target instanceof Element ? e.target : null
    const step = t?.closest<HTMLButtonElement>("[data-step]")
    if (step && root.contains(step)) {
      const inp = document.getElementById(step.dataset.for ?? "") as HTMLInputElement | null
      if (!inp) return
      inp.value = stepValue(inp.value, inp.placeholder, Number(step.dataset.step), Number(inp.min), Number(inp.max))
      syncApply(inp)
      return
    }
    const ap = t?.closest<HTMLButtonElement>("[data-apply]")
    if (!ap || ap.disabled || !root.contains(ap)) return
    const inp = document.getElementById(ap.dataset.apply ?? "") as HTMLInputElement | null
    if (!inp) return
    const was = inp.dataset.saved ?? ""
    const now = inp.value.trim()
    inp.dataset.saved = now
    onApply(inp, now === "" ? null : Number(now), was, ap)
    ap.disabled = true
    ap.textContent = "saved"
    ap.classList.add("ok")
    setTimeout(() => {
      ap.textContent = "apply"
      ap.classList.remove("ok")
    }, 1400)
  })
  root.addEventListener("input", e => {
    if (e.target instanceof HTMLInputElement && e.target.type === "number") syncApply(e.target)
  })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/test.js --suite stepper`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write `src/webview/projectCards.ts`**

```ts
// The projects tab: one card per project with today, the streak, a 14-day
// sparkline and the project's own daily target.
import type { WebviewMessage } from "../shared/types"
import { projectColor } from "./colors"
import { $, el, press } from "./dom"
import { MIN, ago, dstr, fmt } from "./format"
import { sparkGlyphs } from "./layout"
import { seriesFor, streakInfo } from "./model"
import type { Store } from "./state"
import { wireSteppers } from "./stepper"
import { delegateTip, tipLine } from "./tooltip"

type SortBy = "time" | "last" | "name"
let sortBy: SortBy = "time"

// The tab re-renders every 10 s; that must not wipe a target being typed.
function busy(host: HTMLElement): boolean {
  if (document.activeElement instanceof HTMLInputElement && host.contains(document.activeElement)) return true
  return Array.from(host.querySelectorAll<HTMLInputElement>("input")).some(i => i.value.trim() !== (i.dataset.saved ?? ""))
}

export function renderCards(store: Store, openInOverview: (id: string) => void): void {
  const year = store.year
  const host = $("pcards")
  if (!year || busy(host)) return
  const last = year.days.length - 1
  const globalMin = Math.round(year.globalTargetMs / MIN)
  const now = Date.now()
  const list = year.projects.map((p, rank) => ({ p, rank, today: p.active[last] ?? 0, s: seriesFor(year, p.id) }))
  list.sort((a, b) => sortBy === "name" ? a.p.name.localeCompare(b.p.name)
    : sortBy === "last" ? (b.p.lastActive ?? 0) - (a.p.lastActive ?? 0) || a.rank - b.rank
    : b.today - a.today || a.rank - b.rank)

  host.replaceChildren(...list.map(({ p, rank, today, s }) => {
    const info = streakInfo(s, p.streak)
    const color = projectColor(year, p.id)
    const card = el("fieldset", "pcard span-6")
    const legend = el("legend")
    legend.append(el("b", null, p.name), el("span", "ago", ` · ${ago(p.lastActive, now)}`))
    card.append(legend, el("div", "path", p.path))

    const stats = el("div", "stats")
    const todayBox = el("div")
    todayBox.append(el("div", today ? "v" : "v zero", fmt(today)), el("div", "k", "today"))
    const streakBox = el("div")
    streakBox.append(
      el("div", info.current ? "v" : "v zero", `${info.current}d`),
      el("div", info.atRisk ? "k risk" : "k", info.atRisk ? "streak, at risk today" : "streak"),
    )
    stats.append(todayBox, streakBox)
    card.append(stats)

    const from = Math.max(0, s.days.length - 14)
    const spark = el("div", "spark")
    spark.setAttribute("role", "img")
    spark.setAttribute("aria-label", `${p.name}, active time over the last 14 days`)
    sparkGlyphs(s.active.slice(from)).forEach((g, i) => {
      const c = el("span", g.zero ? "z" : null, g.glyph)
      if (!g.zero) c.style.color = color
      c.dataset.i = String(i)
      spark.append(c)
    })
    delegateTip(spark, c => {
      const i = from + Number(c.dataset.i)
      return [tipLine(s.active[i] ? fmt(s.active[i]) : "no activity", dstr(s.days[i]))]
    })
    const axis = el("div", "spark-axis")
    axis.append(el("span", null, "14 days ago"), el("span", null, "today"))
    card.append(spark, axis)

    // ids by registry position: project ids may hold characters a selector can't
    const inputId = `pt-${rank}`
    const own = p.dailyTargetMinutes === undefined ? "" : String(p.dailyTargetMinutes)
    const target = el("div", "target")
    const lbl = el("label", "lbl", "daily target")
    lbl.htmlFor = inputId
    const inp = el("input", "tin")
    inp.id = inputId
    inp.type = "number"
    inp.min = "1"
    inp.max = "1440"
    inp.step = "5"
    inp.placeholder = String(globalMin)
    inp.value = own
    inp.dataset.saved = own
    inp.dataset.optional = ""
    inp.dataset.project = p.id
    const down = el("button", "btn step", "−")
    const up = el("button", "btn step", "+")
    down.dataset.for = inputId
    up.dataset.for = inputId
    down.dataset.step = "-5"
    up.dataset.step = "5"
    down.setAttribute("aria-label", `Decrease ${p.name} target`)
    up.setAttribute("aria-label", `Increase ${p.name} target`)
    const apply = el("button", "btn", "apply")
    apply.dataset.apply = inputId
    apply.dataset.label = `${p.name} target`
    apply.disabled = true
    const hint = el("span", "hint", own ? `own target; clear it to use the global ${globalMin}m` : `empty: uses the global ${globalMin}m`)
    target.append(lbl, down, inp, up, el("span", "unit", "min"), apply, hint)

    const foot = el("div", "foot")
    const open = el("button", "btn", "open in overview")
    open.addEventListener("click", () => openInOverview(p.id))
    foot.append(open)
    card.append(target, foot)
    return card
  }))
  if (!list.length) host.append(el("p", "hint", "No projects yet. Open a folder and start typing."))
}

export function initCards(store: Store, post: (m: WebviewMessage) => void, rerender: () => void): void {
  $("sort").addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button[data-v]") : null
    if (!b) return
    sortBy = (b.dataset.v as SortBy | undefined) ?? "time"
    press($("sort"), x => x === b)
    rerender()
  })
  wireSteppers($("pcards"), (inp, value, was, button) => {
    const projectId = inp.dataset.project
    if (!projectId) return
    post({ type: "updateProjectSetting", projectId, key: "dailyTargetMinutes", value })
    store.note("ok", `${button.dataset.label} set to ${value === null ? "global" : `${value}m`} (was ${was === "" ? "global" : `${was}m`})`)
  })
}
```

- [ ] **Step 6: Wire it in `src/webview/main.ts`**

Imports:

```ts
import { initCards, renderCards } from "./projectCards"
```

Under the activity wiring:

```ts
function openInOverview(id: string): void {
  store.setSelection(id)
  showTab("overview")
  window.scrollTo(0, 0)
}
initCards(store, post, () => renderCards(store, openInOverview))
tabs.projects = () => renderCards(store, openInOverview)
```

- [ ] **Step 7: Build, test, and check by hand**

Run: `npm run build && npm run typecheck && npm test`
Expected: all pass.

In the Extension Development Host, projects tab: a card per project with "N min ago", path, today, streak ("at risk today" in amber when today is under target and the streak is alive), a 14-day sparkline in the project's colour with day tooltips; sorting by active today / last active / name; the target stepper starts from the global target when empty, apply lights only for a valid change, "saved" flashes, the hint switches between "empty: uses the global" and "own target", the streak re-judges (the host resends the year); typing a value and waiting 10 s does not wipe it; "open in overview" selects that project on the overview.

- [ ] **Step 8: Commit**

```bash
git add src/webview/stepper.ts src/webview/projectCards.ts test/webview.stepper.test.ts scripts/test.js src/webview/main.ts
git commit -m "Build the projects tab with per-project targets and sparklines"
```

---

### Task 10: The settings tab and the interim export dialog

**Files:**
- Create: `src/webview/settingsTab.ts`, `src/webview/exportDialog.ts`
- Modify: `src/webview/main.ts`

**Interfaces:**
- Consumes: `stepper.ts` (Task 9); `applyCrt` (Task 4); `Store`; the old `generateJpg`, `generateReportPdf`, `ExportOptions`, `ReportPreset` (kept until phase 3, Deviation 1).
- Produces: `initSettings(store, post, openExport)`, `renderSettings(store)`; `initExport(store, post)`, `openExport()`, `onExportData(msg)`.

- [ ] **Step 1: Write `src/webview/settingsTab.ts`**

```ts
// The settings tab: tracking, the CRT, your data, danger, and an output
// console that shows what each action actually did (host actionResult lines).
import type { CrtEffect, WebviewMessage } from "../shared/types"
import { applyCrt } from "./crt"
import { $, el, press } from "./dom"
import type { Store } from "./state"
import { setSaved, wireSteppers } from "./stepper"

type Post = (m: WebviewMessage) => void

const ACTIONS: Record<string, { cmd: string; run: (post: Post, openExport: () => void) => void }> = {
  reveal: { cmd: "rabbithole reveal-storage", run: post => post({ type: "revealStorage" }) },
  export: { cmd: "rabbithole export", run: (_post, open) => open() },
  "backup-all": { cmd: "rabbithole backup --all", run: post => post({ type: "createBackup", scope: "all" }) },
  "backup-some": { cmd: "rabbithole backup --projects", run: post => post({ type: "createBackup", scope: "projects" }) },
  "restore-some": { cmd: "rabbithole restore --projects", run: post => post({ type: "importData", scope: "projects" }) },
  "restore-all": { cmd: "rabbithole restore --all", run: post => post({ type: "importData", scope: "all" }) },
}

export function initSettings(store: Store, post: Post, openExport: () => void): void {
  wireSteppers($("set-tracking"), (inp, value, was, button) => {
    if (value === null) return
    post({ type: "updateSetting", key: inp.id === "pref-target" ? "dailyTargetMinutes" : "idleThresholdMinutes", value })
    store.note("ok", `${button.dataset.label} set to ${value}m (was ${was}m)`)
  })

  $("osd").addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button[data-v]") : null
    const key = b?.closest<HTMLElement>("[data-key]")?.dataset.key
    const crt = store.settings?.crt
    if (!b || !key || !crt) return
    const v = b.dataset.v ?? ""
    if (key === "effects") {
      const effect = v as CrtEffect
      const value = crt.effects.includes(effect) ? crt.effects.filter(x => x !== effect) : [...crt.effects, effect]
      post({ type: "updateCrtSetting", key: "effects", value })
    } else if (key === "mask" || key === "pitch") {
      post({ type: "updateCrtSetting", key, value: v })
    }
  })
  const strength = $<HTMLInputElement>("strength")
  // preview while dragging; write once, on release
  strength.addEventListener("input", () => {
    $("strength-out").textContent = `${strength.value}%`
    if (store.settings) applyCrt({ ...store.settings.crt, strength: Number(strength.value) })
  })
  strength.addEventListener("change", () => post({ type: "updateCrtSetting", key: "strength", value: Number(strength.value) }))

  document.querySelectorAll<HTMLButtonElement>("[data-act]").forEach(b => b.addEventListener("click", () => {
    const action = ACTIONS[b.dataset.act ?? ""]
    if (!action) return
    store.note("cmd", action.cmd)
    action.run(post, openExport)
  }))

  // type-to-confirm: trimmed, case-sensitive; the exact project name, or DELETE
  const proj = $<HTMLSelectElement>("clear-proj")
  const projConfirm = $<HTMLInputElement>("clear-proj-confirm")
  const projBtn = $<HTMLButtonElement>("clear-proj-btn")
  const projName = () => proj.selectedOptions[0]?.textContent ?? ""
  const syncClear = () => { projBtn.disabled = !projName() || projConfirm.value.trim() !== projName() }
  proj.addEventListener("change", syncClear)
  projConfirm.addEventListener("input", syncClear)
  projBtn.addEventListener("click", () => {
    const name = projName()
    if (!proj.value || projConfirm.value.trim() !== name) return
    store.note("cmd", `rabbithole clear --project ${name}`)
    post({ type: "clearProject", projectId: proj.value })
    projConfirm.value = ""
    syncClear()
  })
  const allConfirm = $<HTMLInputElement>("clear-all-confirm")
  const allBtn = $<HTMLButtonElement>("clear-all-btn")
  allConfirm.addEventListener("input", () => { allBtn.disabled = allConfirm.value.trim() !== "DELETE" })
  allBtn.addEventListener("click", () => {
    if (allConfirm.value.trim() !== "DELETE") return
    store.note("cmd", "rabbithole clear --all")
    post({ type: "clearAll" })
    allConfirm.value = ""
    allBtn.disabled = true
  })
}

export function renderSettings(store: Store): void {
  const s = store.settings
  if (s) {
    setSaved($<HTMLInputElement>("pref-target"), String(s.dailyTargetMinutes))
    setSaved($<HTMLInputElement>("pref-idle"), String(s.idleThresholdMinutes))
    $("spath").textContent = s.storagePath
    $("osd").querySelectorAll<HTMLElement>("[data-key]").forEach(g => {
      const key = g.dataset.key
      press(g, b => (key === "effects"
        ? s.crt.effects.includes(b.dataset.v as CrtEffect)
        : b.dataset.v === (key === "mask" ? s.crt.mask : s.crt.pitch)))
    })
    const strength = $<HTMLInputElement>("strength")
    if (document.activeElement !== strength) {
      strength.value = String(s.crt.strength)
      $("strength-out").textContent = `${s.crt.strength}%`
    }
  }
  // rebuilt only when the project list changes, so a pending choice survives the 10 s refresh
  const year = store.year
  const proj = $<HTMLSelectElement>("clear-proj")
  const ids = year ? year.projects.map(p => `${p.id}\u0000${p.name}`).join("\u0001") : ""
  if (year && proj.dataset.ids !== ids) {
    const keep = proj.value
    proj.replaceChildren(...year.projects.map(p => {
      const o = el("option", null, p.name)
      o.value = p.id
      return o
    }))
    if (year.projects.some(p => p.id === keep)) proj.value = keep
    proj.dataset.ids = ids
    proj.dispatchEvent(new Event("change"))
  }
  const lines = store.console
  $("console").replaceChildren(...lines.map((l, i) => el("div", [l.cls, i === lines.length - 1 ? "cursor" : ""].filter(Boolean).join(" ") || null, l.text)))
}
```

- [ ] **Step 2: Write `src/webview/exportDialog.ts`**

```ts
// Interim export dialog. Phase 3 replaces the share card and report renderers
// and adds the live card preview; until then the card is today only and the
// report today, 30 or 90 days, through the existing generators. CSV and JSON
// go through the host's ranged export.
import type { ExtensionMessage, WebviewMessage } from "../shared/types"
import { $, el, press } from "./dom"
import type { ExportOptions, ReportPreset } from "./exportShared"
import { addDaysKey } from "./format"
import { generateJpg } from "./jpgExport"
import { generateReportPdf } from "./pdfExport"
import type { Store } from "./state"

type Format = "card" | "report" | "csv" | "json"
type Span = "today" | "7d" | "30d" | "90d"

const SPANS: Record<Format, Span[]> = {
  card: ["today"],
  report: ["today", "30d", "90d"],
  csv: ["today", "7d", "30d", "90d"],
  json: ["today", "7d", "30d", "90d"],
}
const BACK: Record<Span, number> = { today: 0, "7d": 6, "30d": 29, "90d": 89 }
const WHAT: Record<Format, string> = {
  card: "A 420×620 JPG of today's numbers, for sharing.",
  report: "A multi-page PDF report.",
  csv: "The raw daily data as CSV.",
  json: "The raw daily logs, sessions included, as JSON.",
}

let format: Format = "card"
let span: Span = "today"
let waiting = false
let store: Store | null = null
let post: ((m: WebviewMessage) => void) | null = null

function render(): void {
  press($("xd-format"), b => b.dataset.v === format)
  if (!SPANS[format].includes(span)) span = SPANS[format][0]
  $("xd-range").replaceChildren(...SPANS[format].map(s => {
    const b = el("button", null, s)
    b.dataset.v = s
    b.setAttribute("aria-pressed", String(s === span))
    return b
  }))
  $("xd-what").textContent = WHAT[format]
}

function resetGo(): void {
  const go = $<HTMLButtonElement>("xd-go")
  go.disabled = false
  go.textContent = "export"
}

function closeExport(): void {
  $("xd").hidden = true
  waiting = false
  resetGo()
}

export function openExport(): void {
  const s = store
  if (!s?.year) return
  const sel = $<HTMLSelectElement>("xd-project")
  const all = el("option", null, "all projects")
  all.value = "all"
  sel.replaceChildren(all, ...s.year.projects.map(p => {
    const o = el("option", null, p.name)
    o.value = p.id
    return o
  }))
  sel.value = s.view.sel
  resetGo()
  render()
  $("xd").hidden = false
  $("xd-format").querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
}

function go(): void {
  const s = store
  const p = post
  if (!s?.year || !p) return
  const sel = $<HTMLSelectElement>("xd-project")
  const projectId = sel.value
  const who = projectId === "all" ? "" : ` --project ${sel.selectedOptions[0]?.textContent ?? projectId}`
  s.note("cmd", `rabbithole export --${format} --${span}${who}`)
  if (format === "csv" || format === "json") {
    const to = s.year.today
    p({ type: "export", format, from: addDaysKey(to, -BACK[span]), to, projectId: projectId === "all" ? undefined : projectId })
    closeExport()
    return
  }
  waiting = true
  const b = $<HTMLButtonElement>("xd-go")
  b.disabled = true
  b.textContent = "generating…"
  p({ type: "exportPdfRequest", preset: span, exportProjectId: projectId })
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// The host answers exportPdfRequest with pdfData; render it and hand the file back.
export function onExportData(msg: ExtensionMessage): void {
  if (msg.type !== "pdfData" || !waiting) return
  const s = store
  const p = post
  if (!s || !p) return
  waiting = false
  const preset: ReportPreset = span === "30d" || span === "90d" ? span : "today"
  const options: ExportOptions = {
    projectName: msg.projectName,
    dateRange: msg.dateRange,
    isToday: preset === "today",
    preset,
    projectNames: Object.fromEntries((s.year?.projects ?? []).map(q => [q.id, q.name])),
  }
  const fail = (err: unknown) => {
    resetGo()
    s.note("bad", `export failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (format === "report") {
    try {
      p({ type: "writePdf", base64: toBase64(generateReportPdf(msg.logs, options)), projectName: msg.projectName })
      closeExport()
    } catch (err) {
      fail(err)
    }
  } else {
    generateJpg(msg.logs, options).then(url => {
      p({ type: "writeJpg", base64: url.split(",")[1], projectName: msg.projectName })
      closeExport()
    }, fail)
  }
}

export function initExport(s: Store, p: (m: WebviewMessage) => void): void {
  store = s
  post = p
  const pick = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLButtonElement>("button[data-v]") : null)
  $("xd-format").addEventListener("click", e => {
    const b = pick(e.target)
    if (b && !waiting) {
      format = b.dataset.v as Format
      render()
    }
  })
  $("xd-range").addEventListener("click", e => {
    const b = pick(e.target)
    if (b && !waiting) {
      span = b.dataset.v as Span
      render()
    }
  })
  $("xd-cancel").addEventListener("click", closeExport)
  $("xd-go").addEventListener("click", go)
  $("xd").addEventListener("click", e => { if (e.target === $("xd")) closeExport() })
  window.addEventListener("keydown", e => { if (e.key === "Escape" && !$("xd").hidden) closeExport() })
}
```

- [ ] **Step 3: Wire them in `src/webview/main.ts`**

Imports:

```ts
import { initExport, onExportData, openExport } from "./exportDialog"
import { initSettings, renderSettings } from "./settingsTab"
```

Under the projects wiring:

```ts
initExport(store, post)
extra.push(onExportData)
initSettings(store, post, openExport)
tabs.settings = () => renderSettings(store)
```

- [ ] **Step 4: Build, test, and check by hand**

Run: `npm run build && npm run typecheck && npm test`
Expected: all pass.

In the Extension Development Host, settings tab:
- **Tracking:** the inputs show the saved target and pause; − / + step and clamp; apply lights only for a change; applying writes the setting (check `settings.json`), the console says "daily target set to 25m (was 20m)", and the streak on the overview re-judges. Change `rabbithole.dailyTargetMinutes` in `settings.json` by hand: the input follows (it is untouched) and the year refreshes.
- **Display:** each mask, pitch and effect button writes `rabbithole.crt.*` and the screen changes at once; the strength slider previews while dragging and writes once on release; reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects off) stops roll and flicker; light theme halves the mask; high contrast removes the CRT entirely. Hand-edit `"rabbithole.crt.mask": "glitter"` in `settings.json`: the dashboard falls back to slot.
- **Your data:** reveal opens the folder; back up everything writes a file and the console shows the host's line ("Backup saved to …"); backup/restore some open the quick picks; each prints its `$ rabbithole …` line first.
- **Danger:** clear stays disabled until the exact, case-sensitive project name (or `DELETE`) is typed; run each only on throwaway data (a backup is written first) and confirm the console shows the host's result and the dashboard refreshes.
- **Export:** share card (today) and report (today / 30d / 90d) for all projects and for one, each saved and opened; CSV and JSON for today / 7d / 30d / 90d, the file covering exactly that range and project; Escape, cancel and a click outside close the dialog.

- [ ] **Step 5: Commit**

```bash
git add src/webview/settingsTab.ts src/webview/exportDialog.ts src/webview/main.ts
git commit -m "Build the settings tab with CRT controls and output console, and an interim export dialog"
```

---

### Task 11: Phase wrap-up

**Files:**
- Modify: `CLAUDE.md` (local, untracked — it is in `.gitignore`)
- Modify: `docs/superpowers/specs/2026-10-04-tty-redesign-design.md` (§2.2 deletions moved to phases 3 and 4)

- [ ] **Step 1: Run everything**

Run: `npm run build && npm run typecheck && npm test`
Expected: all pass; the new suites are `view` (23), `carrot` (2), `state` (15), `display` (10), `stepper` (3), with `model2` at 22, `handler` at 11 and `crt` at 7.

Run: `git grep -n -e "from \"chart.js\"" -e "from \"d3\"" -e "derivePalette" -- src/webview/main.ts src/webview/overview.ts`
Expected: no output (`derivePalette` remains only behind `miniTheme.ts`, for the sidebar).

- [ ] **Step 2: The full manual pass**

In the Extension Development Host, with real data, go through Tasks 6–10's checks once more in each of: Dark Modern, Light Modern, Dark High Contrast, Light High Contrast. Also:
- open the dashboard in a narrow editor split (about 420 px): no horizontal page scroll, one column, 24-cell tape, 26-week heatmap;
- keyboard only: Tab reaches the top bar, the legend keys (focus narrows the overview), the heatmap's neighbours, the project rows (focus narrows the year), every settings control; Escape closes the menu, the calendar and the export dialog;
- the sidebar still renders exactly as before (it is phase 4's);
- **the outstanding phase 1 check:** leave the dashboard open across local midnight (or the next time you work past it): at the first tick after midnight the view on "today" moves to the new day, yesterday's streak mark settles, and no session appears twice. If midnight isn't practical now, record it as still open in the ledger rather than claiming it.

Write any defect found as a failing test first where the code is pure, then fix; DOM-only defects get fixed and rechecked.

- [ ] **Step 3: Correct the spec**

In `docs/superpowers/specs/2026-10-04-tty-redesign-design.md` §2.2, replace the "Deleted:" sentence with:

```markdown
Deleted in phase 2: `charts.ts`, the d3 `heatmap.ts` (replaced), `theme.ts`; dependencies `chart.js`, `d3`. Deleted with
the phase that replaces their last user: `exportShared.ts` and the Electrolize TTF (phase 3, exports), `derivePalette.ts`,
`miniTheme.ts` and the Press Start 2P / Unica One fonts (phase 4, sidebar). `jspdf` stays.
```

and add `format.ts`, `layout.ts`, `colors.ts`, `calendar.ts` (pure helpers), `overview.ts`, `activityTab.ts` (tab composition) and `stepper.ts` (shared controls) to the module table.

- [ ] **Step 4: Update `CLAUDE.md` (local)**

- In "TTY redesign", add a "phase 2 dashboard" paragraph: the store (`state.ts`) owns view state and requests (`fetchSpan` widens to a week; a stale `range` reply is dropped; every `year` refetches; a preset view follows midnight); `requestYear`; validated CRT writes; the old `init`/`update`/`requestRange`/`selectProjects` are gone; the export dialog is interim until phase 3; no webview module touches the DOM at import time.
- In "Relevant files": drop `charts.ts`, `theme.ts` and the d3 `heatmap.ts`; add the new modules with one line each; note `derivePalette.ts`/`miniTheme.ts` are sidebar-only until phase 4.
- In "Dashboard panels": replace the table with the TTY panels (tape, streak, lines, languages, files, sessions/days, range columns, heatmap, project shares, project cards).
- In "Tests": add the five suites and the new counts.
- Remove the pickup item about the redesign waiting until after the Marketplace release (decided otherwise: redesign first).

- [ ] **Step 5: Commit, and hand over for review**

```bash
git add docs/superpowers/specs/2026-10-04-tty-redesign-design.md
git commit -m "Record where the remaining old webview files are deleted"
```

Then request the whole-branch review for phase 2 (superpowers:requesting-code-review, on the most capable model) over `git diff <the commit before Task 1>..HEAD`, fix what it confirms (failing test first where pure), and package for the user to try:

```bash
npx vsce package -o rabbit-hole-0.5.0-tty-dashboard.vsix
```

Installing it (`code --install-extension rabbit-hole-0.5.0-tty-dashboard.vsix --force`, then **Developer: Reload Window**) replaces the build the user is running, so ask first. Pushing and merging stay the user's decisions.

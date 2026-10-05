# TTY redesign — design spec

Date: 2026-10-04 · Branch: `tty-redesign` (from `main` at `2e35ace`)

## Goal

Rebuild Rabbit Hole's dashboard, sidebar and exports in the "TTY" direction agreed through
three published mockups, on real data, before the first Marketplace release. Success means
the extension looks and behaves like the mockups in dark, light and high-contrast themes, at
narrow and wide widths, and every existing test still passes alongside the new ones.

The approved mockups are copied into the repo and are the reference for every visual and
behavioural detail this spec does not spell out. Port from them rather than reinventing:

| Mockup | File | Published (private) |
|---|---|---|
| Dashboard, all four tabs | `docs/design/mockups/dashboard.html` | https://claude.ai/artifact/1Ud4dVJM7CrFDMwjT124E6 (v8) |
| Sidebar mini panel | `docs/design/mockups/sidebar.html` | https://claude.ai/artifact/XRg8BF8mkZnzdeqwtmPcqi (v2) |
| Export dialog, share card, report | `docs/design/mockups/exports.html` | https://claude.ai/artifact/A86YktyhZb2q9pVJKvyfys (v2) |

The mockups load Martian Mono from Google Fonts and run on generated example data. In the
extension the font is bundled and the data is real; everything else carries over.

## Decisions (made during brainstorming)

| # | Decision |
|---|---|
| 1 | Record each session's language time from now on. Older sessions fall back to project colour. |
| 2 | Redesign the exports too (share card and PDF report), keeping canvas and jsPDF as the renderers. CSV and JSON follow the dialog's range and project, as the prototype showed. |
| 3 | The PDF report stays dark with the hairline terminal frame. Heatmaps are centred. The carrot is prominent: 5× in the card header, 4× in the report header, 2× in footers. |
| 4 | CRT is on by default, subtle: slot mask, fine pitch, 23% strength (30% until the first manual pass), edges at 35%, scanlines and bloom. Convergence, refresh roll and flicker default off. |
| 5 | Redesign ships before the first Marketplace release. |
| 6 | Work happens on `tty-redesign`, branched from `main` after fast-forwarding `accurate-line-counts`. |
| 7 | Architecture: rebuild the webview front end as small modules; keep the extension host side. |
| 8 | Drop host-theme hue tinting (`derivePalette.ts`). Fixed palettes: phosphor (dark), paper (light), high contrast. |
| 9 | No PDF page preview in the export dialog; the share card gets a live preview. |
| 10 | The correct carrot is `resources/icon.svg`'s shape, including the bottom-left pixel of row 9 (index 8). `resources/rabbithole-icon.svg` gains that pixel in brown `#A5510C`. |

## Non-goals

- No change to storage keys, backup, restore, clear, streak rules, line counting, or the mirror's schema number.
- No agent-detection UI (still shelved).
- No multi-root attribution change (still a separate product decision).
- No Marketplace publishing; that follows this work and stays a user-run step.

## 1. Data

### 1.1 Per-session language time (tracker)

- `ActivitySession` gains `languages?: Record<string, number>` — active ms per language within the session.
- `flushLanguageTime(now)` already credits elapsed ms to `languageCurrent` on the day log. It must credit
  the same ms to `currentSession.languages[languageCurrent]`, so the session's sum and the day's language
  totals never disagree. Excluded documents (empty `languageCurrent`) credit nothing, as today.
- Midnight split: the pre-midnight share stays on the closed session, the post-midnight share starts the new
  one — the same apportioning the day totals already get.
- Checkpoints write the open session's `languages` along with its `activeTime`.
- Sessions recorded before this change have no `languages`. Every consumer treats it as optional.
- `ActivitySession` also gains `intervals?: [number, number][]` — the wall-clock spans (unix ms) the session was actually
  accruing, closed at pause, end and the midnight split; a checkpoint's written copy adds the open one. The day tape and
  target-met time read these, so idle stretches inside a session (a blur, the 60-minute expiry tail) are not drawn as work.
  Older sessions fall back to start → end.
- Mirror: the field flows through unchanged; `MIRROR_SCHEMA` does not change (additive). The CLI's decoders
  ignore unknown fields; only `rabbithole doctor` reports it. Follow-up in `rabbithole-cli`: add `languages` and `intervals`
  to doctor's known-field list.

### 1.2 Host → webview messages

Replace `init` / `update` for the redesigned webviews with three messages. Request/response pairs keep the
existing `WebviewMessage` style.

- `year` — sent on `ready` and whenever stored data changes (settings applied, project target changed,
  clear, import, midnight):
  `{ type: "year"; today: string; days: string[]; globalTargetMs: number; global: { streak; active: number[]; targetMs: (number|null)[] }; projects: ProjectYear[] }`
  where `ProjectYear = { id; name; path; dailyTargetMinutes?; streak: number; lastActive?: number; active: number[]; targetMs: (number|null)[] }`.
  Colours are assigned in the webview by registry order. `streak` and `global.streak` are storage's stored values, which
  self-heal and are not limited to the year. `days` runs from the Monday on or before today − 364 to today (365–371 days),
  `active[i]` is that project's active ms on `days[i]`,
  `targetMs[i]` the day's stamped target (null if unstamped). Drives heatmap, streaks, range columns,
  project picker times, project cards and sparklines.
- `range` — reply to `{ type: "requestDays"; from: string; to: string }` (at most 92 days, enforced by host; a reversed,
  malformed or too-long request gets `{ type: "rangeRefused"; from; to }`). Named `requestDays` because the current
  webview still sends `requestRange` with a different shape until phase 2 removes it:
  `{ type: "range"; from; to; logs: Record<projectId, DailyLog[]> }` — full per-project logs (sessions with
  `languages`, files, languages). The webview builds "all projects" and focus slices from these.
- `live` — every 10 s while open: `{ type: "live"; today; projectId; log: DailyLog; todayActive: Record<projectId, number>; globalToday: number }`
  for today. The webview merges it into its cached `range`/`year` data and re-renders only if today is in view.

`settings` stays and gains the CRT fields (§3). Existing action messages are kept as they are:
`updateSetting`, `updateProjectSetting`, `revealStorage`, `createBackup`, `importData`, `clearProject`,
`clearAll`, `export`, `writePdf`, `writeJpg`. New: `actionResult` `{ type: "actionResult"; ok: boolean; lines: string[] }`
sent after each action so the Settings output console shows what actually happened (file written, days cleared).
VS Code notifications stay as they are.

### 1.3 `model.ts` (pure, no DOM)

All aggregation lives here, unit-tested: build a view for (project or all, from, to, focus); focus slices
(project, or language using session `languages` and file `language`); range totals; per-day/per-week line
rows (≤ 14 days per day, else per week); "met today", "at risk" and the longest run against each day's stamped target
(the current streak count itself comes from storage); year stats; target-met time within a day; tape cells (48 or 24
cells, single day against the cell, ranges against the busiest cell of the whole so a focus shows a share). The tape
window is 07:00–19:00, widened to whole hours covering every session shown, so night work is never cut off.

## 2. Dashboard

### 2.1 Shell

`dashboardPanel.ts` renders: top bar (carrot, project picker, tabs, range buttons, calendar picker), four tab
sections, tooltip, and the CRT layers. CSP unchanged (`script-src`, `style-src`, `font-src ${cspSource}`; the
CRT mask is a canvas pattern, no `img-src` needed). One font: Martian Mono variable woff2 (OFL), bundled under
`src/webview/fonts/` with its licence. Press Start 2P, Unica One and Electrolize are removed.

### 2.2 Modules (`src/webview/`)

| File | Job |
|---|---|
| `model.ts` | §1.3 |
| `state.ts` | view state (project, from/to, focus), message I/O, caches |
| `main.ts` | wiring only |
| `dom.ts`, `tooltip.ts` | element helpers; one tooltip, hover and focus |
| `carrot.ts` | the pixel grid (§5) and an SVG/canvas drawer |
| `crt.ts` | mask canvas, scanlines, roll, glass; reads settings |
| `focus.ts` | hover/keyboard focus, panel height locking |
| `projectPicker.ts`, `datePicker.ts` | top-bar pickers |
| `tape.ts`, `rangeColumns.ts`, `lines.ts`, `languages.ts`, `files.ts`, `sessionLog.ts`, `streak.ts` | overview panels |
| `heatmap.ts` | block-glyph heatmap (replaces the d3 one) |
| `projectCards.ts`, `settingsTab.ts`, `exportDialog.ts` | other tabs and the dialog |
| `jpgExport.ts`, `pdfExport.ts` | §4 |
| `style.css` | rewritten from the mockup tokens |
| `format.ts`, `layout.ts`, `colors.ts`, `calendar.ts` | pure helpers: text, layout arithmetic, colours, range picking |
| `overview.ts`, `activityTab.ts` | tab composition, so `main.ts` stays wiring only |
| `stepper.ts` | the `−`/`+`/apply controls shared by Settings and Projects |

Deleted in phase 2: `charts.ts`, the d3 `heatmap.ts` (replaced), `theme.ts`; dependencies `chart.js`, `d3`. Deleted with
the phase that replaces their last user: `exportShared.ts` and the Electrolize TTF (phase 3, exports), `derivePalette.ts`,
`miniTheme.ts` and the Press Start 2P / Unica One fonts (phase 4, sidebar). `jspdf` stays.

### 2.3 Behaviour

Everything in dashboard mockup v8:

- Overview: single day (day tape, target meter, sessions) or range (one segmented column per day, green when the
  target was met; click opens the day with "back to range"; tape becomes the average active day; lines per day up
  to 14 days, per week beyond; sessions card becomes "days", scrolling on its own with a TTY scrollbar).
- Project picker (all projects or one) shared with the Activity filter; calendar picker, two months, ≤ 92 days.
- Hover focus: a project (legend key, day-bar segment, session's project label) or a language (legend key, language
  row, session bar segment) narrows hero columns, tape, lines, languages, files and the days/sessions card. The panel
  under the pointer keeps its rows and dims the rest; panels lock their height while a focus is shown; focus clears
  when the pointer leaves the item (after a short grace, so crossing to a neighbouring key doesn't flash). Nothing under
  the pointer may move when a focus is applied: panel titles and the target line stay on one line, and focused rows dim
  rather than redraw (changed 2026-10-05 after the first manual pass: the old rule left a focus on, and moving keys
  made a hover vibrate at narrow widths). Keyboard focus does the same.
- Activity: year stats, block heatmap (53 weeks, 26 below 600 px), project share; hovering a project row narrows stats
  and heatmap.
- Projects: sortable cards with today, streak, 14-day sparkline, per-project target with stepper and apply.
- Settings: tracking (daily target, pause after), display (CRT controls, §3), your data, danger (type-to-confirm),
  output console (§1.2).
- Responsive: one column below 860 px; tape 24 cells below 620 px; `+`/`−` runs and diff-stat graphs measure their
  width; no horizontal page scroll at 420 px.

### 2.4 Themes

Body classes from VS Code select the palette: `vscode-dark` → phosphor, `vscode-light` → paper,
`vscode-high-contrast` / `-light` → high contrast (rules use `--vscode-contrastBorder`, no glow, no CRT). Palettes
are the mockup tokens. Language and project colours are the validated sets (dataviz validator, both modes).
`forced-colors` and `prefers-reduced-motion` are honoured as in the mockups.

## 3. CRT settings

New configuration (Settings tab writes them via `updateSetting`; both webviews read them from `settings`):

| Key | Values | Default |
|---|---|---|
| `rabbithole.crt.mask` | `slot`, `grille`, `shadow`, `off` | `slot` |
| `rabbithole.crt.pitch` | `fine`, `medium`, `coarse` | `fine` |
| `rabbithole.crt.strength` | integer 0–100 | `23` |
| `rabbithole.crt.vignette` | integer 0–100: how much the glass darkens the screen's edges | `35` |
| `rabbithole.crt.effects` | array of `scanlines`, `bloom`, `convergence`, `roll`, `flicker` | `["scanlines", "bloom"]` |

Reads go through `src/shared/config.ts` with clamping, like the existing settings. Light themes scale the
strength down (the mockup's paper value), high contrast disables the CRT entirely.

## 4. Sidebar, status bar, exports

### 4.1 Sidebar

`miniPanel.ts` becomes a thin shell around a second webview bundle (`src/webview/mini.ts`) that reuses `model.ts`,
`tape.ts`, `crt.ts`, `tooltip.ts`, `carrot.ts`. Content per sidebar mockup v2: colour carrot header, streak,
today (all projects) with target meter and 24-cell tape, lines, 7-day eighth-block graph with project keys,
projects today (split bar and list), "open dashboard". Hover focus narrows today, tape, lines and the week to a
project against its own target. Below 230 px: 7 streak days, no graph axis, alternate hour labels, no percentages.
Data: `year` plus today's per-project logs, refreshed every 10 s.

### 4.2 Status bar

`$(rabbithole-carrot) 3h40m / 20m` — all projects' active time against the global target (as today), green while
actively tracking. The 🥕 emoji is removed.

### 4.3 Export dialog

Opened from Settings → export. Format (share card, report, csv, json), range (card: today, 7d, 30d; report: today,
7d, 30d, 90d), project (one or all), the destination file name, export. Live share-card preview (the same canvas);
the report shows a list of its sections instead of a page preview. Card and report request `range` data.
CSV and JSON are written by the host: `exportCSV` / `exportJSON` gain `(from, to, projectId)` parameters (the host refuses a given range that isn't a real one
  of at most 92 days) and keep
their existing columns and shape (JSON sessions now carry `languages`). Range for CSV/JSON: today, 7d, 30d or 90d; with no
range chosen, the last 90 days of all projects (the current behaviour).

### 4.4 Share card (`jpgExport.ts`)

420×620 logical, drawn at 3×, always the phosphor palette. Header: carrot 5×, project, dates. Single day: streak
hero with 14 marks; active, sessions, lines, top language; day tape; languages bar. Range: total hours and active
days; per active day, best day, lines, top language; one column per day (≤ 30 days); languages bar. Footer:
"generated … · rabbit hole" with a 2× carrot. Faint scanlines, no mask. Every variant must fit 620 px.

### 4.5 Report (`pdfExport.ts`)

A4, dark pages (`#06090a`) with the hairline rounded frame (inset 20 pt, radius 6). Flat: no glow, no scanlines.
Header: carrot 4×, "rabbit hole · report", project and dates, page n of N. Page 1: eight summary tiles; day tape or
per-day columns; languages table with bars; projects table when all projects. Page 2: sessions (single day) or days
(newest first, 18 rows, 14 at 30 days and above, with an "and N earlier" line); top files as `git diff --stat`;
centred block heatmap at 30 days (5 weeks) and 90 days (13 weeks). Footer with a 2× carrot, one line.
Font: static Martian Mono Regular and Bold TTF taken from the official Martian Mono release (OFL, licence file committed alongside), embedded via jsPDF's `addFileToVFS`/`addFont`. jsPDF cannot embed the variable font.

## 5. Icon

- `src/webview/carrot.ts` holds the 14×10 grid with the decision-10 shape and palette (`O #FF8B00`, `B #A5510C`,
  `G #01FF00`). A test parses `resources/rabbithole-icon.svg` and `resources/icon.svg` and fails if either drifts
  from the grid (colour and mono shape respectively).
- `resources/rabbithole-icon.svg` gains the missing pixel.
- Icon font: `scripts/build-icon-font.py` (fonttools, a one-time developer tool installed with `pip install fonttools`,
  never a runtime or npm dependency) emits `resources/rabbithole-icons.woff` with one glyph drawn from the grid; the
  generated file is committed so builds never need Python. `contributes.icons` registers `rabbithole-carrot`.
- Marketplace: `resources/icon.png` 128×128, carrot at 8× (112×80) centred on `#06090a`, generated by
  `scripts/build-icon-png.js` from the grid using only Node's built-in `zlib`; `package.json` gets `"icon"` and `"galleryBanner": { "color": "#06090a", "theme": "dark" }`.
  The publisher id stays a placeholder until the user supplies it.

## 6. Testing

Existing runner (`node:test` + esbuild aliases to real sources). Every new test is proven against the pre-change
code first (negative control, per `CLAUDE.md`).

- Tracker: session `languages` accumulate and match day language totals; midnight split apportions; excluded docs
  credit nothing; old sessions without the field load.
- CSV/JSON: range and project filters; all-history option matches the previous output.
- Messages: `year` covers 371 Monday-aligned days per project with stamped targets; `range` refuses > 92 days and
  returns per-project logs.
- `model.ts`: view totals, all-projects merge, project and language focus slices, line grouping, streak and longest
  run with stamped targets, tape slot scaling, target-met time.
- Carrot grid vs both SVGs.
- Export layout rules: card variants fit 620 px; report day-row caps.
- Manual Extension Development Host pass: dark, light, high contrast; narrow editor split and narrow sidebar;
  hover focus everywhere; CRT on and off and each setting; every export written and opened; live update across
  midnight. Then Marketplace screenshots.

## 7. Phases

Each phase leaves `npm run build`, `npm test` and `npm run typecheck` green.

1. **Data** — session languages, `year` / `range` / `live` / `actionResult` messages, CRT settings in config,
   `model.ts` with tests.
2. **Dashboard** — shell, modules, four tabs, pickers, focus, CRT, styles; old charts, heatmap, theme code and
   `chart.js`/`d3` removed.
3. **Exports** — dialog, share card, report, static fonts.
4. **Sidebar** — mini bundle, status bar text.
5. **Icons** (needs `pip install fonttools` once, on the user's go-ahead) — carrot module and tests, SVG fix, icon font, `icon.png`, `galleryBanner`; `DESIGN.md` rewritten;
   `CLAUDE.md` updated; CLI follow-up noted.

## Risks

- `live` merges must not double count today's open session; covered by a `model.ts` test.
- Very old installs may have project-less legacy logs (`rabbithole:log:<date>`); `year`/`range` skip them as every
  current read does.
- Icon-font glyph rendering at 16 px must be checked on Windows and macOS during the manual pass.

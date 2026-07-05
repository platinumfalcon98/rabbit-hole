# Rabbit Hole — Logbook

Running record of what was built and when, ordered newest first.

---

## 2026-07-05

**Phosphor glow system (CRT bloom pass on the whole dashboard)**
- Card glow made dramatic: two-layer bloom (tight bright halo + wide soft spill) on `--rh-shadow-card` / hover / success / danger tokens
- Text phosphor glow: inherited `text-shadow` on `body` using `currentColor`, so every element glows in its own color; tuned to a tight, high-gain 1–1.5px edge after iteration
- Strong-glow tier (`--rh-glow-text-strong`) on large numerals, card titles, all buttons, and the date select; sidebar icons mirror it with accent `drop-shadow`s
- Chart glow via a shared `#rh-phosphor` SVG filter (blur merged twice under source) on the pie/donut canvases and heatmap cells; activity chart instead uses a `phosphorDatasetGlow` Chart.js plugin so bars/line glow but axis ticks stay clean

**CRT glass bulge**
- `body::before` overlay fakes tube curvature without distorting text: rounded screen corners, top specular glare, center bloom, barrel vignette starting mid-screen

**Hover pops**
- Cards (`.chart-box`, `.stat-group`, `.section-card`) lift on hover (`translateY`, not scale — scale blurred canvas text) with brighter bloom
- Chart elements grow under the cursor: pie/donut `hoverOffset`, bar `inflateAmount`, line point hover radius, heatmap cell `scale(1.3)`

**Heatmap fixes**
- Phosphor filter scoped to cells only (whole-svg bloom smudged the small labels); labels got their own tighter, dimmer glow
- Tooltip re-parented to `document.body` — the card hover transform was hijacking its `position: fixed` and rendering it far from the cursor

**Today's Report button**
- Solid green fill replaced with phosphor-text treatment: green glowing label + icon on a dark card body, green bloom on hover

**Fonts: VT323 dropped, system now 3 typefaces**
- VT323 unreadable at small sizes — all uses (chart axes, heatmap, session times, legend values, file diffs, settings inputs) now `var(--rh-font-mono)` → Electrolize, with `tabular-nums` for digit alignment
- JPG export's dead `'Quantico'` references (no `@font-face` — was silently falling back) switched to Electrolize
- Dead font files deleted: VT323, Quantico ×4, Funnel Sans ×2, Rajdhani ×2 (~500KB off the package)

**Streak pill: plain design chosen**
- Bordered/glowing container tried and rejected — final design is plain: no background, border, or glow; state carried by icon/number color alone (documented in DESIGN.md so it isn't "fixed" back)

DESIGN.md kept in sync throughout (glow recipes, bulge, chart glow, font table).

---

## 2026-07-03

**Retro-terminal UI redesign (design-system-first)**
- New `--rh-*` design token layer in `style.css`: type scale, spacing rhythm, color roles, depth/glow recipe — fixes the "generic, no rhythm" complaint at the root
- Dashboard asserts its own fixed dark phosphor palette independent of the VS Code theme; native inputs still track `--vscode-*` vars for light-theme legibility
- Two-accent system: amber for interactive/chrome, phosphor green for positive states
- Fonts consolidated to four (Press Start 2P, Electrolize, VT323, Unica One); Quantico and Funnel Sans dropped from the CSS
- Subtle CRT scanline overlay via a single flat CSS gradient (blend-mode avoided for repaint cost)
- Charts and heatmap restyled through a new shared `src/webview/theme.ts` token helper; hardcoded colors and font strings swept into tokens
- Streak pill overhaul: fire emoji replaced with SVG spark icon
- `DESIGN.md` added at repo root: full design-system spec and rationale
- Committed and pushed (`c334f29`)

**Follow-ups**
- Visual review of the redesign in the Extension Development Host still pending
- Unused font files (Quantico, Funnel Sans, Rajdhani) still bundled — remove before next release

---

## 2026-03-29

**Projects tab overhaul**
- Sort toggle replaced with a dropdown matching the date selector design
- Per-project daily target input now uses custom filled chevron stepper buttons (±5 min); same stepper added to all settings inputs (idle threshold, session expiry)
- Fixed bug: project cards always showed 0m active time for non-selected projects — now uses server-computed aggregate active times so all projects reflect today's real usage
- "Active" label renamed to "Active Today"; stat labels and values switched to Funnel Sans, made larger
- Daily target label on project card: Quantico font, white, larger
- Funnel Sans font added (regular + bold, downloaded locally)

**Export card (JPG + PDF)**
- Pixel carrot logo moved to footer, inline left of "Rabbit Hole" text
- "Rabbit Hole" text in footer is now white
- Project name vertically centered in header section
- Export always shows today's data; date selection removed from modal
- GitHub-style 5-week heatmap on card
- JPG output at 3× resolution (1260×1860px) for crisp mobile display; larger fonts and cell sizes throughout
- Carrot SVG reused as the extension panel tab icon

**Streak fixes**
- Streak pill no longer shows "extended" state before today's target is met (was comparing against a missing yesterday entry; now checks `activeTime` directly)
- "Streak at risk" sub-label copy
- Stats averages now divide by full selected range including zero-activity days

**Settings page**
- Apply Changes button added per setting row; inputs no longer auto-save on change
- Idle threshold and session expiry labels switched to Funnel Sans 1.3em white, matching daily target label

**Activity tab**
- Longest Streak stat card now reads from stored `DailyLog.streak` values (same source as the streak pill) instead of recalculating from scratch — target changes no longer retroactively affect historical streak counts

**New charts**
- Activity bar/line chart added to Overview tab: bar for ≤7 days, line for >7 days, always minimum 7-day window, y-axis shows whole hours only
- Project donut chart in Activity tab (visible when All Projects selected): splits active time per project with legend
- Mini panel (sidebar widget): SVG donut showing today's time split across projects with distinct colors; hidden when only one project active

**Export modal improvements**
- Project selector dropdown (defaults to dashboard selection, independent of dashboard view)
- Display name capped at 20 characters; auto-truncates long default names to 17 + ellipsis
- Character counter hint appears on input focus
- Export button renamed to "Today's Report"

**Performance**
- Charts update in place instead of destroy/recreate on every data refresh
- Sessions and files lists skip DOM rebuild when data is unchanged
- Project card event listeners delegated once to container; no longer accumulate on tab switches

**Released as v0.2.2**

---

## 2026-03-25 — v0.2.0

**Export date picker + single-day filter**
- Export modal: added Date picker for single-day export; renamed "Custom" date range option to "Range" for clarity
- Filter bar: added Date picker for single-day selection in the dashboard range controls
- Version bumped to 0.2.0

**Per-project streaks**
- Streaks are now tracked independently per project with their own daily targets
- Global aggregate streak still shown in the header pill
- Streak pill goes muted/grey when today's target isn't yet met ("at risk"); turns full orange once earned

**Export overhaul**
- JPG-only export (removed PDF); smart streak visibility in export (hidden if streak is 0)
- New date range options: Today, Yesterday, Last 7 days, Last 30 days, Range, Single day
- Added CSV and JSON export formats alongside JPG
- Display name input in export modal
- Refactored JPG helper functions

---

## Earlier — v0.1.x (design branch → merged to main)

**Dashboard sidebar nav**
- Removed top tab bar entirely; sidebar is now primary nav
- Hamburger toggle collapses sidebar to 48px icon-only mode
- Nav items: Overview (magnifying glass eye), Activity (line chart), Code (`</>`), Projects (⊞), Settings (⚙ pinned to bottom)
- Range toggle (7d/30d/90d) lives in the header alongside streak pill

**Project selector**
- Single-select with staged Apply model; moved into Projects tab
- Horizontal chip row (All Projects + per-project chips); active chip is orange-tinted
- Dashboard defaults to current workspace project on open

**Typography + visual style**
- Local fonts (Press Start 2P for streak digit, Inter for body)
- Card darkening + colored glow for visual depth
- Widget titles as uppercase labels
- Streak pill: wide pixel font, responsive orange/muted state

**Heatmap**
- Calendar always starts on Monday (fixed alignment)
- Warm gradient: `#2a2a2a` → `#f97316`; today ring; rich tooltip

**Status bar mini panel**
- Shows top language + session count
- Time display goes green when actively tracking

**Activity summary bar**
- Section card wrapper with responsive vertical layout

**Logo + release prep**
- Custom extension icon, LICENSE, repository field, `.vscodeignore` cleanup

---

## Foundation — v0.1.0

**Core tracking pipeline**
- `ActivityTracker`: VS Code event listeners, session lifecycle
- Idle pause (5 min), session expiry (60 min), midnight split
- `flushLanguageTime()` for accurate per-language time apportionment across splits
- Checkpoint every 10s writes live `activeTime` + language data to `globalState`

**Storage**
- `StorageService`: all reads/writes to `globalState` with key pattern `rabbithole:log:YYYY-MM-DD`
- `appendSessionToDate` / `updateLanguageTimeForDate` for date-targeted writes (e.g. midnight split)
- Multi-project storage keys from the start

**Dashboard panels**
- Stat cards (active time, lines added/deleted, AI events)
- Heatmap (SVG, date range driven)
- Lines chart (Chart.js)
- Language panel (bar/donut toggle, Time/Lines metric toggle)
- Agent chart (stacked bar — shelved but kept)
- Sessions list (grouped by date, most recent first)
- Files panel (top 30 files by activity, last 3 path segments shown)

**Settings**
- `rabbithole.idleThresholdMinutes`, `rabbithole.sessionExpiryMinutes`, `rabbithole.dailyTargetMinutes`, `rabbithole.detectAgents`
- First-run prompt to set daily target

**AI detection**
- Heuristics implemented in `agentDetector.ts`
- Shelved: stopped running detection, removed from all UI (code preserved)

# Rabbit Hole — Logbook

Running record of what was built and when, ordered newest first.

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

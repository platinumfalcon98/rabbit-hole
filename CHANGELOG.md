# Changelog

All notable changes to Rabbit Hole. This project follows [semantic versioning](https://semver.org/).

## [0.6.1] — 2026-10-17

### Added

- **Pick colours for projects and languages** in Settings → colours, from the dashboard's
  24 colours and textures. The dashboard, sidebar, share card and report all use them.
- **Step through days and ranges** with ‹ › beside the date, which now sits in its own row
  under the tabs, next to the presets and a custom range button.
- **Share your activity** from any tab, or from the sidebar, whose button shows today's
  time and streak. It opens the export dialog, which now has a project dropdown.

### Changed

- The tabs are a strip, so it's clearer which section you're in.
- Languages keep one colour everywhere, ranked by use over the past year, instead of
  changing colour with each view.
- The share card names Rabbit Hole beside the carrot and the project on its own line, so
  the project's name no longer reads as the app's. Removed lines are red.
- "Best day" is now "most active".
- The Settings output reads as plain sentences and sits under "your data", next to the
  buttons it reports on. Line-counting notes get a marker on the overview's lines panel.

### Fixed

- After the dashboard was opened twice, each export or backup ran twice.
- The danger card's text collapsed to a word per line beside a long project name.

## [0.6.0] — 2026-10-10

A new dashboard and sidebar, and line counts you can check against git.

### Added

- **A redesigned dashboard**, drawn as a phosphor terminal: Overview, Activity, Projects and
  Settings. The overview puts the day on a 15-minute tape, a range on a column per day, and
  narrows every panel to a project or language you hover. It follows light, dark and high
  contrast themes.
- **A redesigned Activity Bar sidebar** with the streak, today against your target, the
  day's tape, lines, the last seven days and today's projects.
- **New exports:** a share card image and an A4 PDF report, alongside CSV and JSON, each
  for all projects or one, with a live preview.
- **CRT display settings** (mask, pitch, strength, vignette, effects), all of which can be
  turned down or off.
- A carrot icon in the status bar and the Activity Bar.
- **Language time follows terminal agents.** While an agent edits files and you aren't
  using the editor, your time goes to the languages of the files it edits, not to
  whichever tab was last open — including when no file is open at all.
- The streak card follows the day you are viewing: a past day shows the streak as it stood
  that night.

### Changed

- **Lines are counted net per file per day**, the way `git diff` would report each file
  against its start-of-day content. Rewriting the same code repeatedly counts once, and
  work undone the same day cancels out. Days recorded by earlier versions keep their old
  counts.
- The lines card's title says what it shows ("today, and the past week").

### Fixed

- **Line counts were badly inflated.** When an agent rewrote an open file on disk, a
  two-line change at its top and bottom was scored as the whole file changing.
- **The first edit to each file after a restart was lost.** It is now measured from the
  file's content at midnight, and in a git repository edits made while VS Code was closed
  earlier that day are counted when it opens.
- Creating and removing a git worktree no longer records the whole tree as written and
  deleted.
- Idle gaps inside a session are no longer drawn as work on the day's tape, and the tape
  places time correctly on daylight-saving days.
- Hovering a project in a narrow sidebar no longer makes the panels jump and the focus
  flicker between neighbouring projects.

## [0.5.0] — 2026-08-10

First release with backup and restore. Everything before this could delete data with no way
to get it back.

### Added

- **Back up your data**, either everything or a chosen set of projects. Backups are written
  to a folder you can open from the dashboard.
- **Restore from a backup**, either everything or a chosen set of projects. Restoring
  specific projects leaves every other project on the machine completely untouched, so
  recovering one project after a mistaken delete does not revert the others.
- Backups double as a transfer format — a project's history can be moved to another
  machine, where it merges rather than overwriting.

### Fixed

- **Streaks no longer break when you change your daily target.** Each day is now judged
  against the target that was in force when it was earned, so raising the target does not
  retroactively un-earn completed days, and lowering it does not retroactively award days
  that genuinely missed. Applies to per-project targets too.
- **A streak value lost to a delete is repaired automatically.** A day that met its target
  can never legitimately have a streak of zero; where that happened, the chain is rebuilt
  from history rather than left to cap every later day.
- **Clearing the project you have open now clears today as well.** The in-progress session
  was being written back within ten seconds, so the current day reappeared while past days
  stayed deleted.
- Reading a day's log no longer mutates the cached copy held in memory.

### Changed

- Destructive actions all take a backup first, and both clear actions require typing an
  exact confirmation.

### Internal

- 144 assertions across five test suites brought into the repository, runnable with
  `npm test`. No new dependencies — `node:test` with each suite bundled against the real
  source and only the VS Code platform stubbed.

## [0.4.0] — 2026-08-09

### Added

- **Your data** section in Settings: storage location with a reveal button, export
  shortcut, and confirm-to-delete actions for one project or everything. Every destructive
  path writes a snapshot first.

### Fixed

- **A minimised window could record hours of active time.** A background agent writing
  files un-paused the clock after a blur, and nothing paused it again.
- **Agent edits were undercounted against typing.** External edits measured a net line
  count while the editor measured a gross one, so an in-place rewrite by an agent scored
  zero. Both paths now measure the same quantity.
- **The Activity Bar panel showed yesterday's line counts as today's** either side of local
  midnight, from a day key derived in UTC.
- Git diff views and other virtual documents were being recorded as edits to real files.

### Changed

- Settings cut from five options to two. The daily target now always has a value — it
  defaults to 20 minutes — because the documented "no target" mode was unreachable and left
  everyone on a 5-minute target they never chose.
- Session expiry is fixed at 60 minutes; it only ever affected how sessions were grouped
  for display.

---

Releases before 0.4.0 are recorded in the git history.

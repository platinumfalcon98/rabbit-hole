# Changelog

All notable changes to Rabbit Hole. This project follows [semantic versioning](https://semver.org/).

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

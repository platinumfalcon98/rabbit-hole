# Morning baseline — design spec

Date: 2026-10-06 · Branch: `morning-baseline`, cut from `tty-redesign` at `f2f96d2`
(the tracker on `main` lacks phase 1's session languages and intervals, which `measure()`
sits beside), merged after `tty-redesign`.

## Problem

Line counts are net per file per day: a file's row should equal a diff of its current
lines against its content at local midnight. The tracker learns a file's start-of-day
content only by seeing it: an open document is primed when it opens, and an unopened file
is first seen when the watcher reports a change. By then the change has already happened,
so `LineLedger.observe()` takes the changed content as the baseline and credits nothing
("first sighting of a pre-existing file credits nothing").

Measured on 2026-10-06 against an independent recomputation of the day's work (25 files,
expected **+315 −100**), the extension recorded **+33 −22** across 6 files. Every one of
the 25 files was in the ledger, so the watcher saw them all. Files edited once credited
nothing, and files edited more than once credited only the later edits. CLAUDE.md, which
was open in an editor, was exact. Agent work on unopened files is the normal case, so
about 90% of the day's lines were lost.

## Goal

For every file the tracker counts, today's row equals a multiset diff of its current lines
against its lines at local midnight. That holds whether or not the file was ever open,
whether or not VS Code was running when it changed, and for gitignored files the tracker
counts (CLAUDE.md, LOGBOOK.md). Success is measured by `scripts/verify-lines.js` (below)
reporting no mismatches for a real working day, apart from the documented limits.

Unchanged: the net-per-file formula, hashing, exclusions (plus `.vscode-test`), suppression
and the git-operation window, worktree crediting, project attribution, the ledger
snapshot, the mirror format, the focus gate and all active-time accounting.

## Decisions (made during brainstorming)

| # | Decision |
|---|---|
| 1 | Approach A: a morning store consulted on first sighting. Rejected: counting lines from `git diff` (a branch switch would count the whole branch diff; unsaved typing and worktrees break) and loading every file into the ledger at day start (tens of MB in the shared extension host). |
| 2 | Edits made today while VS Code was closed count, as CLAUDE.md already records. Catch-up adds lines, never active time. |
| 3 | Non-git folders are captured by a background scan with a cap of 20,000 captured files per workspace window; above it the folder falls back to today's behaviour, with a note. |
| 4 | A file dirty at midnight and edited again before VS Code opened is compared against the baseline commit: nothing recorded its midnight content. Documented, not hidden. |

## 1. Morning store

New pure module `src/tracker/morningStore.ts` (no vscode import), plus a thin git adapter
`src/tracker/gitBaseline.ts` (node `child_process`, no vscode import). The store answers
one question for a path: its lines at local midnight today, as

- `LineHashes` — the morning content (possibly `[]`: the file did not exist), or
- `unknown` — no source holds it.

Resolution order for a path the ledger has not seen today:

1. **Day-start capture** (section 2) has an entry → its hashes, `[]` for "empty", or B's
   content for "use B", or `unknown`.
2. **git:** the path is in a repo, has no capture entry (so it was clean at day start), and
   exists in the baseline commit B → its content in B. Absent from B → `[]`.
3. Otherwise `unknown`.

`unknown` keeps today's behaviour exactly: the current content becomes the baseline and
nothing is credited.

### Baseline commit B (per repo)

Computed once per day per repo from `git reflog show --date=unix HEAD` (pure function over
parsed entries, `chooseBaseline(entries, midnightMs)`):

- start at the entry in effect at midnight (`HEAD` at midnight);
- a later entry whose action is `commit`, `commit (amend)` or `commit (initial)` leaves B
  unchanged: committed work is today's authorship;
- a later `checkout`, `merge`, `commit (merge)`, `pull`, `reset`, `rebase`, `cherry-pick`,
  `revert` or `clone` entry moves B to that entry's new value, mirroring the live tracker,
  which absorbs those operations (they raise `MERGE_HEAD` / `ORIG_HEAD` /
  `CHERRY_PICK_HEAD` / `REVERT_HEAD` or move `HEAD`) instead of crediting them;
- every entry is after midnight (cloned or initialised today) → B is the first entry's new
  value, so a clone counts 0;
- no reflog → `git rev-list -1 --before=<midnight> HEAD`; nothing → current `HEAD`.

### Reading from git

- The git executable is the one VS Code's git extension reports (`vscode.git` API
  `git.path`), passed to the adapter by the tracker; otherwise `git` on PATH.
- Content is read with `git cat-file --batch --filters` (paths given as `B:<path>`), in
  batches of up to 200 paths per process, so working-tree filters apply: line-ending
  conversion and smudge filters such as Git LFS. Without `--filters` an LFS file would be
  compared against its pointer and score as a rewrite.
- Every git command has a 10 s timeout. A missing binary, a failure or a timeout makes the
  folder a non-git folder for the day (it is scanned instead) and adds a note.
- Blobs over 5 MB are `unknown`, matching `measure()`'s limit.

### Paths

Git reports repo-relative `/` paths; the tracker uses `fsPath` (`c:\…`). Every lookup goes
through one `normalizePath()`: absolute, `\` → `/`, lower-case drive letter, and
case-folded on Windows and macOS. Nested repos (an untracked directory containing `.git`)
and submodules are their own repos with their own B and capture; a path resolves to its
nearest repo root.

## 2. Day-start capture

`src/tracker/dayCapture.ts` builds the capture; `src/tracker/captureStore.ts` (pure node)
reads and writes it.

### When

- At `start()` when no capture for today exists for this workspace.
- At local midnight while running (the existing 10 s tick sees the date change).
- In the background, in batches of 50 files that yield (`setImmediate`) between them. A
  failure is caught and noted; the next start-up retries. It never throws.

### Candidates (per workspace folder)

| Folder | Candidates |
|---|---|
| git repo | `git status --porcelain=v1 -z -uall` (dirty tracked + untracked), plus `git status --porcelain=v1 -z --ignored` (ignored files; collapsed ignored directories are walked) |
| not a git repo | every file under the folder (walked) |

Every candidate passes the tracker's own filters first: `isExcludedPath`, a language from
`languageForFile`, and at most 5 MB. `EXCLUDED_SEGMENTS` gains `.vscode-test` (VS Code's
test-runner download of VS Code itself).

### Classification (pure: `classify(stat, midnightMs, tracked)`)

| File | Entry |
|---|---|
| modified before midnight | its current hashes (exact) |
| created after midnight (`birthtimeMs`, when non-zero) | `empty` (exact) |
| modified after midnight, tracked | `useB` (decision 4) |
| modified after midnight, untracked / ignored / non-git | `unknown` |

Every dirty tracked file gets an entry, so the store never treats it as clean.

### Cap

20,000 captured files per workspace window in total. In a git repo only the dirty,
untracked and ignored candidates count; clean tracked files cost nothing. Past the cap the
folder's capture stops and is marked `partial`: its uncaptured files resolve through git
when clean and tracked, otherwise `unknown`. Note: "line counts in <folder> start from each
file's first edit: more than 20,000 files to capture".

### On disk

`globalStorage/ledger/morning-<workspace hash>.json` and `.bin`, the hash computed like
`ledgerFile()`.

- `.json`: `{ version: 1, day, folders: [{ root, repo?: { top, baseline }, partial }],
  index: { [normalizedPath]: [offset, count] | "empty" | "useB" | "unknown" } }`.
- `.bin`: line hashes as packed little-endian `uint32`, 4 bytes per line.
- Only the index is held in memory; a file's hashes are read from `.bin` (one positioned
  read) at its first sighting.
- Written atomically (tmp + rename) like `ledgerStore.ts`. A capture whose `day` is not
  today, whose version is unknown, or that fails to parse is deleted and retaken.
- Size: a few KB for this repo; at the cap about 16 MB on disk and about 1 MB of index.

## 3. Ledger, catch-up, restarts, midnight

### Ledger

`ObserveOptions` gains `morning?: LineHashes`. On first sighting with `morning` set, the
entry starts from `morning` (not the current content) and the difference is credited
immediately, exactly as for a create with `seed`. Consequences:

- the first edit to an unopened file counts;
- a file deleted before the tracker ever saw it, whose morning content is known, is
  credited as deleted (today it records nothing). `measure()` no longer returns early for
  "deleted and never seen" when the store has morning content;
- a suppressed first sighting with `morning` set starts from `morning` and shifts by the
  suppressed change, so the result equals today's (a branch switch credits nothing).

`measure()` asks the store only when `!ledger.has(path)` and the change is not a create.
The lookup is async; `measure()` is already async.

### Catch-up at start-up

After today's capture is ready (taken or loaded), the tracker measures every file that may
have changed since midnight:

- git repos: `git diff --name-only -z B` (working-tree changes, today's commits and
  deletions) plus capture entries created or modified after midnight;
- non-git folders: capture entries created or modified after midnight.

Each goes through the normal debounced `measure()` with a `catchUp` flag that skips
`onActivity()`: lines count, time does not. `measure()` credits only the change not yet
credited, so measuring a file twice is harmless. Capped at 20,000 files per start-up; the
rest are left to the watcher, with a note.

### Restart

Order in `start()`: restore the ledger snapshot (as now) → load or take today's capture →
catch-up. A file in today's snapshot keeps its morning baseline and the store is never
consulted for it. Catch-up also measures snapshot files changed while VS Code was closed
and not touched since; today those wait for their next edit.

### Midnight while running

Seen files roll over as now (yesterday's last content is today's baseline; the tracker
watched them to midnight). A new capture starts; the store is keyed by day, so yesterday's
capture is never consulted after midnight. First sightings before the new capture is ready
resolve through git where possible, else `unknown`. No catch-up runs at midnight.

### Worktrees

Created worktree files keep the existing seed from the main checkout. A pre-existing
worktree file seen for the first time resolves against that worktree's own B (its own
reflog); worktrees are not captured, so this is treated as `useB`.

## 4. Failures and notes

A failure never stops tracking and never invents lines: it falls back to today's behaviour
for the files it affects and adds a note.

- Notes are strings collected by the tracker for the day ("git unavailable in <folder>",
  "capture partial in <folder>", "catch-up capped at 20,000 files") and carried to the
  dashboard in the existing `settings` message as an optional `lineNotes: string[]`. The
  Settings console prints them. No pop-ups. The mirror and the CLI are unaffected.
- A corrupt, wrong-version or wrong-day capture is deleted and retaken.
- Unreadable files and files over 5 MB are skipped, never treated as deletions.

## Accepted limits (documented in CLAUDE.md)

1. A file dirty at midnight and edited before VS Code opened that day is compared against B
   (decision 4).
2. A pre-existing worktree file first seen today is compared against its worktree's B.
3. An edit made after the day's capture started but before it reached that file resolves
   as `unknown` (about 0.1 s for a git repo; up to the scan time for a large non-git
   folder).
4. Folders over the cap fall back to today's behaviour for uncaptured, non-git-clean files.
5. Work committed while VS Code was closed and then followed by a checkout, reset, pull,
   rebase or merge before it opened is not credited: B follows the operation, and its
   content already contains (or no longer shows) that work. Work done while VS Code is open
   is credited live and unaffected.
6. 32-bit line-hash collisions, as before, can mask a changed line.

## 5. Testing

Production code bundled with only the platform stubbed, as every suite is. New suites are
registered in `scripts/test.js`.

**Pure unit tests**

- `chooseBaseline`: commit keeps B; checkout / merge / pull / reset / rebase / cherry-pick /
  revert move it; clone today; no reflog; entries either side of midnight.
- `classify`: before midnight; created after midnight; modified after midnight, tracked and
  untracked; `birthtimeMs` zero.
- `normalizePath`: drive-letter case, separators, case folding, repo-relative join.
- Capture file round trip; corrupt / wrong version / wrong day rejected.
- Ledger `morning`: first sighting credits immediately; deleted-and-never-seen credited as
  deleted; a second measure does not double count; suppressed first sighting credits
  nothing; snapshot round trip.

**Integration against real git** (a `mkdtemp` repo; `GIT_COMMITTER_DATE` / `GIT_AUTHOR_DATE`
give the reflog a yesterday and a today; `now` injected)

- The 2026-10-06 bug: a file committed yesterday, edited once today on disk, never opened →
  full diff credited. **Negative control:** against the current tracker and ledger
  (`--alias`) it records nothing.
- Replay of 2026-10-06's pattern: many files edited once, two edited repeatedly, one
  gitignored doc → recorded totals equal an independent multiset diff against B.
- Catch-up: closed-period edits and commits counted with no active time; a closed-period
  branch switch not counted; a clone today counts 0; a closed-period delete credited.
- Restart mid-day: snapshot baselines kept; closed-period edits to snapshot files measured.
- Midnight while running: new capture; yesterday's never consulted; seen files roll over.
- Fallbacks: non-git folder scanned and exact; over-cap folder partial with a note; git
  unavailable (bad git path) → scanned; CRLF working files against LF blobs score 0/0.

**Performance:** capturing a synthetic 20,000-file non-git folder while a 10 ms interval
records the longest gap; the test fails on any gap over 50 ms.

**Verification tool:** `scripts/verify-lines.js [date]` recomputes the expected net per
file for a day (multiset diff against B per repo, same exclusions and language filter,
CR-stripped) and compares it with the mirror's rows for that day, printing totals and every
mismatch. It covers git repos only: a non-git folder has no record of its morning content
to check against. The acceptance check is a real working day in the Extension Development Host with
no mismatches outside the accepted limits.

## Documentation

CLAUDE.md's line-counting section replaces "first sighting of a pre-existing file credits
nothing" with the morning store, adds the capture and catch-up, lists the accepted limits,
and updates the test table and relevant-files table.

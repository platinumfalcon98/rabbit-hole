# Morning baseline — design spec

Date: 2026-10-06 · Branch: `tty-redesign` (decided at review: the work lands on the
redesign branch itself, not a separate branch). Amended after review, 2026-10-06: the
capture's dirty list is known before hashing (section 2, "Before the capture finishes"),
yesterday's ledger snapshot is folded into the capture (section 2, "Yesterday's
snapshot"), creation time is trusted only for files git does not track, and soft/mixed
resets are an accepted limit. Amended during planning, 2026-10-06: D1–D6 (see the plan).
Amended after the build, 2026-10-06: review rulings R9, R10 and R12–R14 and the accepted
limits 10–13 below.

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
| 4 | A file dirty at midnight and edited again before VS Code opened is compared against yesterday's ledger snapshot when it is usable, else the baseline commit. Documented, not hidden. (Amended at review: originally the baseline commit only.) |
| 5 | Review, 2026-10-06: the work is done on `tty-redesign`. Yesterday's snapshot is the fallback for files changed overnight, chosen over treating them as `unknown`. |

## 1. Morning store

New pure module `src/tracker/morningStore.ts` (no vscode import), plus a thin git adapter
`src/tracker/gitBaseline.ts` (node `child_process`, no vscode import). The store answers
one question for a path: its lines at local midnight today, as

- `LineHashes` — the morning content (possibly `[]`: the file did not exist), or
- `unknown` — no source holds it.

Resolution order for a path the ledger has not seen today:

1. **Day-start capture** (section 2) has an entry → its hashes (taken from disk, or from
   yesterday's snapshot), `[]` for "empty", or B's content for "use B", or `unknown`.
2. **git:** the path is in a repo whose `git status` has been read, is **not** in that
   status's dirty / untracked / ignored list (so it was clean at day start), and exists in
   the baseline commit B → its content in B. Absent from B → `[]`.
3. Otherwise `unknown`. In particular a path git listed as dirty, untracked or ignored that
   the capture has not reached yet is `unknown`, never B (see section 2, "Before the
   capture finishes").

"No capture entry" alone never means clean: the capture fills in over seconds or minutes,
and treating an unreached edited file as clean would compare it against B and credit
yesterday's uncommitted work to today.

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
- Content is read with plain `git cat-file --batch` (paths given as `B:<path>`), in batches
  of up to 200 paths per process (D1; the original `--filters` plan fails on git 2.51 with
  `fatal: missing path`). Line-ending conversion is harmless because hashing strips CR. A
  blob that is a Git LFS pointer resolves as `unknown`; other smudge filters and
  `working-tree-encoding` are accepted limit 9. Skipping the smudge also avoids network
  fetches.
- `git diff --name-only` runs with `--no-renames`, so a renamed file's old path is caught up
  as a deletion and its new path as a creation.
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
- In the background, yielding to the event loop whenever 8 ms of work has accumulated (D5:
  `Budget`; a fixed batch of 50 files could exceed the 50 ms gap limit on a large file). A
  failure is caught and noted; the next start-up retries. It never throws.

### Candidates (per workspace folder)

| Folder | Candidates |
|---|---|
| git repo | `git status --porcelain=v1 -z -uall` (dirty tracked + untracked), plus `git status --porcelain=v1 -z --ignored` (ignored files; collapsed ignored directories are walked) |
| not a git repo | every file under the folder (walked) |

Every candidate passes the tracker's own filters first: `isExcludedPath`, a language from
`languageForFile`, and at most 5 MB. `EXCLUDED_SEGMENTS` gains `.vscode-test` (VS Code's
test-runner download of VS Code itself).

### Before the capture finishes

The first step of a git folder's capture is `git status`, which takes about 0.1 s; hashing
takes longer. As soon as status returns (R9: the capture marks **every** folder ready in a first
pass as soon as its status is known, before any hashing starts), the store holds the folder's **pending set**: every
dirty, untracked and ignored candidate path. Until the capture reaches a pending path, a
lookup for it returns `unknown`; clean tracked paths resolve through git right away. A
lookup made before status returns **waits** for it (D2; bounded by the 10 s git timeout)
and then applies these rules, so documents restored at start-up do not resolve `unknown`
during the first 0.1 s. A non-git folder is wholly pending
until its walk reaches each file. Pending sets live in memory only; a capture interrupted by
shutdown is retaken at the next start-up, since no file for today was written.

### Yesterday's snapshot

The ledger snapshot (`today-<workspace hash>.json`, `ledgerStore.ts`) holds the last content
the tracker saw for every file it measured yesterday. At start-up, before pruning, a
snapshot whose `day` is yesterday's date key is renamed to `yesterday-<workspace hash>.json`
instead of being deleted. A snapshot from any older day is deleted as now.

It is **usable** if, for a git folder, no reflog entry falls between the snapshot file's
mtime (its last save) and local midnight. A reflog entry in that gap means git moved after
VS Code closed, so the snapshot may be stale. For a non-git folder, the day check alone
decides.

When the capture runs, each path in a usable snapshot gets an entry carrying the snapshot's
`last` content (`[]` if it had been deleted), unless the capture already holds an exact
entry for it (modified before midnight: its current content is its midnight content). This
applies to clean tracked files too. Consider a file that had uncommitted edits at midnight
and was committed this morning before VS Code opened. It is clean at capture time, so B
would get it wrong, while the snapshot has it right. When the file was clean at midnight,
the snapshot equals B anyway. Snapshot entries count toward the cap. Once the capture is
written, the `yesterday-` file is deleted: the capture now holds everything it contributed.

Running through midnight never needs it. Seen files roll over in the ledger, and the
midnight capture reads unseen files' content as it was at midnight.

### Classification (pure: `classify(stat, midnightMs, tracked, existedBefore)`)

| File | Entry |
|---|---|
| modified before midnight | its current hashes (exact) |
| in a usable yesterday's snapshot | the snapshot's content |
| modified after midnight, tracked | `useB` (decision 4) |
| untracked / ignored / non-git, created after midnight (`birthtimeMs`, when non-zero), not `existedBefore` | `empty` |
| untracked / ignored / non-git, created after midnight, `existedBefore` | `unknown` |
| modified after midnight, untracked / ignored / non-git | `unknown` |

**Creation time is trusted only for files git does not track.** Tools that save by writing a
temp file and renaming it over the original give the file a new creation time on macOS and
Linux. Windows usually keeps the old one, through file-system tunnelling. A rewrite would
therefore look like a create, and score every line as added. For a tracked file, git decides
instead: absent from B means created. For anything else, `existedBefore` is true when the
path appears in yesterday's snapshot or in the index of the previous capture. The previous
capture is the wrong-day `morning-*.json`; its index keys are read before it is deleted.

Every dirty tracked file gets an entry, so the store never treats it as clean.

**A tracked file that is missing at capture time** (deleted, with no usable snapshot entry;
R10) is classified by its parent directory's mtime: before midnight, the deletion happened
before today and the entry is `empty`; otherwise it is `useB`. Accepted limit 10.
`existedBefore` is true for any path in yesterday's snapshot, usable or not. Linked
worktrees are never captured as nested repos (section 3, "Worktrees"). A nested repo that
hits the cap is marked `partial` and a note is added.

### Cap

20,000 captured files per workspace window in total. In a git repo only the dirty,
untracked and ignored candidates count; clean tracked files cost nothing. Past the cap the
folder's capture stops and is marked `partial`: its uncaptured files resolve through git
when clean and tracked, otherwise `unknown`. Note: "line counts in <folder> start from each
file's first edit: more than 20,000 files to capture".

### On disk

`globalStorage/ledger/morning-<workspace hash>.json` and the per-capture `.bin`, the hash
computed like `ledgerFile()`.

- `.json` (D4): `{ version: 1, day, bin, folders: [{ root, repo?: { top, baseline },
  partial }], index: { [rawPath]: [offset, count] | "empty" | "useB" | "unknown" } }`. The
  index is keyed by the **raw** path and normalised in memory (catch-up needs real-case
  paths, and ledger keys are VS Code `fsPath`s). `bin` names the capture's `.bin`, which
  is `morning-<hash>-<day>-<rand>.bin`, per capture; the `.json` is written last, so the
  pair is consistent after a crash.
- If the `.bin` cannot be created, git folders fall back to plain for the day (accepted
  limit 13).
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
immediately, exactly as for a create with `seed`. D6: `measure()` calls for one path run
one after another (`runMeasure`), and live first sightings share one git process through
`BlobQueue` (20 ms coalescing, at most 200 paths). Consequences:

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

Each goes through the normal `measure()` (serialised per path, D6) with a `catchUp` flag that skips
`onActivity()`: lines count, time does not. `measure()` credits only the change not yet
credited, so measuring a file twice is harmless. Capped at 20,000 files per start-up; the
rest are left to the watcher, with a note.

### Restart

Order in `start()`: keep yesterday's snapshot aside (renamed, section 2) → restore today's
ledger snapshot (as now) → load or take today's capture → catch-up. A file in today's snapshot keeps its morning
baseline and the store is never consulted for it.

**Open documents (D3, R12, R13).** VS Code restores tabs at start-up, so opening a document
consults the store before priming; priming from current content would drop every
closed-period edit to an open tab. A document whose morning content is known goes through
`measure()` (R12), so it gets suppression and existence checks, and no time is added. While
today's capture runs, a document inside a workspace folder whose morning content is still
unknown is primed only after the capture finishes (R13; accepted limit 12). Documents
outside the workspace are primed at once. `stop()` halts catch-up and priming (R14), so
nothing is credited after the final save. Catch-up also measures snapshot files changed while VS Code was closed
and not touched since; today those wait for their next edit.

### Midnight while running

Seen files roll over as now (yesterday's last content is today's baseline; the tracker
watched them to midnight). A new capture starts; the store is keyed by day, so yesterday's
capture is never consulted after midnight. Before the new capture is ready, a first sighting
of a clean tracked file resolves through git once status has returned. Anything pending,
or anything before status returns, is `unknown` (section 2, "Before the capture finishes"). No catch-up runs at midnight.

### Worktrees

Linked worktrees are never captured as nested repos. Created worktree files keep the
existing seed from the main checkout. A pre-existing
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

1. A file with uncommitted edits at midnight, changed again before VS Code opened that day,
   is compared against yesterday's snapshot. That snapshot misses any edits made yesterday
   after VS Code closed, and those then count today. When the snapshot is missing (VS Code
   not run yesterday) or unusable, the file is compared against B, and yesterday's
   uncommitted work counts today (decision 4).
2. A pre-existing worktree file first seen today is compared against its worktree's B.
3. An edit to a dirty, untracked or ignored file made after the day's capture started, but
   before the capture reached that file, resolves as `unknown`. That window is the hashing
   time: seconds for a git repo, up to the full scan for a large non-git folder. Clean
   tracked files resolve through git once `git status` returns, about 0.1 s.
4. Folders over the cap fall back to today's behaviour for uncaptured, non-git-clean files.
5. Work committed while VS Code was closed and then followed by a checkout, reset, pull,
   rebase or merge before it opened is not credited: B follows the operation, and its
   content already contains (or no longer shows) that work. Work done while VS Code is open
   is credited live and unaffected.
6. 32-bit line-hash collisions, as before, can mask a changed line.
7. `git reset --soft` / `--mixed` while VS Code was closed moves B, but leaves the working
   tree alone; the reflog message does not say which mode was used. Undoing yesterday's
   commit that way makes its changes count today.
8. On macOS and Linux, an untracked or ignored file can be rewritten by temp-and-rename
   while VS Code was closed. If it is in neither yesterday's snapshot nor the previous
   capture, it counts as created, with every line added. That happens on the first day
   after install, or for a file untouched since before the previous capture.
9. Files with a smudge filter other than Git LFS, or with `working-tree-encoding`, are
   compared against the raw blob (D1). `git cat-file --batch --filters` fails on git 2.51
   (`fatal: missing path`), and line-ending conversion is already harmless because hashing
   strips CR. Git LFS pointers resolve as `unknown`.
10. A tracked file deleted and uncommitted before VS Code opened, with no usable snapshot
    entry, is classified by its parent directory's mtime (R10). An old uncommitted deletion
    in a directory whose entries changed today is classified `useB` and credited again that
    day.
11. Case-only path mismatches (the `fsPath` casing differs from the git index on Windows or
    macOS) make B report the file missing, so the whole file is credited as added.
12. A document inside a workspace folder, opened while today's capture runs and whose
    morning content is still unknown, is primed only after the capture finishes (R13). An
    edit typed into it in that window is uncounted. A ledger `rebase` method is a possible
    follow-up.
13. If the capture's `.bin` cannot be created, git folders fall back to plain for the day,
    so clean files no longer resolve through B.

## 5. Testing

Production code bundled with only the platform stubbed, as every suite is. New suites are
registered in `scripts/test.js`.

**Pure unit tests**

- `chooseBaseline`: commit keeps B; checkout / merge / pull / reset / rebase / cherry-pick /
  revert move it; clone today; no reflog; entries either side of midnight.
- `classify`: before midnight; created after midnight; modified after midnight, tracked and
  untracked; `birthtimeMs` zero; a tracked file with a new creation time is `useB`, never
  `empty`; untracked created-after-midnight with `existedBefore` is `unknown`; a path in a
  usable yesterday's snapshot takes its content.
- Yesterday's snapshot: renamed (not pruned) only when its day is yesterday; unusable when a
  reflog entry falls between its save and midnight; folded into the capture, then deleted;
  never consulted after a midnight while running.
- Pending set: a dirty file first sighted before the capture reaches it is `unknown`, and a
  clean tracked file resolves through git, before the capture finishes. **Negative control:**
  a store that treats "no entry" as clean credits the dirty file against B.
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
- Overnight: a file with uncommitted edits yesterday, committed this morning while VS Code
  was closed → only this morning's change against yesterday's snapshot (**negative
  control:** without the snapshot it is compared against B and over-counts).
- Restart mid-day: snapshot baselines kept; closed-period edits to snapshot files measured.
- Midnight while running: new capture; yesterday's never consulted; seen files roll over.
- Fallbacks: non-git folder scanned and exact; over-cap folder partial with a note; git
  unavailable (bad git path) → scanned; CRLF working files against LF blobs score 0/0.

**Performance:** capturing a synthetic 20,000-file non-git folder while a 10 ms interval
records the longest gap; the test fails on any gap over 50 ms.

**Verification tool:** `scripts/verify-lines.js [date] --repo <path>` recomputes the expected net per
file for a day (multiset diff against B per repo, same exclusions and language filter,
CR-stripped) and compares it with the mirror's rows for that day, printing totals and every
mismatch. It skips worktree paths and files over 5 MB, exactly as the tracker does, and
exits 2 with a one-line message on bad input or a missing mirror day. It covers git repos only: a non-git folder has no record of its morning content
to check against. The acceptance check is a real working day in the Extension Development Host with
no mismatches outside the accepted limits.

## Documentation

CLAUDE.md's line-counting section replaces "first sighting of a pre-existing file credits
nothing" with the morning store, adds the capture and catch-up, lists the accepted limits,
and updates the test table and relevant-files table.

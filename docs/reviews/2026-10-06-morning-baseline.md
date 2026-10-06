# Morning baseline: final branch review

Reviewed range: `7fe3495..ddd2448`, followed by the working-tree corrections below.
Recovered from Claude session `d33950da-c210-4a61-b2ad-8961b3f055fd` and final reviewer
`a987660db2ca8071c`. The reviewer stopped with HTTP 429 before producing findings.
All 12 implementation tasks had completed their individual reviews.

## Assessment

**Review corrections implemented, including the user-approved conservative restart policy.** Final automated validation is recorded below. Real Extension Development Host acceptance
remains the user's task, as specified in the original instructions.

## Fixed findings

| Severity | Area | Failure and correction |
|---|---|---|
| Important | `activityTracker.ts`, midnight | A measure before the 10-second tick used the previous day's store; an in-flight lookup could also return the old day's answer after rollover. Check the day before measurement and retry within the per-path queue if the day/store changes during awaits. Priming rechecks the store too. |
| Important | `morningStore.ts`, snapshot ordering | A clean file committed this morning could resolve through B before yesterday's snapshot was folded in, crediting yesterday's lines today. Snapshot paths wait for the capture before resolving; other paths remain available. |
| Important | `captureStore.ts`, persistence result | `saveCapture` swallowed failure while `DayOutcome.saved` was always true. The caller could delete yesterday's only recovery snapshot. Return and propagate the actual save result, with a console note on failure. |
| Important | `captureStore.ts`, concurrent windows | Saving deleted all sibling bins, including an in-progress writer's bin and a live reader's bin. Keep immutable bins until age-based pruning; use a per-capture temporary JSON name. This avoids file deletion races; it does not introduce cross-window aggregation or locking. |
| Important | `dayCapture.ts`, nested repos | Clean files committed today in nested repositories were absent from startup catch-up, both initially and after reload. Enumerate every captured repo's diff, scoped to its captured root; share a diff request for folders using the same repo/B. |
| Important | `dayCapture.ts`, new files on reload | Saved indexes could not name untracked/ignored/plain-folder files created later while closed. Rediscover candidates within the cap, preserve existing entries, and use an empty baseline only for uncaptured files created today. Nested repositories are not treated as untracked files. |
| Important | `captureStore.ts`, validation | `folders: [null]`, out-of-bounds hash ranges, and a bin path escaping the capture directory could be accepted. Validate folder records, bin names, file size/alignment, and safe bounded offsets before accepting a capture. |
| Important | `gitBaseline.ts`, host memory | The 5 MB blob check happened only after collecting all stdout. A large repository object could exhaust the shared host first. Limit each Git command to 32 MiB stdout, bound stderr, kill on overflow, and use the existing failure fallback. |

## Fixed: Git operations after the saved baseline

Reproduction using a throwaway repository:

1. Commit `a.ts = main\n` on main yesterday; commit `a.ts = feature\n` on feature yesterday.
2. On main, take today's capture, then close the tracker.
3. Switch to feature today without editing any file.
4. Reopen with the same capture.

Observed: catch-up includes `a.ts`, the morning answer remains `main\n`, and the
working file is `feature\n`. The resulting +1/-1 is a branch switch, not authorship.
This follows the plan's explicit "keep B on reload" behavior (also asserted by
the existing reload test), but conflicts with the no-branch-diff-credit invariant.
Updating B alone is insufficient: restored ledger entries and captured hashes also
need a consistent policy. The user approved conservative restart recovery that may
omit uncertain closed-period edits.

Captures and ledger checkpoints now retain per-repository fingerprints of non-authorship
reflog entries. Changed or unavailable fingerprints trigger recovery: clean files use
current HEAD, dirty files use current content, and restored ledger entries absorb the
uncertain difference while preserving previously credited totals. Pending recovery paths
are checkpointed, so interruption does not lose the recovery state. Other repositories
keep their captured baselines; linked worktrees use their own operation history.
Ordinary commits and ordinary closed-period edits keep the existing baseline.

Legacy checkpoints and unavailable reflogs recover conservatively. Operations since the
capture can trigger recovery even if observed live earlier. Edits during an uncertain
closed interval or recovery scan may be omitted. This changes internal capture/ledger
metadata only; DailyLog and the published mirror schema are unchanged.

## Fixed: independent review of the restart recovery

All four tests are in `test/tracker.restart.test.ts`; each failed against the tree before
its fix (RED run: 19 tests, 14 passed, 5 failed) and passes after it.

| Severity | Area | Failure and correction | Test |
|---|---|---|---|
| Important | `dayCapture.ts` `discoverSinceCapture`; `activityTracker.ts` `catchUp` | Every already-captured file (up to 20,000 in plain folders, plus captured untracked/ignored files) was added to catch-up on every same-day restart, growing the ledger snapshot and crowding real changes past `CATCH_UP_MAX`. Captured files now only enter catch-up through reload's mtime pass. Catch-up measures restored paths first, so pending recoveries run before the cap. | "a same-day restart does not catch up captured files that did not change" |
| Important | `activityTracker.ts` `beginDay` | An in-session midnight cleared `recoveryPending`; the rollover's base was the pre-operation `last`, so the next observe credited the branch/reset/merge diff to the new day. Pending paths now survive the rollover. | "a recovery still pending when midnight passes in-session is suppressed on the new day" |
| Important | `ledgerStore.ts` `loadYesterday` | A pending path's stale `last` was folded into the next day's capture. Paths listed in the snapshot's `recoveryPending` are dropped. | "yesterday's snapshot leaves out paths whose recovery was still pending" |
| Minor (inflation) | `dayCapture.ts` `recaptureAfterGit` | A tracked file missing during a recovery recapture got morning `[]`, so a later `git restore` counted as the whole file added. A missing or unreadable file is now `unknown`. | "a tracked file deleted while closed around a Git operation is unknown, so restoring it credits nothing" |
| Minor (inflation) | `dayCapture.ts` `capture` | A fresh capture did not report repositories without a reflog in `uncertainRoots`, so with a missing/invalid capture JSON a closed-period reset was measured against the restored ledger. They are now reported. | "a missing capture and no reflog still recover restored entries conservatively" |
| Minor (inflation, follow-up) | `dayCapture.ts` `startDay` / `capture` failure paths | A fresh capture that failed (writer could not be created, or `capture()` threw) returned no `uncertainRoots`, so on a same-day restart restored entries were measured raw and a closed-period branch switch was credited. Both failure paths now report every workspace root (plus any repo top already found) as uncertain; the `capture()` failure note is guarded so a throwing reporter cannot drop the outcome. | "a fresh capture that fails (writer \| capture) still recovers restored entries after a closed-period branch switch" |

## Deferred-minor triage

- Promoted the Task 5 sibling-bin deletion issue to Important and fixed it.
- Addressed repeated per-folder diffs while fixing nested-repository catch-up.
- Test-report arithmetic, comment encoding, fixture spelling, and missing redundant
  unit branches do not block this batch; the real-Git and integration suites remain
  the stronger coverage. The original negative-control correction is retained.
- `start()` after `stop()` on the same instance is not a production lifecycle; left unchanged.
- UNC root normalization, worktree-column rename parsing, nonmonotonic reflogs,
  snapshot-fold cap reporting, late note day attribution, ignored-parent workspace capture, and verify-tool
  input/throughput limitations remain follow-ups. They are not evidence of full
  platform coverage. The documented case mismatch and capture-window limits remain.
- Real VS Code events, cross-platform rendering, and real-day count acceptance are
  not replaced by these Node tests.

## Validation evidence

- Before changes: all 41 existing suites passed; typecheck and build passed.
- New `morningreview` suite: 9 passed / 0 failed with fixes.
- Negative control: copies of `ddd2448` production modules under `src/tracker/`,
  with their local imports kept within the pre-fix copies, produced **9 tests,
  0 passed, 9 failed, 0 cancelled**. The temporary copies were then removed.
  Command: `node scripts/test.js --suite morningreview --alias tracker=src/tracker/_reviewNegactivityTracker.ts --alias dayCapture=src/tracker/_reviewNegdayCapture.ts --alias captureStore=src/tracker/_reviewNegcaptureStore.ts --alias gitBaseline=src/tracker/_reviewNeggitBaseline.ts`.
- Existing `daycapture`: 23 passed / 0 failed after changes.
- Typecheck and extension/webview build passed after changes.
- Restart negative control: the pre-recovery working implementation produced **14 tests,
  2 passed, 12 failed, 0 cancelled**. The two ordinary-edit guards passed; all recovery
  regressions failed. Six isolated temporary production copies were then removed.
- Final full run: **632 tests across all 43 suites passed**, including all 14 restart
  tests and all 9 review tests. Typecheck and extension/webview builds passed.
  Capture performance: 20,000 files, worst event-loop gap 44 ms (limit 50 ms).
- After the independent-review fixes and the failed-capture follow-up: **639 tests across
  all 43 suites passed** (restart suite 21/21); typecheck and extension/webview build passed.
- Changes remain uncommitted on `tty-redesign`; no branch history was rewritten.
- No real activity data was imported, cleared, rewritten, or used for the acceptance check.
- No merge, push, publish, VSIX install, or host acceptance was performed.

## Deliberately outside this review's implementation scope

- Historical repair, mirror ownership/schema, AI attribution, and multi-root time
  policy are separate product decisions.
- The original accepted limits remain documented; approved conservative restart recovery
  adds limit 14 and narrows the soft/mixed reset limitation on same-day recovery.
- The untracked plan and `debug.log`, Claude's reports/ledger, and shared logbook
  are preserved. The plan's unchecked boxes are not treated as evidence of unfinished tasks.

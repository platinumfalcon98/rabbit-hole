import { after, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
// @ts-ignore — production alias and negative-control entry point
import { ActivityTracker } from "tracker"
// @ts-ignore — production alias
import { startDay } from "dayCapture"
import { Git } from "../src/tracker/gitBaseline"
import { hashLines } from "../src/tracker/lineLedger"
import { loadYesterday } from "../src/tracker/ledgerStore"
import { normalizePath } from "../src/tracker/pathRules"
import { dateKey } from "../src/tracker/storageService"
import { TempRepo, startOfToday, yesterdayNoon } from "./helpers/gitRepo"

const v = vscode as any
const cleanups: (() => void)[] = []
after(() => cleanups.forEach(f => f()))
function fixture() {
  const r = new TempRepo(); cleanups.push(() => r.cleanup())
  r.write("a.ts", "main\n"); r.write("b.ts", "main-b\n"); r.commitAll("main", yesterdayNoon())
  r.git(["checkout", "-qb", "feature"], yesterdayNoon())
  r.write("a.ts", "feature\n"); r.write("b.ts", "feature-b\n"); r.commitAll("feature", yesterdayNoon())
  r.git(["checkout", "-q", "main"], yesterdayNoon())
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-restart-"))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  const calls: { path: string; linesAdded: number; linesDeleted: number }[] = []
  const storage: any = {
    registerProject() {}, setCurrentProject() {}, closeStaleSessions() {},
    appendSession() {}, appendSessionToDate() {}, updateLanguageTime() {}, updateLanguageTimeForDate() {},
    appendFileActivity(f: any) { calls.push(f) },
  }
  const start = () => {
    v.__useDisk(r.dir)
    const t: any = new ActivityTracker({ subscriptions: [], globalStorageUri: { fsPath: dir } } as any, storage)
    t.start(); return t
  }
  const measure = (t: any, name = "a.ts") => t.runMeasure(v.Uri.file(r.path(name)), "typescript", true)
  const total = (name = "a.ts") => calls.filter(c => c.path === r.path(name)).reduce((s, c) =>
    [s[0] + c.linesAdded, s[1] + c.linesDeleted], [0, 0])
  return { r, dir, start, measure, total, calls }
}

it("a same-day branch switch does not credit unseen files; later live edits count", async () => {
  const h = fixture()
  const first = h.start(); await first.dayDone; first.stop()
  h.r.git(["checkout", "-q", "feature"])
  const second = h.start()
  try {
    await second.dayDone
    await h.measure(second)
    assert.deepStrictEqual(h.total(), [0, 0])
    h.r.write("a.ts", "feature\nlive\n"); await h.measure(second)
    assert.deepStrictEqual(h.total(), [1, 0])
  } finally { second.stop() }
})

it("recorded totals survive recovery, restored tabs, and another ordinary restart", async () => {
  const h = fixture()
  const first = h.start(); await first.dayDone
  h.r.write("a.ts", "main\ncredited\n"); await h.measure(first)
  h.r.commitAll("authored", Date.now()); first.stop()
  h.r.git(["checkout", "-q", "feature"])
  h.r.write("a.ts", "feature\nuncertain-closed-edit\n")
  v.__openDoc(h.r.path("a.ts"), "feature\nuncertain-closed-edit\n")
  const second = h.start()
  try {
    await second.dayDone; await h.measure(second)
    assert.deepStrictEqual(h.total(), [1, 0], "keep already-credited work, skip the ambiguous closed interval")
  } finally { second.stop(); v.workspace.textDocuments.length = 0 }
  h.r.write("a.ts", "feature\nuncertain-closed-edit\nnew-closed-edit\n")
  const third = h.start()
  try {
    await third.dayDone
    assert.deepStrictEqual(h.total(), [2, 0], "no intervening Git operation: closed-period edits count again")
    h.r.write("a.ts", "feature\nuncertain-closed-edit\nnew-closed-edit\nlive\n")
    await h.measure(third)
    assert.deepStrictEqual(h.total(), [3, 0])
  } finally { third.stop() }
})

it("ordinary commits while closed still count against the original morning", async () => {
  const h = fixture(), first = h.start(); await first.dayDone; first.stop()
  h.r.write("a.ts", "main\nauthored\n"); h.r.commitAll("normal commit", Date.now())
  const second = h.start()
  try { await second.dayDone; assert.deepStrictEqual(h.total(), [1, 0]) }
  finally { second.stop() }
})

it("uncommitted edits while closed still count when there was no Git operation", async () => {
  const h = fixture(), first = h.start(); await first.dayDone; first.stop()
  h.r.write("a.ts", "main\nuncommitted\n")
  const second = h.start()
  try { await second.dayDone; assert.deepStrictEqual(h.total(), [1, 0]) }
  finally { second.stop() }
})

it("recovering one repo preserves another repo's captured dirty baseline", async () => {
  const h = fixture(), other = new TempRepo(); cleanups.push(() => other.cleanup())
  other.write("notes.ts", "committed\n"); other.commitAll("base", yesterdayNoon())
  other.write("notes.ts", "committed\nyesterday-dirty\n", yesterdayNoon())
  const jsonPath = path.join(h.dir, "morning-abc.json")
  const run = () => startDay([h.r.dir, other.dir], "today", new Date().setHours(0, 0, 0, 0), { git: new Git(), jsonPath, yesterday: null, note() {} })
  const first = run(); await first.done
  h.r.git(["checkout", "-q", "feature"])
  other.write("notes.ts", "committed\nyesterday-dirty\ntoday\n")
  const second = run(); const out = await second.done
  assert.deepStrictEqual(await second.store.lookup(h.r.path("a.ts")), hashLines("feature\n"))
  assert.deepStrictEqual(await second.store.lookup(other.path("notes.ts")), hashLines("committed\nyesterday-dirty\n"))
  assert.ok(out.changed.includes(other.path("notes.ts")))
})

it("a Git operation this morning prevents yesterday's snapshot from restoring the old branch baseline", async () => {
  const h = fixture()
  h.r.git(["checkout", "-q", "feature"])
  const d = startDay([h.r.dir], "today", new Date().setHours(0, 0, 0, 0), {
    git: new Git(), jsonPath: path.join(h.dir, "morning-def.json"), note() {},
    yesterday: { savedAt: yesterdayNoon() + 3600000, files: new Map([[h.r.path("a.ts"), hashLines("main\nyesterday-dirty\n")]]) },
  })
  await d.done
  assert.deepStrictEqual(await d.store.lookup(h.r.path("a.ts")), hashLines("feature\n"))
})

it("legacy capture and checkpoint metadata recover once without erasing totals", async () => {
  const h = fixture(), first = h.start(); await first.dayDone
  h.r.write("a.ts", "main\ncredited\n"); await h.measure(first)
  h.r.commitAll("authored", Date.now()); first.stop()
  const ledgerDir = path.join(h.dir, "ledger")
  for (const name of fs.readdirSync(ledgerDir).filter(n => n.endsWith(".json"))) {
    const file = path.join(ledgerDir, name), data = JSON.parse(fs.readFileSync(file, "utf8"))
    delete data.gitMarks; delete data.recoveryPending
    for (const f of data.folders ?? []) if (f.repo) delete f.repo.operation
    fs.writeFileSync(file, JSON.stringify(data))
  }
  h.r.git(["checkout", "-q", "feature"])
  const second = h.start(); await second.dayDone; second.stop()
  assert.deepStrictEqual(h.total(), [1, 0])
  h.r.write("a.ts", "feature\nlater\n")
  const third = h.start()
  try { await third.dayDone; assert.deepStrictEqual(h.total(), [2, 0]) }
  finally { third.stop() }
})

it("a failed capture save retries on restart without counting the branch or losing credited work", async () => {
  const h = fixture(), first = h.start(); await first.dayDone
  h.r.write("a.ts", "main\ncredited\n"); await h.measure(first)
  h.r.commitAll("authored", Date.now()); first.stop()
  h.r.git(["checkout", "-q", "feature"])
  const nativeFs = require("fs") as typeof fs
  const rename = nativeFs.renameSync
  nativeFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    if (String(to).startsWith(h.dir) && path.basename(String(to)).startsWith("morning-") && String(to).endsWith(".json")) throw new Error("injected save failure")
    return rename(from, to)
  }) as typeof fs.renameSync
  const second = h.start()
  try { await second.dayDone; assert.deepStrictEqual(h.total(), [1, 0]) }
  finally { nativeFs.renameSync = rename; second.stop() }
  const third = h.start()
  try {
    await third.dayDone; assert.deepStrictEqual(h.total(), [1, 0])
    h.r.write("a.ts", "feature\nlive\n"); await h.measure(third)
    assert.deepStrictEqual(h.total(), [2, 0])
  } finally { third.stop() }
})

it("missing reflog uses conservative recovery, including a reset that keeps the same HEAD", async () => {
  const h = fixture()
  h.r.git(["config", "core.logAllRefUpdates", "false"])
  fs.rmSync(h.r.path(".git/logs"), { recursive: true, force: true })
  const first = h.start(); await first.dayDone
  h.r.write("a.ts", "main\ncredited\n"); await h.measure(first); first.stop()
  h.r.git(["reset", "--hard", "HEAD"])
  const second = h.start()
  try {
    await second.dayDone; assert.deepStrictEqual(h.total(), [1, 0])
    h.r.write("a.ts", "main\nlive\n"); await h.measure(second)
    assert.deepStrictEqual(h.total(), [2, 0])
  } finally { second.stop() }
})

it("linked worktree recovery uses its own Git operations and retains credits under the main path", async () => {
  const h = fixture()
  h.r.write(".gitignore", ".worktrees/\n"); h.r.commitAll("ignore", yesterdayNoon())
  h.r.git(["worktree", "add", "-q", "-b", "worker", ".worktrees/w"], yesterdayNoon())
  const wtFile = h.r.path(".worktrees/w/a.ts")
  const measure = (t: any) => t.runMeasure(v.Uri.file(wtFile), "typescript", true)
  const first = h.start(); await first.dayDone
  fs.writeFileSync(wtFile, "main\ncredited\n"); await measure(first)
  h.r.git(["-C", h.r.path(".worktrees/w"), "add", "-A"])
  h.r.git(["-C", h.r.path(".worktrees/w"), "commit", "-qm", "authored"])
  first.stop()
  h.r.git(["-C", h.r.path(".worktrees/w"), "reset", "--hard", "feature"])
  const second = h.start(); await second.dayDone; second.stop()
  assert.deepStrictEqual(h.total(), [1, 0])
  fs.writeFileSync(wtFile, "feature\nclosed-edit\n")
  const third = h.start()
  try {
    await third.dayDone
    assert.deepStrictEqual(h.total(), [2, 0], "ordinary worktree restart must resume counting")
  } finally { third.stop() }
})

it("repeated resets to the same HEAD are detected even in the same reflog second", async () => {
  const h = fixture(), first = h.start(); await first.dayDone
  h.r.write("a.ts", "main\none\n"); await h.measure(first); first.stop()
  const when = Date.now()
  h.r.git(["reset", "--hard", "HEAD"], when)
  const second = h.start(); await second.dayDone
  h.r.write("a.ts", "main\ntwo\n"); await h.measure(second); second.stop()
  h.r.git(["reset", "--hard", "HEAD"], when)
  const third = h.start()
  try { await third.dayDone; assert.deepStrictEqual(h.total(), [2, 0]) }
  finally { third.stop() }
})

it("an interrupted recovery persists the remaining files for the next restart", async () => {
  const h = fixture(), first = h.start(); await first.dayDone
  h.r.write("a.ts", "main\ncredited\n"); await h.measure(first)
  h.r.write("b.ts", "main-b\ncredited\n"); await h.measure(first, "b.ts")
  h.r.commitAll("authored", Date.now()); first.stop()
  h.r.git(["checkout", "-q", "feature"])
  const second = h.start()
  second.catchUp = async () => {} // simulate closing after only the first recovery measure
  await second.dayDone; await h.measure(second); second.stop()
  const third = h.start()
  try {
    await third.dayDone
    assert.deepStrictEqual(h.total(), [1, 0])
    assert.deepStrictEqual(h.total("b.ts"), [1, 0])
    h.r.write("b.ts", "feature-b\nlive\n"); await h.measure(third, "b.ts")
    assert.deepStrictEqual(h.total("b.ts"), [2, 0])
  } finally { third.stop() }
})

for (const operation of ["reset", "merge"] as const) {
  it(`${operation} while closed is suppressed even though no checkout event was observed`, async () => {
    const h = fixture(), first = h.start(); await first.dayDone; first.stop()
    h.r.git(operation === "reset" ? ["reset", "--hard", "feature"] : ["merge", "--ff-only", "feature"])
    const second = h.start()
    try { await second.dayDone; await h.measure(second); assert.deepStrictEqual(h.total(), [0, 0]) }
    finally { second.stop() }
  })
}

// Review fix 1: captured files that did not change are not catch-up work.
it("a same-day restart does not catch up captured files that did not change", async () => {
  const h = fixture()
  const untracked = [0, 1, 2, 3, 4].map(i => h.r.write(`u${i}.ts`, `untracked ${i}\n`, yesterdayNoon()))
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-plain-"))
  cleanups.push(() => fs.rmSync(plain, { recursive: true, force: true }))
  const plainFiles = [0, 1, 2, 3, 4].map(i => {
    const p = path.join(plain, `p${i}.ts`)
    fs.writeFileSync(p, `plain ${i}\n`); fs.utimesSync(p, yesterdayNoon() / 1000, yesterdayNoon() / 1000)
    return p
  })
  const run = () => startDay([h.r.dir, plain], "today", startOfToday(), { git: new Git(), jsonPath: path.join(h.dir, "morning-ghi.json"), yesterday: null, note() {} })
  const first = run(); await first.done
  for (const p of [...untracked, ...plainFiles]) assert.ok(first.store.has(p), `captured ${p}`)
  const out = await run().done
  assert.deepStrictEqual(out.changed.filter((p: string) => untracked.includes(p) || plainFiles.includes(p)), [])
})

// Review fix 2(a): a recovery still pending at midnight stays pending.
it("a recovery still pending when midnight passes in-session is suppressed on the new day", async () => {
  const h = fixture(), first = h.start(); await first.dayDone
  h.r.write("a.ts", "main\ncredited\n"); await h.measure(first)
  h.r.commitAll("authored", Date.now()); first.stop()
  h.r.git(["checkout", "-q", "feature"])
  const second = h.start()
  second.catchUp = async () => {} // midnight arrives before the recovery measure
  try {
    await second.dayDone
    assert.ok(second.recoveryPending.has(normalizePath(h.r.path("a.ts"))))
    const yesterday = dateKey(new Date(startOfToday() - 1))
    second.dayKey = yesterday; second.ledger.day = yesterday // midnight passes in-session
    await h.measure(second)
    assert.deepStrictEqual(h.total(), [1, 0], "the branch switch must not be credited to the new day")
    h.r.write("a.ts", "feature\nlive\n"); await h.measure(second)
    assert.deepStrictEqual(h.total(), [2, 0])
  } finally { second.stop() }
})

// Review fix 2(b): a pending path's stale content is not folded into tomorrow.
it("yesterday's snapshot leaves out paths whose recovery was still pending", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-yday-"))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  const pending = path.join(dir, "Proj", "Pending.ts"), settled = path.join(dir, "Proj", "settled.ts")
  const file = path.join(dir, "yesterday-abc.json")
  const entry = (last: number[]) => ({ base: null, last, credited: { added: 0, deleted: 0 }, edited: false })
  fs.writeFileSync(file, JSON.stringify({
    version: 1, day: "yday",
    files: { [pending]: entry([1]), [settled]: entry([2]) },
    recoveryPending: [normalizePath(pending)],
  }))
  assert.deepStrictEqual([...loadYesterday(file, "yday")!.files.keys()], [settled])
})

// Review fix 3: a recovery recapture never invents an empty morning.
it("a tracked file deleted while closed around a Git operation is unknown, so restoring it credits nothing", async () => {
  const h = fixture(), first = h.start(); await first.dayDone; first.stop()
  h.r.git(["checkout", "-q", "-b", "other"])
  fs.rmSync(h.r.path("a.ts"))
  const second = h.start()
  try {
    await second.dayDone
    assert.strictEqual(await second.day.store.lookup(h.r.path("a.ts")), "unknown")
    h.r.git(["restore", "a.ts"]); await h.measure(second)
    assert.deepStrictEqual(h.total(), [0, 0])
  } finally { second.stop() }
})

// Review fix 4: a fresh capture with no reflog is uncertain too.
it("a missing capture and no reflog still recover restored entries conservatively", async () => {
  const h = fixture()
  h.r.git(["config", "core.logAllRefUpdates", "false"])
  fs.rmSync(h.r.path(".git/logs"), { recursive: true, force: true })
  const first = h.start(); await first.dayDone
  h.r.write("a.ts", "main\ncredited\n"); await h.measure(first); first.stop()
  const ledgerDir = path.join(h.dir, "ledger")
  for (const name of fs.readdirSync(ledgerDir)) if (/^morning-.*\.json$/.test(name)) fs.rmSync(path.join(ledgerDir, name))
  h.r.git(["reset", "--hard", "feature"])
  const second = h.start()
  try {
    await second.dayDone; await h.measure(second)
    assert.deepStrictEqual(h.total(), [1, 0], "the closed-period reset must not be credited")
    h.r.write("a.ts", "feature\nlive\n"); await h.measure(second)
    assert.deepStrictEqual(h.total(), [2, 0])
  } finally { second.stop() }
})

// Review follow-up: a fresh capture that fails reports every folder as uncertain.
for (const failure of ["writer", "capture"] as const) {
  it(`a fresh capture that fails (${failure}) still recovers restored entries after a closed-period branch switch`, async () => {
    const h = fixture(), first = h.start(); await first.dayDone
    h.r.write("a.ts", "main\ncredited\n"); await h.measure(first)
    h.r.commitAll("authored", Date.now()); first.stop()
    const ledgerDir = path.join(h.dir, "ledger")
    for (const name of fs.readdirSync(ledgerDir)) if (/^morning-.*\.json$/.test(name)) fs.rmSync(path.join(ledgerDir, name))
    h.r.git(["checkout", "-q", "feature"])
    h.r.write("u.ts", "untracked\n", yesterdayNoon()) // gives the capture something to hash
    const nativeFs = require("fs") as typeof fs
    const open = nativeFs.openSync, write = nativeFs.writeSync
    if (failure === "writer") {
      nativeFs.openSync = ((p: fs.PathLike, ...rest: any[]) => {
        if (String(p).startsWith(h.dir) && String(p).endsWith(".bin")) throw new Error("injected writer failure")
        return (open as any)(p, ...rest)
      }) as typeof fs.openSync
    } else {
      nativeFs.writeSync = (() => { throw new Error("injected ENOSPC") }) as unknown as typeof fs.writeSync
    }
    let second: any
    try { second = h.start(); await second.dayDone }
    finally { nativeFs.openSync = open; nativeFs.writeSync = write }
    try {
      await h.measure(second)
      assert.deepStrictEqual(h.total(), [1, 0], "the closed-period branch switch must not be credited")
    } finally { second.stop() }
  })
}

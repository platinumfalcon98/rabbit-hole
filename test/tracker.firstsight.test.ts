import { after, before, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/tracker/activityTracker.ts
import { ActivityTracker } from "tracker"
// @ts-ignore — esbuild alias to src/tracker/lineNotes.ts
import { lineNotes } from "lineNotes"
import { TempRepo, yesterdayNoon } from "./helpers/gitRepo"

const v = vscode as any
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const DEBOUNCE_WAIT = 2400
const cleanups: (() => void)[] = []
after(() => cleanups.forEach(f => f()))

// An independent multiset diff — deliberately not lineLedger — so a ledger bug
// cannot hide behind a test that shares its arithmetic.
function expected(before: string, after: string): { added: number; deleted: number } {
  const lines = (t: string) => { const l = t.replace(/\r/g, "").split("\n"); if (l[l.length - 1] === "") l.pop(); return t ? l : [] }
  const bag = new Map<string, number>()
  for (const l of lines(before)) bag.set(l, (bag.get(l) ?? 0) + 1)
  let added = 0
  for (const l of lines(after)) { const n = bag.get(l) ?? 0; if (n > 0) bag.set(l, n - 1); else added++ }
  let deleted = 0
  for (const n of bag.values()) deleted += n
  return { added, deleted }
}

function harness(repoDir: string) {
  const calls: { path: string; added: number; deleted: number }[] = []
  const storage: any = {
    registerProject: () => {}, setCurrentProject: () => {}, closeStaleSessions: () => {},
    appendSession: () => {}, appendSessionToDate: () => {}, updateLanguageTime: () => {}, updateLanguageTimeForDate: () => {},
    appendFileActivity: (f: any) => calls.push({ path: f.path, added: f.linesAdded, deleted: f.linesDeleted }),
  }
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-fs-"))
  cleanups.push(() => fs.rmSync(storageDir, { recursive: true, force: true }))
  v.__useDisk(repoDir)
  const make = () => {
    const t = new ActivityTracker({ subscriptions: [], globalStorageUri: { fsPath: storageDir } } as any, storage)
    t.start()
    return t
  }
  const total = (p: string) => calls.filter(c => c.path === p).reduce((s, c) => ({ added: s.added + c.added, deleted: s.deleted + c.deleted }), { added: 0, deleted: 0 })
  return { calls, make, total, storageDir }
}

function newRepo() { const r = new TempRepo(); cleanups.push(() => r.cleanup()); return r }
const edit = async (p: string, content: string) => { fs.writeFileSync(p, content); v.__fireChange(p); await sleep(DEBOUNCE_WAIT) }

describe("the 2026-10-06 bug: one on-disk edit to an unopened file", () => {
  const r = newRepo()
  const before0 = "one\ntwo\nthree\n"
  const after0 = "one\nTWO\nthree\nfour\nfive\n"
  let h: ReturnType<typeof harness>
  before(async () => {
    r.write("src/a.ts", before0); r.commitAll("y", yesterdayNoon()); r.write("src/a.ts", before0, yesterdayNoon())
    h = harness(r.dir)
    const t: any = h.make()
    await t.dayDone
    await edit(r.path("src/a.ts"), after0)
    t.stop()
  })
  it("credits the full diff against the morning content", () =>
    assert.deepStrictEqual(h.total(r.path("src/a.ts")), expected(before0, after0)))
})

describe("replay of 2026-10-06's pattern", () => {
  const r = newRepo()
  const files: Record<string, [string, string[]]> = {}
  for (let i = 0; i < 8; i++) files[`src/once${i}.ts`] = [Array.from({ length: 10 + i }, (_, k) => `l${k}`).join("\n") + "\n", []]
  for (let i = 0; i < 8; i++) files[`src/once${i}.ts`][1] = [files[`src/once${i}.ts`][0].replace("l3\n", "changed\nadded\n")]
  files["src/twice.ts"] = ["a\nb\nc\n", ["a\nB\nc\n", "a\nB\nc\nd\n", "x\nB\nc\nd\ne\n"]]
  files["src/thrice.ts"] = ["1\n2\n3\n4\n", ["1\n3\n4\n", "0\n1\n3\n4\n", "0\n1\n3\n4\n5\n6\n"]]
  files["NOTES.md"] = ["# notes\nold\n", ["# notes\nnew\nmore\n"]]   // gitignored, like CLAUDE.md
  let h: ReturnType<typeof harness>
  before(async () => {
    r.write(".gitignore", "NOTES.md\n")
    for (const [rel, [start]] of Object.entries(files)) r.write(rel, start)
    r.commitAll("y", yesterdayNoon())
    for (const [rel, [start]] of Object.entries(files)) r.write(rel, start, yesterdayNoon())
    h = harness(r.dir)
    const t: any = h.make()
    await t.dayDone
    for (const [rel, [, edits]] of Object.entries(files)) for (const e of edits) { fs.writeFileSync(r.path(rel), e); v.__fireChange(r.path(rel)) ; await sleep(50) }
    await sleep(DEBOUNCE_WAIT)
    for (const [rel, [, edits]] of Object.entries(files)) if (edits.length > 1) for (const e of edits) { fs.writeFileSync(r.path(rel), e); v.__fireChange(r.path(rel)); await sleep(DEBOUNCE_WAIT) }
    t.stop()
  })
  it("every file's recorded total equals an independent diff against its morning content", () => {
    for (const [rel, [start, edits]] of Object.entries(files))
      assert.deepStrictEqual(h.total(r.path(rel)), expected(start, edits[edits.length - 1]), rel)
  })
})

describe("catch-up at start-up", () => {
  const r = newRepo()
  let h: ReturnType<typeof harness>
  let activity = 0
  before(async () => {
    r.write("a.ts", "1\n2\n"); r.write("b.ts", "b\n"); r.write("c.ts", "c1\nc2\nc3\n"); r.write("e.ts", "e\n")
    r.commitAll("y", yesterdayNoon())
    r.git(["checkout", "-q", "-b", "feat"], yesterdayNoon()); r.write("e.ts", "e\nfeature\n"); r.commitAll("f", yesterdayNoon())
    r.git(["checkout", "-q", "main"], yesterdayNoon())
    for (const f of ["a.ts", "b.ts", "c.ts", "e.ts"]) fs.utimesSync(r.path(f), yesterdayNoon() / 1000, yesterdayNoon() / 1000)
    // VS Code closed, today:
    r.git(["checkout", "-q", "feat"], Date.now())        // branch switch: not authorship
    r.write("a.ts", "1\n2\n3\n")                          // edit
    r.write("b.ts", "b\nb2\n"); r.commitAll("t", Date.now()) // committed today
    fs.rmSync(r.path("c.ts"))                             // delete
    r.write("d.ts", "d1\nd2\n")                           // new untracked
    h = harness(r.dir)
    const proto = (ActivityTracker as any).prototype
    const orig = proto.onActivity
    proto.onActivity = function (this: any) { activity++; return orig.call(this) }
    const t: any = h.make()
    activity = 0
    await t.dayDone
    proto.onActivity = orig
    t.stop()
  })
  it("closed-period edits and today's commits count", () => {
    assert.deepStrictEqual(h.total(r.path("a.ts")), { added: 1, deleted: 0 })
    assert.deepStrictEqual(h.total(r.path("b.ts")), { added: 1, deleted: 0 })
  })
  it("a closed-period delete is credited", () => assert.deepStrictEqual(h.total(r.path("c.ts")), { added: 0, deleted: 3 }))
  it("a new untracked file counts every line", () => assert.deepStrictEqual(h.total(r.path("d.ts")), { added: 2, deleted: 0 }))
  // Regression guard (the pre-task tracker also scores 0 here); it fails if catch-up credits a checkout.
  it("a closed-period branch switch is not counted", () => assert.deepStrictEqual(h.total(r.path("e.ts")), { added: 0, deleted: 0 }))
  // Regression guard against the old tracker, which had no catch-up; negative control (b) is what discriminates it.
  it("catch-up adds no activity", () => assert.strictEqual(activity, 0))
})

describe("a repo cloned today counts 0", () => {
  const src = newRepo()
  const dst = new TempRepo(false); cleanups.push(() => dst.cleanup())
  let h: ReturnType<typeof harness>
  before(async () => {
    src.write("a.ts", "1\n2\n"); src.commitAll("y", yesterdayNoon())
    dst.git(["clone", "-q", src.dir, "."], Date.now())
    h = harness(dst.dir)
    const t: any = h.make(); await t.dayDone
    await edit(dst.path("a.ts"), "1\n2\n")   // first sighting, unchanged since the clone
    t.stop()
  })
  // Regression guard (the pre-task tracker also credits nothing); it fails if a fresh clone is read as new files.
  it("nothing is credited", () => assert.deepStrictEqual(h.calls, []))
})

describe("restart mid-day", () => {
  const r = newRepo()
  let h: ReturnType<typeof harness>
  before(async () => {
    r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon()); fs.utimesSync(r.path("a.ts"), yesterdayNoon() / 1000, yesterdayNoon() / 1000)
    h = harness(r.dir)
    const first: any = h.make(); await first.dayDone
    await edit(r.path("a.ts"), "1\n2\n3\n")   // +2 live
    first.stop()
    fs.writeFileSync(r.path("a.ts"), "1\n2\n3\n4\n") // +1 while closed
    const second: any = h.make(); await second.dayDone
    second.stop()
  })
  it("snapshot baselines are kept and the closed-period edit is caught up once", () =>
    assert.deepStrictEqual(h.total(r.path("a.ts")), { added: 3, deleted: 0 }))
})

describe("an open tab restored at start-up", () => {
  const r = newRepo()
  let h: ReturnType<typeof harness>
  before(async () => {
    r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.write("a.ts", "1\n2\n")                 // edited while closed
    h = harness(r.dir)
    v.__openDoc(r.path("a.ts"), "1\n2\n")     // VS Code restores the tab before start()
    const t: any = h.make(); await t.dayDone; await sleep(100)
    t.stop()
    v.workspace.textDocuments.length = 0 // later suites must not inherit the open tab
  })
  it("its closed-period edit is credited, not primed away", () =>
    assert.deepStrictEqual(h.total(r.path("a.ts")), { added: 1, deleted: 0 }))
})

describe("midnight while running", () => {
  const r = newRepo()
  let oldStore: any, newStore: any
  before(async () => {
    r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    const h = harness(r.dir)
    const t: any = h.make(); await t.dayDone
    oldStore = t.day.store
    let oldLookups = 0
    const lookup = oldStore.lookup.bind(oldStore)
    oldStore.lookup = (p: string) => { oldLookups++; return lookup(p) }
    t.checkDay(new Date(Date.now() + 86_400_000))
    newStore = t.day.store
    await t.day.done
    await edit(r.path("a.ts"), "1\n2\n")
    t.stop()
    lookupsAfterMidnight = oldLookups
  })
  let lookupsAfterMidnight = -1
  it("a new capture replaces the store", () => assert.notStrictEqual(oldStore, newStore))
  it("yesterday's store is never consulted after midnight", () => assert.strictEqual(lookupsAfterMidnight, 0))
})

describe("fallbacks", () => {
  it("a non-git folder is scanned and its first edit is exact", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-plainfs-")); cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }))
    fs.writeFileSync(path.join(d, "a.ts"), "1\n"); fs.utimesSync(path.join(d, "a.ts"), yesterdayNoon() / 1000, yesterdayNoon() / 1000)
    const h = harness(d)
    const t: any = h.make(); await t.dayDone
    await edit(path.join(d, "a.ts"), "1\n2\n")
    t.stop()
    assert.deepStrictEqual(h.total(path.join(d, "a.ts")), { added: 1, deleted: 0 })
  })
  it("git unavailable (bad git path): scanned, with a note", async () => {
    const r = newRepo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon()); fs.utimesSync(r.path("a.ts"), yesterdayNoon() / 1000, yesterdayNoon() / 1000)
    v.__setGitPath(path.join(os.tmpdir(), "no-such-git.exe"))
    const h = harness(r.dir)
    const t: any = h.make(); await t.dayDone
    await edit(r.path("a.ts"), "1\n2\n")
    t.stop()
    v.__setGitPath(undefined)
    assert.deepStrictEqual(h.total(r.path("a.ts")), { added: 1, deleted: 0 })
    assert.ok(lineNotes.current(t.dayKey).some((n: string) => n.startsWith(`git unavailable in ${r.dir}`)))
  })
  // Regression guard (the pre-task tracker also passes); it fails if the morning lookup scores a CRLF/LF flip as a rewrite.
  it("a CRLF working file against an LF blob scores 0/0, and an edit scores exactly", async () => {
    const r = newRepo(); r.git(["config", "core.autocrlf", "true"])
    r.write("a.ts", "x\ny\n"); r.commitAll("y", yesterdayNoon())
    fs.writeFileSync(r.path("a.ts"), "x\r\ny\r\n"); fs.utimesSync(r.path("a.ts"), yesterdayNoon() / 1000, yesterdayNoon() / 1000)
    const h = harness(r.dir)
    const t: any = h.make(); await t.dayDone
    await edit(r.path("a.ts"), "x\r\ny\r\n")
    assert.deepStrictEqual(h.calls, [])
    await edit(r.path("a.ts"), "x\r\nY\r\n")
    t.stop()
    assert.deepStrictEqual(h.total(r.path("a.ts")), { added: 1, deleted: 1 })
  })
})

describe("measures of one file never overlap", () => {
  it("a second measure starts only after the first finishes", async () => {
    const r = newRepo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    const h = harness(r.dir)
    const t: any = h.make(); await t.dayDone
    const order: string[] = []
    const measure = t.measure.bind(t)
    t.measure = async (...args: any[]) => { order.push("in"); await sleep(50); await measure(...args); order.push("out") }
    const uri = v.Uri.file(r.path("a.ts"))
    await Promise.all([t.runMeasure(uri, "typescript"), t.runMeasure(uri, "typescript")])
    t.stop()
    assert.deepStrictEqual(order, ["in", "out", "in", "out"])
  })
})

describe("opening a file inside a git-op window", () => {
  const r = newRepo()
  let h: ReturnType<typeof harness>
  before(async () => {
    r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon()); fs.utimesSync(r.path("a.ts"), yesterdayNoon() / 1000, yesterdayNoon() / 1000)
    h = harness(r.dir)
    const t: any = h.make(); await t.dayDone
    v.__fireChange(path.join(r.dir, ".git", "HEAD"))   // a checkout, with VS Code open
    fs.writeFileSync(r.path("a.ts"), "1\n2\n")          // the branch's content
    v.__openDoc(r.path("a.ts"), "1\n2\n")              // opened before the watcher's measure runs
    await sleep(300)
    t.stop()
    v.workspace.textDocuments.length = 0
  })
  it("the branch diff is not credited as authorship", () => assert.deepStrictEqual(h.calls, []))
})

describe("stop() before the catch-up runs", () => {
  const r = newRepo()
  let h: ReturnType<typeof harness>
  let atStop = -1
  before(async () => {
    r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.write("a.ts", "1\n2\n")                 // edited while closed: catch-up would credit it
    h = harness(r.dir)
    const t: any = h.make()
    t.stop()                                   // before dayDone resolves
    atStop = h.calls.length
    await t.dayDone
    await sleep(100)
  })
  it("nothing is credited after stop", () => assert.strictEqual(h.calls.length, atStop))
})

describe("a document outside the workspace, opened during the capture", () => {
  const r = newRepo()
  let h: ReturnType<typeof harness>
  let outside = ""
  before(async () => {
    r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-outside-")); cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }))
    outside = path.join(d, "b.ts")
    fs.writeFileSync(outside, "x\n")
    h = harness(r.dir)
    const t: any = h.make()
    // Hold the capture open until the edit has been measured.
    let release = () => {}
    const gate = new Promise<void>(res => { release = res })
    const day = t.day
    t.day = { store: day.store, done: gate.then(() => day.done) }
    const doc = v.__openDoc(outside, "x\n")
    v.__editDoc(doc, "x\ny\n", true)           // typed
    await sleep(DEBOUNCE_WAIT)
    release()
    await t.dayDone
    t.stop()
    v.workspace.textDocuments.length = 0
  })
  it("is primed at once, so its first typed edit counts", () =>
    assert.deepStrictEqual(h.total(outside), { added: 1, deleted: 0 }))
})

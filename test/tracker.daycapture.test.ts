import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawnSync } from "node:child_process"
// @ts-ignore — esbuild alias to src/tracker/dayCapture.ts
import { startDay } from "dayCapture"
// @ts-ignore — esbuild alias to src/tracker/gitBaseline.ts
import { Git } from "gitBaseline"
// @ts-ignore — esbuild alias to src/tracker/captureStore.ts
import { captureFile, loadCapture } from "captureStore"
// @ts-ignore — esbuild alias to src/tracker/lineLedger.ts
import { hashLines } from "ledger"
import { TempRepo, startOfToday, yesterdayNoon } from "./helpers/gitRepo"

const h = (t: string) => hashLines(t)
const MID = startOfToday()
const DAY = "today"
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-dc-"))
const repos: TempRepo[] = []
const repo = () => { const r = new TempRepo(); repos.push(r); return r }
after(() => { repos.forEach(r => r.cleanup()); fs.rmSync(STORE, { recursive: true, force: true }) })
let n = 0
function run(roots: string[], extra: Partial<any> = {}) {
  const notes: string[] = []
  const jsonPath = extra.jsonPath ?? captureFile(STORE, [`k${n++}`])
  const day = startDay(roots, DAY, MID, { git: new Git(), jsonPath, yesterday: null, note: (t: string) => notes.push(t), ...extra })
  return { day, notes, jsonPath }
}

describe("a git folder", () => {
  it("captures what git cannot vouch for and leaves clean files to git", async () => {
    const r = repo()
    r.write(".gitignore", "docs/\nnode_modules/\n")
    r.write("a.ts", "1\n"); r.write("t.ts", "1\n"); r.write("clean.ts", "c\n"); r.commitAll("y", yesterdayNoon())
    r.write("a.ts", "1\n2\n", yesterdayNoon())        // dirty at midnight → exact
    r.write("t.ts", "1\n2\n3\n")                      // tracked, edited today → useB
    r.write("new.ts", "n\n")                          // untracked, created today → empty
    r.write("docs/notes.md", "d\n", yesterdayNoon())  // ignored, before midnight → exact
    r.write("node_modules/x/i.js", "x\n", yesterdayNoon()) // excluded → never captured
    const { day } = run([r.dir])
    const out = await day.done
    const idx = day.store.index()
    assert.deepStrictEqual(await day.store.lookup(r.path("a.ts")), h("1\n2\n"))
    assert.strictEqual(idx[r.path("t.ts")], "useB")
    assert.deepStrictEqual(await day.store.lookup(r.path("t.ts")), h("1\n"))
    assert.strictEqual(idx[r.path("new.ts")], "empty")
    assert.deepStrictEqual(await day.store.lookup(r.path("docs/notes.md")), h("d\n"))
    assert.strictEqual(idx[r.path("node_modules/x/i.js")], undefined)
    assert.deepStrictEqual(await day.store.lookup(r.path("clean.ts")), h("c\n"))
    assert.strictEqual(idx[r.path("clean.ts")], undefined)
    assert.ok(out.saved)
    // new.ts by creation time; a.ts and t.ts because git diff against B lists them
    assert.deepStrictEqual(out.changed.map((p: string) => path.basename(p)).sort(), ["a.ts", "new.ts", "t.ts"])
  })
  it("worktree files are not captured", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.write(".worktrees/w1/a.ts", "w\n", yesterdayNoon())
    const { day } = run([r.dir]); await day.done
    assert.strictEqual(day.store.index()[r.path(".worktrees/w1/a.ts")], undefined)
  })
  it("a nested repo is captured with its own baseline", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    const inner = r.path("sub")
    fs.mkdirSync(inner)
    const g = (args: string[], when: number) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: inner, env: { ...process.env, GIT_AUTHOR_DATE: `${Math.floor(when / 1000)} +0000`, GIT_COMMITTER_DATE: `${Math.floor(when / 1000)} +0000` } })
    g(["init", "-q", "-b", "main"], yesterdayNoon())
    fs.writeFileSync(path.join(inner, "s.ts"), "s\n"); g(["add", "-A"], yesterdayNoon()); g(["commit", "-q", "-m", "s"], yesterdayNoon())
    fs.writeFileSync(path.join(inner, "d.ts"), "d\n"); fs.utimesSync(path.join(inner, "d.ts"), yesterdayNoon() / 1000, yesterdayNoon() / 1000)
    const { day } = run([r.dir]); await day.done
    assert.deepStrictEqual(await day.store.lookup(path.join(inner, "s.ts")), h("s\n"))
    assert.deepStrictEqual(await day.store.lookup(path.join(inner, "d.ts")), h("d\n"))
  })
  it("folder inside a larger repo: only its own files are captured and caught up", async () => {
    const r = repo(); r.write("pkg/app/a.ts", "1\n"); r.write("other/b.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.write("pkg/app/a.ts", "2\n"); r.write("other/b.ts", "2\n")
    const { day } = run([r.path("pkg/app")])
    const out = await day.done
    assert.deepStrictEqual(Object.keys(day.store.index()).map(p => path.basename(p)), ["a.ts"])
    assert.deepStrictEqual(out.changed.map((p: string) => path.basename(p)), ["a.ts"])
    assert.deepStrictEqual(await day.store.lookup(r.path("pkg/app/a.ts")), h("1\n"))
  })
  it("two folders sharing a repo: one status, each folder captures its own files", async () => {
    const r = repo(); r.write("x/a.ts", "1\n"); r.write("y/b.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.write("x/a.ts", "2\n", yesterdayNoon()); r.write("y/b.ts", "2\n", yesterdayNoon())
    let statuses = 0
    const git = new Git()
    const status = git.status.bind(git)
    git.status = (top: string) => { statuses++; return status(top) }
    const { day } = run([r.path("x"), r.path("y")], { git })
    await day.done
    assert.strictEqual(statuses, 1)
    assert.deepStrictEqual(await day.store.lookup(r.path("x/a.ts")), h("2\n"))
    assert.deepStrictEqual(await day.store.lookup(r.path("y/b.ts")), h("2\n"))
  })
  it("two folders in separate repos: the second folder's lookups do not wait for the first folder's capture", async () => {
    const r1 = repo(); r1.write("a.ts", "1\n"); r1.commitAll("y", yesterdayNoon())
    const r2 = repo(); r2.write("c.ts", "c\n"); r2.commitAll("y", yesterdayNoon())
    // hold the first folder's capture open at its final git call
    let release = () => {}
    const held = new Promise<void>(r => { release = r })
    const git = new Git()
    const diffNames = git.diffNames.bind(git)
    git.diffNames = async (top: string, rev: string) => {
      if (path.basename(top) === path.basename(r1.dir)) await held
      return diffNames(top, rev)
    }
    const { day } = run([r1.dir, r2.dir], { git })
    try {
      const timeout = new Promise<"timed out">(r => setTimeout(() => r("timed out"), 5_000))
      const got = await Promise.race([day.store.lookup(r2.path("c.ts")), timeout])
      assert.deepStrictEqual(got, h("c\n"))
    } finally {
      release()
      await day.done
    }
  })
  it("repo with no commits: untracked files captured, nothing from git", async () => {
    const r = repo(); r.write("a.ts", "1\n", yesterdayNoon()); r.write("b.ts", "2\n")
    const { day } = run([r.dir]); await day.done
    assert.deepStrictEqual(await day.store.lookup(r.path("a.ts")), h("1\n"))
    assert.deepStrictEqual(await day.store.lookup(r.path("b.ts")), [])   // created today
  })
  it("a file over 5 MB is not captured", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.write("big.json", Buffer.alloc(5 * 1024 * 1024 + 1, 0x61), yesterdayNoon())
    const { day } = run([r.dir]); await day.done
    assert.strictEqual(day.store.index()[r.path("big.json")], undefined)
  })
})

describe("yesterday's snapshot", () => {
  function snapshotRepo() {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    return r
  }
  it("usable: a file committed this morning is compared against yesterday's last content", async () => {
    const r = snapshotRepo()
    // yesterday evening: uncommitted edit seen by the tracker; this morning: committed, then edited
    r.write("a.ts", "1\n2\n"); r.commitAll("t", Date.now())
    const yesterday = { savedAt: yesterdayNoon() + 3_600_000, files: new Map([[r.path("a.ts"), h("1\nyesterday\n")]]) }
    const { day } = run([r.dir], { yesterday }); await day.done
    assert.deepStrictEqual(await day.store.lookup(r.path("a.ts")), h("1\nyesterday\n"))
  })
  it("unusable when git moved after the snapshot was saved and before midnight", async () => {
    const r = snapshotRepo()
    r.write("a.ts", "1\n2\n"); r.commitAll("late", yesterdayNoon() + 2 * 3_600_000)
    const yesterday = { savedAt: yesterdayNoon() + 3_600_000, files: new Map([[r.path("a.ts"), h("stale\n")]]) }
    const { day } = run([r.dir], { yesterday }); await day.done
    assert.strictEqual(day.store.index()[r.path("a.ts")], undefined)
    assert.deepStrictEqual(await day.store.lookup(r.path("a.ts")), h("1\n2\n"))
  })
  it("existedBefore: an untracked file in the previous capture with a new creation time is unknown", async () => {
    const r = snapshotRepo()
    const jsonPath = captureFile(STORE, [`prev${n++}`])
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    fs.writeFileSync(jsonPath, JSON.stringify({ version: 1, day: "yesterday", bin: "x.bin", folders: [], index: { [r.path("notes.md")]: "unknown" } }))
    r.write("notes.md", "rewritten\n")
    const { day } = run([r.dir], { jsonPath }); await day.done
    assert.strictEqual(day.store.index()[r.path("notes.md")], "unknown")
  })
})

describe("caps, failures and plain folders", () => {
  it("over the cap: the folder is partial, with a note, and uncaptured listed files stay unknown", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    for (const f of ["u1.ts", "u2.ts", "u3.ts", "u4.ts"]) r.write(f, "u\n", yesterdayNoon())
    const { day, notes, jsonPath } = run([r.dir], { cap: 2 }); await day.done
    assert.strictEqual(Object.keys(day.store.index()).length, 2)
    assert.ok(notes.some(t => t.startsWith(`line counts in ${r.dir} start from each file's first edit`)), notes.join("\n"))
    const missing = ["u1.ts", "u2.ts", "u3.ts", "u4.ts"].find(f => !day.store.has(r.path(f)))!
    assert.strictEqual(await day.store.lookup(r.path(missing)), "unknown")
    assert.strictEqual((loadCapture(jsonPath, DAY) as any).capture.folders[0].partial, true)
  })
  it("git unavailable: the folder is scanned like a plain folder, with a note", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    fs.utimesSync(r.path("a.ts"), yesterdayNoon() / 1000, yesterdayNoon() / 1000) // otherwise a plain scan sees a file created today
    const { day, notes } = run([r.dir], { git: new Git(path.join(os.tmpdir(), "no-such-git.exe")) }); await day.done
    assert.deepStrictEqual(await day.store.lookup(r.path("a.ts")), h("1\n"))
    assert.ok(notes.some(t => t.startsWith(`git unavailable in ${r.dir}`)), notes.join("\n"))
  })
  it("a plain folder: every countable file captured, excluded ones skipped", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-plain-"))
    fs.mkdirSync(path.join(d, "dist")); fs.writeFileSync(path.join(d, "dist", "o.js"), "o\n")
    fs.writeFileSync(path.join(d, "a.ts"), "a\n"); fs.writeFileSync(path.join(d, "img.png"), "p")
    const { day } = run([d]); await day.done
    assert.deepStrictEqual(Object.keys(day.store.index()).map(p => path.basename(p)), ["a.ts"])
    fs.rmSync(d, { recursive: true, force: true })
  })
  it("storage that cannot be written: nothing captured, a note, and startDay does not throw", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    const blocker = path.join(STORE, `blocker${n++}`)
    fs.writeFileSync(blocker, "a file where the ledger directory should be")
    const { day, notes } = run([r.dir], { jsonPath: path.join(blocker, "ledger", "morning-x.json") })
    const out = await day.done
    assert.strictEqual(out.saved, false)
    assert.ok(notes.some(t => t.startsWith("line capture failed: ")), notes.join("\n"))
    assert.strictEqual(await day.store.lookup(r.path("a.ts")), "unknown")
  })
  it("a missing folder captures nothing and does not throw", async () => {
    const { day } = run([path.join(os.tmpdir(), "rabbithole-nope-" + Date.now())])
    const out = await day.done
    assert.deepStrictEqual(out.changed, [])
  })
})

describe("fix round 1", () => {
  const setDirTime = (dir: string, ms: number) => fs.utimesSync(dir, ms / 1000, ms / 1000)
  it("a tracked file deleted before midnight (parent unchanged since) is empty, not B", async () => {
    const r = repo(); r.write("sub/d.ts", "1\n2\n"); r.write("sub/keep.ts", "k\n"); r.commitAll("y", yesterdayNoon())
    fs.unlinkSync(r.path("sub/d.ts")); setDirTime(r.path("sub"), yesterdayNoon())
    const { day } = run([r.dir]); await day.done
    assert.strictEqual(day.store.index()[r.path("sub/d.ts")], "empty")
    assert.deepStrictEqual(await day.store.lookup(r.path("sub/d.ts")), [])
  })
  // Regression guard for the other branch: a deletion today keeps B.
  it("a tracked file deleted today (parent changed today) is B", async () => {
    const r = repo(); r.write("sub/d.ts", "1\n2\n"); r.write("sub/keep.ts", "k\n"); r.commitAll("y", yesterdayNoon())
    fs.unlinkSync(r.path("sub/d.ts"))
    const { day } = run([r.dir]); await day.done
    assert.strictEqual(day.store.index()[r.path("sub/d.ts")], "useB")
    assert.deepStrictEqual(await day.store.lookup(r.path("sub/d.ts")), h("1\n2\n"))
  })
  it("an untracked file created today that is in an unusable snapshot is unknown, not empty", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.write("a.ts", "1\n2\n"); r.commitAll("late", yesterdayNoon() + 2 * 3_600_000) // git moved in the gap
    r.write("n.md", "today\n")
    const yesterday = { savedAt: yesterdayNoon() + 3_600_000, files: new Map([[r.path("n.md"), h("old\n")]]) }
    const { day } = run([r.dir], { yesterday }); await day.done
    assert.strictEqual(day.store.index()[r.path("n.md")], "unknown")
  })
  it("a linked worktree that is not gitignored is not a nested repo; its files resolve through its own B", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.write("c.ts", "c\n"); r.commitAll("y", yesterdayNoon())
    r.git(["worktree", "add", "-q", "-b", "w1", ".worktrees/w1"])
    r.write(".worktrees/w1/a.ts", "1\nwt\n")
    const { day, jsonPath } = run([r.dir]); await day.done
    const folders = (loadCapture(jsonPath, DAY) as any).capture.folders.map((f: any) => path.basename(f.root))
    assert.deepStrictEqual(folders, [path.basename(r.dir)])
    assert.deepStrictEqual(await day.store.lookup(r.path(".worktrees/w1/c.ts")), h("c\n"))
    assert.deepStrictEqual(await day.store.lookup(r.path(".worktrees/w1/a.ts")), h("1\n")) // dirty but a worktree: B
  })
  it("the cap reached inside a nested repo marks that folder partial, with a note naming it", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    const inner = r.path("sub")
    fs.mkdirSync(inner)
    const g = (args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: inner })
    g(["init", "-q", "-b", "main"])
    for (const f of ["u1.ts", "u2.ts", "u3.ts", "u4.ts"]) { const p = path.join(inner, f); fs.writeFileSync(p, "u\n"); fs.utimesSync(p, yesterdayNoon() / 1000, yesterdayNoon() / 1000) }
    const { day, notes, jsonPath } = run([r.dir], { cap: 2 }); await day.done
    const entry = (loadCapture(jsonPath, DAY) as any).capture.folders.find((f: any) => path.basename(f.root) === "sub")
    assert.strictEqual(entry?.partial, true)
    assert.ok(notes.some(t => t.startsWith(`line counts in ${inner} start from each file's first edit`)), notes.join("\n"))
  })
  it("a file dirty at midnight and restored this morning is caught up from the snapshot", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    const yesterday = { savedAt: yesterdayNoon() + 3_600_000, files: new Map([[r.path("a.ts"), h("1\nyesterday\n")]]) }
    const { day } = run([r.dir], { yesterday }); const out = await day.done
    assert.deepStrictEqual(await day.store.lookup(r.path("a.ts")), h("1\nyesterday\n"))
    assert.ok(out.changed.some((p: string) => path.basename(p) === "a.ts"), out.changed.join("\n"))
  })
})

describe("reloading today's capture", () => {
  it("a second start the same day loads it instead of retaking, and keeps B", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.write("a.ts", "1\n2\n", yesterdayNoon())
    const first = run([r.dir]); await first.day.done
    const bin = (loadCapture(first.jsonPath, DAY) as any).capture.bin
    r.write("b.ts", "b\n"); r.commitAll("t", Date.now())
    const second = run([r.dir], { jsonPath: first.jsonPath }); const out = await second.day.done
    assert.strictEqual((loadCapture(first.jsonPath, DAY) as any).capture.bin, bin)
    assert.deepStrictEqual(await second.day.store.lookup(r.path("a.ts")), h("1\n2\n"))
    assert.deepStrictEqual(await second.day.store.lookup(r.path("b.ts")), [])   // still against the morning B
    assert.ok(out.changed.some((p: string) => path.basename(p) === "b.ts"))
  })
})

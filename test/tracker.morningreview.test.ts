import { after, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
// @ts-ignore — production aliases, including pre-fix negative controls
import { ActivityTracker } from "tracker"
// @ts-ignore — production alias
import { startDay } from "dayCapture"
// @ts-ignore — production alias
import { CaptureWriter, captureFile, loadCapture, saveCapture } from "captureStore"
// @ts-ignore — production alias, including the output-limit negative control
import { Git } from "gitBaseline"
import { hashLines } from "../src/tracker/lineLedger"
import { dateKey } from "../src/tracker/storageService"
import { TempRepo, startOfToday, yesterdayNoon } from "./helpers/gitRepo"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-review-"))
const repos: TempRepo[] = []
after(() => { repos.forEach(r => r.cleanup()); fs.rmSync(dir, { recursive: true, force: true }) })
let serial = 0
const jsonFile = () => captureFile(dir, [`review-${serial++}`])
const repo = () => { const r = new TempRepo(); repos.push(r); return r }
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
function day(r: TempRepo, extra: Record<string, unknown> = {}) {
  return startDay([r.dir], dateKey(new Date()), startOfToday(), {
    git: new Git(), jsonPath: jsonFile(), yesterday: null, note: () => {}, ...extra,
  })
}

it("a failed JSON rename is not reported as a saved capture", async () => {
  const r = repo(); r.write("a.ts", "a\n"); r.commitAll("y", yesterdayNoon())
  const json = jsonFile()
  const git = new Git(), diff = git.diffNames.bind(git)
  git.diffNames = async (top: string, rev: string) => {
    // Writer creation succeeded; only the final JSON rename will fail.
    fs.mkdirSync(json)
    return diff(top, rev)
  }
  const notes: string[] = []
  const d = day(r, { git, jsonPath: json, note: (s: string) => notes.push(s) })
  const result = await d.done
  assert.strictEqual(result.saved, false, "the caller must retain yesterday's recovery snapshot")
  assert.ok(notes.some(n => n.includes("capture") && n.includes("sav")))
})

it("a save does not delete another live capture's bin", () => {
  const json = jsonFile()
  const first = new CaptureWriter(json, "today"), second = new CaptureWriter(json, "today")
  const a = first.add(hashLines("a\n")), b = second.add(hashLines("b\n"))
  first.close(); second.close()
  saveCapture(json, { version: 1, day: "today", bin: first.name, folders: [], index: { a } })
  assert.ok(fs.existsSync(path.join(path.dirname(json), second.name)))
  saveCapture(json, { version: 1, day: "today", bin: second.name, folders: [], index: { b } })
  assert.strictEqual(loadCapture(json, "today").kind, "today")
})

it("a clean file waits for yesterday's snapshot instead of resolving early through B", async () => {
  const r = repo(); r.write("a.ts", "base\n"); r.commitAll("y", yesterdayNoon())
  r.write("a.ts", "base\nyesterday\ntoday\n"); r.commitAll("today", Date.now())
  const blocked = gate(), reached = gate()
  const git = new Git(), diff = git.diffNames.bind(git)
  git.diffNames = async (top: string, rev: string) => { reached.release(); await blocked.promise; return diff(top, rev) }
  const d = day(r, { git, yesterday: { savedAt: yesterdayNoon() + 3600000,
    files: new Map([[r.path("a.ts"), hashLines("base\nyesterday\n")]]) } })
  await reached.promise
  const reading = d.store.lookup(r.path("a.ts"))
  // Let the real lookup run while the capture is still blocked; no race against a sleep.
  const first = await Promise.race([reading.then(() => "resolved"), new Promise<string>(r => setTimeout(() => r("waiting"), 100))])
  blocked.release()
  await d.done
  assert.strictEqual(first, "waiting")
  assert.deepStrictEqual(await reading, hashLines("base\nyesterday\n"))
})

it("catch-up includes committed edits in nested repos, initially and on reload", async () => {
  const r = repo(); r.write("a.ts", "a\n"); r.commitAll("y", yesterdayNoon())
  const nested = r.path("inner"); fs.mkdirSync(nested)
  r.git(["-C", nested, "init", "-q", "-b", "main"])
  const commit = (when: number) => { r.git(["-C", nested, "add", "-A"]); r.git(["-C", nested, "commit", "-qm", "nested"], when) }
  const file = path.join(nested, "n.ts")
  fs.writeFileSync(file, "before\n"); commit(yesterdayNoon())
  fs.writeFileSync(file, "before\nafter\n"); commit(Date.now())
  const jsonPath = jsonFile()
  const first = day(r, { jsonPath }); const out1 = await first.done
  const second = day(r, { jsonPath }); const out2 = await second.done
  assert.ok(out1.changed.includes(file), "initial capture must enumerate each nested repo's diff")
  assert.ok(out2.changed.includes(file), "reload must enumerate nested repos as well")
})

function bareTracker() {
  const calls: any[] = []
  const tracker: any = new ActivityTracker({ subscriptions: [] } as any, {
    appendFileActivity: (f: unknown) => calls.push(f),
  } as any)
  tracker.readText = async () => "yesterday\ntoday\n"
  tracker.isNonAuthored = async () => false
  tracker.resolveProjectForUri = () => "test"
  return { tracker, calls }
}

it("reload discovers untracked, ignored and plain-folder files created while closed", async () => {
  const r = repo(); r.write(".gitignore", "notes/\n"); r.write("a.ts", "a\n"); r.commitAll("y", yesterdayNoon())
  for (const git of [new Git(), null]) {
    const jsonPath = jsonFile()
    const first = day(r, { jsonPath, git }); await first.done
    const files = [r.write(`new-${serial}.ts`, "new\n"), r.write(`notes/new-${serial}.md`, "notes\n")]
    const second = day(r, { jsonPath, git }); const outcome = await second.done
    for (const file of files) {
      assert.ok(outcome.changed.includes(file), `catch-up missed ${file}`)
      assert.deepStrictEqual(await second.store.lookup(file), [])
    }
  }
})

it("capture validation rejects malformed folders and truncated hash data", () => {
  for (const corrupt of [
    (c: any) => { c.folders = [null] },
    (c: any) => { c.index.a = [0, 1000] },
    (c: any) => { c.bin = "../outside.bin" },
  ]) {
    const json = jsonFile(), w = new CaptureWriter(json, "today")
    const a = w.add(hashLines("one\n")); w.close()
    const c: any = { version: 1, day: "today", bin: w.name, folders: [], index: { a } }
    corrupt(c)
    fs.writeFileSync(path.join(dir, "outside.bin"), Buffer.alloc(4))
    fs.writeFileSync(json, JSON.stringify(c))
    assert.strictEqual(loadCapture(json, "today").kind, "stale")
  }
})

it("git output is bounded before parsing blobs, even when a repository object is oversized", async () => {
  const git = new Git(process.execPath)
  await assert.rejects(git.run(dir, ["-e", "process.stdout.write(Buffer.alloc(40 * 1024 * 1024))"]), /output limit/)
})

it("a measurement begun before midnight discards the old morning answer after rollover", async () => {
  const { tracker: t, calls } = bareTracker()
  const held = gate(), reached = gate()
  const today = dateKey(new Date())
  t.dayKey = today
  t.day = { store: { lookup: async () => { reached.release(); await held.promise; return hashLines("old\n") } } }
  const oldDay = t.day
  const pending = t.runMeasure(vscode.Uri.file(path.join(dir, "midnight.ts")), "typescript", true)
  await reached.promise
  t.day = { store: { lookup: async () => hashLines("yesterday\n") } }
  held.release()
  await pending
  assert.notStrictEqual(t.day, oldDay)
  assert.deepStrictEqual(calls.map(c => [c.linesAdded, c.linesDeleted]), [[1, 0]])
})

it("a measurement refreshes the morning store before the ten-second midnight tick", async () => {
  const { tracker: t, calls } = bareTracker()
  t.dayKey = dateKey(new Date(startOfToday() - 1))
  t.day = { store: { lookup: async () => hashLines("old\n") } }
  t.beginDay = (now: Date) => { t.dayKey = dateKey(now); t.day = { store: { lookup: async () => hashLines("yesterday\n") } } }
  await t.runMeasure(vscode.Uri.file(path.join(dir, "before-tick.ts")), "typescript", true)
  assert.deepStrictEqual(calls.map(c => [c.linesAdded, c.linesDeleted]), [[1, 0]])
})

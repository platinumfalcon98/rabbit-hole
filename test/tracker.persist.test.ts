import { after, before, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/tracker/activityTracker.ts
import { ActivityTracker } from "tracker"
// @ts-ignore — esbuild alias to src/tracker/ledgerStore.ts
import { ledgerFile } from "ledgerStore"
// @ts-ignore — esbuild alias to src/tracker/storageService.ts
import { dateKey } from "storage"

const v = vscode as any

// Today's line snapshots are saved to globalStorage so a VS Code restart does
// not lose the first agent edit to each unopened file. Each test here runs one
// tracker, stops it (a window close), and starts a fresh one (the reopen).

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-persist-"))
const FILE = ledgerFile(DIR, ["file:///repo"])
const today = dateKey(new Date())

const calls: { path: string; added: number; deleted: number }[] = []
const storage: any = {
  registerProject: () => {},
  setCurrentProject: () => {},
  closeStaleSessions: () => {},
  appendSession: () => {},
  appendSessionToDate: () => {},
  updateLanguageTime: () => {},
  updateLanguageTimeForDate: () => {},
  appendFileActivity: (f: any) => calls.push({ path: f.path, added: f.linesAdded, deleted: f.linesDeleted }),
}
const callsFor = (p: string) => calls.filter(c => c.path === p)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const DEBOUNCE_WAIT = 2400
const newTracker = () => {
  const t = new ActivityTracker({ subscriptions: [], globalStorageUri: { fsPath: DIR } } as any, storage)
  t.start()
  return t
}
const write = (p: string, content: string) => { v.__writeFile(p, content); v.__fireChange(p) }

after(() => fs.rmSync(DIR, { recursive: true, force: true }))

describe("today's snapshots survive a restart", () => {
  before(async () => {
    const first = newTracker()
    write("/repo/src/r.ts", "a\nb\n")          // first sighting: the morning photo
    await sleep(DEBOUNCE_WAIT)
    write("/repo/src/r.ts", "a\nb\nc\n")       // +1
    await sleep(DEBOUNCE_WAIT)
    first.stop()                               // window closed
    const second = newTracker()                // reopened
    write("/repo/src/r.ts", "a\nb\nc\nd\n")    // +1 — lost without the snapshot
    await sleep(DEBOUNCE_WAIT)
    second.stop()
  })
  it("a snapshot file is written to globalStorage on close", () =>
    assert.ok(fs.existsSync(FILE), `expected ${FILE}`))
  it("the first edit after reopening is counted", () =>
    assert.deepStrictEqual(callsFor("/repo/src/r.ts").map(c => [c.added, c.deleted]), [[1, 0], [1, 0]]))
})

describe("a snapshot from another day is never used", () => {
  before(async () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify({
      version: 1, day: "2000-01-01",
      files: { "/repo/src/y.ts": { base: null, last: [1], credited: { added: 0, deleted: 0 }, edited: false } },
    }))
    const t = newTracker()
    write("/repo/src/y.ts", "x\ny\nz\n")
    await sleep(DEBOUNCE_WAIT)
    t.stop()
  })
  it("the stale photo is ignored (first sighting credits nothing)", () =>
    assert.strictEqual(callsFor("/repo/src/y.ts").length, 0))
  it("the saved file now holds today's snapshot", () =>
    assert.strictEqual(JSON.parse(fs.readFileSync(FILE, "utf8")).day, today))
})

describe("old snapshot files from other workspaces are cleaned up", () => {
  const other = ledgerFile(DIR, ["file:///some/other/project"])
  before(() => {
    fs.writeFileSync(other, "{}")
    const yesterday = new Date(Date.now() - 36 * 3600_000)
    fs.utimesSync(other, yesterday, yesterday)
    newTracker().stop()
  })
  it("a snapshot file last written before today is deleted on start", () =>
    assert.strictEqual(fs.existsSync(other), false))
})

describe("a corrupt snapshot file is survivable", () => {
  before(async () => {
    fs.writeFileSync(FILE, "{ not json")
    const t = newTracker()
    write("/repo/src/c.ts", "1\n")
    await sleep(DEBOUNCE_WAIT)
    write("/repo/src/c.ts", "1\n2\n")
    await sleep(DEBOUNCE_WAIT)
    t.stop()
  })
  it("tracking still works", () =>
    assert.deepStrictEqual(callsFor("/repo/src/c.ts").map(c => [c.added, c.deleted]), [[1, 0]]))
})

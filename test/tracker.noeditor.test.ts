import { after, before, beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/tracker/activityTracker.ts
import { ActivityTracker } from "tracker"

// Working in the terminal with no file open (or only a tab whose language is
// not tracked): agent edits claim the held time; with none, no language.
const v = vscode as any
const MIN = 60_000
const GRACE = 5_000
const DEBOUNCE_WAIT = 2400 // MEASURE_DEBOUNCE_MS is 2000
const KEYBOARD = 1

const realNow = Date.now
let now = realNow()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let credits = new Map<string, number>()
let sessions: any[] = []
const credit = (l: string, ms: number) => {
  assert.notStrictEqual(l, "", "\"\" must never be written as a language")
  credits.set(l, (credits.get(l) ?? 0) + ms)
}
const storage: any = {
  registerProject: () => {},
  setCurrentProject: () => {},
  closeStaleSessions: () => {},
  appendSession: (s: any) => sessions.push(structuredClone(s)),
  appendSessionToDate: () => {},
  updateLanguageTime: (l: string, ms: number) => credit(l, ms),
  updateLanguageTimeForDate: (l: string, ms: number) => credit(l, ms),
  appendFileActivity: () => {},
}

let tracker: any
let rev = 0
async function agentWrites(path: string) {
  v.__writeFile(path, `line ${++rev}\nmore ${rev}\n`)
  v.__fireChange(path)
  await sleep(DEBOUNCE_WAIT)
}
const sum = () => [...credits.values()].reduce((s, ms) => s + ms, 0)
// Blur pauses: the span is closed and settled, as when the user alt-tabs.
const blur = () => v.__setFocused(false)

// Seen once up front: a first sighting with unknown morning content is not an edit.
const SEEN = ["/repo/main.go", "/repo/a.go", "/repo/b.go", "/repo/notes.json"]

before(async () => {
  Date.now = () => now
  tracker = new ActivityTracker({ subscriptions: [] } as any, storage)
  tracker.start()                       // no active editor, ever
  for (const p of SEEN) { v.__writeFile(p, "seen\n"); v.__fireChange(p) }
  await sleep(DEBOUNCE_WAIT)
})
after(() => { tracker.stop(); Date.now = realNow })

// Each test starts from a fresh resume (span engaged now), credits cleared.
beforeEach(() => {
  blur()
  v.__setFocused(true)
  credits = new Map()
  sessions = []
})

describe("no active editor", () => {
  it("an agent editing Go with no file open credits Go", async () => {
    const t0 = now
    now += 3 * MIN
    await agentWrites("/repo/main.go")
    now += 2 * MIN
    blur()
    assert.deepStrictEqual([...credits], [["go", now - t0 - GRACE]])
  })

  it("no edits: no language time at all", () => {
    now += 10 * MIN
    blur()
    assert.deepStrictEqual([...credits], [])
  })

  it("splits by edit events across languages, summing to the held time", async () => {
    const t0 = now
    now += 2 * MIN
    await agentWrites("/repo/a.go")
    await agentWrites("/repo/b.go")
    await agentWrites("/repo/notes.json")
    now += MIN
    blur()
    const held = now - t0 - GRACE
    assert.strictEqual(sum(), held)
    assert.ok(Math.abs(credits.get("go")! - (2 * held) / 3) <= 1)
  })

  it("the session's languages grow by exactly the day's credits and never hold \"\"", async () => {
    tracker.saveCheckpoint()             // baseline: the session carries earlier tests' languages
    const before: Record<string, number> = structuredClone(sessions[sessions.length - 1]?.languages ?? {})
    credits = new Map()
    now += 3 * MIN
    await agentWrites("/repo/main.go")
    blur()
    v.__setFocused(true)
    tracker.saveCheckpoint()
    const last = sessions[sessions.length - 1]
    assert.ok(!("" in (last.languages ?? {})))
    const grown = Object.entries(last.languages ?? {}).reduce((s, [l, ms]) => s + (ms as number) - (before[l] ?? 0), 0)
    assert.ok(sum() > 0)
    assert.strictEqual(grown, sum())
  })

  it("clearing the data drops held time with no editor", async () => {
    now += 3 * MIN
    await agentWrites("/repo/main.go")
    tracker.saveCheckpoint()
    credits = new Map()
    tracker.discardCurrentSession()
    blur()
    assert.deepStrictEqual([...credits], [])
  })

  // Before 2026-10-10 the no-editor stretch was never flushed, so the first
  // file opened afterwards was credited with all of it.
  it("opening a file after a no-editor stretch does not hand it that stretch", () => {
    const goDoc = v.__openDoc("/repo/opened.go", "package o\n", "go")
    now += 10 * MIN
    v.__setActiveEditor(goDoc)
    now += MIN
    blur()
    assert.deepStrictEqual([...credits], [["go", MIN]])
  })

  it("an excluded file in front: agent edits claim the held time", async () => {
    const lock = v.__openDoc("/repo/package-lock.json", "{}\n", "json")
    v.__setActiveEditor(lock)
    v.__select(KEYBOARD)                 // engaged on the lockfile
    credits = new Map()
    const t0 = now
    now += 3 * MIN
    await agentWrites("/repo/main.go")
    v.__select(KEYBOARD)                 // back in the editor
    assert.deepStrictEqual([...credits], [["go", now - t0 - GRACE]])
  })

  it("a webview tab in front keeps the last language", async () => {
    const md = v.__openDoc("/repo/README.md", "# r\n", "markdown")
    v.__setActiveEditor(md)
    v.__select(KEYBOARD)
    v.__setActiveEditor(undefined)       // the dashboard comes to the front
    credits = new Map()
    const t0 = now
    now += 4 * MIN
    blur()
    assert.deepStrictEqual([...credits], [["markdown", now - t0]])
  })

})

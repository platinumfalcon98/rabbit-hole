import { after, afterEach, before, beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/tracker/activityTracker.ts
import { ActivityTracker } from "tracker"

const v = vscode as any
const MIN = 60_000
const GRACE = 5_000
const DEBOUNCE_WAIT = 2400 // MEASURE_DEBOUNCE_MS is 2000
const KEYBOARD = 1, MOUSE = 2, COMMAND = 3

// Date.now is driven by the test; setTimeout (the measure debounce) stays real.
const realNow = Date.now
let now = realNow()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Language credits per language, summed over day and dated writes.
let credits = new Map<string, number>()
const credit = (l: string, ms: number) => credits.set(l, (credits.get(l) ?? 0) + ms)
const storage: any = {
  registerProject: () => {},
  setCurrentProject: () => {},
  closeStaleSessions: () => {},
  appendSession: () => {},
  appendSessionToDate: () => {},
  updateLanguageTime: (l: string, ms: number) => credit(l, ms),
  updateLanguageTimeForDate: (l: string, ms: number) => credit(l, ms),
  appendFileActivity: () => {},
}

let tracker: any
let readme: any

// An unopened file rewritten on disk by an agent. The first write is a first
// sighting; later ones are measured against it.
let rev = 0
async function agentWrites(path: string) {
  v.__writeFile(path, `line ${++rev}\nmore ${rev}\n`)
  v.__fireChange(path)
  await sleep(DEBOUNCE_WAIT)
}
const sum = () => [...credits.values()].reduce((s, ms) => s + ms, 0)

// Files the tests rewrite. Seen once up front: with no morning content (no
// git here) a file's first sighting cannot tell an edit from a touch, so it
// is not an edit.
const SEEN = ["/repo/main.go", "/repo/a.go", "/repo/b.go", "/repo/notes.json", "/repo/late.go"]

before(async () => {
  Date.now = () => now
  tracker = new ActivityTracker({ subscriptions: [] } as any, storage)
  tracker.start()
  readme = v.__openDoc("/repo/README.md", "# readme\n", "markdown")
  v.__setActiveEditor(readme)
  for (const p of SEEN) { v.__writeFile(p, "seen\n"); v.__fireChange(p) }
  await sleep(DEBOUNCE_WAIT)
})
after(() => { tracker.stop(); Date.now = realNow })

// Each test starts engaged on the README with nothing held, then clears credits.
beforeEach(() => {
  v.__setActiveEditor(readme)
  v.__select(KEYBOARD)
  credits = new Map()
})
afterEach(() => v.__select(KEYBOARD)) // close any span the test left open

describe("terminal agent spans", () => {
  it("watching an agent edit Go with a README tab focused credits Go", async () => {
    const t0 = now
    now += 5 * MIN
    await agentWrites("/repo/main.go")
    now += 5 * MIN
    await agentWrites("/repo/main.go")
    v.__select(MOUSE) // the user clicks back into the editor
    assert.strictEqual(credits.get("markdown"), GRACE)
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
    assert.strictEqual(sum(), now - t0)
  })

  it("a span with no edits goes to the last editor, as before", () => {
    const t0 = now
    now += 10 * MIN
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["markdown", now - t0]])
  })

  it("splits by edit events across languages", async () => {
    const t0 = now
    now += 2 * MIN
    await agentWrites("/repo/a.go")
    await agentWrites("/repo/b.go")
    await agentWrites("/repo/notes.json")
    now += MIN
    v.__scroll() // scrolling is engagement too
    const held = now - t0 - GRACE
    assert.strictEqual(credits.get("go")! + credits.get("json")!, held)
    assert.ok(Math.abs(credits.get("go")! - (2 * held) / 3) <= 1)
    assert.strictEqual(sum(), now - t0)
  })

  it("a Command selection does not end the span", async () => {
    const t0 = now
    now += 3 * MIN
    v.__select(COMMAND) // an agent revealing a diff
    assert.strictEqual(credits.get("go"), undefined)
    await agentWrites("/repo/main.go")
    now += MIN
    v.__select(KEYBOARD)
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
  })

  it("unsaved typing is not an agent edit", async () => {
    const t0 = now
    const goDoc = v.__openDoc("/repo/typed.go", "package x\n", "go")
    now += 3 * MIN
    v.__editDoc(goDoc, "package x\nfunc y() {}\n", true)
    await sleep(DEBOUNCE_WAIT)
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["markdown", now - t0]])
  })

  it("a save of already-measured content is not an edit", async () => {
    const goDoc = v.__openDoc("/repo/saved.go", "package s\n", "go")
    v.__editDoc(goDoc, "package s\nvar z = 1\n", true) // typed while engaged
    await sleep(DEBOUNCE_WAIT)                          // measured as typing
    const t0 = now
    credits = new Map()
    now += 3 * MIN
    goDoc.isDirty = false                               // Ctrl+S: same content, now on disk
    v.__fireChange("/repo/saved.go")
    await sleep(DEBOUNCE_WAIT)
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["markdown", now - t0]])
  })

  it("a save right after typing, before the typing was measured, is not an edit", async () => {
    const goDoc = v.__openDoc("/repo/quick.go", "package q\n", "go")
    const t0 = now
    v.__editDoc(goDoc, "package q\nvar w = 2\n", true) // typed while engaged
    goDoc.isDirty = false                               // Ctrl+S at once: one measure, from disk
    v.__fireChange("/repo/quick.go")
    await sleep(DEBOUNCE_WAIT)                          // measured inside the 5 s grace
    now += 3 * MIN
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["markdown", now - t0]])
  })

  it("suppressed changes are not edits", async () => {
    const t0 = now
    now += 3 * MIN
    v.__fireChange("/repo/.git/HEAD") // a checkout in progress
    await agentWrites("/repo/main.go")
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["markdown", now - t0]])
  })

  it("a cursor move does not resume a paused session", () => {
    tracker.pauseSession()                  // the idle timer fired
    v.__select(MOUSE)
    assert.strictEqual(tracker.isActivelyTracking, false) // active time is unchanged by cursor moves
    v.__scroll()                            // scrolling was always activity
    assert.strictEqual(tracker.isActivelyTracking, true)
  })

  it("an agent edit measured after the user clicks back in still counts", async () => {
    const t0 = now
    now += 3 * MIN
    v.__writeFile("/repo/late.go", `late ${++rev}
`)
    v.__fireChange("/repo/late.go")
    v.__select(MOUSE)                       // before the 2 s debounce runs the measure
    await sleep(DEBOUNCE_WAIT)
    assert.strictEqual(credits.get("markdown"), GRACE)
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
  })

  it("an agent edit measured after a blur still counts", async () => {
    const t0 = now
    now += 3 * MIN
    v.__writeFile("/repo/late.go", `late ${++rev}
`)
    v.__fireChange("/repo/late.go")
    v.__setFocused(false)                   // alt-tab right after the agent's last write
    await sleep(DEBOUNCE_WAIT)
    v.__setFocused(true)
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
  })

  it("the scroll of a programmatic reveal does not end the span", async () => {
    const t0 = now
    now += 3 * MIN
    v.__select(COMMAND)                     // an agent tool reveals a diff…
    v.__scroll()                            // …which scrolls the editor
    await agentWrites("/repo/main.go")
    now += MIN
    v.__select(KEYBOARD)
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
  })

  it("touching a file not seen today, with unknown morning content, is not an edit", async () => {
    const t0 = now
    now += 3 * MIN
    await agentWrites("/repo/touched.go")   // first sighting: edit or touch, unknowable
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["markdown", now - t0]])
  })

  it("an agent creating a file is an edit", async () => {
    const t0 = now
    now += 3 * MIN
    v.__writeFile("/repo/created.go", "package c\n")
    v.__fireCreate("/repo/created.go")
    await sleep(DEBOUNCE_WAIT)
    v.__select(KEYBOARD)
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
  })

  it("an agent edit that resumes an idle pause counts, and so does the time after it", async () => {
    tracker.pauseSession()                  // the agent thought for over 5 minutes
    credits = new Map()
    await agentWrites("/repo/main.go")      // its write resumes the session
    now += 3 * MIN
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["go", 3 * MIN]])
  })

  it("blur resolves the span; blurred edits are dropped", async () => {
    const t0 = now
    now += 4 * MIN
    await agentWrites("/repo/main.go")
    v.__setFocused(false)
    const atBlur = now
    assert.strictEqual(credits.get("go"), atBlur - t0 - GRACE) // resolved at the pause
    now += 10 * MIN
    await agentWrites("/repo/main.go")                        // while blurred
    v.__setFocused(true)
    credits = new Map()
    now += 2 * MIN
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["markdown", 2 * MIN]])
  })
})

// Every path that ends a session or replaces its data must settle a held span
// (or, for a wipe, drop it). Last in the file: the final test stops the tracker.
describe("held spans at session boundaries", () => {
  let other: any
  let ydoc: any

  it("an agent editing another root's files does not move this project's time", async () => {
    other = v.__addFolder("/other")
    v.__writeFile("/other/x.go", "x\n"); v.__fireChange("/other/x.go")
    await sleep(DEBOUNCE_WAIT)              // seen
    v.__select(KEYBOARD)
    credits = new Map()
    const t0 = now
    now += 3 * MIN
    await agentWrites("/other/x.go")
    v.__select(KEYBOARD)
    assert.deepStrictEqual([...credits], [["markdown", now - t0]])
  })

  it("a project switch credits the held span before the session ends", async () => {
    const t0 = now
    now += 3 * MIN
    await agentWrites("/repo/main.go")
    ydoc = v.__openDoc("/other/y.ts", "y\n", "typescript")
    v.__setActiveEditor(ydoc)               // ends the /repo session
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
  })

  it("removing a workspace folder that ends the session credits the held span", async () => {
    // In /other's project, hold, edit there, then remove /other: the active
    // editor's project changes, which ends the session.
    v.__setActiveEditor(ydoc)               // beforeEach went back to the README
    v.__writeFile("/other/z.go", "z\n"); v.__fireChange("/other/z.go")
    await sleep(DEBOUNCE_WAIT)              // seen
    v.__select(KEYBOARD)
    credits = new Map()
    const t0 = now
    now += 3 * MIN
    await agentWrites("/other/z.go")
    v.__removeFolder(other)
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
  })

  it("clearing the data drops a held span instead of crediting it", async () => {
    v.__setActiveEditor(readme)             // back in /repo
    v.__select(KEYBOARD)
    credits = new Map()
    now += 3 * MIN
    await agentWrites("/repo/main.go")
    tracker.saveCheckpoint()                // the 10 s tick: the grace is credited, the rest held
    credits = new Map()
    tracker.discardCurrentSession()
    v.__scroll()                            // next activity opens a fresh session
    v.__select(KEYBOARD)                    // and an engagement would settle anything left
    assert.deepStrictEqual([...credits], [])
  })

  it("stopping the extension credits the held span", async () => {
    v.__select(KEYBOARD)
    credits = new Map()
    const t0 = now
    now += 3 * MIN
    await agentWrites("/repo/main.go")
    tracker.stop()
    assert.strictEqual(credits.get("go"), now - t0 - GRACE)
  })
})

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

before(() => {
  Date.now = () => now
  tracker = new ActivityTracker({ subscriptions: [] } as any, storage)
  tracker.start()
  readme = v.__openDoc("/repo/README.md", "# readme\n", "markdown")
  v.__setActiveEditor(readme)
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

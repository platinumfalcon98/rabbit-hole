import { after, before, describe, it } from "node:test"
import * as assert from "node:assert"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/tracker/activityTracker.ts
import { ActivityTracker } from "tracker"

const v = vscode as any

const fileCalls: { path: string; added: number; deleted: number }[] = []

// Only the calls the capture model makes are stubbed; this suite is about what
// the tracker *measures*, not what storage does with it.
const storage: any = {
  registerProject: () => {},
  setCurrentProject: () => {},
  closeStaleSessions: () => {},
  appendSession: () => {},
  appendSessionToDate: () => {},
  updateLanguageTime: () => {},
  updateLanguageTimeForDate: () => {},
  appendFileActivity: (f: any) =>
    fileCalls.push({ path: f.path, added: f.linesAdded, deleted: f.linesDeleted }),
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const DEBOUNCE_WAIT = 2400 // EXTERNAL_DEBOUNCE_MS is 2000

let tracker: any

async function externalChange(path: string, content: string, isCreate = false) {
  v.__writeFile(path, content)
  if (isCreate) v.__fireCreate(path)
  else v.__fireChange(path)
  await sleep(DEBOUNCE_WAIT)
}

before(() => {
  tracker = new ActivityTracker({ subscriptions: [] } as any, storage)
  tracker.start()
})

after(() => tracker.stop())

// Registered first so it observes the tracker before the focus-gate suite
// blurs the window.
describe("session start", () => {
  it("session is active when the window starts focused", () =>
    assert.strictEqual(tracker.isActivelyTracking, true))
})

describe("focus gate — a blurred window must not accrue active time", () => {
  let beforeBlurWrite = 0

  before(async () => {
    v.__setFocused(false)
    beforeBlurWrite = fileCalls.length
    await externalChange("/repo/src/a.ts", "one\ntwo\nthree\n", true)
  })

  it("blur pauses the session", () =>
    assert.strictEqual(tracker.isActivelyTracking, false))

  // Without the gate a background agent writing files un-paused the clock and
  // nothing re-paused it — a minimised editor recorded hours of active time.
  it("an agent write while blurred does NOT resume the active clock", () =>
    assert.strictEqual(tracker.isActivelyTracking, false))

  it("an agent write while blurred STILL records file/line stats", () =>
    assert.ok(fileCalls.length > beforeBlurWrite, "expected an appendFileActivity call"))

  it("refocus resumes the session", () => {
    v.__setFocused(true)
    assert.strictEqual(tracker.isActivelyTracking, true)
  })
})

describe("gross line counts — multiset diff, not net", () => {
  let created: any, rewrite: any, appended: any, second: any
  let beforeRewrite = 0, beforeReorder = 0, afterReorder = 0
  let beforeFirstSight = 0, afterFirstSight = 0, beforeSecond = 0

  before(async () => {
    await externalChange("/repo/src/b.ts", "a\nb\nc\nd\ne\n", true)
    created = fileCalls[fileCalls.length - 1]

    beforeRewrite = fileCalls.length
    await externalChange("/repo/src/b.ts", "v\nw\nx\ny\nz\n")
    rewrite = fileCalls[fileCalls.length - 1]

    await externalChange("/repo/src/b.ts", "v\nw\nx\ny\nz\nnew1\nnew2\n")
    appended = fileCalls[fileCalls.length - 1]

    beforeReorder = fileCalls.length
    await externalChange("/repo/src/b.ts", "new2\nnew1\nz\ny\nx\nw\nv\n")
    afterReorder = fileCalls.length

    // A change, not a create: the file is "pre-existing" as far as the tracker
    // is concerned, so there is no baseline to diff against.
    beforeFirstSight = fileCalls.length
    await externalChange("/repo/src/c.ts", "pre\nexisting\nfile\n")
    afterFirstSight = fileCalls.length

    beforeSecond = fileCalls.length
    await externalChange("/repo/src/c.ts", "pre\nexisting\nfile\nplus\n")
    second = fileCalls[fileCalls.length - 1]
  })

  it("create records full line count as added", () => {
    assert.strictEqual(created.added, 6) // 5 lines + trailing "" from split
    assert.strictEqual(created.deleted, 0)
  })

  // The old net diff (lineCount - prev) scored this 0/0, systematically
  // undercounting agent rewrites against typing.
  it("in-place rewrite counts BOTH ways (a net diff would score 0/0)", () => {
    assert.ok(fileCalls.length > beforeRewrite, "expected a call, got none")
    assert.strictEqual(rewrite.added, 5)
    assert.strictEqual(rewrite.deleted, 5)
  })

  it("pure append counts as added only", () => {
    assert.strictEqual(appended.added, 2)
    assert.strictEqual(appended.deleted, 0)
  })

  it("reordering the same lines records nothing", () =>
    assert.strictEqual(afterReorder, beforeReorder))

  it("first sighting of a pre-existing file records no row", () =>
    assert.strictEqual(afterFirstSight, beforeFirstSight))

  it("...but the NEXT edit diffs against that baseline", () => {
    assert.ok(fileCalls.length > beforeSecond, "expected a call, got none")
    assert.strictEqual(second.added, 1)
    assert.strictEqual(second.deleted, 0)
  })
})

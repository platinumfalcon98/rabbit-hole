import { afterEach, beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/tracker/activityTracker.ts
import { ActivityTracker } from "tracker"

const MIN = 60_000
const realNow = Date.now
let now = 0

interface Calls {
  day: [string, number][]
  dayFor: [string, number, string][]
  appended: any[]
  appendedTo: [any, string][]
}
let calls: Calls

// Only what the session/language path touches. Clones, because the tracker
// keeps mutating its live session object after handing it over.
const storage: any = {
  updateLanguageTime: (l: string, ms: number) => calls.day.push([l, ms]),
  updateLanguageTimeForDate: (l: string, ms: number, d: string) => calls.dayFor.push([l, ms, d]),
  appendSession: (s: any) => calls.appended.push(structuredClone(s)),
  appendSessionToDate: (s: any, d: string) => calls.appendedTo.push([structuredClone(s), d]),
}

// A tracker mid-session, built without start(): no timers, watchers or editors.
function trackerAt(startedAt: number, language: string): any {
  const t: any = new ActivityTracker({ subscriptions: [] } as any, storage)
  t.currentProjectId = "alpha"
  t.currentSession = { id: "s1", startTime: startedAt, endTime: null, duration: 0, activeTime: 0 }
  t.isPaused = false
  t.activeIntervalStart = startedAt
  t.activeTimeAccumulated = 0
  t.languageCurrent = language
  t.languageIntervalStart = startedAt
  t.span.engage(startedAt)
  return t
}
// The user is working in the editor right now (keyboard/mouse): nothing is held.
const engaged = (t: any) => t.span.engage(now)
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).getTime()

beforeEach(() => {
  calls = { day: [], dayFor: [], appended: [], appendedTo: [] }
  Date.now = () => now
})
afterEach(() => { Date.now = realNow })

describe("session languages", () => {
  it("a flush credits the open session with the same ms as the day", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "typescript")
    now += 7 * MIN
    engaged(t)
    t.flushLanguageTime(now)
    assert.deepStrictEqual(calls.day, [["typescript", 7 * MIN]])
    assert.deepStrictEqual(t.currentSession.languages, { typescript: 7 * MIN })
  })

  it("a checkpoint writes every language the session has seen, summing to the day's credit", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "typescript")
    now += 5 * MIN
    engaged(t)
    t.flushLanguageTime(now)
    t.languageCurrent = "markdown"
    now += 3 * MIN
    engaged(t)
    t.saveCheckpoint()
    const last = calls.appended[calls.appended.length - 1]
    assert.deepStrictEqual(last.languages, { typescript: 5 * MIN, markdown: 3 * MIN })
    const dayTotal = calls.day.reduce((s, [, ms]) => s + ms, 0)
    const sessionTotal = Object.values(last.languages as Record<string, number>).reduce((s, ms) => s + ms, 0)
    assert.strictEqual(sessionTotal, dayTotal)
  })

  it("an excluded document credits nothing to the session", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "")
    now += 4 * MIN
    t.flushLanguageTime(now)
    assert.strictEqual(t.currentSession.languages, undefined)
    assert.deepStrictEqual(calls.day, [])
  })

  it("midnight gives yesterday's session its share and starts today's from zero", () => {
    const start = at(2026, 9, 2, 23, 50)
    now = start
    const t = trackerAt(start, "typescript")
    now = at(2026, 9, 3, 0, 6)
    engaged(t)
    t.saveCheckpoint()
    const [closed, date] = calls.appendedTo[0]
    assert.strictEqual(date, "2026-10-02")
    assert.deepStrictEqual(closed.languages, { typescript: 10 * MIN })
    assert.deepStrictEqual(calls.appended[calls.appended.length - 1].languages, { typescript: 6 * MIN })
  })

  it("time held after midnight is weighted by the same agent turn's edits", () => {
    now = at(2026, 9, 2, 23, 0)
    const t = trackerAt(now, "markdown")
    t.isWindowFocused = true
    now = at(2026, 9, 2, 23, 30)
    t.span.edit("go", 3, now)                // the agent edits Go before midnight
    now = at(2026, 9, 3, 0, 10)
    t.saveCheckpoint()                       // the split credits yesterday's share
    now = at(2026, 9, 3, 0, 20)
    t.onEngagement()                         // the user clicks back in
    t.clearIdleTimer()
    assert.deepStrictEqual(calls.day, [["go", 20 * MIN]])
  })

  it("an editor switch just after midnight splits the day first", () => {
    now = at(2026, 9, 2, 23, 50)
    const t = trackerAt(now, "typescript")
    t.isWindowFocused = true
    t.resolveProjectForUri = () => "alpha"
    now = at(2026, 9, 3, 0, 5)
    engaged(t)
    const uri = { scheme: "file", fsPath: "/repo/README.md", path: "/repo/README.md", toString: () => "file:///repo/README.md" }
    t.onEditorChange({ document: { uri, languageId: "markdown" } })
    t.clearIdleTimer()
    const yesterday = calls.dayFor.filter(([l, , d]) => l === "typescript" && d === "2026-10-02").reduce((s, [, ms]) => s + ms, 0)
    assert.strictEqual(yesterday, 10 * MIN)
    assert.deepStrictEqual(calls.day, [["typescript", 5 * MIN]])
  })

  it("a held span is credited to the day it was held on", () => {
    const start = at(2026, 9, 2, 23, 0)
    now = start
    const t = trackerAt(start, "markdown") // engaged at 23:00, then watching the terminal
    now = at(2026, 9, 3, 0, 10)
    t.saveCheckpoint()
    const yesterday = calls.dayFor.filter(([, , d]) => d === "2026-10-02").reduce((s, [, ms]) => s + ms, 0)
    assert.strictEqual(yesterday, 60 * MIN)            // grace + held, all to 2026-10-02
    assert.deepStrictEqual(calls.appendedTo[0][0].languages, { markdown: 60 * MIN })
    assert.deepStrictEqual(calls.day, [])              // nothing after midnight credited yet: still held
  })

  it("no editor across midnight: edits weight each day's held time, nothing is written as \"\"", () => {
    now = at(2026, 9, 2, 23, 0)
    const t = trackerAt(now, "")             // no usable editor
    t.isWindowFocused = true
    now = at(2026, 9, 2, 23, 30)
    t.span.edit("go", 3, now)                // the agent edits Go before midnight
    now = at(2026, 9, 3, 0, 10)
    t.saveCheckpoint()                       // the split credits yesterday's share
    now = at(2026, 9, 3, 0, 20)
    t.onEngagement()
    t.clearIdleTimer()
    const yesterday = calls.dayFor.filter(([, , d]) => d === "2026-10-02")
    assert.deepStrictEqual(yesterday, [["go", 60 * MIN - 5_000, "2026-10-02"]])
    assert.deepStrictEqual(calls.day, [["go", 20 * MIN]])
    assert.ok(![...calls.day, ...calls.dayFor].some(([l]) => l === ""))
  })

  it("no editor across midnight with no edits writes no language time", () => {
    now = at(2026, 9, 2, 23, 0)
    const t = trackerAt(now, "")
    t.isWindowFocused = true
    now = at(2026, 9, 3, 0, 10)
    t.saveCheckpoint()
    now = at(2026, 9, 3, 0, 20)
    t.onEngagement()
    t.clearIdleTimer()
    assert.deepStrictEqual(calls.day, [])
    assert.deepStrictEqual(calls.dayFor, [])
    assert.strictEqual(calls.appendedTo[0][0].languages, undefined)
  })
})

// The day tape and target-met time must show when work happened, not the whole
// span a session was open: a session that pauses and later expires carries a
// 60-minute idle tail, and one that resumes after a blur has gaps inside it.
describe("active intervals", () => {
  const stopTimers = (t: any) => { t.clearIdleTimer(); t.clearExpiryTimer() }

  it("a pause closes the active interval", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "typescript")
    now = at(2026, 9, 3, 10, 5)
    t.pauseSession()
    stopTimers(t)
    assert.deepStrictEqual(calls.appended[calls.appended.length - 1].intervals, [[at(2026, 9, 3, 10, 0), at(2026, 9, 3, 10, 5)]])
  })

  it("a checkpoint after a resume carries the closed interval and the open one", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "typescript")
    t.isWindowFocused = true
    now = at(2026, 9, 3, 10, 5)
    t.pauseSession()
    now = at(2026, 9, 3, 10, 30)
    t.onActivity()
    now = at(2026, 9, 3, 10, 40)
    t.saveCheckpoint()
    stopTimers(t)
    const last = calls.appended[calls.appended.length - 1]
    assert.deepStrictEqual(last.intervals, [
      [at(2026, 9, 3, 10, 0), at(2026, 9, 3, 10, 5)],
      [at(2026, 9, 3, 10, 30), at(2026, 9, 3, 10, 40)],
    ])
    assert.strictEqual(last.activeTime, 15 * MIN)
    // the checkpoint's open interval is a snapshot, not part of the session's closed list
    assert.strictEqual(t.currentSession.intervals.length, 1)
  })

  it("ending an active session closes its last interval", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "typescript")
    now = at(2026, 9, 3, 10, 20)
    t.endSession()
    assert.deepStrictEqual(calls.appended[calls.appended.length - 1].intervals, [[at(2026, 9, 3, 10, 0), at(2026, 9, 3, 10, 20)]])
  })

  it("midnight cuts the open interval between the two days", () => {
    now = at(2026, 9, 2, 23, 50)
    const t = trackerAt(now, "typescript")
    now = at(2026, 9, 3, 0, 6)
    t.saveCheckpoint()
    const midnight = at(2026, 9, 3, 0, 0)
    assert.deepStrictEqual(calls.appendedTo[0][0].intervals, [[at(2026, 9, 2, 23, 50), midnight]])
    assert.deepStrictEqual(calls.appended[calls.appended.length - 1].intervals, [[midnight, now]])
  })
})

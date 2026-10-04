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
  return t
}
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
    t.flushLanguageTime(now)
    assert.deepStrictEqual(calls.day, [["typescript", 7 * MIN]])
    assert.deepStrictEqual(t.currentSession.languages, { typescript: 7 * MIN })
  })

  it("a checkpoint writes every language the session has seen, summing to the day's credit", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "typescript")
    now += 5 * MIN
    t.flushLanguageTime(now)
    t.languageCurrent = "markdown"
    now += 3 * MIN
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
    t.saveCheckpoint()
    const [closed, date] = calls.appendedTo[0]
    assert.strictEqual(date, "2026-10-02")
    assert.deepStrictEqual(closed.languages, { typescript: 10 * MIN })
    assert.deepStrictEqual(calls.appended[calls.appended.length - 1].languages, { typescript: 6 * MIN })
  })
})

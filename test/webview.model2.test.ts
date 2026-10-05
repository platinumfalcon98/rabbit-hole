import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/model.ts
import { mergeLive, seriesFor, storedStreak, streakInfo, tapeCells, tapeWindow, targetMetAt, yearStats } from "model"

const MIN = 60_000
const T = 20 * MIN
const at = (h: number, m = 0) => new Date(2026, 9, 3, h, m).getTime()
const sess = (start: number, active: number, span = active, extra: any = {}) =>
  ({ id: String(start), startTime: start, endTime: start + span, duration: span, activeTime: active, ...extra })

// Five days; the second-to-last day met only its stamped (lower) target.
function year(): any {
  return {
    today: "2026-10-03",
    days: ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"],
    globalTargetMs: T,
    global: { streak: 2, active: [30 * MIN, 0, 25 * MIN, 15 * MIN, 5 * MIN], targetMs: [T, null, T, 10 * MIN, T] },
    projects: [
      { id: "alpha", name: "alpha", path: "/a", streak: 1, dailyTargetMinutes: 15,
        active: [20 * MIN, 0, 16 * MIN, 0, 18 * MIN], targetMs: [null, null, null, null, 30 * MIN] },
    ],
  }
}

describe("series and streaks", () => {
  it("all projects use the global records; unstamped days use the current target", () => {
    const s = seriesFor(year(), "all")
    assert.deepStrictEqual(s.targetMs, [T, T, T, 10 * MIN, T])
  })

  it("a project uses its own target, and today is judged against the live target, not its stamp", () => {
    const s = seriesFor(year(), "alpha")
    assert.deepStrictEqual(s.targetMs, [15 * MIN, 15 * MIN, 15 * MIN, 15 * MIN, 15 * MIN])
  })

  it("an unknown project is all zeros", () => {
    assert.deepStrictEqual(seriesFor(year(), "gone").active, [0, 0, 0, 0, 0])
  })

  it("at risk before today's target is met; the current count comes from storage", () => {
    const info = streakInfo(seriesFor(year(), "all"), storedStreak(year(), "all"))
    assert.strictEqual(info.current, 2)
    assert.strictEqual(info.todayMet, false)
    assert.strictEqual(info.atRisk, true)
    assert.strictEqual(info.todayRemainingMs, 15 * MIN)
  })

  it("the longest run honours each day's stamped target", () => {
    const info = streakInfo(seriesFor(year(), "all"), 0)
    assert.strictEqual(info.longest, 2)
    assert.strictEqual(info.longestEnd, "2026-10-02")
  })

  it("year stats count active days, total and the best day", () => {
    const st = yearStats(seriesFor(year(), "all"))
    assert.strictEqual(st.activeDays, 4)
    assert.strictEqual(st.totalMs, 75 * MIN)
    assert.deepStrictEqual(st.best, { date: "2026-09-29", ms: 30 * MIN })
  })
})

describe("day tape", () => {
  it("defaults to 07:00–19:00", () => {
    assert.deepStrictEqual(tapeWindow([sess(at(9), 30 * MIN)], 48, at(20)), { startMin: 420, endMin: 1140, cells: 48, cellMin: 15 })
  })

  it("widens to whole hours that cover night and early sessions", () => {
    const w = tapeWindow([sess(at(5, 10), 20 * MIN), sess(at(22, 30), 60 * MIN, 70 * MIN)], 48, at(23, 59))
    assert.strictEqual(w.startMin, 300)
    assert.strictEqual(w.endMin, 1440)
  })

  it("spreads active time evenly over the session's span", () => {
    const win = tapeWindow([], 48, at(20))
    const cells = tapeCells([sess(at(9), 30 * MIN, 60 * MIN, { languages: { typescript: 30 * MIN } })], win, at(20))
    const nine = cells.filter((c: any) => c.startMin >= 540 && c.startMin < 600)
    assert.deepStrictEqual(nine.map((c: any) => c.level), [3, 3, 3, 3])
    assert.strictEqual(nine[0].language, "typescript")
    assert.strictEqual(cells.find((c: any) => c.startMin === 600).level, 0)
  })

  it("an open session runs up to now", () => {
    const open = { id: "o", startTime: at(10), endTime: null, duration: 0, activeTime: 30 * MIN, projectId: "alpha" }
    const cells = tapeCells([open], tapeWindow([open], 48, at(10, 30)), at(10, 30))
    assert.deepStrictEqual(cells.filter((c: any) => c.level === 4).map((c: any) => c.startMin), [600, 615])
    assert.strictEqual(cells[0].projectId, null)
    assert.strictEqual(cells.find((c: any) => c.startMin === 600).projectId, "alpha")
  })

  it("an averaged range is scaled to the whole's busiest cell, so a focus reads as a share", () => {
    const whole = [sess(at(9), 15 * MIN), sess(at(9), 15 * MIN)]
    const focus = [whole[0]]
    const win = tapeWindow(whole, 48, at(20))
    const cells = tapeCells(focus, win, at(20), { perDays: 2, base: whole })
    assert.strictEqual(cells.find((c: any) => c.startMin === 540).level, 3)
  })
})

describe("target time and live merges", () => {
  it("interpolates inside the session that crossed the target", () => {
    const met = targetMetAt([sess(at(8), 10 * MIN), sess(at(9), 20 * MIN, 40 * MIN)], T, at(20))
    assert.strictEqual(met, at(9, 20))
  })

  it("is null when the target was never reached, and uses now for an open session", () => {
    assert.strictEqual(targetMetAt([sess(at(8), 5 * MIN)], T, at(20)), null)
    const open = { id: "o", startTime: at(10), endTime: null, duration: 0, activeTime: 40 * MIN }
    assert.strictEqual(targetMetAt([open], T, at(10, 40)), at(10, 20))
  })

  it("replaces today's values instead of adding, however often it runs", () => {
    const y = year()
    const range: any = { from: "2026-10-02", to: "2026-10-03", logs: { alpha: [{ date: "2026-10-02", activeTime: 1 }] } }
    const live: any = { today: "2026-10-03", projectId: "alpha", log: { date: "2026-10-03", activeTime: 42 * MIN },
      todayActive: { alpha: 42 * MIN }, globalToday: 50 * MIN, globalStreak: 2, streaks: { alpha: 1 } }
    mergeLive(y, range, live)
    mergeLive(y, range, live)
    assert.strictEqual(y.projects[0].active[4], 42 * MIN)
    assert.strictEqual(y.global.active[4], 50 * MIN)
    assert.strictEqual(range.logs.alpha.length, 2)
    assert.strictEqual(range.logs.alpha[1].activeTime, 42 * MIN)
  })

  it("takes the streaks from each live update", () => {
    const y = year()
    mergeLive(y, null, { today: "2026-10-03", projectId: "alpha", log: { date: "2026-10-03" },
      todayActive: { alpha: 18 * MIN }, globalToday: 25 * MIN, globalStreak: 3, streaks: { alpha: 2 } } as any)
    assert.strictEqual(storedStreak(y, "all"), 3)
    assert.strictEqual(storedStreak(y, "alpha"), 2)
  })

  it("leaves a range that doesn't include today alone", () => {
    const range: any = { from: "2026-09-01", to: "2026-09-02", logs: { alpha: [] } }
    mergeLive(year(), range, { today: "2026-10-03", projectId: "alpha", log: { date: "2026-10-03" }, todayActive: {}, globalToday: 0, globalStreak: 0, streaks: {} } as any)
    assert.strictEqual(range.logs.alpha.length, 0)
  })
})

describe("active intervals", () => {
  // 15 minutes of work at 09:00, then away: the session expired at 10:15.
  const expired = { id: "e", startTime: at(9), endTime: at(10, 15), duration: 75 * MIN, activeTime: 15 * MIN,
    intervals: [[at(9), at(9, 15)]] }

  it("the tape draws only the recorded intervals, not the idle tail", () => {
    const cells = tapeCells([expired], tapeWindow([expired], 48, at(20)), at(20))
    assert.strictEqual(cells.find((c: any) => c.startMin === 540).level, 4)
    assert.strictEqual(cells.find((c: any) => c.startMin === 555).level, 0)
  })

  it("the window ignores a session's idle tail", () => {
    const late = { id: "l", startTime: at(18, 30), endTime: at(19, 40), duration: 70 * MIN, activeTime: 10 * MIN,
      intervals: [[at(18, 30), at(18, 40)]] }
    assert.strictEqual(tapeWindow([late], 48, at(20)).endMin, 1140)
  })

  it("target-met time walks the intervals, skipping the gap between them", () => {
    const gappy = { id: "g", startTime: at(9), endTime: at(9, 40), duration: 40 * MIN, activeTime: 20 * MIN,
      intervals: [[at(9), at(9, 10)], [at(9, 30), at(9, 40)]] }
    assert.strictEqual(targetMetAt([gappy], 15 * MIN, at(20)), at(9, 35))
  })
})
describe("phase 2 fixes", () => {
  const liveFor = (projectId: string): any => ({
    today: "2026-10-03", projectId,
    log: { date: "2026-10-03", totalTime: 0, activeTime: 0, streak: 0, languages: {}, agents: {}, files: [], sessions: [] },
    todayActive: {}, globalToday: 0, globalStreak: 0, streaks: {},
  })

  it("a hand-edited project target is clamped the way the host clamps it", () => {
    const y = year()
    y.projects[0].dailyTargetMinutes = 0
    let s = seriesFor(y, "alpha")
    assert.strictEqual(s.targetMs[s.targetMs.length - 1], MIN)
    y.projects[0].dailyTargetMinutes = 5000
    s = seriesFor(y, "alpha")
    assert.strictEqual(s.targetMs[s.targetMs.length - 1], 1440 * MIN)
  })

  it("a live update with no project leaves no empty key in the range", () => {
    const range: any = { from: "2026-10-03", to: "2026-10-03", logs: {} }
    assert.strictEqual(mergeLive(year(), range, liveFor("")), true)
    assert.deepStrictEqual(Object.keys(range.logs), [])
  })

  it("says when the live project isn't in the year yet", () => {
    assert.strictEqual(mergeLive(year(), null, liveFor("newcomer")), false)
    assert.strictEqual(mergeLive(year(), null, liveFor("alpha")), true)
  })
})

import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import { MIN, PROJECTS_KEY, cleanupStorageRoot, daysAgo, log, makeStore, proj, today } from "./helpers/store"
// @ts-ignore — esbuild alias to src/dashboard/payloads.ts
import { MAX_RANGE_DAYS, buildLive, buildMini, buildRange, buildYear, yearStart } from "payloads"

after(cleanupStorageRoot)

const TARGET = 20 * MIN

function store() {
  const sessionEnd = Date.now() - 5 * MIN
  return makeStore({
    [PROJECTS_KEY]: [proj("alpha", 4), proj("beta", 0)],
    [`rabbithole:log:alpha:${today}`]: {
      ...log(30 * MIN),
      targetMs: TARGET,
      sessions: [{ id: "a1", startTime: sessionEnd - 30 * MIN, endTime: sessionEnd, duration: 30 * MIN, activeTime: 30 * MIN }],
    },
    // alpha's 4 rests on yesterday: today (30m of its 45m target) isn't met yet
    [`rabbithole:log:alpha:${daysAgo(1)}`]: { ...log(50 * MIN, daysAgo(1)), streak: 4 },
    [`rabbithole:log:beta:${daysAgo(2)}`]: log(12 * MIN, daysAgo(2)),
    [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 6, targetMs: TARGET },
    [`rabbithole:global:${daysAgo(2)}`]: { date: daysAgo(2), activeTime: 12 * MIN, streak: 5 },
    // Pre-multi-project installs wrote keys with no project segment; nothing reads them.
    [`rabbithole:log:${today}`]: log(99 * MIN),
  }).s
}

describe("year payload", () => {
  it("starts on a Monday, 364–370 days back, and ends today", () => {
    const now = new Date()
    const start = yearStart(now)
    assert.strictEqual(start.getDay(), 1)
    const back = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - start.getTime()) / 86_400_000)
    assert.ok(back >= 364 && back <= 370, `went back ${back} days`)
    const y = buildYear(store(), now, TARGET)
    assert.strictEqual(y.days[y.days.length - 1], today)
    assert.strictEqual(y.days.length, back + 1)
    assert.strictEqual(y.today, today)
  })

  it("carries each project's daily active time and stamped targets in registry order", () => {
    const y = buildYear(store(), new Date(), TARGET)
    assert.deepStrictEqual(y.projects.map((p: any) => p.id), ["alpha", "beta"])
    const [alpha, beta] = y.projects
    assert.strictEqual(alpha.active[alpha.active.length - 1], 30 * MIN)
    assert.strictEqual(alpha.targetMs[alpha.targetMs.length - 1], TARGET)
    assert.strictEqual(beta.active[beta.active.length - 3], 12 * MIN)
    assert.strictEqual(beta.targetMs[beta.targetMs.length - 3], null)
    assert.strictEqual(alpha.streak, 4)
    assert.strictEqual(alpha.dailyTargetMinutes, 45)
  })

  it("carries the global series and stored streak", () => {
    const y = buildYear(store(), new Date(), TARGET)
    assert.strictEqual(y.global.streak, 6)
    assert.strictEqual(y.global.active[y.global.active.length - 1], 30 * MIN)
    assert.strictEqual(y.global.targetMs[y.global.targetMs.length - 3], null)
    assert.strictEqual(y.globalTargetMs, TARGET)
  })

  it("reports the latest session end as lastActive, and none for a project without sessions", () => {
    const y = buildYear(store(), new Date(), TARGET)
    assert.ok(typeof y.projects[0].lastActive === "number")
    assert.strictEqual(y.projects[1].lastActive, undefined)
  })
})

describe("range payload", () => {
  it("returns one log per day per registered project", () => {
    const r = buildRange(store(), daysAgo(6), today)
    assert.ok(r)
    assert.deepStrictEqual(Object.keys(r.logs), ["alpha", "beta"])
    assert.strictEqual(r.logs.alpha.length, 7)
    assert.strictEqual(r.logs.alpha[6].activeTime, 30 * MIN)
    assert.strictEqual(r.logs.beta[4].activeTime, 12 * MIN)
  })

  it(`accepts exactly ${MAX_RANGE_DAYS} days and refuses one more`, () => {
    assert.ok(buildRange(store(), daysAgo(MAX_RANGE_DAYS - 1), today))
    assert.strictEqual(buildRange(store(), daysAgo(MAX_RANGE_DAYS), today), null)
  })

  it("refuses reversed, impossible and malformed dates without throwing", () => {
    const s = store()
    assert.strictEqual(buildRange(s, today, daysAgo(3)), null)
    assert.strictEqual(buildRange(s, "2026-02-30", "2026-03-02"), null)
    assert.strictEqual(buildRange(s, "garbage", today), null)
    assert.strictEqual(buildRange(s, "", ""), null)
  })
})

describe("live payload", () => {
  it("has today's active time for every project and the current project's log", () => {
    const l = buildLive(store(), new Date())
    assert.strictEqual(l.today, today)
    assert.strictEqual(l.projectId, "alpha")
    assert.deepStrictEqual(l.todayActive, { alpha: 30 * MIN, beta: 0 })
    assert.strictEqual(l.globalToday, 30 * MIN)
    assert.strictEqual(l.log.activeTime, 30 * MIN)
  })

  // storage.updateStreak runs every tick; without these the streak shown would
  // stay at yesterday's count until the dashboard was reopened.
  it("carries the stored streaks so they stay current while the dashboard is open", () => {
    const l = buildLive(store(), new Date())
    assert.strictEqual(l.globalStreak, 6)
    assert.deepStrictEqual(l.streaks, { alpha: 4, beta: 0 })
  })
})

// ProjectMeta.streak is a cache that only the open project's tick refreshes, so a
// project left alone kept its last streak for ever (mekatrone showed 1 three idle
// days after its last met day). Payloads must read the chain, not the cache.
describe("per-project streaks for a project not opened lately", () => {
  function idle() {
    return makeStore({
      [PROJECTS_KEY]: [proj("alpha", 0), proj("gamma", 1)],
      [`rabbithole:log:gamma:${daysAgo(3)}`]: { ...log(50 * MIN, daysAgo(3)), streak: 1 },
    }).s
  }

  it("drops to 0 in the year payload once the chain is broken", () => {
    const y = buildYear(idle(), new Date(), TARGET)
    assert.strictEqual(y.projects.find((p: any) => p.id === "gamma").streak, 0)
  })

  it("drops to 0 in the live payload too", () => {
    assert.strictEqual(buildLive(idle(), new Date()).streaks.gamma, 0)
  })

  it("keeps a streak that is only at risk today", () => {
    const s = makeStore({
      [PROJECTS_KEY]: [proj("alpha", 0), proj("gamma", 9)],
      [`rabbithole:log:gamma:${daysAgo(1)}`]: { ...log(50 * MIN, daysAgo(1)), streak: 3 },
    }).s
    assert.strictEqual(buildLive(s, new Date()).streaks.gamma, 3)
  })
})

// The sidebar redraws everything from one message, so its parts must agree on the day.
describe("sidebar payload", () => {
  it("carries the year and today's log for every project, all for the same day", () => {
    const m = buildMini(store(), new Date(), TARGET)
    assert.strictEqual(m.year.today, today)
    assert.deepStrictEqual(Object.keys(m.logs).sort(), ["alpha", "beta"])
    assert.ok(Object.values(m.logs).every((l: any) => l.date === today))
    assert.strictEqual(m.logs.alpha.activeTime, 30 * MIN)
    assert.strictEqual(m.logs.beta.activeTime, 0)
  })

})

import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/miniModel.ts
import { eighthRows, miniView } from "miniModel"
import { MIN, TODAY, addDays, at, todayLogs, world } from "./helpers/exportFixtures"

const HOUR = 60 * MIN
const NOW = at(TODAY, 18)

// alpha: today 50m (two sessions), yesterday 25m, the day before 10m; beta: today 30m.
const w = world({
  alpha: {
    [TODAY]: {
      ms: 50 * MIN,
      langs: { typescript: [40 * MIN, 100, 20], markdown: [10 * MIN, 5, 0] },
      files: [["/work/alpha/src/a.ts", 100, 20], ["/work/alpha/README.md", 5, 0]],
      sessions: [[9 * 60, 60, 40, { typescript: 40 * MIN }], [14 * 60, 15, 10, { markdown: 10 * MIN }]],
    },
    [addDays(TODAY, -1)]: { ms: 25 * MIN },
    [addDays(TODAY, -2)]: { ms: 10 * MIN },
  },
  beta: { [TODAY]: { ms: 30 * MIN, langs: { go: [30 * MIN, 10, 2] }, files: [["/work/beta/main.go", 10, 2]], sessions: [[11 * 60, 40, 30, { go: 30 * MIN }]] } },
}, { globalStreak: 3 })
const view = (focus: string | null, ww: any = w) => miniView(ww.year, todayLogs(ww), focus, NOW)

describe("sidebar: all projects", () => {
  const v = view(null)

  it("shows today across projects against the global target, and when it was met", () => {
    assert.strictEqual(v.who, "all projects")
    assert.strictEqual(v.todayMs, 80 * MIN)
    assert.strictEqual(v.targetMs, 20 * MIN)
    assert.deepStrictEqual(v.meter, [10, 0])
    assert.strictEqual(v.metAt, at(TODAY, 9, 30))
    assert.deepStrictEqual([v.added, v.deleted], [115, 22])
  })

  it("takes the streak from storage and marks the last 14 days", () => {
    assert.strictEqual(v.streak, 3)
    assert.deepStrictEqual(v.marks.slice(-3), ["miss", "met", "today"])
    assert.strictEqual(v.todayMet, true)
  })

  it("lists today's projects by time with their share, and the week's projects as keys", () => {
    assert.deepStrictEqual(v.projects.map((p: any) => [p.id, p.ms, p.share]), [["alpha", 50 * MIN, 0.625], ["beta", 30 * MIN, 0.375]])
    assert.deepStrictEqual(v.keys.map((k: any) => k.id), ["alpha", "beta"])
  })

  it("draws the last seven days on a scale of whole hours, today last", () => {
    assert.strictEqual(v.week.length, 7)
    assert.strictEqual(v.week.map((d: any) => d.label).join(""), "TWTFSSM")
    assert.ok(v.week[6].today && !v.week[5].today)
    assert.strictEqual(v.weekMax, 2 * HOUR)
    assert.deepStrictEqual(v.week[6].rows, [" ", "▅", "█", "█"])
  })
})

describe("sidebar: focus on one project", () => {
  const v = view("beta")

  it("narrows today, lines and the tape to the project, against its own target", () => {
    assert.strictEqual(v.who, "beta only")
    assert.strictEqual(v.todayMs, 30 * MIN)
    assert.deepStrictEqual([v.added, v.deleted], [10, 2])
    assert.strictEqual(v.sessions.length, 1)
    assert.strictEqual(v.baseSessions.length, 3)
    assert.strictEqual(v.metAt, at(TODAY, 11) + 1_600_000)
  })

  it("keeps the week's scale, so the project shows as its share of each day", () => {
    assert.strictEqual(v.weekMax, 2 * HOUR)
    assert.deepStrictEqual(v.week[6].rows, [" ", " ", " ", "█"])
    assert.strictEqual(v.week[6].total, 80 * MIN)
  })

  it("leaves the streak and today's project list as they are", () => {
    assert.strictEqual(v.streak, 3)
    assert.strictEqual(v.projects.length, 2)
  })

  it("a project that no longer exists falls back to all projects", () => {
    const g = view("gone")
    assert.strictEqual(g.focus, null)
    assert.strictEqual(g.who, "all projects")
    assert.strictEqual(g.todayMs, 80 * MIN)
  })
})

describe("sidebar: nothing to show", () => {
  it("a brand-new install shows zeros and no projects, never NaN", () => {
    const v = view(null, world({}, { ids: [] }))
    for (const k of ["todayMs", "targetMs", "remainingMs", "weekMax", "added", "deleted", "streak"]) {
      assert.ok(Number.isFinite(v[k]), `${k} = ${v[k]}`)
    }
    assert.strictEqual(v.todayMs, 0)
    assert.deepStrictEqual(v.meter, [0, 10])
    assert.strictEqual(v.metAt, null)
    assert.deepStrictEqual([v.projects, v.keys, v.sessions], [[], [], []])
    assert.strictEqual(v.weekMax, HOUR)
  })
})

describe("eighth-block columns", () => {
  it("nothing is blank, any activity shows a step, the maximum fills all four rows", () => {
    assert.deepStrictEqual(eighthRows(0, HOUR), [" ", " ", " ", " "])
    assert.deepStrictEqual(eighthRows(1, HOUR), [" ", " ", " ", "▁"])
    assert.deepStrictEqual(eighthRows(HOUR, HOUR), ["█", "█", "█", "█"])
  })
})

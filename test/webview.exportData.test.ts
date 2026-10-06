import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/exportModel.ts
import { LANG_COLORS, OTHER_COLOR, SPANS, exportData, fitSpan, generatedText, mix, rangeText, spanDates } from "exportModel"
import { MIN, TODAY, addDays, at, world } from "./helpers/exportFixtures"

const D1 = addDays(TODAY, -1)
const D2 = addDays(TODAY, -2)
const NOW = at(TODAY, 18)

// alpha: today 50m (two sessions), yesterday 25m, the day before 10m; beta: today 30m.
function busy(opts: any = {}) {
  return world({
    alpha: {
      [TODAY]: {
        ms: 50 * MIN,
        langs: { typescript: [40 * MIN, 100, 20], markdown: [10 * MIN, 5, 0] },
        files: [["/work/alpha/src/a.ts", 100, 20], ["/work/alpha/README.md", 5, 0]],
        sessions: [[9 * 60, 60, 40, { typescript: 40 * MIN }], [14 * 60, 15, 10, { markdown: 10 * MIN }]],
      },
      [D1]: { ms: 25 * MIN },
      [D2]: { ms: 10 * MIN },
    },
    beta: {
      [TODAY]: { ms: 30 * MIN, langs: { go: [30 * MIN, 10, 2] }, files: [["/work/beta/main.go", 10, 2]], sessions: [[11 * 60, 40, 30, { go: 30 * MIN }]] },
    },
  }, { globalStreak: 3, streaks: { alpha: 2 }, ...opts })
}
const data = (w: any, sel: string, span: string) => exportData(w.range, w.year, sel, span, NOW)

describe("export spans", () => {
  it("the card has no 90 days; switching to it keeps the longest span it has", () => {
    assert.ok(!SPANS.card.includes("90d"))
    assert.strictEqual(fitSpan("card", "90d"), "30d")
    assert.strictEqual(fitSpan("report", "30d"), "30d")
  })

  it("a span ends today and counts today", () => {
    assert.deepStrictEqual(spanDates("7d", TODAY), { from: addDays(TODAY, -6), to: TODAY })
    assert.deepStrictEqual(spanDates("today", TODAY), { from: TODAY, to: TODAY })
  })
})

describe("one day, all projects", () => {
  const d = data(busy(), "all", "today")

  it("totals the day across projects, from the fetched 90 days narrowed to today", () => {
    assert.strictEqual(d.title, "all projects")
    assert.strictEqual(d.daysList.length, 1)
    assert.strictEqual(d.totalMs, 80 * MIN)
    assert.deepStrictEqual([d.added, d.deleted], [115, 22])
  })

  it("lists every session in time order with its project and languages", () => {
    assert.deepStrictEqual(d.sessions.map((s: any) => [s.start, s.project, s.languages]), [
      [at(TODAY, 9), "alpha", ["typescript"]],
      [at(TODAY, 11), "beta", ["go"]],
      [at(TODAY, 14), "alpha", ["markdown"]],
    ])
    assert.strictEqual(d.firstStart, at(TODAY, 9))
    assert.strictEqual(d.lastEnd, at(TODAY, 14, 15))
  })

  it("ranks languages by time and colours them by that rank", () => {
    assert.deepStrictEqual(d.langs.map((l: any) => [l.name, l.color]), [["typescript", LANG_COLORS[0]], ["go", LANG_COLORS[1]], ["markdown", LANG_COLORS[2]]])
    assert.ok(d.langs.every((l: any) => l.texture === "solid"))
  })

  it("past six languages, a language keeps a palette colour and takes the dashboard's texture", () => {
    const langs = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`l${i}`, [(30 - i) * MIN, 1, 0] as [number, number, number]]))
    const many = data(world({ a: { [TODAY]: { ms: 600 * MIN, langs } } }), "all", "today").langs
    const at = (i: number) => [many[i].name, many[i].color, many[i].texture]
    assert.deepStrictEqual(at(5), ["l5", LANG_COLORS[5], "solid"])
    assert.deepStrictEqual(at(6), ["l6", LANG_COLORS[0], "stripes"])
    assert.deepStrictEqual(at(12), ["l12", LANG_COLORS[0], "bars"])
    assert.deepStrictEqual(at(23), ["l23", LANG_COLORS[5], "checks"])
    assert.deepStrictEqual(at(24), ["l24", OTHER_COLOR, "solid"])
  })

  it("takes the streak from storage and marks the last 14 days against each day's target", () => {
    assert.strictEqual(d.streak, 3)
    assert.strictEqual(d.marks.length, 14)
    assert.deepStrictEqual(d.marks.slice(-3), ["miss", "met", "today"])   // 10m, 25m, today
  })

  it("draws the day on a 24-cell tape for the card and a 48-cell one for the report", () => {
    assert.strictEqual(d.tapes.card.cells.length, 24)
    assert.strictEqual(d.tapes.report.cells.length, 48)
    assert.strictEqual(d.tapes.report.win.cellMin, 15)
    assert.strictEqual(d.heat, null)
  })

  it("lists projects by time, and files as git would with the project in front", () => {
    assert.deepStrictEqual(d.projects, [{ name: "alpha", ms: 50 * MIN }, { name: "beta", ms: 30 * MIN }])
    assert.deepStrictEqual(d.files.map((f: any) => [f.dir, f.name, f.added, f.deleted]), [
      ["alpha/src/", "a.ts", 100, 20], ["beta/", "main.go", 10, 2], ["alpha/", "README.md", 5, 0],
    ])
  })
})

describe("a range for one project", () => {
  const d = data(busy(), "alpha", "7d")

  it("has one entry per day, and counts active days, the best day and the average", () => {
    assert.strictEqual(d.title, "alpha")
    assert.strictEqual(d.daysList.length, 7)
    assert.ok(d.daysList[6].today)
    assert.strictEqual(d.activeDays, 3)
    assert.strictEqual(d.totalMs, 85 * MIN)
    assert.strictEqual(d.best.date, TODAY)
    assert.strictEqual(d.perActiveMs, 85 * MIN / 3)
  })

  it("counts days on target, has no sessions or tape, and uses the project's own streak", () => {
    assert.strictEqual(d.metDays, 2)
    assert.deepStrictEqual(d.sessions, [])
    assert.strictEqual(d.tapes, null)
    assert.deepStrictEqual(d.projects, [])
    assert.strictEqual(d.streak, 2)
    assert.strictEqual(d.files[0].dir, "src/")
  })

  it("judges a past day against the target stamped on it, today against the live one", () => {
    const s = data(busy({ stamped: { [D1]: 30 } }), "all", "7d")
    assert.strictEqual(s.daysList.find((x: any) => x.date === D1).met, false)
    assert.strictEqual(s.metDays, 1)
  })
})

describe("heatmaps", () => {
  it("30 days get five Monday-first weeks ending this week; days after today are empty", () => {
    const h = data(busy(), "all", "30d").heat
    assert.strictEqual(h.weeks, 5)
    assert.strictEqual(h.cells.length, 35)
    assert.deepStrictEqual(h.cells[28], { date: TODAY, level: 2, today: true })
    assert.deepStrictEqual(h.cells[27], { date: D1, level: 1, today: false })
    assert.ok(h.cells.slice(29).every((c: any) => c === null))
  })

  it("90 days get thirteen weeks and every day of the span", () => {
    const d = data(busy(), "all", "90d")
    assert.strictEqual(d.heat.weeks, 13)
    assert.strictEqual(d.heat.cells.length, 91)
    assert.strictEqual(d.daysList.length, 90)
  })
})

describe("nothing to show", () => {
  it("a brand-new install gives zeros, never NaN", () => {
    const w = world({}, { ids: ["alpha"] })
    for (const span of ["today", "7d", "90d"]) {
      const d = data(w, "all", span)
      for (const k of ["totalMs", "activeDays", "perActiveMs", "added", "deleted", "metDays", "streak"]) {
        assert.ok(Number.isFinite(d[k]), `${span} ${k} = ${d[k]}`)
      }
      assert.strictEqual(d.best, null)
      assert.deepStrictEqual([d.langs, d.files, d.sessions], [[], [], []])
    }
    const day = data(w, "all", "today")
    assert.strictEqual(day.firstStart, null)
    assert.ok(day.tapes.card.cells.every((c: any) => c.level === 0))
  })

  it("a project cleared while the dialog was open is an empty, named export", () => {
    const d = data(busy(), "gone", "7d")
    assert.strictEqual(d.title, "unknown project")
    assert.strictEqual(d.totalMs, 0)
    assert.strictEqual(d.streak, 0)
  })
})

describe("export text and colour helpers", () => {
  it("mixes a colour toward the background by a clamped amount", () => {
    assert.strictEqual(mix("#39d98a", "#06090a", 1), "#39d98a")
    assert.strictEqual(mix("#39d98a", "#06090a", 0), "#06090a")
    assert.strictEqual(mix("#39d98a", "#06090a", 2), "#39d98a")
  })

  it("says when it was generated and which days it covers", () => {
    assert.strictEqual(generatedText(at(TODAY, 17, 58)), "generated 5 Oct 2026 17:58")
    assert.strictEqual(rangeText(data(busy(), "all", "today")), "Mon 5 Oct")
    assert.strictEqual(rangeText(data(busy(), "all", "7d")), "Tue 29 Sep – Mon 5 Oct")
  })
})

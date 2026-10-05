import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/exportLayout.ts
import { CARD_BOTTOM, CARD_H, CARD_TOP, CONTENT_H, cardLayout, dayRowCap, reportOutline, reportPages, stackHeight } from "exportLayout"
// @ts-ignore — esbuild alias to src/webview/exportModel.ts
import { exportData } from "exportModel"
import { MIN, TODAY, at, world } from "./helpers/exportFixtures"

const w = world({
  alpha: {
    [TODAY]: {
      ms: 50 * MIN,
      langs: { typescript: [40 * MIN, 100, 20], markdown: [10 * MIN, 5, 0] },
      files: [["/work/alpha/src/a.ts", 100, 20], ["/work/alpha/README.md", 5, 0]],
      sessions: [[9 * 60, 60, 40, { typescript: 40 * MIN }], [14 * 60, 15, 10, { markdown: 10 * MIN }]],
    },
  },
  beta: { [TODAY]: { ms: 30 * MIN, langs: { go: [30 * MIN, 10, 2] }, files: [["/work/beta/main.go", 10, 2]], sessions: [[11 * 60, 40, 30, { go: 30 * MIN }]] } },
})
const real = (sel: string, span: string) => exportData(w.range, w.year, sel, span, at(TODAY, 18))

// reportPages reads only counts, so the worst cases are described directly.
const n = (k: number) => Array.from({ length: k }, (_, i) => ({ i }))
const fake = (o: any): any => ({
  single: false, sel: "all", days: 7, activeDays: 0, metDays: 0,
  langs: [], projects: [], sessions: [], files: [], daysList: [], heat: null, tapes: null, ...o,
})
const tapes = { card: { cells: n(24), win: { cellMin: 30 } }, report: { cells: n(48), win: { cellMin: 15 } } }
const crowded = (o: any) => fake({ langs: n(30), projects: n(40), sessions: n(50), files: n(300), ...o })
const WORST = [
  crowded({ single: true, days: 1, activeDays: 1, daysList: n(1), tapes }),
  crowded({ days: 7, activeDays: 7, daysList: n(7) }),
  crowded({ days: 30, activeDays: 30, daysList: n(30), heat: { weeks: 5 } }),
  crowded({ days: 90, activeDays: 90, daysList: n(90), heat: { weeks: 13 } }),
]

describe("share card layout", () => {
  for (const span of ["today", "7d", "30d"]) {
    it(`${span}: every block sits inside the 620 px card without overlapping`, () => {
      const blocks = cardLayout(real("all", span))
      assert.ok(blocks[0].y >= CARD_TOP)
      for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i - 1].y + blocks[i - 1].h <= blocks[i].y, `${blocks[i - 1].kind} runs into ${blocks[i].kind}`)
      const last = blocks[blocks.length - 1]
      assert.strictEqual(last.kind, "footer")
      assert.ok(last.y + last.h <= CARD_H - CARD_BOTTOM)
    })
  }

  it("one day gets the tape, a range the columns", () => {
    assert.ok(cardLayout(real("all", "today")).some((b: any) => b.kind === "tape"))
    assert.ok(cardLayout(real("all", "7d")).some((b: any) => b.kind === "columns"))
  })
})

describe("report pages", () => {
  it("one day: summary, tape, languages, projects; then sessions and files", () => {
    const pages = reportPages(real("all", "today"))
    assert.deepStrictEqual(pages.map((p: any[]) => p.map(s => s.kind)), [["tiles", "tape", "langs", "projects"], ["sessions", "files"]])
  })

  it("a range for one project: columns and no projects table; days instead of sessions; a heatmap from 30 days", () => {
    assert.deepStrictEqual(reportPages(real("alpha", "7d")).map((p: any[]) => p.map(s => s.kind)), [["tiles", "columns", "langs"], ["days", "files"]])
    assert.deepStrictEqual(reportPages(real("alpha", "30d"))[1].map((s: any) => s.kind), ["days", "files", "heat"])
  })

  it("the days table holds 18 rows below 30 days and 14 from 30, the rest counted", () => {
    assert.deepStrictEqual([dayRowCap(7), dayRowCap(29), dayRowCap(30), dayRowCap(90)], [18, 18, 14, 14])
    const days = (o: any) => reportPages(fake(o))[1][0]
    assert.deepStrictEqual([days({ days: 7, activeDays: 7 }).rows, days({ days: 7, activeDays: 7 }).more], [7, 0])
    assert.deepStrictEqual([days({ days: 30, activeDays: 25 }).rows, days({ days: 30, activeDays: 25 }).more], [14, 11])
  })

  it("long lists are capped with the rest counted", () => {
    const [p1, p2] = reportPages(WORST[0])
    const at = (secs: any[], kind: string) => secs.find(s => s.kind === kind)
    assert.deepStrictEqual([at(p1, "langs").rows, at(p1, "langs").more], [8, 22])
    assert.deepStrictEqual([at(p1, "projects").rows, at(p1, "projects").more], [6, 34])
    assert.deepStrictEqual([at(p2, "sessions").rows, at(p2, "sessions").more], [20, 30])
    assert.deepStrictEqual([at(p2, "files").rows, at(p2, "files").more], [10, 290])
  })

  it("the busiest day or range, for all projects or one, is two pages that fit", () => {
    for (const c of WORST) {
      for (const sel of ["all", "alpha"]) {
        const pages = reportPages({ ...c, sel })
        assert.strictEqual(pages.length, 2)
        pages.forEach((p: any[], i: number) => assert.ok(stackHeight(p) <= CONTENT_H, `days ${c.days} ${sel} page ${i + 1}: ${stackHeight(p)} > ${CONTENT_H}`))
      }
    }
  })

  it("an empty export still has a row for 'none' in every table", () => {
    const pages = reportPages(fake({ single: true, days: 1, tapes }))
    for (const s of pages.flat()) assert.ok(s.h > 0)
    pages.forEach((p: any[]) => assert.ok(stackHeight(p) <= CONTENT_H))
  })
})

describe("report outline", () => {
  it("lists each page's sections with their sizes", () => {
    assert.deepStrictEqual(reportOutline(real("all", "today")), [
      { page: 1, items: ["summary · 8 tiles", "day tape · 15-minute cells", "languages · 3", "projects · 2"] },
      { page: 2, items: ["sessions · 3", "files · 3, git diff --stat"] },
    ])
  })

  it("says how much was left out", () => {
    const out = reportOutline(WORST[2])
    assert.strictEqual(out[0].items[2], "languages · 8 of 30")
    assert.strictEqual(out[1].items[0], "days · 14 of 30 active, newest first")
    assert.strictEqual(out[1].items[2], "activity · 5 weeks")
  })
})

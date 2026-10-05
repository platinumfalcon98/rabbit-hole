import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/format.ts
import { addDaysKey, ago, dayDiff, dstr, fmt, hhmm, hours, signed, splitPath } from "format"
// @ts-ignore — esbuild alias to src/webview/layout.ts
import { colAxis, colSegments, heatCells, heatLevel, heatMonths, heatWeeksFor, meter, runs, sparkGlyphs, tapeCellCount, tapeMaxCells, tapeTicks } from "layout"
// @ts-ignore — esbuild alias to src/webview/colors.ts
import { OTHER, languageColors, namesFor, projectColor } from "colors"
// @ts-ignore — esbuild alias to src/webview/calendar.ts
import { dayDisabled, monthDays, pickDay, pickLabel, presetOf, presetRange } from "calendar"

const MIN = 60_000
const HOUR = 60 * MIN

describe("format", () => {
  it("durations read like a terminal: 0m, <1m, 45m, 1h05m", () => {
    assert.strictEqual(fmt(0), "0m")
    assert.strictEqual(fmt(-5), "0m")
    assert.strictEqual(fmt(20_000), "<1m")
    assert.strictEqual(fmt(45 * MIN), "45m")
    assert.strictEqual(fmt(65 * MIN), "1h05m")
    assert.strictEqual(fmt(220 * MIN), "3h40m")
  })

  it("long totals drop the minutes", () => {
    assert.strictEqual(hours(12.4 * HOUR), "12h")
    assert.strictEqual(hours(9 * HOUR), "9h00m")
  })

  it("clock text rounds without reaching :60", () => {
    assert.strictEqual(hhmm(7 * 60 + 5), "07:05")
    assert.strictEqual(hhmm(59.6), "01:00")
  })

  it("day arithmetic is on calendar days, across month ends and DST", () => {
    assert.strictEqual(addDaysKey("2026-01-31", 1), "2026-02-01")
    assert.strictEqual(addDaysKey("2026-03-01", -1), "2026-02-28")
    assert.strictEqual(dayDiff("2026-03-28", "2026-03-30"), 2)
    assert.strictEqual(dayDiff("2026-10-31", "2026-11-02"), 2)
    assert.strictEqual(dayDiff("2026-10-03", "2026-10-03"), 0)
  })

  it("dates and signs", () => {
    assert.strictEqual(dstr("2026-10-03"), "Sat 3 Oct")
    assert.strictEqual(signed(-12), "−12")
    assert.strictEqual(signed(0), "+0")
  })

  it("ago", () => {
    const now = new Date(2026, 9, 3, 12).getTime()
    assert.strictEqual(ago(undefined, now), "never")
    assert.strictEqual(ago(now - 30_000, now), "just now")
    assert.strictEqual(ago(now - 5 * MIN, now), "5 min ago")
    assert.strictEqual(ago(now - 3 * HOUR, now), "3 h ago")
    assert.strictEqual(ago(now - 50 * HOUR, now), "2 days ago")
  })

  it("paths show relative to the project, else their last three segments", () => {
    assert.deepStrictEqual(splitPath("C:\\Users\\me\\rh\\src\\a.ts", "C:\\Users\\me\\rh"), { dir: "src/", name: "a.ts" })
    assert.deepStrictEqual(splitPath("/x/y/z/w/file.ts", "/other"), { dir: "z/w/", name: "file.ts" })
    assert.deepStrictEqual(splitPath("/repo/README.md", "/repo"), { dir: "", name: "README.md" })
  })
})

describe("layout", () => {
  it("width breakpoints", () => {
    assert.strictEqual(tapeMaxCells(619), 24)
    assert.strictEqual(tapeMaxCells(620), 48)
    assert.strictEqual(heatWeeksFor(599), 26)
    assert.strictEqual(heatWeeksFor(600), 53)
  })

  it("tape cells are whole minutes that divide an hour, within the budget", () => {
    assert.strictEqual(tapeCellCount(720, 48), 48)    // 12 h at 15 min
    assert.strictEqual(tapeCellCount(780, 48), 39)    // 13 h at 20 min, not 52 at 15
    assert.strictEqual(tapeCellCount(1440, 48), 48)   // 24 h at 30 min
    assert.strictEqual(tapeCellCount(720, 24), 24)
    assert.strictEqual(tapeCellCount(1080, 24), 18)   // 18 h at 60 min
    assert.strictEqual(tapeCellCount(1440, 24), 24)
  })

  it("hour ticks thin out on a long, narrow tape", () => {
    const day = { startMin: 420, endMin: 1140, cells: 48, cellMin: 15 }
    const ticks = tapeTicks(day, 48)
    assert.strictEqual(ticks.length, 12)
    assert.strictEqual(ticks[0], "07")
    const all = tapeTicks({ startMin: 0, endMin: 1440, cells: 24, cellMin: 60 }, 24)
    assert.strictEqual(all.length, 24)
    assert.strictEqual(all[0], "00")
    assert.strictEqual(all[1], "")
  })

  it("+/- runs never exceed the columns and show both sides when both changed", () => {
    for (const cols of [2, 3, 6, 40]) {
      for (const [a, r] of [[1, 1], [1000, 1], [1, 1000], [500, 500], [0, 7], [7, 0]]) {
        const [na, nr] = runs(a, r, 1000, cols)
        assert.ok(na + nr <= cols, `${a}/${r} in ${cols} cols gave ${na}+${nr}`)
        if (a) assert.ok(na >= 1)
        if (r) assert.ok(nr >= 1)
      }
    }
    assert.deepStrictEqual(runs(0, 0, 0, 10), [0, 0])
  })

  it("column segments", () => {
    assert.deepStrictEqual(colSegments(0, 100), new Array(12).fill(0))
    assert.deepStrictEqual(colSegments(100, 100), new Array(12).fill(1))
    assert.strictEqual(colSegments(1, 1000)[0], 0.25)   // a sliver still shows
  })

  it("column axis labels by range length", () => {
    const week = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]
    const a = colAxis(week, "2026-10-03")
    assert.strictEqual(a.length, 7)
    assert.strictEqual(a[6].text, "sat 3")
    assert.strictEqual(a[6].cls, "now")
    const month = Array.from({ length: 30 }, (_: unknown, i: number) => addDaysKey("2026-09-04", i))
    assert.ok(colAxis(month, "2026-10-03").every((l: any) => l.cls === "mon"))
    assert.deepStrictEqual(colAxis([], "2026-10-03"), [])
  })

  it("heatmap levels, cells and month labels", () => {
    assert.deepStrictEqual([0, 29 * MIN, 30 * MIN, 90 * MIN, 180 * MIN].map(heatLevel), [0, 1, 2, 3, 4])
    assert.strictEqual(heatCells(371, 53).length, 371)
    const short = heatCells(365, 53)
    assert.strictEqual(short.length, 371)
    assert.strictEqual(short[364], 364)
    assert.strictEqual(short[365], null)
    assert.strictEqual(heatCells(365, 26)[0], 189)
    assert.deepStrictEqual(heatCells(0, 53), [])
    // 2025-09-29 is a Monday; September only shows two days at the left edge, so its label is skipped
    const days = Array.from({ length: 371 }, (_: unknown, i: number) => addDaysKey("2025-09-29", i))
    assert.deepStrictEqual(heatMonths(days, 53)[0], { text: "oct", col: 2 })
    assert.deepStrictEqual(heatMonths([], 53), [])
  })

  it("sparklines and the target meter", () => {
    const s = sparkGlyphs([0, 5, 10])
    assert.deepStrictEqual(s.map((g: any) => g.glyph), ["▁", "▄", "█"])
    assert.deepStrictEqual(s.map((g: any) => g.zero), [true, false, false])
    assert.deepStrictEqual(sparkGlyphs([]), [])
    assert.deepStrictEqual(meter(10, 20), [5, 5])
    assert.deepStrictEqual(meter(50, 20), [10, 0])
    assert.deepStrictEqual(meter(5, 0), [10, 0])
  })
})

describe("colours", () => {
  const year: any = { projects: ["a", "b", "c", "d", "e", "f", "g"].map(id => ({ id, name: id.toUpperCase(), path: "/" + id })) }

  it("projects keep their registry colour and wrap after six", () => {
    assert.strictEqual(projectColor(year, "a"), "var(--c1)")
    assert.strictEqual(projectColor(year, "f"), "var(--c6)")
    assert.strictEqual(projectColor(year, "g"), "var(--c1)")
    assert.strictEqual(projectColor(year, "zzz"), OTHER)
    assert.strictEqual(projectColor(null, "a"), OTHER)
  })

  it("languages are coloured by rank; the seventh is other", () => {
    const rows = ["ts", "md", "go", "css", "json", "sh", "lua"].map(name => ({ name, ms: 1, added: 0, deleted: 0 }))
    const m = languageColors(rows)
    assert.strictEqual(m.get("ts"), "var(--c1)")
    assert.strictEqual(m.get("sh"), "var(--c6)")
    assert.strictEqual(m.has("lua"), false)
  })

  it("names fall back for a project the year doesn't know", () => {
    const n = namesFor(year)
    assert.strictEqual(n.project("a"), "A")
    assert.strictEqual(n.project("gone"), "unknown project")
    assert.strictEqual(n.root("b"), "/b")
  })
})

describe("calendar", () => {
  const today = "2026-10-03"

  it("presets and back", () => {
    assert.deepStrictEqual(presetRange("7d", today), { from: "2026-09-27", to: today })
    assert.deepStrictEqual(presetRange("yday", today), { from: "2026-10-02", to: "2026-10-02" })
    assert.strictEqual(presetOf("2026-09-04", today, today), "30d")
    assert.strictEqual(presetOf("2026-09-05", today, today), null)
  })

  it("click a start, then an end; an earlier click becomes the start", () => {
    let p = pickDay({ start: null, end: null }, "2026-09-10")
    p = pickDay(p, "2026-09-20")
    assert.deepStrictEqual(p, { start: "2026-09-10", end: "2026-09-20" })
    p = pickDay(pickDay(p, "2026-09-15"), "2026-09-12")
    assert.deepStrictEqual(p, { start: "2026-09-12", end: "2026-09-15" })
    // too far back to keep the old start as the end
    p = pickDay({ start: "2026-09-15", end: null }, "2026-05-01")
    assert.deepStrictEqual(p, { start: "2026-05-01", end: null })
  })

  it("days past today, before the year and beyond 92 days are disabled", () => {
    const first = "2025-09-29"
    assert.strictEqual(dayDisabled({ start: null, end: null }, "2026-10-04", first, today), true)
    assert.strictEqual(dayDisabled({ start: null, end: null }, "2025-09-28", first, today), true)
    const p = { start: "2026-07-01", end: null }
    assert.strictEqual(dayDisabled(p, addDaysKey("2026-07-01", 91), first, today), false)
    assert.strictEqual(dayDisabled(p, addDaysKey("2026-07-01", 92), first, today), true)
  })

  it("month grids start on Monday", () => {
    const oct = monthDays(2026, 9)   // 1 Oct 2026 is a Thursday
    assert.deepStrictEqual(oct.slice(0, 4), [null, null, null, "2026-10-01"])
    assert.strictEqual(oct.length, 3 + 31)
  })

  it("selection text", () => {
    assert.strictEqual(pickLabel({ start: null, end: null }), "no range")
    assert.strictEqual(pickLabel({ start: "2026-09-10", end: null }), "10 Sep – …")
    assert.strictEqual(pickLabel({ start: "2026-09-10", end: "2026-09-12" }), "10 Sep – 12 Sep · 3 days")
  })
})

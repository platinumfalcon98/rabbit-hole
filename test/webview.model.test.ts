import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/model.ts
import { buildView, datesBetween, daySlice, lineRows } from "model"

const MIN = 60_000

function dlog(date: string, parts: { active?: number; sessions?: any[]; files?: any[]; languages?: Record<string, any> } = {}): any {
  return {
    date, totalTime: 0, activeTime: parts.active ?? 0, streak: 0,
    languages: parts.languages ?? {}, agents: {}, files: parts.files ?? [], sessions: parts.sessions ?? [],
  }
}
const file = (path: string, language: string, a: number, d: number) => ({ path, language, linesAdded: a, linesDeleted: d, lastModified: 0 })
const lang = (time: number, a = 0, d = 0) => ({ time, linesAdded: a, linesDeleted: d })
const sess = (id: string, start: number, active: number, languages?: Record<string, number>) =>
  ({ id, startTime: start, endTime: start + active, duration: active, activeTime: active, ...(languages ? { languages } : {}) })

const D1 = "2026-10-02", D2 = "2026-10-03"
const range: any = {
  from: D1, to: D2,
  logs: {
    alpha: [
      dlog(D1, { active: 10 * MIN, files: [file("/a.ts", "typescript", 5, 1)], languages: { typescript: lang(10 * MIN, 5, 1) },
        sessions: [sess("a0", 1000, 10 * MIN, { typescript: 10 * MIN })] }),
      dlog(D2, { active: 30 * MIN,
        files: [file("/a.ts", "typescript", 20, 4), file("/README.md", "markdown", 6, 0)],
        languages: { typescript: lang(20 * MIN, 20, 4), markdown: lang(10 * MIN, 6, 0) },
        sessions: [sess("a1", 5000, 30 * MIN, { typescript: 20 * MIN, markdown: 10 * MIN })] }),
    ],
    beta: [
      dlog(D1),
      dlog(D2, { active: 12 * MIN,
        files: [file("/a.ts", "typescript", 3, 3)],
        languages: { typescript: lang(12 * MIN, 3, 3) },
        // recorded before per-session languages existed
        sessions: [sess("b1", 2000, 12 * MIN)] }),
    ],
  },
}

describe("day slices", () => {
  it("merges all projects and tags sessions and files with their project", () => {
    const s = daySlice(range, D2, "all", null)
    assert.strictEqual(s.activeMs, 42 * MIN)
    assert.deepStrictEqual(s.sessions.map((x: any) => [x.id, x.projectId]), [["b1", "beta"], ["a1", "alpha"]])
    assert.deepStrictEqual(s.files.map((f: any) => f.projectId + f.path), ["alpha/a.ts", "alpha/README.md", "beta/a.ts"])
    assert.deepStrictEqual(s.languages.map((l: any) => [l.name, l.ms]), [["typescript", 32 * MIN], ["markdown", 10 * MIN]])
    assert.strictEqual(s.linesAdded, 29)
    assert.strictEqual(s.linesDeleted, 7)
  })

  it("a single-project selection ignores the others", () => {
    const s = daySlice(range, D2, "beta", null)
    assert.strictEqual(s.activeMs, 12 * MIN)
    assert.strictEqual(s.sessions.length, 1)
  })

  it("a project focus keeps only that project", () => {
    const s = daySlice(range, D2, "all", { kind: "project", id: "beta" })
    assert.strictEqual(s.activeMs, 12 * MIN)
    assert.deepStrictEqual(s.files.map((f: any) => f.projectId), ["beta"])
  })

  it("a language focus uses that language's time, files and session shares", () => {
    const s = daySlice(range, D2, "all", { kind: "language", id: "markdown" })
    assert.strictEqual(s.activeMs, 10 * MIN)
    assert.deepStrictEqual(s.files.map((f: any) => f.path), ["/README.md"])
    assert.deepStrictEqual(s.sessions.map((x: any) => [x.id, x.activeTime]), [["a1", 10 * MIN]])
    assert.strictEqual(s.linesAdded, 6)
  })

  it("sessions without per-session languages drop out of a language focus but the day total still counts them", () => {
    const s = daySlice(range, D2, "all", { kind: "language", id: "typescript" })
    assert.strictEqual(s.activeMs, 32 * MIN)
    assert.deepStrictEqual(s.sessions.map((x: any) => x.id), ["a1"])
  })

  it("a day or project with no log gives zeros, not an error", () => {
    const s = daySlice(range, "2026-09-01", "all", null)
    assert.strictEqual(s.activeMs, 0)
    assert.deepStrictEqual(s.sessions, [])
    assert.strictEqual(daySlice(range, D2, "gone", null).activeMs, 0)
  })
})

describe("views", () => {
  it("sums shown and whole totals and merges files across days per project", () => {
    const v = buildView(range, "all", { kind: "project", id: "alpha" })
    assert.strictEqual(v.totalMs, 40 * MIN)
    assert.strictEqual(v.wholeMs, 52 * MIN)
    const tsAlpha = v.files.find((f: any) => f.projectId === "alpha" && f.path === "/a.ts")
    assert.strictEqual(tsAlpha.added, 25)
    assert.strictEqual(v.files.some((f: any) => f.projectId === "beta"), false)
    assert.deepStrictEqual(v.wholeLanguages.map((l: any) => l.name), ["typescript", "markdown"])
  })

  it("keeps the same path in two projects as two rows", () => {
    const v = buildView(range, "all", null)
    assert.strictEqual(v.files.filter((f: any) => f.path === "/a.ts").length, 2)
  })
})

describe("dates and line rows", () => {
  it("lists every day across a month boundary", () => {
    assert.deepStrictEqual(datesBetween("2026-09-29", "2026-10-02"), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"])
  })

  // A pure helper the panels will call from many places; a bad end date must
  // not hang the webview. Ranges are at most 92 days and the year 371.
  it("caps a runaway range and returns nothing for malformed dates", () => {
    assert.ok(datesBetween("2026-10-01", "9999-12-31").length <= 400)
    assert.deepStrictEqual(datesBetween("2026-10-01", "garbage"), [])
    assert.deepStrictEqual(datesBetween("bad", "2026-10-01"), [])
  })

  it("one row per day up to 14 days", () => {
    const v = buildView(range, "all", null)
    assert.strictEqual(lineRows(v.days).length, 2)
  })

  it("beyond 14 days, 7-day rows counted back from the last day", () => {
    const days = datesBetween("2026-09-04", "2026-10-03").map((date: string) => ({
      date, whole: null, shown: { linesAdded: 1, linesDeleted: 0 },
    }))
    const rows = lineRows(days as any)
    assert.strictEqual(rows.length, 5)
    assert.deepStrictEqual([rows[0].from, rows[0].to, rows[0].added], ["2026-09-04", "2026-09-05", 2])
    assert.deepStrictEqual([rows[4].from, rows[4].to, rows[4].added], ["2026-09-27", "2026-10-03", 7])
  })
})

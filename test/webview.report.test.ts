import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/exportModel.ts
import { exportData } from "exportModel"
// @ts-ignore — esbuild alias to src/webview/reportPdf.ts
import { reportPdf } from "report"
import { DaySpec, MIN, TODAY, addDays, at, sampleWorld, world } from "./helpers/exportFixtures"

// jsPDF runs in node, so the real renderer is exercised end to end.
const NOW = at(TODAY, 18)
const pdf = (w: any, sel: string, span: string): string =>
  Buffer.from(reportPdf(exportData(w.range, w.year, sel, span, NOW))).toString("latin1")
const pages = (s: string) => (s.match(/\/Type \/Page[^s]/g) ?? []).length

// 40 projects, 30 languages, 300 files and 50 sessions every day for 90 days,
// and names the embedded font can't draw.
function crowded() {
  const langs: Record<string, [number, number, number]> = {}
  for (let i = 0; i < 30; i++) langs[`lang-${i}`] = [(i + 1) * MIN, i * 3, i]
  const files = Array.from({ length: 300 }, (_, i): [string, number, number] =>
    [`/work/p0/src/very/deeply/nested/folder/file-${i}-🥕-日本.ts`, i + 1, i % 7])
  const sessions = Array.from({ length: 50 }, (_, i): [number, number, number, Record<string, number>] =>
    [i * 20, 15, 10, { "lang-0": 10 * MIN }])
  const spec: Record<string, Record<string, DaySpec>> = { p0: {} }
  for (let k = 0; k < 90; k++) spec.p0[addDays(TODAY, -k)] = { ms: 200 * MIN, langs, files, sessions }
  for (let p = 1; p < 40; p++) spec[`p${p}`] = { [TODAY]: { ms: 5 * MIN } }
  return world(spec, { names: { p0: "日本語プロジェクト 🥕" } })
}

describe("the report", () => {
  it("is a two-page PDF for every span, all projects or one", () => {
    const w = sampleWorld()
    for (const span of ["today", "7d", "30d", "90d"]) {
      for (const sel of ["all", "rabbit-hole"]) {
        const out = pdf(w, sel, span)
        assert.ok(out.startsWith("%PDF-"), `${span} ${sel}`)
        assert.strictEqual(pages(out), 2, `${span} ${sel}`)
      }
    }
  })

  it("renders an empty install without throwing", () => {
    const w = world({}, { ids: ["alpha"] })
    for (const span of ["today", "7d", "30d", "90d"]) assert.strictEqual(pages(pdf(w, "all", span)), 2)
  })

  it("renders the busiest day and quarter, with names the font lacks, in two pages", () => {
    const w = crowded()
    for (const span of ["today", "90d"]) {
      assert.strictEqual(pages(pdf(w, "all", span)), 2)
      assert.strictEqual(pages(pdf(w, "p0", span)), 2)
    }
  })
})

import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import { MIN, PROJECTS_KEY, cleanupStorageRoot, daysAgo, log, makeStore, proj, today } from "./helpers/store"

after(cleanupStorageRoot)

function store() {
  return makeStore({
    [PROJECTS_KEY]: [proj("alpha"), proj("beta")],
    [`rabbithole:log:alpha:${today}`]: {
      ...log(30 * MIN),
      files: [{ path: "/a.ts", language: "typescript", linesAdded: 10, linesDeleted: 2, lastModified: 0 }],
      sessions: [{ id: "a1", startTime: 1, endTime: 2, duration: 1, activeTime: 30 * MIN, languages: { typescript: 30 * MIN } }],
    },
    [`rabbithole:log:beta:${today}`]: log(20 * MIN),
    [`rabbithole:log:alpha:${daysAgo(10)}`]: log(15 * MIN, daysAgo(10)),
    [`rabbithole:global:${today}`]: { date: today, activeTime: 50 * MIN, streak: 3 },
    [`rabbithole:global:${daysAgo(10)}`]: { date: daysAgo(10), activeTime: 15 * MIN, streak: 1 },
  }).s
}

const csvRows = (csv: string) => csv.split("\n").slice(1)

describe("exports", () => {
  it("with no arguments, export the last 90 days of all projects, as before", () => {
    const s = store()
    assert.strictEqual(s.exportJSON(), JSON.stringify(s.getAggregateRange(90), null, 2))
    const rows = csvRows(s.exportCSV())
    assert.strictEqual(rows.length, 90)
    assert.ok(rows[89].startsWith(`${today},`))
  })

  it("limits to a date range", () => {
    const s = store()
    const rows = csvRows(s.exportCSV(daysAgo(2), today))
    assert.strictEqual(rows.length, 3)
    assert.ok(rows[2].includes(`,${50 * MIN},`))
  })

  it("limits to one project", () => {
    const s = store()
    const days = JSON.parse(s.exportJSON(today, today, "beta"))
    assert.strictEqual(days.length, 1)
    assert.strictEqual(days[0].activeTime, 20 * MIN)
  })

  it("keeps per-session languages in JSON", () => {
    const s = store()
    const days = JSON.parse(s.exportJSON(today, today, "alpha"))
    assert.deepStrictEqual(days[0].sessions[0].languages, { typescript: 30 * MIN })
  })
})

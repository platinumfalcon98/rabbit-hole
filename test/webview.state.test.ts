import { beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/state.ts
import { Store, fetchSpan, subRange } from "state"

const MIN = 60_000
const blankLog = (date: string): any => ({ date, totalTime: 0, activeTime: 0, streak: 0, languages: {}, agents: {}, files: [], sessions: [] })

function year(today: string, days: string[], ids = ["alpha"]): any {
  const zeros = () => days.map(() => 0)
  const nulls = () => days.map(() => null)
  return {
    type: "year", today, days, globalTargetMs: 20 * MIN,
    global: { streak: 0, active: zeros(), targetMs: nulls() },
    projects: ids.map(id => ({ id, name: id, path: "/" + id, streak: 0, active: zeros(), targetMs: nulls() })),
  }
}
const OCT3 = ["2026-10-01", "2026-10-02", "2026-10-03"]
const OCT4 = ["2026-10-02", "2026-10-03", "2026-10-04"]

function rangeMsg(from: string, to: string, ids = ["alpha"]): any {
  return { type: "range", from, to, logs: Object.fromEntries(ids.map(id => [id, []])) }
}
function live(projectId: string): any {
  return { type: "live", today: "2026-10-03", projectId, log: blankLog("2026-10-03"), todayActive: {}, globalToday: 0, globalStreak: 0, streaks: {} }
}

let posts: any[]
let s: any
const requests = () => posts.filter(m => m.type === "requestDays")
beforeEach(() => {
  posts = []
  s = new Store((m: any) => posts.push(m))
})

describe("store: what it asks the host for", () => {
  it("opens on today and fetches the week ending today", () => {
    s.receive(year("2026-10-03", OCT3))
    assert.strictEqual(s.view.from, "2026-10-03")
    assert.strictEqual(s.view.to, "2026-10-03")
    assert.strictEqual(s.view.preset, "today")
    assert.deepStrictEqual(requests(), [{ type: "requestDays", from: "2026-09-27", to: "2026-10-03" }])
  })

  it("a view inside the fetched days needs no request", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(rangeMsg("2026-09-27", "2026-10-03"))
    posts = []
    s.setView("2026-10-01", "2026-10-03", null)
    assert.deepStrictEqual(requests(), [])
    assert.strictEqual(s.days().from, "2026-10-01")
  })

  it("a view outside them asks", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(rangeMsg("2026-09-27", "2026-10-03"))
    posts = []
    s.setView("2026-09-04", "2026-10-03", "30d")
    assert.deepStrictEqual(requests(), [{ type: "requestDays", from: "2026-09-04", to: "2026-10-03" }])
    assert.strictEqual(s.days(), null)
  })

  it("a reply to an older request never shows under a newer view", () => {
    s.receive(year("2026-10-03", OCT3))
    s.setView("2026-09-27", "2026-10-03", "7d")
    s.setView("2026-09-04", "2026-10-03", "30d")
    s.receive(rangeMsg("2026-09-27", "2026-10-03"))
    assert.strictEqual(s.days(), null)
    s.receive(rangeMsg("2026-09-04", "2026-10-03"))
    assert.strictEqual(s.days().from, "2026-09-04")
  })

  it("a refused range is reported for the view that asked", () => {
    s.receive(year("2026-10-03", OCT3))
    s.setView("2026-01-01", "2026-10-03", null)
    s.receive({ type: "rangeRefused", from: "2026-01-01", to: "2026-10-03" })
    assert.strictEqual(s.refused, true)
    s.setView("2026-10-03", "2026-10-03", "today")
    assert.strictEqual(s.refused, false)
  })
})

describe("store: when the year changes", () => {
  it("midnight moves a today view and a 7d view with the date", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(year("2026-10-04", OCT4))
    assert.strictEqual(s.view.from, "2026-10-04")
    s.setView("2026-09-28", "2026-10-04", "7d")
    s.receive(year("2026-10-05", ["2026-10-03", "2026-10-04", "2026-10-05"]))
    assert.deepStrictEqual([s.view.from, s.view.to], ["2026-09-29", "2026-10-05"])
  })

  it("a picked range stays put at midnight", () => {
    s.receive(year("2026-10-03", OCT3))
    s.setView("2026-09-01", "2026-09-10", null)
    s.receive(year("2026-10-04", OCT4))
    assert.deepStrictEqual([s.view.from, s.view.to], ["2026-09-01", "2026-09-10"])
  })

  it("every year after the first refetches the shown days (data may have been wiped or imported)", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(rangeMsg("2026-09-27", "2026-10-03"))
    posts = []
    s.receive(year("2026-10-03", OCT3))
    assert.strictEqual(requests().length, 1)
  })

  it("a selected project that no longer exists falls back to all projects", () => {
    s.receive(year("2026-10-03", OCT3))
    s.setSelection("alpha")
    s.receive(year("2026-10-03", OCT3, []))
    assert.strictEqual(s.view.sel, "all")
  })

  it("an empty install still gives a view", () => {
    s.receive(year("2026-10-03", OCT3, []))
    s.receive(rangeMsg("2026-09-27", "2026-10-03", []))
    assert.deepStrictEqual(s.days().logs, {})
  })
})

describe("store: live updates", () => {
  it("asks for the year once when live names a project it doesn't know", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(live("newcomer"))
    s.receive(live("newcomer"))
    assert.strictEqual(posts.filter(m => m.type === "requestYear").length, 1)
    assert.strictEqual(s.here, "newcomer")
  })

  // After "clear everything" the tracker's project stays unregistered until a
  // reload, so every live names it; asking again on each tick was a 10 s loop.
  it("asks about an unknown project once, even after the year it asked for arrives", () => {
    s.receive(year("2026-10-03", OCT3))
    s.receive(live("ghost"))
    s.receive(year("2026-10-03", OCT3))
    s.receive(live("ghost"))
    assert.strictEqual(posts.filter(m => m.type === "requestYear").length, 1)
    s.receive(live("other"))
    assert.strictEqual(posts.filter(m => m.type === "requestYear").length, 2)
  })

  it("is ignored before the first year", () => {
    s.receive(live("alpha"))
    assert.deepStrictEqual(posts, [])
  })
})

describe("store: helpers", () => {
  it("fetchSpan widens a short view to a week and leaves longer ones alone", () => {
    assert.deepStrictEqual(fetchSpan("2026-10-03", "2026-10-03"), { from: "2026-09-27", to: "2026-10-03" })
    assert.deepStrictEqual(fetchSpan("2026-09-04", "2026-10-03"), { from: "2026-09-04", to: "2026-10-03" })
  })

  it("subRange only answers inside what was fetched", () => {
    const r: any = { from: "2026-09-27", to: "2026-10-03", logs: { a: [blankLog("2026-09-27"), blankLog("2026-10-03")] } }
    assert.deepStrictEqual(subRange(r, "2026-10-03", "2026-10-03").logs.a.map((l: any) => l.date), ["2026-10-03"])
    assert.strictEqual(subRange(r, "2026-09-26", "2026-10-03"), null)
  })

  it("the console keeps the last nine lines", () => {
    for (let i = 0; i < 12; i++) s.note("", `line ${i}`)
    assert.strictEqual(s.console.length, 9)
    assert.strictEqual(s.console[0].text, "line 3")
  })
})

// The export dialog fetches its own 90 days; that reply must never become the
// dashboard's view data, even when its dates would cover the view.
describe("store: replies tagged for the export dialog", () => {
  it("ignores a tagged range and a tagged refusal", () => {
    s.receive(year("2026-10-03", OCT3))
    const span = fetchSpan("2026-10-03", "2026-10-03")
    s.receive({ ...rangeMsg(span.from, span.to), for: "export" })
    assert.strictEqual(s.days(), null)
    s.receive({ type: "rangeRefused", ...span, for: "export" })
    assert.strictEqual(s.refused, false)
    s.receive(rangeMsg(span.from, span.to))
    assert.notStrictEqual(s.days(), null)
  })
})

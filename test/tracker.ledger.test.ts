import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/tracker/lineLedger.ts
import { LineLedger, hashLines } from "ledger"

const D1 = "2026-10-03"
const D2 = "2026-10-04"
const h = (text: string) => hashLines(text)

describe("hashLines", () => {
  it("a trailing newline is not an extra line (git counts 'a\\nb\\n' as 2)", () =>
    assert.strictEqual(h("a\nb\n").length, 2))
  it("no trailing newline still counts the last line", () =>
    assert.strictEqual(h("a\nb").length, 2))
  it("empty text has no lines", () => assert.strictEqual(h("").length, 0))
  // A CRLF<->LF flip rewrote every line under the old hashing.
  it("CRLF and LF hash identically", () =>
    assert.deepStrictEqual(h("x\r\ny\r\n"), h("x\ny\n")))
})

describe("first sighting and creation", () => {
  it("first sighting of a pre-existing file credits nothing", () => {
    const l = new LineLedger()
    assert.strictEqual(l.observe("/f", h("a\nb\n"), { day: D1 }), null)
    assert.ok(l.has("/f"))
  })
  it("a created file credits every line as added", () => {
    const l = new LineLedger()
    assert.deepStrictEqual(l.observe("/f", h("a\nb\nc\n"), { day: D1, isCreate: true }), { added: 3, deleted: 0 })
  })
  it("a created file with a seed only credits lines that differ from the seed", () => {
    const l = new LineLedger()
    const d = l.observe("/wt", h("a\nb\nc\n"), { day: D1, isCreate: true, seed: h("a\nb\n") })
    assert.deepStrictEqual(d, { added: 1, deleted: 0 })
  })
  it("prime() records a baseline without crediting, and is a no-op once tracked", () => {
    const l = new LineLedger()
    l.prime("/f", h("a\n"), D1)
    l.prime("/f", h("zzz\n"), D1) // ignored
    assert.deepStrictEqual(l.observe("/f", h("a\nb\n"), { day: D1 }), { added: 1, deleted: 0 })
  })
})

describe("net, not gross", () => {
  const l = new LineLedger()
  l.observe("/f", h("one\ntwo\nthree\n"), { day: D1 })

  it("an append credits the appended lines", () =>
    assert.deepStrictEqual(l.observe("/f", h("one\ntwo\nthree\nfour\n"), { day: D1 }), { added: 1, deleted: 0 }))
  it("rewriting a line added today does not grow the count (net unchanged)", () =>
    assert.strictEqual(l.observe("/f", h("one\ntwo\nthree\nFOUR\n"), { day: D1 }), null))
  it("changing a start-of-day line counts it once each way", () =>
    assert.deepStrictEqual(l.observe("/f", h("ONE\ntwo\nthree\nFOUR\n"), { day: D1 }), { added: 1, deleted: 1 }))
  it("reordering the same lines credits nothing", () =>
    assert.strictEqual(l.observe("/f", h("FOUR\nthree\ntwo\nONE\n"), { day: D1 }), null))
  it("reverting to the start-of-day content returns a negative delta to zero", () =>
    assert.deepStrictEqual(l.observe("/f", h("one\ntwo\nthree\n"), { day: D1 }), { added: -2, deleted: -1 }))
})

describe("deletion and recreation", () => {
  it("a file created and deleted the same day nets to zero", () => {
    const l = new LineLedger()
    const a = l.observe("/t", h("x\ny\nz\n"), { day: D1, isCreate: true })!
    const b = l.observe("/t", [], { day: D1 })!
    assert.strictEqual(a.added + b.added, 0)
    assert.strictEqual(a.deleted + b.deleted, 0)
  })
  it("deleting a start-of-day file counts its lines as deleted", () => {
    const l = new LineLedger()
    l.observe("/p", h("x\ny\n"), { day: D1 })
    assert.deepStrictEqual(l.observe("/p", [], { day: D1 }), { added: 0, deleted: 2 })
  })
  it("lastPresent() survives deletion", () => {
    const l = new LineLedger()
    l.observe("/p", h("x\ny\n"), { day: D1 })
    l.observe("/p", [], { day: D1 })
    assert.deepStrictEqual(l.lastPresent("/p"), h("x\ny\n"))
  })
})

describe("suppressed changes (git operations) are absorbed", () => {
  it("a suppressed change credits nothing and moves the baseline", () => {
    const l = new LineLedger()
    l.observe("/g", h("a\nb\n"), { day: D1 })
    assert.strictEqual(l.observe("/g", h("a\nb\nc\nd\n"), { day: D1, suppress: true }), null)
    // the next authored edit is measured against the post-checkout content
    assert.deepStrictEqual(l.observe("/g", h("a\nb\nc\nd\ne\n"), { day: D1 }), { added: 1, deleted: 0 })
  })
  it("a checkout that removes a line authored today keeps that line credited", () => {
    const l = new LineLedger()
    l.observe("/g", h("a\n"), { day: D1 })
    assert.deepStrictEqual(l.observe("/g", h("a\nmine\n"), { day: D1 }), { added: 1, deleted: 0 }) // authored
    assert.strictEqual(l.observe("/g", h("a\n"), { day: D1, suppress: true }), null)        // switch branch
    assert.strictEqual(l.observe("/g", h("a\nmine\n"), { day: D1, suppress: true }), null)  // switch back
    assert.strictEqual(l.observe("/g", h("a\nmine\n"), { day: D1 }), null)                  // still exactly +1
    assert.deepStrictEqual(l.observe("/g", h("a\nmine\nmore\n"), { day: D1 }), { added: 1, deleted: 0 })
  })
})

describe("day rollover", () => {
  it("the new day starts from the last content and charges nothing from yesterday", () => {
    const l = new LineLedger()
    l.observe("/r", h("a\n"), { day: D1 })
    l.observe("/r", h("a\nb\nc\n"), { day: D1 }) // +2 on D1
    assert.deepStrictEqual(l.observe("/r", h("a\nb\nc\nd\n"), { day: D2 }), { added: 1, deleted: 0 })
  })
})

// The extension host is shared and long-lived: a per-line bag for every file
// ever sighted would grow without bound. A bag is held only while a file has
// something credited today.
describe("memory", () => {
  it("first sightings and primes hold no line bag", () => {
    const l = new LineLedger()
    l.observe("/a", h("a\nb\n"), { day: D1 })
    l.prime("/b", h("c\n"), D1)
    assert.deepStrictEqual(l.stats(), { files: 2, bags: 0 })
  })
  it("a suppressed change on an uncredited file holds no bag", () => {
    const l = new LineLedger()
    l.observe("/a", h("a\n"), { day: D1 })
    l.observe("/a", h("a\nb\n"), { day: D1, suppress: true })
    assert.deepStrictEqual(l.stats(), { files: 1, bags: 0 })
  })
  it("a file with credit today holds a bag; reverting to zero releases it", () => {
    const l = new LineLedger()
    l.observe("/a", h("a\n"), { day: D1 })
    l.observe("/a", h("a\nb\n"), { day: D1 })
    assert.strictEqual(l.stats().bags, 1)
    l.observe("/a", h("a\n"), { day: D1 })
    assert.strictEqual(l.stats().bags, 0)
  })
  it("a new day releases every bag", () => {
    const l = new LineLedger()
    l.observe("/a", h("a\n"), { day: D1 })
    l.observe("/a", h("a\nb\n"), { day: D1 })
    l.observe("/z", h("z\n"), { day: D2 }) // any activity on the new day
    assert.strictEqual(l.stats().bags, 0)
  })
  it("wasEdited() is false for sightings, primes and suppressed changes", () => {
    const l = new LineLedger()
    l.observe("/a", h("a\n"), { day: D1 })
    l.prime("/b", h("b\n"), D1)
    l.observe("/a", h("a\nz\n"), { day: D1, suppress: true })
    assert.strictEqual(l.wasEdited("/a"), false)
    assert.strictEqual(l.wasEdited("/b"), false)
  })
  // Worktree work done in the evening and cherry-picked next morning must still
  // be recognised as already credited.
  it("wasEdited() survives a new day", () => {
    const l = new LineLedger()
    l.observe("/a", h("a\n"), { day: D1 })
    l.observe("/a", h("a\nb\n"), { day: D1 })
    l.observe("/z", h("z\n"), { day: D2 })
    assert.strictEqual(l.wasEdited("/a"), true)
  })
})

// Today's snapshots survive a VS Code restart: without them, the first agent
// edit to each unopened file after reopening is unmeasurable and lost.
describe("export / restore (today only)", () => {
  // JSON round trip, exactly as the snapshot file stores it.
  const roundTrip = (l: any, day: string) => JSON.parse(JSON.stringify(l.export(day)))

  it("an edit after restore is measured against the morning content", () => {
    const a = new LineLedger()
    a.observe("/f", h("a\nb\n"), { day: D1 })                 // morning photo
    a.observe("/f", h("a\nb\nc\n"), { day: D1 })              // +1 credited
    const b = new LineLedger()
    assert.strictEqual(b.restore(roundTrip(a, D1), D1), true)
    assert.deepStrictEqual(b.observe("/f", h("a\nb\nc\nd\n"), { day: D1 }), { added: 1, deleted: 0 })
  })
  it("an untouched photo restores too, so the first edit after restart counts", () => {
    const a = new LineLedger()
    a.observe("/f", h("x\n"), { day: D1 })
    const b = new LineLedger()
    b.restore(roundTrip(a, D1), D1)
    assert.deepStrictEqual(b.observe("/f", h("x\ny\n"), { day: D1 }), { added: 1, deleted: 0 })
  })
  it("a snapshot from another day is ignored", () => {
    const a = new LineLedger()
    a.observe("/f", h("x\n"), { day: D1 })
    const b = new LineLedger()
    assert.strictEqual(b.restore(roundTrip(a, D1), D2), false)
    assert.strictEqual(b.observe("/f", h("x\ny\n"), { day: D2 }), null) // first sighting again
  })
  it("only files seen today are exported", () => {
    const a = new LineLedger()
    a.observe("/old", h("x\n"), { day: D1 })
    a.observe("/new", h("y\n"), { day: D2 })
    assert.deepStrictEqual(Object.keys(a.export(D2).files), ["/new"])
  })
  it("a suppressed (git-op) baseline shift survives the round trip", () => {
    const a = new LineLedger()
    a.observe("/g", h("a\n"), { day: D1 })
    a.observe("/g", h("a\nmine\n"), { day: D1 })                       // +1 authored
    a.observe("/g", h("a\n"), { day: D1, suppress: true })              // branch switch
    const b = new LineLedger()
    b.restore(roundTrip(a, D1), D1)
    assert.strictEqual(b.observe("/g", h("a\nmine\n"), { day: D1, suppress: true }), null) // switch back
    assert.strictEqual(b.observe("/g", h("a\nmine\n"), { day: D1 }), null)                 // still exactly +1
  })
  it("wasEdited and deleted-file content survive the round trip", () => {
    const a = new LineLedger()
    a.observe("/w", h("a\n"), { day: D1 })
    a.observe("/w", h("a\nb\n"), { day: D1 })
    a.observe("/w", [], { day: D1 })
    const b = new LineLedger()
    b.restore(roundTrip(a, D1), D1)
    assert.strictEqual(b.wasEdited("/w"), true)
    assert.deepStrictEqual(b.lastPresent("/w"), h("a\nb\n"))
  })
  it("a malformed snapshot or entry is rejected without throwing", () => {
    const b = new LineLedger()
    assert.strictEqual(b.restore(null, D1), false)
    assert.strictEqual(b.restore({ version: 1, day: D1, files: "nope" }, D1), false)
    assert.strictEqual(
      b.restore({ version: 1, day: D1, files: { "/bad": { last: "x" }, "/ok": { last: [1, 2], base: null, credited: { added: 0, deleted: 0 }, edited: false } } }, D1),
      true)
    assert.strictEqual(b.has("/bad"), false)
    assert.strictEqual(b.has("/ok"), true)
  })
  it("a live entry is never overwritten by a restored one", () => {
    const b = new LineLedger()
    b.prime("/f", h("live\n"), D1)
    const a = new LineLedger()
    a.observe("/f", h("stale\n"), { day: D1 })
    b.restore(roundTrip(a, D1), D1)
    assert.deepStrictEqual(b.lastPresent("/f"), h("live\n"))
  })
  it("changes() moves whenever the ledger is mutated", () => {
    const l = new LineLedger()
    const c0 = l.changes()
    l.observe("/f", h("a\n"), { day: D1 })
    assert.notStrictEqual(l.changes(), c0)
  })
})

describe("restart", () => {
  it("a fresh ledger (VS Code restarted) credits nothing on first sighting", () => {
    const l = new LineLedger()
    assert.strictEqual(l.observe("/f", h("lots\nof\nlines\n"), { day: D1 }), null)
  })
})

describe("morning baseline on first sighting", () => {
  it("the first edit to an unseen file credits its diff against the morning content", () => {
    const l = new LineLedger()
    assert.deepStrictEqual(
      l.observe("/f", h("a\nb\nc\n"), { day: D1, morning: h("a\nb\n") }),
      { added: 1, deleted: 0 })
  })
  it("a file deleted before it was ever seen is credited as deleted", () => {
    const l = new LineLedger()
    assert.deepStrictEqual(l.observe("/f", [], { day: D1, morning: h("a\nb\n") }), { added: 0, deleted: 2 })
  })
  it("measuring the same content again credits nothing more", () => {
    const l = new LineLedger()
    l.observe("/f", h("a\nb\nc\n"), { day: D1, morning: h("a\nb\n") })
    assert.strictEqual(l.observe("/f", h("a\nb\nc\n"), { day: D1 }), null)
    assert.deepStrictEqual(l.observe("/f", h("a\nb\nc\nd\n"), { day: D1 }), { added: 1, deleted: 0 })
  })
  it("morning equal to the current content credits nothing but tracks the file", () => {
    const l = new LineLedger()
    assert.strictEqual(l.observe("/f", h("a\n"), { day: D1, morning: h("a\n") }), null)
    assert.ok(l.has("/f"))
  })
  it("a suppressed first sighting with morning credits nothing, and later edits count from there", () => {
    const l = new LineLedger()
    assert.strictEqual(l.observe("/f", h("x\ny\n"), { day: D1, morning: h("a\n"), suppress: true }), null)
    assert.deepStrictEqual(l.observe("/f", h("x\ny\nz\n"), { day: D1 }), { added: 1, deleted: 0 })
  })
  it("morning is ignored once the file is tracked", () => {
    const l = new LineLedger()
    l.prime("/f", h("a\n"), D1)
    assert.deepStrictEqual(l.observe("/f", h("a\nb\n"), { day: D1, morning: h("q\nr\ns\n") }), { added: 1, deleted: 0 })
  })
  it("a morning-started entry survives export/restore without double counting", () => {
    const l = new LineLedger()
    l.observe("/f", h("a\nb\nc\n"), { day: D1, morning: h("a\n") })
    const r = new LineLedger()
    assert.ok(r.restore(JSON.parse(JSON.stringify(l.export(D1))), D1))
    assert.strictEqual(r.observe("/f", h("a\nb\nc\n"), { day: D1 }), null)
  })
})

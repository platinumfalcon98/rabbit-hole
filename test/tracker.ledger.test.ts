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

describe("restart", () => {
  it("a fresh ledger (VS Code restarted) credits nothing on first sighting", () => {
    const l = new LineLedger()
    assert.strictEqual(l.observe("/f", h("lots\nof\nlines\n"), { day: D1 }), null)
  })
})

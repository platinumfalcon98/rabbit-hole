import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/tracker/lineNotes.ts
import { LineNotes } from "lineNotes"

describe("LineNotes", () => {
  it("keeps today's notes once each, in order", () => {
    const n = new LineNotes()
    n.add("d1", "a"); n.add("d1", "b"); n.add("d1", "a")
    assert.deepStrictEqual(n.current("d1"), ["a", "b"])
  })
  it("a new day starts empty; another day's notes are not shown", () => {
    const n = new LineNotes()
    n.add("d1", "a"); n.add("d2", "b")
    assert.deepStrictEqual(n.current("d1"), [])
    assert.deepStrictEqual(n.current("d2"), ["b"])
  })
  it("listeners hear new notes only", () => {
    const n = new LineNotes()
    let heard = 0
    const sub = n.onChange(() => heard++)
    n.add("d", "a"); n.add("d", "a")
    sub.dispose(); n.add("d", "b")
    assert.strictEqual(heard, 1)
  })
})

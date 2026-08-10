import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/tracker/storageService.ts
import { dateKey } from "storage"

// Built from LOCAL wall-clock components, so this is "00:30 on Aug 10" on
// whatever machine runs it — the window the mini panel got wrong when it
// derived its day key from toISOString().
const justAfterLocalMidnight = new Date(2026, 7, 10, 0, 30, 0)
const offsetMin = -justAfterLocalMidnight.getTimezoneOffset()

const viaDateKey = dateKey(justAfterLocalMidnight)
const viaIso = justAfterLocalMidnight.toISOString().slice(0, 10)

describe("dateKey uses the local day, not UTC", () => {
  it("returns the LOCAL day — matches every storage key", () => {
    assert.strictEqual(viaDateKey, "2026-08-10")
  })

  // Only a machine east of UTC can observe the divergence; the assertions are
  // skipped rather than silently dropped so the reason stays visible.
  const needsPositiveOffset = offsetMin <= 30
  const skip = needsPositiveOffset
    ? `machine is UTC${offsetMin / 60}; needs a positive offset to reproduce`
    : false

  it("the old UTC key resolved to the WRONG day", { skip }, () => {
    assert.strictEqual(viaIso, "2026-08-09")
  })

  it("the keys genuinely diverge (bug reproduced on this machine)", { skip }, () => {
    assert.notStrictEqual(viaDateKey, viaIso)
  })

  it("at midday the two agree (why the bug looked intermittent)", () => {
    const midday = new Date(2026, 7, 10, 12, 0, 0)
    assert.strictEqual(dateKey(midday), midday.toISOString().slice(0, 10))
  })

  it("every hour of the local day maps to the same dateKey", () => {
    for (let h = 0; h < 24; h++) {
      assert.strictEqual(dateKey(new Date(2026, 7, 10, h, 30, 0)), "2026-08-10")
    }
  })
})

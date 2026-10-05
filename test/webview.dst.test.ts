import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/model.ts
import { tapeCells, tapeWindow } from "model"

// The runner starts this suite with TZ=America/New_York. Clocks went forward at
// 02:00 on 2026-03-08 (a 23-hour day) and back at 02:00 on 2026-11-01 (25 hours).
const MIN = 60_000
const local = (mo: number, d: number, h: number, m = 0) => new Date(2026, mo, d, h, m).getTime()
const sess = (a: number, b: number) =>
  ({ id: String(a), startTime: a, endTime: b, duration: b - a, activeTime: b - a, intervals: [[a, b]] })

// Every quarter hour of the clock day, so a cell's start is its clock time.
const DAY = { startMin: 0, endMin: 1440, cells: 96, cellMin: 15 }
const msAt = (cells: any[], h: number, m = 0) => cells.find((c: any) => c.startMin === h * 60 + m).ms
const total = (cells: any[]) => cells.reduce((n: number, c: any) => n + c.ms, 0)

describe("day tape across daylight-saving changes", () => {
  it("runs in a zone with daylight saving", () => {
    assert.notStrictEqual(new Date(2026, 0, 15).getTimezoneOffset(), new Date(2026, 6, 15).getTimezoneOffset())
  })

  it("spring forward: 23:00 is drawn at 23:00, not an hour early", () => {
    const s = sess(local(2, 8, 23), local(2, 8, 23, 30))
    const cells = tapeCells([s], DAY, local(2, 9, 1))
    assert.strictEqual(msAt(cells, 23), 15 * MIN)
    assert.strictEqual(msAt(cells, 23, 15), 15 * MIN)
    assert.strictEqual(msAt(cells, 22), 0)
    assert.strictEqual(tapeWindow([s], 48, local(2, 9, 1)).endMin, 1440)
  })

  it("fall back: the last hour of the day is drawn instead of dropped", () => {
    const s = sess(local(10, 1, 23), local(10, 1, 23, 30))
    const cells = tapeCells([s], DAY, local(10, 2, 1))
    assert.strictEqual(msAt(cells, 23), 15 * MIN)
    assert.strictEqual(msAt(cells, 23, 15), 15 * MIN)
    assert.strictEqual(total(cells), 30 * MIN)
  })

  it("fall back: a session ending at midnight keeps its last half hour", () => {
    const s = sess(local(10, 1, 23, 30), local(10, 2, 0))
    const cells = tapeCells([s], DAY, local(10, 2, 1))
    assert.strictEqual(msAt(cells, 23, 45), 15 * MIN)
    assert.strictEqual(total(cells), 30 * MIN)
    assert.strictEqual(tapeWindow([s], 48, local(10, 2, 1)).endMin, 1440)
  })

  it("spring forward: work across the skipped hour lands either side of it", () => {
    // 01:50 EST → 03:10 EDT is 20 minutes of real time.
    const s = sess(local(2, 8, 1, 50), local(2, 8, 3, 10))
    assert.strictEqual(s.activeTime, 20 * MIN)
    const cells = tapeCells([s], DAY, local(2, 8, 12))
    assert.strictEqual(msAt(cells, 1, 45), 10 * MIN)
    assert.strictEqual(msAt(cells, 3), 10 * MIN)
    assert.strictEqual(msAt(cells, 2), 0)
    assert.strictEqual(msAt(cells, 2, 30), 0)
  })

  it("fall back: work across the repeated hour is drawn in both passes", () => {
    // 01:50 EDT → 01:10 EST (the second 01:00) is 20 minutes of real time.
    const a = local(10, 1, 1, 50)
    const s = sess(a, a + 20 * MIN)
    const cells = tapeCells([s], DAY, local(10, 1, 12))
    assert.strictEqual(msAt(cells, 1, 45), 10 * MIN)
    assert.strictEqual(msAt(cells, 1), 10 * MIN)
    assert.strictEqual(msAt(cells, 1, 15), 0)
    assert.strictEqual(total(cells), 20 * MIN)
  })
})

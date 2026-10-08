import { test } from "node:test"
import assert from "node:assert/strict"
import { cursorAt, cursorCues, type CursorKey } from "../src/cursor/path"
import { MIN_GAP_FRAMES } from "../src/audio/cues"

const keys: CursorKey[] = [
  { frame: 0, x: 0, y: 0 },
  { frame: 30, x: 500, y: 0, ease: "overshoot" },
  { frame: 60, x: 500, y: 0, click: true },
  { frame: 90, x: 520, y: 250 },
]

test("cursorAt hits each key exactly at its frame", () => {
  for (const k of keys) {
    const p = cursorAt(k.frame, keys)
    assert.ok(Math.abs(p.x - k.x) < 1e-6 && Math.abs(p.y - k.y) < 1e-6, `frame ${k.frame}`)
  }
})
test("before the first key and after the last it holds", () => {
  assert.deepEqual([cursorAt(-10, keys).x, cursorAt(-10, keys).y], [0, 0])
  assert.deepEqual([cursorAt(500, keys).x, cursorAt(500, keys).y], [520, 250])
})
test("overshoot passes beyond the target, then settles by the next key", () => {
  let beyond = false
  for (let f = 0; f <= 30; f++) if (cursorAt(f, keys).x > 500.5) beyond = true
  assert.ok(beyond)
  for (let f = 30; f <= 60; f++) assert.ok(Math.abs(cursorAt(f, keys).x - 500) < 1e-6)
})
test("pressed only within 6 frames of a click key", () => {
  assert.equal(cursorAt(59, keys).pressed, false)
  for (let f = 60; f < 66; f++) assert.equal(cursorAt(f, keys).pressed, true)
  assert.equal(cursorAt(66, keys).pressed, false)
})
test("cursorCues: a click and a release for each click key, a swipe for long moves", () => {
  const cues = cursorCues(keys, "t")
  const clicks = cues.filter(c => c.sound === "click")
  const releases = cues.filter(c => c.sound === "release")
  assert.equal(clicks.length, 1)
  assert.equal(releases.length, 1)
  assert.equal(clicks[0].frame, 60)
  assert.ok(releases[0].frame - clicks[0].frame >= MIN_GAP_FRAMES && releases[0].frame - clicks[0].frame <= 7)
  assert.deepEqual(cues.filter(c => c.sound === "swipe").map(c => c.frame), [0])
})

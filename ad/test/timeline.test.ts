import { test } from "node:test"
import assert from "node:assert/strict"
import { BAR_FRAMES, BEAT_FRAMES, PHASE_FRAMES, SCENES, barFrame, beatFrame, snapToBar } from "../src/timeline"
import { DURATION } from "../src/constants"

test("bars are a measured ~144 frames apart from the measured phase", () => {
  assert.ok(Math.abs(BAR_FRAMES - 144) < 1)
  assert.equal(BAR_FRAMES, BEAT_FRAMES * 4)
  assert.equal(barFrame(0), PHASE_FRAMES)
  for (let n = 0; n < 29; n++) assert.ok([144, 145].includes(barFrame(n + 1) - barFrame(n)))
  assert.equal(beatFrame(8), barFrame(2))
})
test("snapToBar picks the nearest bar line", () => {
  assert.equal(snapToBar(barFrame(5) + 70), barFrame(5))
  assert.equal(snapToBar(barFrame(5) + 74), barFrame(6))
  assert.equal(snapToBar(barFrame(5) - 70), barFrame(5))
})
test("scenes are contiguous, start at 0, end at 4200, in storyboard order", () => {
  assert.equal(SCENES[0].from, 0)
  assert.equal(SCENES[SCENES.length - 1].to, DURATION)
  for (let i = 1; i < SCENES.length; i++) assert.equal(SCENES[i].from, SCENES[i - 1].to)
  assert.deepEqual(SCENES.map(s => s.id), ["powerOn", "hook", "today", "month", "agent", "year", "streaks", "share", "local", "end"])
})
test("every inner boundary is on a bar line and within a bar of the spec's target", () => {
  const targets = [5, 14, 24, 34, 44, 52, 58, 63, 66].map(s => s * 60)
  SCENES.slice(1).forEach((s, i) => {
    assert.equal(snapToBar(s.from), s.from)
    assert.ok(Math.abs(s.from - targets[i]) <= BAR_FRAMES / 2 + 1)
  })
})

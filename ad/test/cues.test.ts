import { test } from "node:test"
import assert from "node:assert/strict"
import { schedule, MIN_GAP_FRAMES, type Cue } from "../src/audio/cues"

const c = (frame: number, event = String(frame)): Cue => ({ frame, sound: "tick", event })
test("no two onsets within the minimum gap", () => {
  const out = schedule([c(10), c(10, "10b"), c(11), c(30), c(31)])
  for (let i = 1; i < out.length; i++) assert.ok(out[i].frame - out[i - 1].frame >= MIN_GAP_FRAMES)
})
test("a cue never moves earlier than its event", () => {
  const input = [c(10, "a"), c(10, "b"), c(11, "c")]
  const out = schedule(input)
  for (const o of out) assert.ok(o.frame >= input.find(i => i.event === o.event)!.frame)
})
test("cues from different scenes at the same frame are spread (Review Focus 3)", () => {
  const out = schedule([{ frame: 840, sound: "whoosh", event: "hook→today" }, { frame: 840, sound: "thud", event: "today caption" }])
  assert.equal(out[1].frame - out[0].frame, MIN_GAP_FRAMES)
})
test("deterministic and order-independent", () => {
  const a = schedule([c(5, "x"), c(5, "y"), c(6, "z")])
  const b = schedule([c(6, "z"), c(5, "y"), c(5, "x")])
  assert.deepEqual(a, b)
})
test("keeps every cue and does not mutate its input", () => {
  const input = [c(3, "a"), c(3, "b")]
  const out = schedule(input)
  assert.equal(out.length, 2)
  assert.equal(input[1].frame, 3)
})
test.todo("filmCues() keeps the gap over the whole film")

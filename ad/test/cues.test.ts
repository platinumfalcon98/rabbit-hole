import { test } from "node:test"
import assert from "node:assert/strict"
import { schedule, MIN_GAP_FRAMES, type Cue } from "../src/audio/cues"
import { filmCues, rawFilmCues } from "../src/audio/film"
import { CAPTIONS } from "../src/captions/film"
import { DURATION } from "../src/constants"

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
test("filmCues() keeps the gap over the whole film, inside it, and never moves a cue early", () => {
  const raw = rawFilmCues()
  const out = filmCues()
  assert.equal(out.length, raw.length)
  assert.ok(out.length > 200)
  for (let i = 1; i < out.length; i++) assert.ok(out[i].frame - out[i - 1].frame >= MIN_GAP_FRAMES, `${out[i - 1].event} / ${out[i].event}`)
  for (const o of out) {
    assert.ok(o.frame >= raw.find(r => r.event === o.event)!.frame)
    assert.ok(o.frame >= 0 && o.frame < DURATION, o.event)
  }
  assert.equal(new Set(raw.map(r => r.event)).size, raw.length, "events are unique")
})
test("every caption entrance and flicker has a sound; exactly 3–4 captions flicker", () => {
  const raw = rawFilmCues()
  for (const c of CAPTIONS) {
    assert.ok(raw.some(r => r.frame === c.at && r.event.endsWith(" in")), c.lines.join(" "))
    if (c.flicker !== undefined) assert.ok(raw.some(r => r.frame === c.flicker && r.sound === "glitch"))
  }
  const n = CAPTIONS.filter(c => c.flicker !== undefined).length
  assert.ok(n >= 3 && n <= 4)
})
test("captions are the storyboard's, verbatim", () => {
  const plain = CAPTIONS.map(c => c.lines.join(" ").replace(/[[\]]/g, ""))
  assert.deepEqual(plain, [
    "WHERE DID TODAY GO?", "EVERY MINUTE. EVERY LANGUAGE.", "EVERY DAY, AT A GLANCE.", "YOUR AGENT CODES. RABBIT HOLE KNOWS.",
    "A WHOLE YEAR OF YOU.", "KEEP THE STREAK.", "SHARE IT.", "NO ACCOUNT. NO CLOUD. JUST YOUR MACHINE.",
  ])
})

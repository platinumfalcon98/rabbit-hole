import { test } from "node:test"
import assert from "node:assert/strict"
import { captionCues, decodeText, type CaptionSpec } from "../src/captions/effects"

const caps: CaptionSpec[] = [
  { lines: ["WHERE DID", "TODAY GO?"], at: 100, style: "slam" },
  { lines: ["EVERY MINUTE."], at: 200, style: "decode", flicker: 260 },
  { lines: ["SHARE IT."], at: 300, style: "stretch" },
  { lines: ["X"], at: 400, style: "glitch", flicker: 430 },
]

test("exactly one entrance cue per caption, at its frame", () => {
  const cues = captionCues(caps, "s")
  for (const c of caps) assert.equal(cues.filter(q => q.event.startsWith(`s caption ${c.lines.join(" ")} in`)).length, 1)
  assert.equal(cues.filter(q => q.event.endsWith(" in")).length, caps.length)
})
test("one glitch cue per flickering caption", () => {
  const cues = captionCues(caps, "s")
  assert.equal(cues.filter(q => q.sound === "glitch").length, caps.filter(c => c.flicker !== undefined).length)
})
test("decode ends on the caption text, and scrambles before that", () => {
  assert.equal(decodeText("EVERY MINUTE.", 1, 3), "EVERY MINUTE.")
  assert.notEqual(decodeText("EVERY MINUTE.", 0.3, 3), "EVERY MINUTE.")
  assert.equal(decodeText("EVERY MINUTE.", 0.3, 3).length, "EVERY MINUTE.".length)
  assert.equal(decodeText("A B", 0.1, 3)[1], " ")
  assert.equal(decodeText("EVERY", 0.5, 9), decodeText("EVERY", 0.5, 9))
})

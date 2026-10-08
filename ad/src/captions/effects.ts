// The caption kit's pure parts: timing, the scrambled-letter decode and the
// sounds each caption makes.
import type { Cue } from "../audio/cues"

export type CaptionStyle = "slam" | "decode" | "stretch" | "glitch"
export interface CaptionSpec {
  lines: string[]
  at: number                  // entrance frame (scene-relative)
  style: CaptionStyle
  flicker?: number            // frame of the rare flicker (3–4 in the film)
  until?: number              // exit frame (default: end of the scene)
}

export const ENTRANCE_FRAMES: Record<CaptionStyle, number> = { slam: 14, decode: 30, stretch: 16, glitch: 22 }
export const FLICKER_FRAMES = 16

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*+=?/<>░▒▓█"
const hash = (a: number, b: number, c: number) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** The text at decode progress t (0..1): letters lock in left to right, the rest cycle. */
export function decodeText(text: string, t: number, seed: number, step = 0): string {
  if (t >= 1) return text
  const n = text.length
  return Array.from(text, (ch, i) => {
    if (ch === " " || ch === "\n") return ch
    const lock = (i / Math.max(1, n - 1)) * 0.75 + hash(i, seed, 1) * 0.2
    if (t >= lock) return ch
    return GLYPHS[Math.floor(hash(i, seed, Math.floor(step / 2) + 7) * GLYPHS.length)]
  }).join("")
}

export function captionCues(caps: CaptionSpec[], scene: string): Cue[] {
  const out: Cue[] = []
  for (const c of caps) {
    const name = `${scene} caption ${c.lines.join(" ")}`
    const sound: Cue["sound"] = c.style === "stretch" ? "whoosh" : c.style === "decode" ? "sweep" : "thud"
    out.push({ frame: c.at, sound, gain: c.style === "glitch" ? 0.9 : 1, event: `${name} in` })
    if (c.style === "decode") {
      // the letters' chatter, every 3 frames while they lock in
      for (let f = 2; f < ENTRANCE_FRAMES.decode; f += 4) out.push({ frame: c.at + f, sound: "tick", variant: f, gain: 0.5, event: `${name} decode ${f}` })
    }
    if (c.flicker !== undefined) out.push({ frame: c.flicker, sound: "glitch", variant: c.lines.length, event: `${name} flicker` })
  }
  return out
}

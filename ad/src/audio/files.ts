// Which file plays for a cue. Paths are relative to public/.
import type { Cue } from "./cues"

const KENNEY = { click: "click", release: "release", hover: "hover", swipe: "swipe", whoosh: "whoosh", open: "open", close: "close" } as const

export function cueFile(c: Cue): string {
  switch (c.sound) {
    case "click": case "release": case "hover": case "swipe": case "whoosh": case "open": case "close":
      return `sfx/kenney/${KENNEY[c.sound]}.ogg`
    case "blip": return `sfx/synth/blip_${clampDeg(c.pitch)}.wav`
    case "pixel": return `sfx/synth/pixel_${clampDeg(c.pitch)}.wav`
    case "riser": return `sfx/synth/riser_${c.variant === 1 ? 1 : 0}.wav`
    case "tick": return `sfx/synth/tick_${(c.variant ?? 0) % 2 ? "b" : "a"}.wav`
    case "type": return `sfx/synth/type_${"abc"[(c.variant ?? 0) % 3]}.wav`
    case "thud": return "sfx/synth/thud.wav"
    case "glitch": return `sfx/synth/glitch_${(c.variant ?? 0) % 2 ? "b" : "a"}.wav`
    case "sweep": return `sfx/synth/sweep_${c.variant === 1 ? 1 : 0}.wav`
    case "boot": return "sfx/synth/boot.wav"
    case "chime": return "sfx/synth/chime.wav"
    case "drone": return "local/drone.wav"
  }
}
const clampDeg = (p?: number) => Math.max(0, Math.min(14, Math.round(p ?? 0)))

// Default levels under the music (linear gain).
export const DEFAULT_GAIN: Record<Cue["sound"], number> = {
  click: 0.9, release: 0.6, hover: 0.45, swipe: 0.55, whoosh: 0.5, open: 0.5, close: 0.5,
  blip: 0.55, pixel: 0.35, riser: 0.45, tick: 0.35, type: 0.45, thud: 0.8, glitch: 0.5, sweep: 0.5, boot: 0.7, chime: 0.6, drone: 0.35,
}

// Every sound effect in the film is a cue. schedule() works on the merged,
// film-wide list: no two onsets closer than MIN_GAP_FRAMES, a cue only ever
// moves later than its event, and the result is independent of input order.
export type Sound =
  | "click" | "release" | "hover" | "swipe" | "whoosh" | "open" | "close"   // Kenney (recorded)
  | "blip" | "riser" | "tick" | "thud" | "glitch" | "pixel" | "drone"        // synth (+ "drone" = the Mixkit hum)
  | "sweep" | "boot" | "chime" | "type"                                     // synth extras

export interface Cue {
  frame: number
  sound: Sound
  gain?: number
  pitch?: number     // scale degree for blips/pixels (0 = tonic), or semitones for others
  variant?: number   // which take of a sound with several (ticks, clicks)
  event: string      // why, for debugging and for a stable order
}

export const MIN_GAP_FRAMES = 2

export function schedule(cues: Cue[]): Cue[] {
  const sorted = cues.map(c => ({ ...c })).sort((a, b) => a.frame - b.frame || (a.event < b.event ? -1 : a.event > b.event ? 1 : 0))
  for (let i = 1; i < sorted.length; i++) {
    const min = sorted[i - 1].frame + MIN_GAP_FRAMES
    if (sorted[i].frame < min) sorted[i].frame = min
  }
  return sorted
}

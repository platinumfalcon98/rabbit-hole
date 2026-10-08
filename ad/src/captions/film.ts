// Every caption in the film, in absolute frames, verbatim from the storyboard.
// Exactly three flicker (agent, streaks, local).
import type { CaptionSpec } from "./effects"

export interface FilmCaption extends CaptionSpec { position: "top" | "bottom" | "center"; seed: number }

export const CAPTIONS: FilmCaption[] = [
  { lines: ["WHERE DID", "TODAY [GO?]"], at: 383, until: 540, style: "slam", position: "top", seed: 1 },
]

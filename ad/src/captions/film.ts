// Every caption in the film, in absolute frames, verbatim from the storyboard.
// Exactly three flicker (agent, streaks, local).
import type { CaptionSpec } from "./effects"

export interface FilmCaption extends CaptionSpec { position: "top" | "bottom" | "center"; seed: number }

export const CAPTIONS: FilmCaption[] = [
  { lines: ["WHERE DID", "TODAY [GO?]"], at: 383, until: 540, style: "slam", position: "top", seed: 1 },
  { lines: ["EVERY [MINUTE].", "EVERY [LANGUAGE]."], at: 888 + 36, until: 888 + 250, style: "decode", position: "bottom", seed: 2 },
  { lines: ["EVERY DAY,", "AT A [GLANCE]."], at: 1466 + 180, until: 1466 + 420, style: "stretch", position: "bottom", seed: 3 },
]

// Every caption in the film, in absolute frames, verbatim from the storyboard.
// Exactly three flicker (agent, streaks, local). Scene starts: today 888,
// month 1466, agent 2043, year 2621, streaks 3054, share 3487, local 3775.
import type { CaptionSpec } from "./effects"

export interface FilmCaption extends CaptionSpec { position: "top" | "bottom" | "center"; seed: number }

export const CAPTIONS: FilmCaption[] = [
  { lines: ["WHERE DID", "TODAY [GO?]"], at: 383, until: 540, style: "slam", position: "top", seed: 1 },
  { lines: ["EVERY [MINUTE].", "EVERY [LANGUAGE]."], at: 888 + 36, until: 888 + 250, style: "decode", position: "bottom", seed: 2 },
  { lines: ["EVERY DAY,", "AT A [GLANCE]."], at: 1466 + 180, until: 1466 + 420, style: "stretch", position: "bottom", seed: 3 },
  { lines: ["YOUR AGENT CODES.", "RABBIT HOLE [KNOWS.]"], at: 2043 + 330, flicker: 2043 + 430, until: 2043 + 548, style: "glitch", position: "bottom", seed: 4 },
  { lines: ["A WHOLE YEAR", "OF [YOU]."], at: 2621 + 108, until: 2621 + 250, style: "slam", position: "bottom", seed: 5 },
  { lines: ["KEEP THE", "[STREAK]."], at: 3054 + 72, flicker: 3054 + 346, until: 3054 + 420, style: "decode", position: "top", seed: 6 },
  { lines: ["[SHARE] IT."], at: 3487 + 108, until: 3487 + 270, style: "stretch", position: "top", seed: 7 },
  { lines: ["NO ACCOUNT.", "NO CLOUD.", "JUST YOUR [MACHINE]."], at: 3775 + 18, flicker: 3775 + 96, until: 3920 + 60, style: "decode", position: "bottom", seed: 8 },
]

// Every scene's cues, shifted to film frames, plus every caption's, merged and
// scheduled film-wide (so two scenes' cues at a boundary are spread too).
import { captionCues } from "../captions/effects"
import { CAPTIONS } from "../captions/film"
import { SCENE_CUES } from "../scenes/cues"
import { scene } from "../timeline"
import { type Cue, schedule } from "./cues"

export function rawFilmCues(): Cue[] {
  const out: Cue[] = []
  for (const [id, fn] of Object.entries(SCENE_CUES)) {
    const from = scene(id as never).from
    for (const c of fn!()) out.push({ ...c, frame: c.frame + from })
  }
  out.push(...captionCues(CAPTIONS, "film"))
  return out
}

export function filmCues(): Cue[] {
  return schedule(rawFilmCues())
}

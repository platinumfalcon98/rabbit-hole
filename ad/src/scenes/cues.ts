// Each scene's cues, scene-relative (pure: plan.ts only).
import type { Cue } from "../audio/cues"
import type { SceneId } from "../timeline"
import { hookCues, powerOnCues } from "./plan"

export const SCENE_CUES: Partial<Record<SceneId, () => Cue[]>> = {
  powerOn: powerOnCues,
  hook: hookCues,
}

// Each scene's cues, scene-relative (pure: plan.ts only).
import type { Cue } from "../audio/cues"
import type { SceneId } from "../timeline"
import { hookCues, powerOnCues, todayCues } from "./plan"
import { monthCues } from "./plan2"

export const SCENE_CUES: Partial<Record<SceneId, () => Cue[]>> = {
  powerOn: powerOnCues,
  hook: hookCues,
  today: todayCues,
  month: monthCues,
}

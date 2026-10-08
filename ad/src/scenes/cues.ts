// Each scene's cues, scene-relative (pure: the plan files only).
import type { Cue } from "../audio/cues"
import type { SceneId } from "../timeline"
import { hookCues, powerOnCues, todayCues } from "./plan"
import { monthCues } from "./plan2"
import { agentCues } from "./plan3"
import { endCues, localCues, shareCues, streakCues, yearCues } from "./plan4"

export const SCENE_CUES: Record<SceneId, () => Cue[]> = {
  powerOn: powerOnCues, hook: hookCues, today: todayCues, month: monthCues, agent: agentCues,
  year: yearCues, streaks: streakCues, share: shareCues, local: localCues, end: endCues,
}

// Scene components by id, in storyboard order.
import type { SceneId } from "../timeline"
import { Agent } from "./Agent"
import { Hook } from "./Hook"
import { End, Local } from "./LocalEnd"
import { Month } from "./Month"
import { PowerOn } from "./PowerOn"
import { Share } from "./Share"
import { Streaks } from "./Streaks"
import { Today } from "./Today"
import { Year } from "./Year"

export const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  powerOn: PowerOn, hook: Hook, today: Today, month: Month, agent: Agent,
  year: Year, streaks: Streaks, share: Share, local: Local, end: End,
}

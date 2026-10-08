// Scene components by id, in storyboard order.
import type { SceneId } from "../timeline"
import { PowerOn } from "./PowerOn"
import { Hook } from "./Hook"
import { Today } from "./Today"

export const SCENE_COMPONENTS: Partial<Record<SceneId, React.FC>> = {
  powerOn: PowerOn,
  hook: Hook,
  today: Today,
}

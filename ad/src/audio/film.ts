// Every scene's cues, shifted to film frames, merged, then scheduled. Filled in
// as the scenes are built (Task 7).
import { type Cue, schedule } from "./cues"

export function filmCues(): Cue[] {
  return schedule([])
}

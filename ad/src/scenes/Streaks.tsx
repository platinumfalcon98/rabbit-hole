// 0:52–0:58 — the projects tab, on the second dip: the streak cards flip in;
// quill-api is "at risk today"; the mouse clicks it back on track (a live
// update: a 26-minute session, the streak goes 6d → 7d, "at risk" clears).
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { rescueLive } from "../data/agentLive"
import { Cursor } from "../cursor/Cursor"
import { UiFrame } from "../ui/UiFrame"
import { easeIn, ramp } from "./beat"
import { STREAK, STREAK_CAM, STREAK_CURSOR } from "./plan4"
import { shot } from "./shots"
import { World } from "./World"

const S = shot("streaks")
const RESCUE = rescueLive()

export const Streaks: React.FC = () => {
  const f = useCurrentFrame()
  const exit = easeIn(ramp(f, STREAK.exit, 433))
  const rescued = f >= STREAK.click + 2
  const view = {
    ...S.view,
    live: rescued ? RESCUE : null,
    reveal: { cards: ramp(f, STREAK.flipFrom, STREAK.flipTo), count: rescued ? 1 : ramp(f, STREAK.countFrom, STREAK.countTo), spark: ramp(f, STREAK.flipFrom + 20, STREAK.flipTo + 20) },
  }
  // the card that was saved glows for a moment
  const glow = rescued ? Math.max(0, 1 - (f - STREAK.click) / 40) : 0
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, f / 4) * (1 - exit) }}>
      <World cam={STREAK_CAM}>
        <div style={{ position: "absolute", left: 0, top: 0, transform: `scale(${1 + exit * 0.4})`, transformOrigin: "1000px 480px" }}>
          <UiFrame width={S.width} height={S.height} view={view} />
          {glow > 0 && <div style={{ position: "absolute", left: 731, top: 343, width: 683, height: 280, borderRadius: 6, boxShadow: `0 0 ${80 * glow}px rgba(57,217,138,${0.7 * glow}), inset 0 0 ${40 * glow}px rgba(57,217,138,${0.35 * glow})` }} />}
        </div>
        <Cursor keys={STREAK_CURSOR} visibleFrom={120} visibleTo={STREAK.leave} />
      </World>
    </AbsoluteFill>
  )
}

// 0:44–0:52 — the activity tab: year stats count up, the heatmap cascades in
// week by week, the project shares grow; hovering rabbithole-cli narrows the
// year to it (the real hover).
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { HERO_PROJECT } from "../data/showcase"
import { Cursor } from "../cursor/Cursor"
import { UiFrame } from "../ui/UiFrame"
import { easeIn, easeOut, ramp } from "./beat"
import { YEAR, YEAR_CAM, YEAR_CURSOR } from "./plan4"
import { shot } from "./shots"
import { World } from "./World"

const S = shot("year")

export const Year: React.FC = () => {
  const f = useCurrentFrame()
  const enter = easeOut(ramp(f, 0, YEAR.enter))
  const exit = easeIn(ramp(f, YEAR.exit, 433))
  const view = {
    ...S.view,
    focus: f >= YEAR.hover && f < YEAR.leave ? { kind: "project" as const, id: HERO_PROJECT } : null,
    reveal: { count: ramp(f, YEAR.countFrom, YEAR.countTo), heat: ramp(f, YEAR.heatFrom, YEAR.heatTo), bars: ramp(f, YEAR.barsFrom, YEAR.barsTo), rows: ramp(f, YEAR.barsFrom - 20, YEAR.barsTo - 10) },
  }
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, f / 5) * (1 - exit), filter: enter < 1 ? `blur(${(1 - enter) * 10}px)` : undefined }}>
      <World cam={YEAR_CAM}>
        <div style={{ position: "absolute", left: 0, top: 0, transform: `translateY(${(1 - enter) * 500 - exit * 300}px) rotateX(${(1 - enter) * 30}deg)`, transformOrigin: "720px 1080px" }}>
          <UiFrame width={S.width} height={S.height} view={view} />
        </div>
        <Cursor keys={YEAR_CURSOR} visibleFrom={230} visibleTo={YEAR.leave} />
      </World>
    </AbsoluteFill>
  )
}

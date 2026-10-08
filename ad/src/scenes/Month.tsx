// 0:24–0:34 — the mouse clicks 30d; the day columns drop into place one by one,
// each with its own pitched blip up the scale; hovering a column shows the real
// tooltip; tab cards float in the background.
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { Cursor } from "../cursor/Cursor"
import { UiFrame } from "../ui/UiFrame"
import { easeIn, easeOut, ramp } from "./beat"
import { FloatingTabs } from "./FloatingTabs"
import { MONTH, MONTH_CAM, MONTH_CARD, MONTH_CURSOR } from "./plan2"
import { shot } from "./shots"
import { World } from "./World"

const S = shot("month")
const COL = (i: number) => `#cols .c[data-i="${i}"]`

export const Month: React.FC = () => {
  const f = useCurrentFrame()
  const enter = easeOut(ramp(f, 0, MONTH.enter))
  const exit = easeIn(ramp(f, MONTH.exit, 577))
  const before = f < MONTH.click + 2
  const tip = f >= MONTH.tip1 && f < MONTH.tip2 - 10 ? COL(19) : f >= MONTH.tip2 && f < MONTH.leave - 20 ? COL(9) : null
  const view = {
    ...S.view, range: (before ? "today" : "30d") as "today" | "30d",
    tooltipAt: tip ? { selector: tip, fy: 0.45 } : null,
    reveal: before ? {} : { cols: ramp(f, MONTH.colsFrom, MONTH.colsTo), count: ramp(f, MONTH.countFrom, MONTH.countTo), tape: ramp(f, MONTH.tapeFrom, MONTH.tapeTo) },
  }
  const s = MONTH_CARD.scale
  return (
    <AbsoluteFill>
      <World cam={MONTH_CAM}>
        <FloatingTabs layer="back" count={12} seed={2} />
        <div style={{
          position: "absolute", left: 0, top: 0, width: 1440, height: 1080, transformOrigin: "720px 540px",
          transform: `translateX(${(1 - enter) * 1500 - exit * 1700}px) scale(${s}) rotate(${(1 - enter) * 6 - exit * 5}deg)`,
          boxShadow: "0 40px 120px rgba(0,0,0,.7), 0 0 0 1px #22392d", borderRadius: 10, overflow: "hidden",
        }}>
          <UiFrame width={S.width} height={S.height} view={view} />
        </div>
        <Cursor keys={MONTH_CURSOR} visibleFrom={18} visibleTo={MONTH.leave} />
        <FloatingTabs layer="front" count={3} seed={5} />
      </World>
    </AbsoluteFill>
  )
}

// 0:14–0:24 — the real dashboard opens on today: the hero total counts up, the
// day tape fills cell by cell, the target meter grows to "met at 14:32"; then
// the camera finds the languages and the mouse points at one: the real hover
// focus narrows the tape and the hero to it.
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { Cursor } from "../cursor/Cursor"
import { UiFrame } from "../ui/UiFrame"
import { easeOut, ramp } from "./beat"
import { TODAY_CAM, TODAY_CURSOR, TODAY_S } from "./plan"
import { shot } from "./shots"
import { World } from "./World"

const S = shot("today")

export const Today: React.FC = () => {
  const f = useCurrentFrame()
  const enter = easeOut(ramp(f, 0, TODAY_S.enter))
  const focus = f >= TODAY_S.focusTs && f < TODAY_S.leave ? { kind: "language" as const, id: "typescript" }
    : f >= TODAY_S.focusGo && f < TODAY_S.focusTs ? { kind: "language" as const, id: "go" } : null
  const view = {
    ...S.view, focus,
    reveal: {
      count: ramp(f, TODAY_S.countFrom, TODAY_S.countTo), tape: ramp(f, TODAY_S.tapeFrom, TODAY_S.tapeTo), meter: ramp(f, TODAY_S.meterFrom, TODAY_S.meterTo),
      rows: ramp(f, TODAY_S.panTo - 50, TODAY_S.panTo + 10), bars: ramp(f, TODAY_S.panTo - 30, TODAY_S.panTo + 20),
    },
  }
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, f / 6), filter: enter < 1 ? `blur(${(1 - enter) * 12}px)` : undefined }}>
      <World cam={TODAY_CAM}>
        <div style={{ position: "absolute", left: 0, top: 0, transform: `scale(${1.25 - 0.25 * enter})`, transformOrigin: "720px 540px" }}>
          <UiFrame width={S.width} height={S.height} view={view} />
        </div>
        <Cursor keys={TODAY_CURSOR} visibleFrom={262} visibleTo={TODAY_S.leave} />
      </World>
    </AbsoluteFill>
  )
}

// 0:58–1:03 — settings → "export…": the real export dialog draws the real share
// card; the mouse clicks export and the card flies out of the screen.
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { Cursor } from "../cursor/Cursor"
import { UiFrame } from "../ui/UiFrame"
import { easeIn, easeOut, ramp } from "./beat"
import { SHARE, SHARE_CAM, SHARE_CURSOR } from "./plan4"
import { shot } from "./shots"
import { World } from "./World"

const SET = shot("settings")
const DLG = shot("share")

export const Share: React.FC = () => {
  const f = useCurrentFrame()
  const enter = easeOut(ramp(f, 0, SHARE.enter))
  const exit = easeIn(ramp(f, SHARE.exit, 288))
  const open = f >= SHARE.open
  const view = open
    ? { ...DLG.view, reveal: { card: ramp(f, SHARE.cardFrom, SHARE.cardTo), fly: ramp(f, SHARE.flyFrom, SHARE.flyTo) } }
    : { ...SET.view }
  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <World cam={SHARE_CAM}>
        <div style={{ position: "absolute", left: 0, top: 0, transform: `translateX(${(1 - enter) * -1500}px)` }}>
          <UiFrame width={DLG.width} height={DLG.height} view={view} />
        </div>
        <Cursor keys={SHARE_CURSOR} visibleFrom={4} visibleTo={276} />
      </World>
    </AbsoluteFill>
  )
}

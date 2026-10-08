// 0:05–0:14 — a VS Code window floats in; the status bar's 3h40m / 20m swells
// under the fisheye; the mouse glides to the Activity Bar carrot and clicks;
// the real Rabbit Hole view slides open, the mouse points at a project (the
// view narrows to it), then clicks "open dashboard" and the camera dives in.
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { H, W } from "../constants"
import { HERO_PROJECT, MIN, showcase } from "../data/showcase"
import { Cursor } from "../cursor/Cursor"
import { Fisheye } from "../fx/Fisheye"
import { UiFrame } from "../ui/UiFrame"
import { easeInOut, easeOut, outBack, ramp } from "./beat"
import { HOOK, HOOK_CAM, HOOK_CURSOR, MINI_AT } from "./plan"
import { README } from "./readme"
import { STATUS_ITEM, VsCodeFrame } from "./VsCodeFrame"
import { World } from "./World"

const data = showcase()
const today = data.year.global.active[data.year.global.active.length - 1]

export const Hook: React.FC = () => {
  const f = useCurrentFrame()
  const float = outBack(ramp(f, 0, HOOK.floatTo), 1.2)
  const fish = f < HOOK.fishOut ? easeInOut(ramp(f, HOOK.fishFrom, HOOK.fishIn)) : 1 - easeInOut(ramp(f, HOOK.fishOut, HOOK.fishBack))
  const side = easeOut(ramp(f, HOOK.sideFrom, HOOK.sideTo))
  const hot = f >= HOOK.carrotHover - 4 ? Math.min(1, (f - HOOK.carrotHover + 4) / 6) * (f > HOOK.click + 40 ? Math.max(0, 1 - (f - HOOK.click - 40) / 12) : 1) : 0
  const dive = ramp(f, HOOK.dive, 577)
  const winScale = 0.92 + 0.08 * float
  const rot = -2.5 * (1 - float)
  const mini = {
    focus: f >= HOOK.focusFrom && f < HOOK.focusTo ? { kind: "project" as const, id: HERO_PROJECT } : null,
    reveal: { rows: ramp(f, HOOK.rowsFrom, HOOK.rowsTo), count: ramp(f, HOOK.countFrom, HOOK.countTo), tape: ramp(f, HOOK.countFrom, HOOK.countTo + 20), week: ramp(f, HOOK.rowsFrom + 20, HOOK.rowsTo + 30), bars: ramp(f, HOOK.rowsFrom + 30, HOOK.rowsTo + 30) },
  }
  return (
    <AbsoluteFill>
      <Fisheye amount={fish} center={[STATUS_ITEM.x + 40, STATUS_ITEM.y]} zoom={4.4 + 0.5 * ramp(f, HOOK.fishIn, HOOK.fishOut)}>
        <World cam={HOOK_CAM} drift={1 - dive}>
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `translateY(${(1 - float) * 60}px) scale(${winScale}) rotate(${rot}deg)`, transformOrigin: "720px 540px", opacity: Math.min(1, f / 8) }}>
            <VsCodeFrame
              file="README.md" tabs={["README.md", "week.go", "main.go"]} lines={README} caretLine={11} caretOn={Math.floor(f / 30) % 2 === 0}
              sidebarOpen={side} carrotHot={hot} activeMs={f < HOOK.tick ? today - MIN : today} targetMs={20 * MIN} statusLang="Markdown"
              sidebar={side > 0 ? <UiFrame page="mini" width={MINI_AT.w} height={MINI_AT.h} view={mini} style={{ marginLeft: 6 }} /> : null}
            />
          </div>
          <Cursor keys={HOOK_CURSOR} visibleFrom={160} />
        </World>
      </Fisheye>
      {/* the dive: the dashboard's own background floods in */}
      {dive > 0 && <AbsoluteFill style={{ background: "#050b08", opacity: easeInOut(ramp(f, HOOK.dive + 14, 577)) }} />}
    </AbsoluteFill>
  )
}

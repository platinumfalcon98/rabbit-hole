import { AbsoluteFill } from "remotion"
import { UiFrame } from "../ui/UiFrame"
import { shot } from "../scenes/shots"

// One shot's base view at its own size, for layout checks.
export const ShotCheck: React.FC<{ id: string; extra?: object }> = ({ id, extra }) => {
  const s = shot(id)
  return <AbsoluteFill style={{ background: "#300" }}><UiFrame page={s.page} width={s.width} height={s.height} view={{ ...s.view, ...(extra ?? {}) }} /></AbsoluteFill>
}

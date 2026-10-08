import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"
import { UiFrame } from "../ui/UiFrame"

// Determinism check: reveal 0 → 1 over the clip, a language focus from frame 450.
export const UiCheck: React.FC = () => {
  const f = useCurrentFrame()
  const p = interpolate(f, [0, 800], [0, 1], { extrapolateRight: "clamp" })
  return (
    <AbsoluteFill style={{ background: "#050b08" }}>
      <UiFrame width={1440} height={1080} view={{
        tab: "overview", range: "today", zoom: 1.25,
        focus: f >= 450 ? { kind: "language", id: "go" } : null,
        reveal: { count: p, tape: p, meter: p, bars: p, rows: p, week: p },
      }} />
    </AbsoluteFill>
  )
}

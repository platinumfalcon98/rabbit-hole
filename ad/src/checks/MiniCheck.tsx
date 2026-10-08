import { AbsoluteFill } from "remotion"
import { UiFrame } from "../ui/UiFrame"

export const MiniCheck: React.FC = () => (
  <AbsoluteFill style={{ background: "#050b08", alignItems: "center", justifyContent: "center" }}>
    <UiFrame page="mini" width={600} height={1080} view={{ zoom: 1.6 }} />
  </AbsoluteFill>
)

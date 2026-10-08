import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion"
import { Caption } from "../captions/Caption"
import { Cursor } from "../cursor/Cursor"
import { Backlight } from "../fx/Backlight"
import { Crt } from "../fx/Crt"
import { Fisheye } from "../fx/Fisheye"
import { loadFonts } from "../fonts"
import { UiFrame } from "../ui/UiFrame"

loadFonts()

export const KitCheck: React.FC = () => {
  const f = useCurrentFrame()
  const amount = interpolate(f, [120, 200], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <Crt>
      <Backlight />
      <Fisheye amount={amount} center={[300, 200]} zoom={1.8}>
        <AbsoluteFill style={{ padding: 60 }}>
          <UiFrame width={1320} height={960} view={{ zoom: 1.2, focus: f > 90 ? { kind: "language", id: "go" } : null }} style={{ borderRadius: 12, boxShadow: "0 30px 80px rgba(0,0,0,.6)" }} />
        </AbsoluteFill>
        <Cursor keys={[{ frame: 0, x: 1100, y: 900 }, { frame: 40, x: 700, y: 560, ease: "overshoot" }, { frame: 70, x: 700, y: 560, click: true }, { frame: 100, x: 300, y: 200 }]} />
      </Fisheye>
      <Sequence from={10} durationInFrames={50}><Caption lines={["WHERE DID", "TODAY [GO?]"]} at={0} style="slam" /></Sequence>
      <Sequence from={60} durationInFrames={90}><Caption lines={["EVERY MINUTE.", "EVERY LANGUAGE."]} at={0} style="decode" flicker={60} position="bottom" /></Sequence>
      <Sequence from={150} durationInFrames={70}><Caption lines={["SHARE IT."]} at={0} style="stretch" position="center" /></Sequence>
      <Sequence from={220} durationInFrames={80}><Caption lines={["YOUR AGENT CODES.", "RABBIT HOLE [KNOWS.]"]} at={0} style="glitch" until={80} /></Sequence>
    </Crt>
  )
}

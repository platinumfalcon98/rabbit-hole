// The film: the backlight, the ten scenes on the beat grid, the captions over
// them, all under the whole-frame CRT; the soundtrack alongside.
import { AbsoluteFill, Sequence } from "remotion"
import { Soundtrack } from "./audio/Soundtrack"
import { Captions } from "./captions/Captions"
import { Backlight } from "./fx/Backlight"
import { Crt } from "./fx/Crt"
import { loadFonts } from "./fonts"
import { SCENE_COMPONENTS } from "./scenes"
import { SCENES } from "./timeline"

loadFonts()

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ background: "#050b08" }}>
    <Crt>
      <Backlight />
      {SCENES.map(s => {
        const C = SCENE_COMPONENTS[s.id]
        return C ? <Sequence key={s.id} from={s.from} durationInFrames={s.to - s.from} name={s.id}><C /></Sequence> : null
      })}
      <Captions />
    </Crt>
    <Soundtrack />
  </AbsoluteFill>
)

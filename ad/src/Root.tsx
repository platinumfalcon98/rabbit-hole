import { Composition } from "remotion"
import { DURATION, FPS, H, W } from "./constants"
import { Promo } from "./Promo"

export const Root: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} width={W} height={H} fps={FPS} durationInFrames={DURATION} />
  </>
)

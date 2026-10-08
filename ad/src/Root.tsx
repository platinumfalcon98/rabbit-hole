import { Composition } from "remotion"
import { DURATION, FPS, H, W } from "./constants"
import { Promo } from "./Promo"
import { UiCheck } from "./checks/UiCheck"
import { MiniCheck } from "./checks/MiniCheck"
import { KitCheck } from "./checks/KitCheck"

export const Root: React.FC = () => (
  <>
    <Composition id="UiCheck" component={UiCheck} width={W} height={H} fps={FPS} durationInFrames={900} />
    <Composition id="MiniCheck" component={MiniCheck} width={W} height={H} fps={FPS} durationInFrames={60} />
    <Composition id="KitCheck" component={KitCheck} width={W} height={H} fps={FPS} durationInFrames={300} />
    <Composition id="Promo" component={Promo} width={W} height={H} fps={FPS} durationInFrames={DURATION} />
  </>
)

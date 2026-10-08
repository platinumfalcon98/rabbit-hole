// The extension's dark background, brightening toward the centre: a soft
// green-black backlight. It breathes very slightly so no frame is flat.
import { AbsoluteFill, useCurrentFrame } from "remotion"

export const Backlight: React.FC<{ intensity?: number }> = ({ intensity = 1 }) => {
  const f = useCurrentFrame()
  const breathe = 1 + Math.sin(f / 60 * Math.PI * 2 / 4.8) * 0.06
  const a = 0.55 * intensity * breathe
  return (
    <AbsoluteFill style={{
      background: `radial-gradient(ellipse 70% 62% at 50% 48%, rgba(24,58,40,${a}) 0%, rgba(13,28,20,${a * 0.8}) 38%, rgba(5,11,8,0) 78%), #050b08`,
    }} />
  )
}

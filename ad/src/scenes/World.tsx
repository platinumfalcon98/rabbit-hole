// A camera over a world: children are placed in world coordinates, the camera
// keys say which world point sits at the frame centre and how close.
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { H, W } from "../constants"
import { type CamKey, cameraAt, cameraTransform } from "../fx/camera"

export const World: React.FC<{ cam: CamKey[]; children: React.ReactNode; drift?: number }> = ({ cam, children, drift = 1 }) => {
  const f = useCurrentFrame()
  const c = cameraAt(f, cam)
  // a slow hand-held drift so no frame is perfectly still
  const dx = Math.sin(f / 97) * 6 * drift, dy = Math.cos(f / 131) * 4 * drift
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) ${cameraTransform(c, W, H)}` }}>
        {children}
      </div>
    </AbsoluteFill>
  )
}

/** A box at world (x, y) of the given size. */
export const At: React.FC<{ x: number; y: number; w?: number; h?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ x, y, w, h, style, children }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, ...style }}>{children}</div>
)

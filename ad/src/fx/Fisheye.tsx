// A push-in with a fisheye bulge: the content scales up around `center` and the
// middle of the lens swells (an SVG displacement map, so iframes bend too).
import { useId, useMemo } from "react"
import { AbsoluteFill } from "remotion"
import { H, W } from "../constants"

function bulgeMap(w: number, h: number): string {
  if (typeof document === "undefined") return ""
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")!
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w - 0.5, v = (y + 0.5) / h - 0.5
    const r = Math.min(1, Math.hypot(u, v * (H / W)) / 0.5)
    // sample toward the centre inside the lens (magnify), unchanged at its rim
    const f = -Math.sin(Math.PI * r) * 0.5 * (1 - r)
    const i = (y * w + x) * 4
    img.data[i] = Math.round(128 + u * f * 255)
    img.data[i + 1] = Math.round(128 + v * f * 255)
    img.data[i + 2] = 128
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL("image/png")
}

/** amount 0..1: 0 = untouched; zoom = the push-in scale at amount 1. */
export const Fisheye: React.FC<{ amount: number; center?: [number, number]; zoom?: number; children: React.ReactNode }> = ({ amount, center = [W / 2, H / 2], zoom = 1.6, children }) => {
  const map = useMemo(() => bulgeMap(240, 180), [])
  const id = "fisheye" + useId().replace(/[^a-zA-Z0-9]/g, "")
  const s = 1 + (zoom - 1) * amount
  const bulge = 520 * amount
  const [cx, cy] = center
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <filter id={id} x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feImage href={map} x="0" y="0" width={W} height={H} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={bulge} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill style={{ filter: amount > 0.001 ? `url(#${id})` : undefined }}>
        <AbsoluteFill style={{ transform: `translate(${(W / 2 - cx) * amount}px, ${(H / 2 - cy) * amount}px) scale(${s})`, transformOrigin: `${cx}px ${cy}px` }}>
          {children}
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

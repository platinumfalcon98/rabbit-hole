// The whole-frame CRT, drawn over the composited film: bloom, curved-glass
// barrel warp (SVG filters on the content, so iframes are warped too), an
// aperture grille at fine pitch and 34% strength, scanlines, a subtle global
// flicker and the vignette. The values come from the extension's own
// crtParams() for the showcase's settings (mask grille, pitch fine,
// strength 34, scanlines + bloom + flicker), adapted to a 1080-line frame.
import { useMemo } from "react"
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { crtParams } from "../../../src/webview/crt"
import { CRT } from "../data/showcase"
import { H, W } from "../constants"

export const CRT_PARAMS = crtParams(CRT, "dark")
// Film adaptations, measured on the 400 px phone downscale: a 3 px scanline
// period aliases there, 4 px with a soft profile does not.
export const SCANLINE_PERIOD = 4
const SCAN_ALPHA = 0.3
const BARREL = 0.085          // how far the corners pull in (fraction of the half-diagonal)

const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// A displacement map for feDisplacementMap: R/G encode where each pixel samples
// from. Barrel: sample further out toward the edges, so the picture bows in.
function barrelMap(w: number, h: number, k: number, scale: number): string {
  if (typeof document === "undefined") return ""
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")!
  const img = ctx.createImageData(w, h)
  const aspect = W / H
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w - 0.5, v = (y + 0.5) / h - 0.5
    const r2 = (u * aspect) ** 2 + v ** 2
    const f = k * r2 / (0.25 * (aspect ** 2 + 1))     // 0 at the centre, k at the corners
    const dx = u * f * W, dy = v * f * H              // px, outward
    const i = (y * w + x) * 4
    img.data[i] = Math.max(0, Math.min(255, Math.round(128 + dx / scale * 255)))
    img.data[i + 1] = Math.max(0, Math.min(255, Math.round(128 + dy / scale * 255)))
    img.data[i + 2] = 128
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL("image/png")
}

export const Crt: React.FC<{ children: React.ReactNode; off?: boolean }> = ({ children, off }) => {
  const frame = useCurrentFrame()
  const scale = 2 * BARREL * W * 0.55
  const map = useMemo(() => barrelMap(W / 4, H / 4, BARREL, scale), [scale])
  const p = CRT_PARAMS
  const lo = Math.round(255 * (1 - p.s))
  // aperture grille: vertical R/G/B phosphor stripes, one unit each (fine pitch)
  const u = p.unit
  const grille = `repeating-linear-gradient(90deg, rgb(255,${lo},${lo}) 0 ${u}px, rgb(${lo},255,${lo}) ${u}px ${2 * u}px, rgb(${lo},${lo},255) ${2 * u}px ${3 * u}px)`
  const L = SCANLINE_PERIOD
  const scan = `repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,${SCAN_ALPHA}) ${L * 0.62}px, rgba(0,0,0,0) ${L}px)`
  // flicker: global, frame-seeded, about ±1.5%
  const flicker = p.fx.flicker ? 0.015 + (hash(frame) - 0.5) * 0.03 : 0
  if (off) return <AbsoluteFill>{children}</AbsoluteFill>
  return (
    <AbsoluteFill style={{ background: "#010201", overflow: "hidden" }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <filter id="crt" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            {/* bloom: a wide blur of the bright parts, screened back on */}
            <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
            <feComponentTransfer in="blur" result="glow">
              <feFuncR type="linear" slope="0.55" />
              <feFuncG type="linear" slope="0.55" />
              <feFuncB type="linear" slope="0.55" />
            </feComponentTransfer>
            <feBlend in="SourceGraphic" in2="glow" mode="screen" result="bloomed" />
            {/* curved glass */}
            <feImage href={map} x="0" y="0" width={W} height={H} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="bloomed" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill style={{ filter: "url(#crt)" }}>
        <AbsoluteFill style={{ filter: `brightness(${p.boost})` }}>{children}</AbsoluteFill>
        <AbsoluteFill style={{ background: grille, mixBlendMode: "multiply", opacity: 0.85 }} />
        <AbsoluteFill style={{ background: scan }} />
      </AbsoluteFill>
      {/* the glass: vignette, a soft glare, rounded bezel corners */}
      <AbsoluteFill style={{
        borderRadius: "46px / 40px",
        boxShadow: `0 0 0 80px #010201, inset 0 0 26px rgba(0,0,0,${0.55 * p.vig + 0.25}), inset 0 0 160px rgba(0,0,0,${0.62 * p.vig + 0.1})`,
        background: `radial-gradient(ellipse 60% 35% at 28% 4%, rgba(190,255,220,.045), transparent 70%), radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(0,0,0,${0.62 * p.vig}) 125%)`,
      }} />
      <AbsoluteFill style={{ background: "#000", opacity: Math.max(0, flicker) }} />
    </AbsoluteFill>
  )
}

// 0:00–0:05 — a black CRT warms up: a line spreads, opens into a picture, and
// the carrot draws itself pixel by pixel (one blip per pixel), then flies off
// to where the Activity Bar will be.
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { CARROT_H, CARROT_W } from "../../../src/webview/carrot"
import { H, W } from "../constants"
import { easeIn, easeInOut, easeOut, outBack, ramp } from "./beat"
import { CARROT_SLOT, PIXELS, POWER, actSlot, WIN } from "./plan"

export const CarrotPixels: React.FC<{ size: number; shown?: number; frame?: number; glow?: number }> = ({ size, shown = PIXELS.length, frame, glow = 1 }) => (
  <div style={{ position: "relative", width: CARROT_W * size, height: CARROT_H * size, filter: `drop-shadow(0 0 ${8 * glow}px rgba(255,139,0,.7)) drop-shadow(0 0 ${26 * glow}px rgba(255,139,0,.35))` }}>
    {PIXELS.slice(0, shown).map((p, i) => {
      // each pixel pops in: big and white-hot, then settles to its colour
      const age = frame === undefined ? 99 : frame - (POWER.drawFrom + POWER.every * i)
      const k = Math.min(1, Math.max(0, age / 7))
      const s = 1 + 0.9 * (1 - outBack(k, 2.4))
      return (
        <div key={i} style={{
          position: "absolute", left: p.x * size, top: p.y * size, width: size, height: size,
          background: k < 1 ? `color-mix(in srgb, ${p.c} ${Math.round(40 + 60 * k)}%, #fff6e0)` : p.c,
          transform: `scale(${s})`, boxShadow: k < 1 ? `0 0 ${24 * (1 - k)}px ${p.c}` : undefined,
        }} />
      )
    })}
  </div>
)

export const PowerOn: React.FC = () => {
  const f = useCurrentFrame()
  const lineW = easeOut(ramp(f, POWER.lineFrom, POWER.lineTo))
  const open = easeInOut(ramp(f, POWER.openFrom, POWER.openTo))
  const shown = Math.max(0, Math.min(PIXELS.length, Math.floor((f - POWER.drawFrom) / POWER.every) + 1))
  const size = POWER.pixel
  // the flight to the Activity Bar (where the next scene's window puts its carrot)
  const fly = easeIn(ramp(f, POWER.flyFrom, POWER.flyFrom + 26))
  const slot = actSlot(CARROT_SLOT)
  const tx = 720 + (slot.x - 720) * 0.92 - (WIN.x - 60), ty = 540 + (slot.y - 540) * 0.92
  const cx = W / 2 + (tx - W / 2) * fly, cy = H / 2 + (ty - H / 2) * fly
  const scale = 1 - fly * (1 - 2.2 / size)
  const breathe = 1 + Math.sin(f / 9) * 0.015 * ramp(f, 240, 260)
  const flash = f >= POWER.openTo - 4 && f < POWER.openTo + 10 ? 1 - Math.abs(f - (POWER.openTo + 1)) / 9 : 0
  const glowAfter = 1 + 0.6 * Math.max(0, 1 - Math.abs(f - 274) / 10)   // the settle thud
  if (f < POWER.lineFrom) return <AbsoluteFill style={{ background: "#000" }} />
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* the picture, inside the opening raster */}
      <AbsoluteFill style={{ clipPath: `inset(${(1 - open) * 50}% ${(1 - lineW) * 50}% ${(1 - open) * 50}% ${(1 - lineW) * 50}%)` }}>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 55% at 50% 50%, rgba(30,74,50,${0.55 + 0.1 * Math.sin(f / 13)}), #050b08 75%)` }} />
        {/* faint phosphor raster rolling while the tube warms */}
        <AbsoluteFill style={{
          opacity: 0.18 * (1 - ramp(f, 60, 140)),
          background: `repeating-linear-gradient(to bottom, rgba(120,255,180,.25) 0 2px, transparent 2px 9px)`, backgroundPositionY: `${f * 3}px`,
        }} />
        <div style={{ position: "absolute", left: cx, top: cy, transform: `translate(-50%, -50%) scale(${scale * breathe}) rotate(${Math.sin(f / 40) * 1.2 * (1 - fly)}deg)` }}>
          <CarrotPixels size={size} shown={shown} frame={f} glow={glowAfter} />
        </div>
      </AbsoluteFill>
      {/* the line itself, white-hot, before and while it opens */}
      {open < 1 && (
        <div style={{
          position: "absolute", left: (1 - lineW) * W / 2, width: lineW * W, top: H / 2 - 2 - open * H / 2, height: 4 + open * H,
          background: `rgba(220,255,235,${(1 - open) * 0.95})`, boxShadow: `0 0 30px rgba(140,255,200,${1 - open}), 0 0 90px rgba(80,255,160,${0.6 * (1 - open)})`,
        }} />
      )}
      {flash > 0 && <AbsoluteFill style={{ background: `rgba(200,255,225,${0.35 * flash})` }} />}
    </AbsoluteFill>
  )
}

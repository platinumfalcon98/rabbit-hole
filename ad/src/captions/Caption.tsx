// Captions: Martian Mono, bold, all caps, cap height ≥ 9% of the frame
// (125 px type, cap height 0.8 em = 100 px). Four dramatic entrances — slam with
// motion blur, scrambled-letter decode, stretch-snap, glitch slices with RGB
// split — and the rare flicker. Words in [brackets] take the carrot accent.
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { type CaptionSpec, ENTRANCE_FRAMES, FLICKER_FRAMES, decodeText } from "./effects"

export const CAPTION_PX = 125
const INK = "#e4fff0"
const ACCENT = "#ffb703"
const GLOW = "0 0 2px rgba(207,238,221,.9), 0 0 14px rgba(57,217,138,.55), 0 0 40px rgba(57,217,138,.25)"
const ACCENT_GLOW = "0 0 2px rgba(255,220,140,.95), 0 0 16px rgba(255,139,0,.65), 0 0 44px rgba(255,139,0,.3)"

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const hash = (a: number, b: number) => {
  let h = Math.imul((a * 2654435761) ^ (b * 40503), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const outBack = (t: number, s = 2.2) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
const outCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3)

// "EVERY [MINUTE]." → segments with an accent flag; brackets are not shown.
function segments(line: string): { text: string; accent: boolean }[] {
  const out: { text: string; accent: boolean }[] = []
  line.split(/(\[[^\]]*\])/).forEach(s => { if (s) out.push(s.startsWith("[") ? { text: s.slice(1, -1), accent: true } : { text: s, accent: false }) })
  return out
}
const plain = (line: string) => line.replace(/[[\]]/g, "")

function Line({ line, text, dim }: { line: string; text: string; dim: (i: number) => boolean }) {
  // `text` is the shown characters (decode scrambles them) for `line`'s plain text
  let k = 0
  return (
    <div style={{ whiteSpace: "pre" }}>
      {segments(line).map((s, si) => (
        <span key={si} style={{ color: s.accent ? ACCENT : INK, textShadow: s.accent ? ACCENT_GLOW : GLOW }}>
          {Array.from(s.text).map((_, ci) => {
            const i = k++
            return <span key={ci} style={dim(i) ? { color: "#39d98a", opacity: 0.75, textShadow: "0 0 12px rgba(57,217,138,.8)" } : undefined}>{text[i]}</span>
          })}
        </span>
      ))}
    </div>
  )
}

export const Caption: React.FC<CaptionSpec & { position?: "top" | "bottom" | "center"; seed?: number; scrim?: boolean; size?: number }> = ({
  lines, at, style, flicker, until, position = "top", seed = 1, scrim = true, size = CAPTION_PX,
}) => {
  const f = useCurrentFrame()
  if (f < at) return null
  if (until !== undefined && f >= until) return null
  const e = f - at
  const dur = ENTRANCE_FRAMES[style]
  const t = clamp(e / dur)
  let transform = ""
  let filter = ""
  let opacity = 1
  let letterSpacing = "-0.01em"
  let rgb = 0            // RGB split, px
  let slices = 0         // glitch slice strength, px
  let flash = 0

  if (style === "slam") {
    const k = clamp(e / 10)
    const s = 1 + 2.2 * (1 - outBack(k, 1.6))
    transform = `scale(${s.toFixed(4)}) translateY(${((1 - k) * -30).toFixed(1)}px)`
    filter = `blur(${((1 - outCubic(k)) * 16).toFixed(2)}px)`
    opacity = clamp(e / 3)
    flash = e >= 6 && e < 18 ? 1 - (e - 6) / 12 : 0
    if (e >= 9 && e < 18) transform += ` translate(${((hash(e, seed) - 0.5) * 10 * (1 - (e - 9) / 9)).toFixed(1)}px, ${((hash(e, seed + 1) - 0.5) * 8 * (1 - (e - 9) / 9)).toFixed(1)}px)`
  } else if (style === "stretch") {
    const k = clamp(e / dur)
    const sx = k < 0.55 ? 0.02 + (1.14 - 0.02) * outCubic(k / 0.55) : 1.14 - 0.14 * outBack((k - 0.55) / 0.45, 1.4)
    const sy = k < 0.55 ? 2.6 - 1.75 * outCubic(k / 0.55) : 0.85 + 0.15 * outBack((k - 0.55) / 0.45, 1.4)
    transform = `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
    letterSpacing = `${(0.5 * (1 - outCubic(k)) - 0.01).toFixed(3)}em`
    filter = `blur(${((1 - outCubic(k)) * 6).toFixed(2)}px)`
    opacity = clamp(e / 2)
    rgb = (1 - outCubic(k)) * 10
  } else if (style === "glitch") {
    const k = clamp(e / dur)
    rgb = (1 - k) * 18 + (k < 1 ? 2 : 0)
    slices = (1 - k) * 60
    opacity = e < 8 ? (hash(e, seed + 3) > 0.35 ? 1 : 0.15) : 1
    transform = `translateX(${((hash(e, seed) - 0.5) * 24 * (1 - k)).toFixed(1)}px)`
  } else {
    // decode
    opacity = clamp(e / 4)
    transform = `translateY(${((1 - outCubic(e / 10)) * 24).toFixed(1)}px)`
  }

  // the rare flicker: the caption drops out and jitters, with an RGB split
  if (flicker !== undefined && f >= flicker && f < flicker + FLICKER_FRAMES) {
    const g = f - flicker
    const on = [1, 0, 1, 1, 0, 0, 1, 0.4, 1, 0, 1, 1, 0.6, 1, 1, 1][g] ?? 1
    opacity *= on
    rgb = Math.max(rgb, (1 - g / FLICKER_FRAMES) * 16)
    slices = Math.max(slices, (1 - g / FLICKER_FRAMES) * 46)
  }
  // exit: the last 9 frames before `until`
  if (until !== undefined && f >= until - 9) {
    const x = (f - (until - 9)) / 9
    opacity *= 1 - outCubic(x)
    filter += ` blur(${(x * 10).toFixed(1)}px)`
    transform += ` translateY(${(-x * 40).toFixed(1)}px) scale(${(1 + x * 0.08).toFixed(3)})`
  }

  const decodeT = style === "decode" ? clamp(e / dur) : 1
  const total = lines.map(plain).join("").length
  let offset = 0
  const rendered = lines.map(l => {
    const p = plain(l)
    const start = offset
    offset += p.length
    // each line decodes over its share of the time, overlapping the next
    const lt = clamp((decodeT * total * 1.4 - start) / (p.length * 1.0 + 1))
    const shown = decodeText(p, lt, seed + start, f)
    return { l, shown, lt, p }
  })

  const align: React.CSSProperties = position === "top" ? { justifyContent: "flex-start", paddingTop: 64 }
    : position === "bottom" ? { justifyContent: "flex-end", paddingBottom: 72 } : { justifyContent: "center" }
  const block = (dx: number, color?: string, clip?: string, key?: string) => (
    <div key={key} style={{
      position: dx || clip || color ? "absolute" : "relative", left: 0, right: 0, top: dx || clip || color ? 0 : undefined, padding: dx || clip || color ? "0 40px" : undefined, transform: `translateX(${dx}px)`,
      clipPath: clip, mixBlendMode: color ? "screen" : undefined, opacity: color ? 0.75 : 1, color,
    }}>
      {rendered.map((r, i) => color
        ? <div key={i} style={{ whiteSpace: "pre", color, textShadow: "none" }}>{r.shown}</div>
        : <Line key={i} line={r.l} text={r.shown} dim={ci => style === "decode" && r.lt < 1 && r.shown[ci] !== r.p[ci]} />)}
    </div>
  )
  const sliceBands = slices > 0.5 ? Array.from({ length: 7 }, (_, i) => ({ top: i / 7, dx: (hash(f * 7 + i, seed) - 0.5) * 2 * slices })) : []
  return (
    <AbsoluteFill style={{ alignItems: "center", ...align, pointerEvents: "none" }}>
      {scrim && (
        <AbsoluteFill style={{
          opacity: opacity * 0.9,
          background: position === "top" ? "linear-gradient(to bottom, rgba(2,6,4,.88) 0%, rgba(2,6,4,.7) " + (lines.length * 13 + 8) + "%, rgba(2,6,4,0) " + (lines.length * 13 + 26) + "%)"
            : position === "bottom" ? "linear-gradient(to top, rgba(2,6,4,.88) 0%, rgba(2,6,4,.7) " + (lines.length * 13 + 8) + "%, rgba(2,6,4,0) " + (lines.length * 13 + 26) + "%)"
            : "radial-gradient(ellipse 80% 40% at 50% 50%, rgba(2,6,4,.82), rgba(2,6,4,0) 100%)",
        }} />
      )}
      {flash > 0 && (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 30% at 50% ${position === "top" ? 20 : position === "bottom" ? 80 : 50}%, rgba(255,183,3,${0.22 * flash}), transparent 70%)` }} />
      )}
      <div style={{
        position: "relative", fontFamily: "'Martian Mono'", fontWeight: 800, fontSize: size, lineHeight: 1.04,
        fontStretch: "75%", fontVariationSettings: '"wdth" 75', letterSpacing, textAlign: "center", textTransform: "uppercase",
        transform, filter: filter || undefined, opacity, transformOrigin: "50% 50%", padding: "0 40px",
      }}>
        {sliceBands.length
          ? sliceBands.map((b, i) => block(b.dx, undefined, `inset(${(b.top * 100).toFixed(2)}% 0 ${(100 - (b.top + 1 / 7) * 100).toFixed(2)}% 0)`, `s${i}`))
          : block(0)}
        {sliceBands.length > 0 && <div style={{ visibility: "hidden" }}>{block(0)}</div>}
        {rgb > 0.5 && block(rgb, "#ff2a4a", undefined, "r")}
        {rgb > 0.5 && block(-rgb, "#20e0ff", undefined, "c")}
      </div>
    </AbsoluteFill>
  )
}

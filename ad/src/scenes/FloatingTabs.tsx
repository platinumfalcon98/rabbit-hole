// Floating tab cards (an allowed extra): the dashboard's own tab and range
// labels drifting in depth around the shot. Back ones sit behind the UI, front
// ones blur past the lens. Positions are seeded; motion is continuous.
import { useCurrentFrame } from "remotion"

const LABELS = ["overview", "activity", "projects", "settings", "30d", "7d", "today", "orbit-ui", "tidepool", "rabbithole-cli", "quill-api", "languages", "streak", "lines"]
const hash = (n: number) => { let h = Math.imul(n ^ 0x2545f491, 0x9e3779b1) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; return ((h ^ (h >>> 13)) >>> 0) / 4294967296 }

export const FloatingTabs: React.FC<{ layer: "back" | "front"; count?: number; seed?: number; opacity?: number }> = ({ layer, count = 10, seed = 1, opacity = 1 }) => {
  const f = useCurrentFrame()
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const k = seed * 100 + i
        const depth = layer === "back" ? 0.35 + hash(k) * 0.4 : 1.25 + hash(k) * 0.5
        const x = (hash(k + 1) * 1.3 - 0.15) * 1440 + Math.sin(f / (90 + hash(k + 2) * 60) + i) * 40 - f * 0.6 * depth
        const y = hash(k + 3) * 1080 + Math.cos(f / (110 + hash(k + 4) * 50) + i * 2) * 30
        const wrapX = ((x % 1700) + 1700) % 1700 - 130
        const label = LABELS[(i + seed * 3) % LABELS.length]
        const active = (i + seed) % 4 === 0
        return (
          <div key={i} style={{
            position: "absolute", left: wrapX, top: y, transform: `scale(${depth}) rotate(${(hash(k + 5) - 0.5) * 10}deg)`, transformOrigin: "0 0",
            fontFamily: "'Martian Mono'", fontSize: 30, padding: "8px 22px", borderRadius: 6,
            background: active ? "rgba(255,183,3,.85)" : "rgba(8,17,13,.85)", color: active ? "#1a1300" : "#86a596",
            border: `1px solid ${active ? "#ffb703" : "#22392d"}`, boxShadow: "0 12px 40px rgba(0,0,0,.5)",
            filter: layer === "back" ? `blur(${(0.75 - depth) * 5}px) brightness(.7)` : `blur(${(depth - 1) * 9}px)`,
            opacity: (layer === "back" ? 0.55 : 0.45) * opacity, whiteSpace: "nowrap",
          }}>{label}</div>
        )
      })}
    </>
  )
}

// The main character: a glowing arrow on eased curves, a short motion trail,
// a press squash and a pulse ring on every click. Drawn in world coordinates
// (inside the camera), so it moves with whatever it is pointing at.
import { useCurrentFrame } from "remotion"
import { type CursorKey, cursorAt } from "./path"

const SIZE = 46
const RING_FRAMES = 26

function Arrow({ x, y, scale = 1, opacity = 1, glow = true }: { x: number; y: number; scale?: number; opacity?: number; glow?: boolean }) {
  return (
    <svg width={SIZE} height={SIZE * 1.3} viewBox="0 0 20 26" style={{
      position: "absolute", left: x - 2, top: y - 1, opacity, transform: `scale(${scale})`, transformOrigin: "2px 1px",
      filter: glow ? "drop-shadow(0 0 6px rgba(57,217,138,.85)) drop-shadow(0 0 18px rgba(57,217,138,.45))" : undefined, overflow: "visible",
    }}>
      <path d="M1 1 L1 20 L6 15.5 L9.6 23.5 L13 22 L9.4 14.2 L16 14.2 Z" fill="#eafff3" stroke="#04110a" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

export const Cursor: React.FC<{ keys: CursorKey[]; from?: number; visibleFrom?: number; visibleTo?: number }> = ({ keys, visibleFrom = -Infinity, visibleTo = Infinity }) => {
  const f = useCurrentFrame()
  if (f < visibleFrom || f > visibleTo) return null
  const fade = Math.min(1, (f - visibleFrom) / 8, (visibleTo - f) / 8)
  const p = cursorAt(f, keys)
  // motion blur: sub-frame copies along the last frame's path, only while moving fast
  const trail = p.speed > 6 ? [0.3, 0.6, 0.9, 1.2].map((d, i) => ({ ...cursorAt(f - d, keys), o: [0.3, 0.2, 0.12, 0.06][i] })) : []
  const rings = keys.filter(k => k.click && f >= k.frame && f < k.frame + RING_FRAMES)
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, opacity: fade }}>
      {rings.map((k, i) => {
        const t = (f - k.frame) / RING_FRAMES
        const r = 12 + 70 * (1 - Math.pow(1 - t, 2))
        return (
          <div key={i} style={{
            position: "absolute", left: k.x - r, top: k.y - r, width: 2 * r, height: 2 * r, borderRadius: "50%",
            border: `${3 * (1 - t) + 1}px solid rgba(255,183,3,${(1 - t) * 0.95})`, boxShadow: `0 0 18px rgba(255,183,3,${(1 - t) * 0.6})`,
          }} />
        )
      })}
      {trail.map((q, i) => <Arrow key={i} x={q.x} y={q.y} opacity={q.o} glow={false} />)}
      <Arrow x={p.x} y={p.y} scale={p.pressed ? 0.86 : 1} />
    </div>
  )
}

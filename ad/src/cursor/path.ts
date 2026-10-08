// The mouse: keyframed positions, eased moves along a slight arc, overshoot,
// click presses, and the sounds they make. Pure: a frame number in, a position out.
import type { Cue } from "../audio/cues"

export interface CursorKey {
  frame: number
  x: number
  y: number
  click?: boolean
  hover?: boolean                       // arriving here plays a hover cue
  ease?: "inOut" | "overshoot"          // how the move INTO this key eases
}
export interface CursorPos { x: number; y: number; pressed: boolean; speed: number }

export const PRESS_FRAMES = 6
const SWIPE_DISTANCE = 300

const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const back = (t: number) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2) }

function position(frame: number, keys: CursorKey[]): { x: number; y: number } {
  if (!keys.length) return { x: 0, y: 0 }
  if (frame <= keys[0].frame) return { x: keys[0].x, y: keys[0].y }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1]
    if (frame > b.frame) continue
    const t = (frame - a.frame) / Math.max(1, b.frame - a.frame)
    const k = b.ease === "overshoot" ? back(t) : inOut(t)
    // a gentle arc: offset perpendicular to the move, zero at both ends
    const dx = b.x - a.x, dy = b.y - a.y
    const arc = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 0.08
    return { x: a.x + dx * k - dy * arc, y: a.y + dy * k + dx * arc }
  }
  const z = keys[keys.length - 1]
  return { x: z.x, y: z.y }
}

export function cursorAt(frame: number, keys: CursorKey[]): CursorPos {
  const p = position(frame, keys)
  const q = position(frame - 1, keys)
  const pressed = keys.some(k => k.click && frame >= k.frame && frame < k.frame + PRESS_FRAMES)
  return { ...p, pressed, speed: Math.hypot(p.x - q.x, p.y - q.y) }
}

export function cursorCues(keys: CursorKey[], scene: string): Cue[] {
  const out: Cue[] = []
  keys.forEach((k, i) => {
    if (k.click) {
      out.push({ frame: k.frame, sound: "click", event: `${scene} cursor click ${i}` })
      out.push({ frame: k.frame + 5, sound: "release", event: `${scene} cursor release ${i}` })
    } else if (k.hover) out.push({ frame: k.frame, sound: "hover", event: `${scene} cursor hover ${i}` })
    const next = keys[i + 1]
    if (next && Math.hypot(next.x - k.x, next.y - k.y) >= SWIPE_DISTANCE) {
      out.push({ frame: k.frame, sound: "swipe", gain: 0.7, event: `${scene} cursor move ${i}` })
    }
  })
  return out
}

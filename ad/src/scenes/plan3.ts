// The choreography of the wow scene (an agent codes while README.md stays
// focused), pure data as in plan.ts.
import type { Cue } from "../audio/cues"
import { cursorCues, type CursorKey } from "../cursor/path"
import type { CamKey } from "../fx/camera"
import { L, WIN, centre } from "./plan"

export const PROMPT = `agent "add a --json flag to rabbithole week"`
export const AGENT_OUT: { text: string; at: number; tone?: "ok" | "dim" }[] = [
  { text: "● Reading internal/report/week.go", at: 132, tone: "dim" },
  { text: "● Editing internal/report/week.go       +34 −14", at: 160 },
  { text: "● Editing cmd/rabbithole/main.go         +9 −4", at: 184 },
  { text: "● Writing internal/report/week_test.go  +17 −2", at: 208 },
  { text: "✓ done · 3 files changed, +60 −20", at: 232, tone: "ok" },
]
export const AGENT = {
  panelFrom: 14, panelTo: 46, typeFrom: 52, typeEvery: 2, cardIn: 96, cardInTo: 128,
  click: 253, shiftFrom: 258, shiftTo: 318, hoverGo: 361, leave: 470, exit: 545,
}
export const typeEnd = AGENT.typeFrom + PROMPT.length * AGENT.typeEvery
/** Where the floating languages card sits (world) and its scale. */
export const AGENT_CARD = { x: 690, y: 210, scale: 0.88 }
const cardT = (k: string, dx = 0) => { const c = centre(L.agent[k]); return { x: AGENT_CARD.x + c.x * AGENT_CARD.scale + dx, y: AGENT_CARD.y + c.y * AGENT_CARD.scale } }

export const AGENT_CURSOR: CursorKey[] = [
  { frame: 196, x: 1460, y: 820 },
  { frame: AGENT.click, x: WIN.x + 420, y: WIN.y + 330, ease: "overshoot", click: true },
  { frame: AGENT.click + 40, x: WIN.x + 470, y: WIN.y + 300 },
  { frame: AGENT.hoverGo, ...cardT("go", -120), ease: "overshoot", hover: true },
  { frame: AGENT.leave - 30, ...cardT("go", -60) },
  { frame: AGENT.leave, x: 1500, y: 1100 },
]
export const AGENT_CAM: CamKey[] = [
  { frame: 0, x: 720, y: 560, zoom: 1.0 },
  { frame: AGENT.panelTo, x: 700, y: 640, zoom: 1.08 },
  { frame: typeEnd, x: 640, y: 760, zoom: 1.22 },
  { frame: AGENT.click - 30, x: 640, y: 700, zoom: 1.12 },
  { frame: AGENT.shiftFrom, x: 980, y: 430, zoom: 1.3 },
  { frame: AGENT.shiftTo + 30, x: 1000, y: 420, zoom: 1.36 },
  { frame: AGENT.leave, x: 900, y: 480, zoom: 1.2 },
  { frame: 578, x: 720, y: 540, zoom: 1.0 },
]
export function agentCues(): Cue[] {
  const out: Cue[] = [
    { frame: AGENT.panelFrom, sound: "swipe", event: "agent terminal slides up" },
    { frame: AGENT.cardIn, sound: "sweep", variant: 0, gain: 0.7, event: "agent languages card floats in" },
    { frame: AGENT.shiftFrom, sound: "riser", variant: 1, gain: 0.6, event: "agent markdown to go" },
    { frame: AGENT.shiftTo, sound: "blip", pitch: 12, event: "agent shift lands" },
    { frame: AGENT.exit, sound: "whoosh", event: "agent exit" },
  ]
  // keys, every 3rd character (the gap rule allows one onset per 2 frames)
  for (let i = 0; i < PROMPT.length; i += 3) out.push({ frame: AGENT.typeFrom + i * AGENT.typeEvery, sound: "type", variant: i, gain: 0.8, event: `agent type ${String(i).padStart(2, "0")}` })
  AGENT_OUT.forEach((l, i) => out.push({ frame: l.at, sound: "tick", variant: i, gain: 0.7, event: `agent output ${i}` }))
  return [...out, ...cursorCues(AGENT_CURSOR, "agent")]
}

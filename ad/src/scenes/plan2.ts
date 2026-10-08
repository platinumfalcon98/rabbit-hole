// The choreography of the second half of the film (month → end), pure data,
// as in plan.ts.
import type { Cue } from "../audio/cues"
import { cursorCues, type CursorKey } from "../cursor/path"
import type { CamKey } from "../fx/camera"
import { L, type Rect } from "./plan"

// ── month ──
export const MONTH_CARD = { x: 720, y: 540, scale: 0.88 }   // the dashboard card, scaled about the frame centre
const card = (r: Rect, dx = 0, dy = 0, s = MONTH_CARD.scale) => ({ x: 720 + (r.x + r.w / 2 - 720) * s + dx, y: 540 + (r.y + r.h / 2 - 540) * s + dy })
export const MONTH = { enter: 30, hover30: 62, click: 72, colsFrom: 76, colsTo: 166, countFrom: 76, countTo: 140, tapeFrom: 130, tapeTo: 175, tip1: 217, tip2: 325, leave: 440, exit: 540 }
export const MONTH_COLS = 30
/** When column i lands (scene frame), from the cols reveal (itemT with overlap 2). */
export const colLands = (i: number) => Math.round(MONTH.colsFrom + (MONTH.colsTo - MONTH.colsFrom) * (i + 2) / (MONTH_COLS + 1))
export const MONTH_CURSOR: CursorKey[] = [
  { frame: 18, x: 300, y: 1100 },
  { frame: MONTH.hover30, ...card(L.month.d30, 4, 6), ease: "overshoot", hover: true },
  { frame: MONTH.click, ...card(L.month.d30, 4, 6), click: true },
  { frame: 150, ...card(L.month.d30, -60, 160) },
  { frame: MONTH.tip1, ...card(L.month.col, 0, -23), ease: "overshoot", hover: true },
  { frame: 290, ...card(L.month.col, 4, -10) },
  { frame: MONTH.tip2, ...card(L.month.col2, 0, -23), hover: true },
  { frame: MONTH.leave - 30, ...card(L.month.col2, 6, -12) },
  { frame: MONTH.leave, x: 1500, y: 1150 },
]
export const MONTH_CAM: CamKey[] = [
  { frame: 0, x: 720, y: 540, zoom: 1.0 },
  { frame: MONTH.click, x: 760, y: 470, zoom: 1.04 },
  { frame: MONTH.colsTo, x: 720, y: 470, zoom: 1.06 },
  { frame: MONTH.tip1, x: 860, y: 430, zoom: 1.18 },
  { frame: MONTH.tip2, x: 580, y: 440, zoom: 1.2 },
  { frame: MONTH.leave, x: 720, y: 500, zoom: 1.05 },
  { frame: 577, x: 720, y: 540, zoom: 1.0 },
]
export function monthCues(): Cue[] {
  const out: Cue[] = [
    { frame: 0, sound: "swipe", event: "month card swings in" },
    { frame: MONTH.tapeFrom, sound: "riser", variant: 0, gain: 0.35, event: "month tape fills" },
    { frame: MONTH.tip1 + 2, sound: "tick", variant: 1, gain: 0.8, event: "month tooltip 1" },
    { frame: MONTH.tip2 + 2, sound: "tick", variant: 1, gain: 0.8, event: "month tooltip 2" },
    { frame: MONTH.exit, sound: "whoosh", event: "month exit" },
  ]
  for (let i = 0; i < MONTH_COLS; i++) out.push({ frame: colLands(i), sound: "blip", pitch: Math.floor(i / 2), gain: 0.8, event: `month column ${String(i).padStart(2, "0")}` })
  return [...out, ...cursorCues(MONTH_CURSOR, "month")]
}

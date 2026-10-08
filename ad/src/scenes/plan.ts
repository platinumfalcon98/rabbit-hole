// The film's choreography, as pure data: per scene, its cursor path, camera,
// reveal timings and the sound cues they make (scene-relative frames). The
// components draw from it and filmCues() hears from it, so a picture and its
// sound can never drift apart. No React, no DOM: tested in node.
import type { Cue } from "../audio/cues"
import { carrotPixels } from "../../../src/webview/carrot"
import { onBeat } from "./beat"
import layout from "./layout.json"
import { cursorCues, type CursorKey } from "../cursor/path"
import type { CamKey } from "../fx/camera"

// ── shared geometry: the VS Code window (world coordinates) ──
export const WIN = { x: 60, y: 60, w: 1320, h: 960 }
export const TITLE_H = 38
export const ACT_W = 60
export const STATUS_H = 30
export const SIDEBAR_W = 360
export const ACT_SLOT = 58
/** Activity Bar slot k's centre (k = 5 is Rabbit Hole). */
export const actSlot = (k: number) => ({ x: WIN.x + ACT_W / 2, y: WIN.y + TITLE_H + 10 + ACT_SLOT / 2 + ACT_SLOT * k })
export const CARROT_SLOT = 5

// ── power-on ──
export const POWER = {
  boot: 2,
  lineFrom: 5, lineTo: 20,          // the horizontal line spreads
  openFrom: 20, openTo: 38,         // and opens into a picture
  drawFrom: 46, every: 3,           // one pixel every 3 frames
  pixel: 44,                        // px per carrot pixel
  flyFrom: 282,                     // the carrot flies to the Activity Bar
}
export const PIXELS = carrotPixels()
export function powerOnCues(): Cue[] {
  const out: Cue[] = [{ frame: POWER.boot, sound: "boot", event: "powerOn boot" }]
  PIXELS.forEach((_, i) => out.push({
    frame: POWER.drawFrom + POWER.every * i, sound: "pixel", pitch: Math.floor(i * 15 / PIXELS.length), event: `powerOn pixel ${String(i).padStart(2, "0")}`,
  }))
  const done = POWER.drawFrom + POWER.every * PIXELS.length
  out.push({ frame: onBeat("powerOn", done + 14), sound: "thud", gain: 0.6, event: "powerOn carrot settles" })
  out.push({ frame: POWER.flyFrom, sound: "whoosh", event: "powerOn carrot flies" })
  return out
}

// ── hook ──

export type Rect = { x: number; y: number; w: number; h: number }
export const L = layout as Record<string, Record<string, Rect>>
export const centre = (r: Rect, ox = 0, oy = 0, s = 1) => ({ x: ox + (r.x + r.w / 2) * s, y: oy + (r.y + r.h / 2) * s })

/** The Rabbit Hole view inside the sidebar (world). */
export const MINI_AT = { x: WIN.x + ACT_W + 6, y: WIN.y + TITLE_H + 34, w: 348, h: 780 }
const miniT = (k: string, dx = 0) => { const c = centre(L.mini[k], MINI_AT.x, MINI_AT.y); return { x: c.x + dx, y: c.y } }
const slot = actSlot(CARROT_SLOT)
export const HOOK = {
  floatTo: 36,
  fishFrom: 40, fishIn: 108, fishOut: 150, fishBack: 186, tick: 126,
  carrotHover: 222, click: 253,
  sideFrom: 256, sideTo: 284,
  rowsFrom: 262, rowsTo: 320, countFrom: 268, countTo: 320,
  camIn: 290,
  focusFrom: 372, focusTo: 455,
  openHover: 505, openClick: 541,
  dive: 546,
}
export const HOOK_CURSOR: CursorKey[] = [
  { frame: 160, x: 1300, y: 990 },
  { frame: HOOK.carrotHover, x: slot.x + 6, y: slot.y + 4, ease: "overshoot", hover: true },
  { frame: HOOK.click, x: slot.x + 6, y: slot.y + 4, click: true },
  { frame: 300, x: slot.x + 70, y: slot.y - 40 },
  { frame: HOOK.focusFrom, ...miniT("cli", -60), ease: "overshoot", hover: true },
  { frame: HOOK.focusTo, ...miniT("cli", 40) },
  { frame: HOOK.openHover, ...miniT("open", -40), hover: true },
  { frame: HOOK.openClick, ...miniT("open", -40), click: true },
  { frame: 577, ...miniT("open", -40) },
]
export const HOOK_CAM: CamKey[] = [
  { frame: 0, x: 720, y: 540, zoom: 1 },
  { frame: HOOK.camIn, x: 720, y: 540, zoom: 1 },
  { frame: HOOK.camIn + 46, x: 330, y: 540, zoom: 1.7 },
  { frame: HOOK.focusFrom, x: 320, y: 640, zoom: 1.85 },
  { frame: HOOK.openHover, x: 320, y: 700, zoom: 1.9 },
  { frame: HOOK.openClick, x: 310, y: 760, zoom: 2.0 },
  { frame: 577, x: miniT("open", -40).x, y: miniT("open").y, zoom: 7 },
]
export function hookCues(): Cue[] {
  const out: Cue[] = [
    { frame: 0, sound: "open", event: "hook window floats in" },
    { frame: HOOK.fishFrom, sound: "drone", gain: 0.9, event: "hook zoom drone" },
    { frame: HOOK.fishFrom + 2, sound: "riser", variant: 0, gain: 0.5, event: "hook zoom in" },
    { frame: HOOK.tick, sound: "tick", variant: 1, gain: 1, event: "hook status ticks to 3h40m" },
    { frame: HOOK.fishOut, sound: "sweep", variant: 0, event: "hook zoom out" },
    { frame: HOOK.sideFrom, sound: "swipe", event: "hook sidebar opens" },
    { frame: HOOK.camIn, sound: "sweep", variant: 0, gain: 0.8, event: "hook camera to sidebar" },
    { frame: HOOK.dive, sound: "whoosh", event: "hook dive into dashboard" },
  ]
  for (let f = HOOK.countFrom; f < HOOK.countTo; f += 4) out.push({ frame: f, sound: "tick", variant: f, gain: 0.6, event: `hook count ${f}` })
  return [...out, ...cursorCues(HOOK_CURSOR, "hook")]
}

// ── today ──
const todayT = (k: string, dx = 0) => { const c = centre(L.today[k]); return { x: c.x + dx, y: c.y } }
export const TODAY_S = {
  enter: 24, countFrom: 8, countTo: 68, tapeFrom: 70, tapeTo: 140, meterFrom: 142, meterTo: 182,
  pan: 252, panTo: 292, focusGo: 325, focusTs: 433, leave: 515, exit: 545,
}
export const TODAY_CURSOR: CursorKey[] = [
  { frame: 262, x: 1300, y: 1060 },
  { frame: TODAY_S.focusGo, ...todayT("go", -300), ease: "overshoot", hover: true },
  { frame: TODAY_S.focusGo + 70, ...todayT("go", -200) },
  { frame: TODAY_S.focusTs, ...todayT("ts", -250), hover: true },
  { frame: TODAY_S.leave - 20, ...todayT("ts", -160) },
  { frame: TODAY_S.leave, x: 1340, y: 1040 },
]
export const TODAY_CAM: CamKey[] = [
  { frame: 0, x: 720, y: 420, zoom: 1.0 },
  { frame: TODAY_S.meterFrom, x: 700, y: 410, zoom: 1.05 },
  { frame: TODAY_S.pan, x: 720, y: 420, zoom: 1.02 },
  { frame: TODAY_S.panTo, x: 720, y: 770, zoom: 1.0 },
  { frame: TODAY_S.focusTs, x: 700, y: 790, zoom: 1.05 },
  { frame: TODAY_S.exit, x: 720, y: 770, zoom: 1.0 },
  { frame: 578, x: 720, y: 700, zoom: 0.78 },
]
export function todayCues(): Cue[] {
  const out: Cue[] = [
    { frame: 0, sound: "open", event: "today dashboard opens" },
    { frame: TODAY_S.meterFrom, sound: "riser", variant: 0, event: "today meter grows" },
    { frame: TODAY_S.meterTo, sound: "blip", pitch: 10, gain: 1.1, event: "today target met at 14:32" },
    { frame: TODAY_S.pan, sound: "sweep", variant: 0, event: "today camera to languages" },
    { frame: TODAY_S.exit, sound: "whoosh", event: "today exit" },
  ]
  for (let f = TODAY_S.countFrom; f < TODAY_S.countTo; f += 6) out.push({ frame: f, sound: "tick", variant: f, gain: 0.55, event: `today count ${f}` })
  for (let f = TODAY_S.tapeFrom; f < TODAY_S.tapeTo; f += 3) out.push({ frame: f, sound: "tick", variant: f + 1, gain: 0.45, event: `today tape ${f}` })
  return [...out, ...cursorCues(TODAY_CURSOR, "today")]
}

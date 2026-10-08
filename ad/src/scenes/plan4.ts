// The choreography of the year, streaks, share, local and end scenes, pure
// data as in plan.ts.
import type { Cue } from "../audio/cues"
import { cursorCues, type CursorKey } from "../cursor/path"
import type { CamKey } from "../fx/camera"
import { L, centre } from "./plan"

const at = (shot: string, k: string, dx = 0, dy = 0) => { const c = centre(L[shot][k]); return { x: c.x + dx, y: c.y + dy } }

// ── year ──
export const YEAR = { enter: 24, countFrom: 6, countTo: 60, heatFrom: 20, heatTo: 110, barsFrom: 240, barsTo: 290, hover: 289, leave: 395, exit: 410 }
export const YEAR_CURSOR: CursorKey[] = [
  { frame: 230, x: 1480, y: 1120 },
  { frame: YEAR.hover, ...at("year", "cli", -380), ease: "overshoot", hover: true },
  { frame: YEAR.leave - 40, ...at("year", "cli", -300) },
  { frame: YEAR.leave, x: 1500, y: 1150 },
]
export const YEAR_CAM: CamKey[] = [
  { frame: 0, x: 720, y: 440, zoom: 1.0 },
  { frame: YEAR.heatTo, x: 730, y: 470, zoom: 1.06 },
  { frame: YEAR.barsFrom, x: 720, y: 520, zoom: 1.05 },
  { frame: YEAR.hover, x: 720, y: 600, zoom: 1.02 },
  { frame: 433, x: 720, y: 560, zoom: 0.92 },
]
export function yearCues(): Cue[] {
  const out: Cue[] = [
    { frame: 0, sound: "swipe", event: "year rises in" },
    { frame: YEAR.barsFrom, sound: "riser", variant: 0, gain: 0.5, event: "year shares grow" },
    { frame: YEAR.exit, sound: "whoosh", event: "year exit" },
  ]
  for (let f = YEAR.countFrom; f < YEAR.countTo; f += 6) out.push({ frame: f, sound: "tick", variant: f, gain: 0.5, event: `year count ${f}` })
  for (let f = YEAR.heatFrom + 1; f < YEAR.heatTo; f += 4) out.push({ frame: f, sound: "tick", variant: f + 1, gain: 0.3, event: `year heat ${f}` })
  return [...out, ...cursorCues(YEAR_CURSOR, "year")]
}

// ── streaks ──
export const STREAK = { flipFrom: 10, flipTo: 90, countFrom: 24, countTo: 84, hover: 180, click: 217, leave: 380, exit: 410 }
export const CARDS = 5
export const cardStarts = (i: number) => Math.round(STREAK.flipFrom + (STREAK.flipTo - STREAK.flipFrom) * i / (CARDS + 1))
export const STREAK_CURSOR: CursorKey[] = [
  { frame: 120, x: 300, y: 1120 },
  { frame: STREAK.hover, ...at("streaks", "risk", -40, 6), ease: "overshoot", hover: true },
  { frame: STREAK.click, ...at("streaks", "risk", -40, 6), click: true },
  { frame: 300, ...at("streaks", "risk", 60, 60) },
  { frame: STREAK.leave, x: 1500, y: 1150 },
]
export const STREAK_CAM: CamKey[] = [
  { frame: 0, x: 720, y: 520, zoom: 1.0 },
  { frame: STREAK.flipTo, x: 720, y: 540, zoom: 1.04 },
  { frame: STREAK.hover - 30, x: 900, y: 500, zoom: 1.3 },
  { frame: STREAK.click, x: 1020, y: 500, zoom: 1.65 },
  { frame: 330, x: 1040, y: 500, zoom: 1.75 },
  { frame: 433, x: 900, y: 520, zoom: 1.2 },
]
export function streakCues(): Cue[] {
  const out: Cue[] = [
    { frame: STREAK.click + 3, sound: "blip", pitch: 12, gain: 1.1, event: "streaks back on track" },
    { frame: STREAK.click + 14, sound: "blip", pitch: 14, gain: 0.8, event: "streaks back on track 2" },
    { frame: STREAK.exit, sound: "whoosh", event: "streaks exit" },
  ]
  for (let i = 0; i < CARDS; i++) out.push({ frame: cardStarts(i), sound: "swipe", gain: 0.6, event: `streaks card ${i} flips` })
  for (let f = STREAK.countFrom; f < STREAK.countTo; f += 4) out.push({ frame: f, sound: "tick", variant: f, gain: 0.45, event: `streaks count ${f}` })
  return [...out, ...cursorCues(STREAK_CURSOR, "streaks")]
}

// ── share ──
export const SHARE = { enter: 18, click: 36, open: 40, cardFrom: 44, cardTo: 96, hoverGo: 150, go: 180, flyFrom: 184, flyTo: 232, exit: 268 }
export const SHARE_CURSOR: CursorKey[] = [
  { frame: 4, x: 1000, y: 700 },
  { frame: SHARE.click - 6, ...at("settings", "export", -10, 4), ease: "overshoot", hover: true },
  { frame: SHARE.click, ...at("settings", "export", -10, 4), click: true },
  { frame: 110, ...at("share", "go", 120, 120) },
  { frame: SHARE.hoverGo, ...at("share", "go", -6, 4), ease: "overshoot", hover: true },
  { frame: SHARE.go, ...at("share", "go", -6, 4), click: true },
  { frame: 260, ...at("share", "go", -40, 80) },
]
export const SHARE_CAM: CamKey[] = [
  { frame: 0, x: 900, y: 760, zoom: 1.25 },
  { frame: SHARE.click, x: 1000, y: 800, zoom: 1.35 },
  { frame: SHARE.open + 14, x: 720, y: 540, zoom: 1.0 },
  { frame: SHARE.hoverGo, x: 640, y: 520, zoom: 1.08 },
  { frame: SHARE.go, x: 640, y: 520, zoom: 1.1 },
  { frame: 288, x: 720, y: 540, zoom: 0.95 },
]
export function shareCues(): Cue[] {
  const out: Cue[] = [
    { frame: 0, sound: "swipe", event: "share settings slide in" },
    { frame: SHARE.open, sound: "open", event: "share export dialog opens" },
    { frame: SHARE.flyFrom, sound: "whoosh", event: "share card flies out" },
    { frame: SHARE.flyFrom + 4, sound: "sweep", variant: 0, event: "share card air" },
  ]
  for (let f = SHARE.cardFrom; f < SHARE.cardTo; f += 4) out.push({ frame: f, sound: "tick", variant: f, gain: 0.5, event: `share card draws ${f}` })
  return [...out, ...cursorCues(SHARE_CURSOR, "share")]
}

// ── local ──
export const LOCAL = { pullTo: 70, land: 74 }
export function localCues(): Cue[] {
  return [
    { frame: 0, sound: "sweep", variant: 1, event: "local everything pulls back" },
    { frame: LOCAL.land, sound: "thud", event: "local lands in the carrot" },
  ]
}

// ── end ──
export const END = { title: 72, live: 120, pulse: 216, fadeFrom: 246 }
export function endCues(): Cue[] {
  return [
    { frame: END.title, sound: "thud", event: "end RABBIT HOLE slams" },
    { frame: END.live, sound: "chime", event: "end LIVE ON VSCODE MARKETPLACE" },
    { frame: END.live + 2, sound: "sweep", variant: 0, gain: 0.6, event: "end live decodes" },
    { frame: END.pulse, sound: "thud", gain: 0.45, event: "end final soft thud" },
  ]
}

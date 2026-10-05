// Layout arithmetic for the text charts. Pure, so the width rules are tested
// without a browser.
import { MIN, MON, WD, fromKey, pad2 } from "./format"
import type { TapeWindow } from "./model"

export const TAPE_GLYPHS = ["·", "░", "▒", "▓", "█"]
export const SPARK = "▁▂▃▄▅▆▇█"
export const SEG = 12

export const tapeMaxCells = (width: number): 24 | 48 => (width < 620 ? 24 : 48)
export const heatWeeksFor = (width: number): 26 | 53 => (width < 600 ? 26 : 53)

// Cells are whole minutes that divide an hour, as fine as the budget allows:
// 15 min for a 12-hour day when wide, 30 when narrow, coarser when night work
// widens the window. Uneven cells (16.25 min) would make the tooltips lie.
const CELL_MINUTES = [5, 10, 15, 20, 30, 60]
export function tapeCellCount(windowMin: number, maxCells: number): number {
  for (const c of CELL_MINUTES) if (windowMin / c <= maxCells) return windowMin / c
  return windowMin / 60
}

// One label per hour; every other one when a long window meets a narrow tape.
export function tapeTicks(win: TapeWindow, maxCells: number): string[] {
  const n = Math.round((win.endMin - win.startMin) / 60)
  const step = n > (maxCells <= 24 ? 12 : 18) ? 2 : 1
  const first = win.startMin / 60
  return Array.from({ length: n }, (_, i) => (i % step === 0 ? pad2(first + i) : ""))
}

export function tapeKey(win: TapeWindow, average: boolean): string {
  const c = win.cellMin
  return average
    ? `each cell is ${c} min; █ marks the busiest slots`
    : `each cell is ${c} min: █ ${Math.ceil(c * 0.75)}m+ active … ░ under ${Math.ceil(c * 0.25)}m`
}

// Lengths of the + and - runs for a row, scaled to the biggest row. Both sides
// stay visible when both changed, and together they never pass `cols`.
export function runs(added: number, deleted: number, max: number, cols: number): [number, number] {
  const scale = (v: number) => Math.round(v / Math.max(1, max) * cols)
  const na = added ? Math.max(0, Math.min(Math.max(1, scale(added)), cols - (deleted ? 1 : 0))) : 0
  const nr = deleted ? Math.max(0, Math.min(Math.max(1, scale(deleted)), cols - na)) : 0
  return [na, nr]
}

// How full each of a range column's SEG segments is (0–1), bottom first. A day
// with any activity shows at least a quarter segment.
export function colSegments(ms: number, max: number): number[] {
  const h = ms > 0 ? Math.max(0.25, ms / Math.max(1, max) * SEG) : 0
  return Array.from({ length: SEG }, (_, s) => Math.max(0, Math.min(1, h - s)))
}

export const colGap = (n: number): number => (n > 45 ? 1 : n > 20 ? 2 : 5)

export interface AxisLabel { text: string; cls: string; col: number; span: number }

// A week names its days, two weeks number them, longer ranges label Mondays.
export function colAxis(dates: string[], today: string): AxisLabel[] {
  const n = dates.length
  const out: AxisLabel[] = []
  dates.forEach((key, i) => {
    const d = fromKey(key)
    const cls = key === today ? "now" : ""
    if (n <= 7) out.push({ text: `${WD[d.getDay()].toLowerCase()} ${d.getDate()}`, cls, col: i + 1, span: 1 })
    else if (n <= 16) out.push({ text: String(d.getDate()), cls, col: i + 1, span: 1 })
    else if (d.getDay() === 1 && n - i >= 3) {
      out.push({ text: `${d.getDate()} ${MON[d.getMonth()].toLowerCase()}`, cls: "mon", col: i + 1, span: Math.min(7, n - i) })
    }
  })
  return out
}

export function heatLevel(ms: number): 0 | 1 | 2 | 3 | 4 {
  if (ms <= 0) return 0
  if (ms < 30 * MIN) return 1
  if (ms < 90 * MIN) return 2
  if (ms < 180 * MIN) return 3
  return 4
}

// Indices into the year's days for the last `weeks` whole weeks, Monday first
// (the year starts on a Monday); null for the days after today.
export function heatCells(total: number, weeks: number): (number | null)[] {
  const all = Math.ceil(total / 7)
  const first = Math.max(0, all - weeks) * 7
  const out: (number | null)[] = []
  for (let i = first; i < all * 7; i++) out.push(i < total ? i : null)
  return out
}

export function heatMonths(days: string[], weeks: number): { text: string; col: number }[] {
  const all = Math.ceil(days.length / 7)
  const first = Math.max(0, all - weeks)
  const out: { text: string; col: number }[] = []
  let last = -1
  for (let w = first; w < all; w++) {
    const m = fromKey(days[w * 7]).getMonth()
    if (m === last) continue
    last = m
    // a month showing only its last days at the left edge would collide with the next label
    if (w === first && fromKey(days[Math.min(days.length - 1, (first + 2) * 7)]).getMonth() !== m) continue
    out.push({ text: MON[m].toLowerCase(), col: w - first + 1 })
  }
  return out
}

export function sparkGlyphs(values: number[]): { glyph: string; zero: boolean }[] {
  const max = Math.max(1, ...values)
  return values.map(v => (v > 0
    ? { glyph: SPARK[Math.min(7, Math.floor(v / max * 7.999))], zero: false }
    : { glyph: SPARK[0], zero: true }))
}

// Ten cells of progress toward the target: [filled, empty].
export function meter(ms: number, targetMs: number): [number, number] {
  const filled = targetMs > 0 ? Math.min(10, Math.round(ms / targetMs * 10)) : 10
  return [filled, 10 - filled]
}

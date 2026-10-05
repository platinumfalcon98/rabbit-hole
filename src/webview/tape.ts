// The day tape: block glyphs across the day, one cell per few minutes, coloured
// by the cell's main language. For a range it is the average active day.
import type { ActivitySession } from "../shared/types"
import { $, el, onWidth } from "./dom"
import { fmt, hhmm } from "./format"
import { TAPE_GLYPHS, tapeCellCount, tapeKey, tapeMaxCells, tapeTicks } from "./layout"
import { TapeCell, tapeCells, tapeWindow } from "./model"
import { bindTip, tipLine, tipSub } from "./tooltip"

export interface TapeSource {
  sessions: ActivitySession[]   // what is drawn (narrowed to the focus)
  base: ActivitySession[]       // the unfocused sessions: they set the window and, for averages, the scale
  perDays: number               // 1 = a single day; more = the average active day of a range
  now: number
  color: (c: TapeCell) => string | null
  label: (c: TapeCell) => string | null
}

let src: TapeSource | null = null
let drawnFor = -1

export function setTape(next: TapeSource): void {
  src = next
  drawnFor = -1
  drawTape()
}

// Redraws only when the cell budget changes; between breakpoints the glyphs
// scale with the container (style.css).
function drawTape(): void {
  const width = $("tape-wrap").clientWidth
  if (!src || !width) return
  const maxCells = tapeMaxCells(width)
  if (maxCells === drawnFor) return
  drawnFor = maxCells
  const s = src
  const first = tapeWindow(s.base, 1, s.now)
  const win = tapeWindow(s.base, tapeCellCount(first.endMin - first.startMin, maxCells), s.now)
  const average = s.perDays > 1
  const cells = tapeCells(s.sessions, win, s.now, { perDays: s.perDays, base: s.base })
  const tape = $("tape")
  tape.style.setProperty("--cells", String(win.cells))
  tape.setAttribute("aria-label", `Active time across the day in ${win.cellMin}-minute blocks, ${hhmm(win.startMin)} to ${hhmm(win.endMin)}`)
  tape.replaceChildren(...cells.map(c => {
    const span = el("span", c.level ? null : "off", TAPE_GLYPHS[c.level])
    const color = c.level ? s.color(c) : null
    if (color) span.style.color = color
    const what = s.label(c)
    bindTip(span, () => (c.level
      ? [tipLine(`${fmt(c.ms)} active`, average ? `of ${win.cellMin}m, average day` : `of ${win.cellMin}m`), tipSub(hhmm(c.startMin) + (what ? ` · mostly ${what}` : ""))]
      : [tipSub(`${hhmm(c.startMin)} · idle`)]))
    return span
  }))
  const ticks = tapeTicks(win, maxCells)
  const row = $("ticks")
  row.style.gridTemplateColumns = `repeat(${ticks.length}, minmax(0, 1fr))`
  row.replaceChildren(...ticks.map(t => el("span", null, t)))
  const key = document.getElementById("tape-key")
  if (key) key.textContent = tapeKey(win, average)
}

export function initTape(): void {
  onWidth($("tape-wrap"), drawTape)
}

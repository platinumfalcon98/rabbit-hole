// The report: A4, dark pages with the hairline terminal frame, flat (no glow,
// no scanlines, which neither PDF viewers nor printers keep). Marks are shapes;
// text is Martian Mono, embedded, and goes through pdfSafe because jsPDF has no
// fallback for a character the font lacks.
import { jsPDF } from "jspdf"
import MM_BOLD from "./fonts/MartianMono-NrBd.ttf"
import MM_REGULAR from "./fonts/MartianMono-NrRg.ttf"
import { carrotPixels } from "./carrot"
import { ExportData, OTHER_COLOR, PAGE, SHADE, generatedText, mix, rangeText } from "./exportModel"
import {
  CONTENT_TOP, FOOTER_H, FRAME_INSET, FRAME_RADIUS, GAP, HEADER_H, PAGE_BOTTOM, PAGE_H, PAGE_TOP, PAGE_W, PAGE_X,
  ROW, Section, TITLE_H, reportPages,
} from "./exportLayout"
import { clock, dstr, fmt, hhmm, hours, pct, shortDate } from "./format"
import { colGap, runs, tapeTicks } from "./layout"
import { ellipsize, pdfSafe, ttfCoverage } from "./textFit"

type Doc = jsPDF
const FONT = "MartianMono"
const W = PAGE_W - 2 * PAGE_X
const DIVIDER = mix(PAGE.rule, PAGE.bg, 0.6)

let covered: Set<number> | null = null
const coverage = (): Set<number> =>
  covered ?? (covered = ttfCoverage(Uint8Array.from(atob(MM_REGULAR), c => c.charCodeAt(0))))

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const fill = (doc: Doc, hex: string) => doc.setFillColor(...rgb(hex))
const stroke = (doc: Doc, hex: string) => doc.setDrawColor(...rgb(hex))

function type(doc: Doc, size: number, bold = false): void {
  doc.setFont(FONT, bold ? "bold" : "normal")
  doc.setFontSize(size)
}

function say(doc: Doc, s: string, x: number, y: number, color: string, align: "left" | "right" | "center" = "left"): void {
  doc.setTextColor(...rgb(color))
  doc.text(pdfSafe(s, coverage()), x, y, { align })
}

const fit = (doc: Doc, s: string, w: number): string => ellipsize(pdfSafe(s, coverage()), w, t => doc.getTextWidth(t))

function carrot(doc: Doc, x: number, y: number, px: number): void {
  for (const p of carrotPixels()) {
    fill(doc, p.c)
    doc.rect(x + p.x * px, y + p.y * px, px, px, "F")
  }
}

function frame(doc: Doc, d: ExportData, page: number, pages: number): void {
  fill(doc, PAGE.bg)
  doc.rect(0, 0, PAGE_W, PAGE_H, "F")
  stroke(doc, PAGE.frame)
  doc.setLineWidth(0.75)
  doc.roundedRect(FRAME_INSET, FRAME_INSET, PAGE_W - 2 * FRAME_INSET, PAGE_H - 2 * FRAME_INSET, FRAME_RADIUS, FRAME_RADIUS, "S")

  carrot(doc, PAGE_X, PAGE_TOP, 4)
  const tx = PAGE_X + 14 * 4 + 12
  type(doc, 9.5)
  const right = `page ${page} of ${pages}`
  const rw = doc.getTextWidth(right)
  say(doc, right, PAGE_X + W, PAGE_TOP + 14, PAGE.dim, "right")
  say(doc, fit(doc, `${d.title} · ${rangeText(d)}`, PAGE_X + W - rw - 12 - tx), tx, PAGE_TOP + 31, PAGE.dim)
  type(doc, 15, true)
  say(doc, "rabbit hole · report", tx, PAGE_TOP + 14, PAGE.ink)
  doc.line(PAGE_X, PAGE_TOP + HEADER_H - 2, PAGE_X + W, PAGE_TOP + HEADER_H - 2)

  const fy = PAGE_H - PAGE_BOTTOM - FOOTER_H
  doc.line(PAGE_X, fy, PAGE_X + W, fy)
  carrot(doc, PAGE_X, fy + 4, 2)
  type(doc, 8.5)
  say(doc, `${generatedText(d.generatedAt)} by rabbit hole`, PAGE_X + 28 + 8, fy + 17, PAGE.mute)
  say(doc, "local data only", PAGE_X + W, fy + 17, PAGE.mute, "right")
}

// A boxed section with its title set into the top rule.
function box(doc: Doc, y: number, s: Section, title: string, sub = ""): void {
  stroke(doc, PAGE.rule)
  doc.setLineWidth(0.75)
  doc.rect(PAGE_X, y + 5, W, s.h - 5, "S")
  type(doc, 9.5, true)
  const tw = doc.getTextWidth(title + " ")
  type(doc, 9.5)
  const sw = sub ? doc.getTextWidth(pdfSafe(sub, coverage())) : 0
  fill(doc, PAGE.bg)
  doc.rect(PAGE_X + 8, y, tw + sw + 8, 10, "F")
  type(doc, 9.5, true)
  say(doc, title, PAGE_X + 12, y + 8.5, PAGE.amber)
  if (sub) {
    type(doc, 9.5)
    say(doc, sub, PAGE_X + 12 + tw, y + 8.5, PAGE.dim)
  }
}

type Cell = string | { t: string; c: string }
interface Col { w: number; right?: boolean }   // w 0: whatever width is left
interface Placed { x: number; w: number; right: boolean }

function place(cols: Col[]): Placed[] {
  const fixed = cols.reduce((t, c) => t + c.w, 0) + 8 * (cols.length - 1)
  let x = PAGE_X + 12
  return cols.map(c => {
    const w = c.w || Math.max(20, W - 24 - fixed)
    const out = { x, w, right: !!c.right }
    x += w + 8
    return out
  })
}

function line(doc: Doc, at: Placed[], y: number, row: Cell[], color: string): void {
  row.forEach((cell, i) => {
    const col = at[i]
    if (!col) return
    const t = typeof cell === "string" ? cell : cell.t
    const c = typeof cell === "string" ? color : cell.c
    say(doc, fit(doc, t, col.w), col.right ? col.x + col.w : col.x, y, c, col.right ? "right" : "left")
  })
}

// Header, rows ("none" when empty), "… and N more", footer rows, ROW apart, as
// reportPages measured them. Returns the first body row's baseline.
function table(doc: Doc, y: number, cols: Col[], head: string[], body: Cell[][], more: string, foot: Cell[][] = []): number {
  const at = place(cols)
  let base = y + TITLE_H + ROW - 3
  type(doc, 8.5, true)
  line(doc, at, base, head, PAGE.dim)
  stroke(doc, PAGE.frame)
  doc.setLineWidth(0.5)
  doc.line(PAGE_X + 12, base + 3, PAGE_X + W - 12, base + 3)
  const first = base + ROW
  type(doc, 9)
  if (!body.length) {
    base += ROW
    say(doc, "none", at[0].x, base, PAGE.mute)
  }
  for (const r of body) {
    base += ROW
    line(doc, at, base, r, PAGE.ink)
    stroke(doc, DIVIDER)
    doc.line(PAGE_X + 12, base + 3, PAGE_X + W - 12, base + 3)
  }
  if (more) {
    base += ROW
    say(doc, more, at[0].x, base, PAGE.mute)
  }
  type(doc, 9, true)
  for (const r of foot) {
    base += ROW
    line(doc, at, base, r, PAGE.ink)
  }
  return first
}

const langColor = (d: ExportData) => {
  const m = new Map(d.langs.map(l => [l.name, l.color]))
  return (name: string | null) => (name ? m.get(name) ?? OTHER_COLOR : PAGE.add)
}

function tiles(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "summary")
  const top = d.langs[0]
  const last: [string, string, string] = d.sel === "all"
    ? [d.projects[0]?.name ?? "—", "top project", PAGE.ink]
    : d.single
      ? [d.metDays ? "met" : `${fmt(Math.max(0, d.targetMs - d.totalMs))} short`, `daily target ${fmt(d.targetMs)}`, d.metDays ? PAGE.add : PAGE.ink]
      : [`${d.metDays}/${d.days}`, "days on target", PAGE.ink]
  const list: [string, string, string][] = d.single
    ? [
      [fmt(d.totalMs), "active time", PAGE.ink],
      [`${d.streak}d`, "day streak", PAGE.ink],
      [String(d.sessions.length), "sessions", PAGE.ink],
      [top ? top.name : "—", "top language", PAGE.ink],
      [`+${d.added.toLocaleString("en-US")}`, "lines added", PAGE.add],
      [`−${d.deleted.toLocaleString("en-US")}`, "lines removed", PAGE.del],
      [d.firstStart !== null ? clock(d.firstStart) : "—", "first session", PAGE.ink],
      last,
    ]
    : [
      [hours(d.totalMs), "active time", PAGE.ink],
      [`${d.activeDays}/${d.days}`, "active days", PAGE.ink],
      [fmt(d.perActiveMs), "per active day", PAGE.ink],
      [top ? top.name : "—", "top language", PAGE.ink],
      [`+${d.added.toLocaleString("en-US")}`, "lines added", PAGE.add],
      [`−${d.deleted.toLocaleString("en-US")}`, "lines removed", PAGE.del],
      [d.best ? fmt(d.best.ms) : "—", d.best ? `best day, ${shortDate(d.best.date)}` : "best day", PAGE.ink],
      last,
    ]
  const tw = (W - 24 - 3 * 8) / 4
  list.forEach(([value, key, color], i) => {
    const x = PAGE_X + 12 + (i % 4) * (tw + 8)
    const ty = y + TITLE_H + Math.floor(i / 4) * (36 + 6)
    stroke(doc, PAGE.rule)
    doc.setLineWidth(0.75)
    doc.rect(x, ty, tw, 36, "S")
    // a word value (a language or project name) shrinks before it is cut
    let size = 17
    type(doc, size, true)
    while (size > 11 && doc.getTextWidth(pdfSafe(value, coverage())) > tw - 12) type(doc, --size, true)
    say(doc, fit(doc, value, tw - 12), x + 6, ty + 18, color)
    type(doc, 8.5)
    say(doc, fit(doc, key, tw - 12), x + 6, ty + 30, PAGE.dim)
  })
}

function tape(doc: Doc, d: ExportData, y: number, s: Section): void {
  const t = d.tapes!.report
  box(doc, y, s, "day", `${hhmm(t.win.startMin)}–${hhmm(t.win.endMin)}, ${t.win.cellMin}-minute cells`)
  const x0 = PAGE_X + 12
  const w = W - 24
  const cw = w / t.cells.length
  const top = y + TITLE_H + 2
  const h = 22
  const color = langColor(d)
  t.cells.forEach((c, i) => {
    const x = x0 + i * cw
    if (!c.level) {
      fill(doc, PAGE.mute)
      doc.rect(x + cw / 2 - 0.75, top + h - 1.5, 1.5, 1.5, "F")
      return
    }
    fill(doc, mix(color(c.language), PAGE.bg, SHADE[c.level]))
    doc.rect(x + 0.5, top, cw - 1, h, "F")
  })
  type(doc, 8)
  const ticks = tapeTicks(t.win, t.cells.length)
  ticks.forEach((label, i) => { if (label) say(doc, label, x0 + i * (w / ticks.length), top + h + 10, PAGE.mute) })
}

function columns(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "each day", `target ${fmt(d.targetMs)} met on ${d.metDays} of ${d.days} days`)
  const list = d.daysList
  const gap = colGap(list.length)
  const x0 = PAGE_X + 12
  const w = W - 24
  const cw = (w - gap * (list.length - 1)) / list.length
  const base = y + TITLE_H + 2 + 70
  const max = Math.max(1, ...list.map(x => x.ms))
  list.forEach((day, i) => {
    if (!day.ms) return
    const h = Math.max(1.5, day.ms / max * 70)
    fill(doc, day.met ? PAGE.add : PAGE.mute)
    doc.rect(x0 + i * (cw + gap), base - h, cw, h, "F")
  })
  type(doc, 8)
  say(doc, dstr(list[0].date), x0, base + 10, PAGE.mute)
  say(doc, dstr(list[list.length - 1].date), x0 + w, base + 10, PAGE.mute, "right")
}

// Most lines first, lines before time: the dashboard's languages card does the same.
function langs(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "languages", "most lines first")
  const lines = (l: { added: number; deleted: number }) => l.added + l.deleted
  const rows = [...d.langs].sort((a, b) => lines(b) - lines(a) || b.ms - a.ms || a.name.localeCompare(b.name)).slice(0, s.rows)
  const max = Math.max(1, ...rows.map(lines))
  const cols: Col[] = [{ w: 110 }, { w: 0 }, { w: 56, right: true }, { w: 56, right: true }, { w: 50, right: true }]
  const first = table(doc, y, cols, ["language", "", "added", "removed", "time"],
    rows.map(l => [l.name, "", { t: `+${l.added}`, c: PAGE.add }, { t: `−${l.deleted}`, c: PAGE.del }, hours(l.ms)]),
    s.more ? `… and ${s.more} more` : "")
  const bar = place(cols)[1]
  rows.forEach((l, i) => {
    if (!lines(l)) return
    fill(doc, l.color)
    doc.rect(bar.x, first + i * ROW - 6, Math.max(1, lines(l) / max * bar.w), 6, "F")
  })
}

function projects(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "projects")
  table(doc, y, [{ w: 0 }, { w: 60, right: true }, { w: 50, right: true }], ["project", "time", "share"],
    d.projects.slice(0, s.rows).map(p => [p.name, hours(p.ms), `${pct(p.ms, d.totalMs)}%`]),
    s.more ? `… and ${s.more} more` : "")
}

function sessions(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "sessions")
  const all = d.sel === "all"
  const cols: Col[] = [{ w: 40 }, { w: 40 }, { w: 50, right: true }, { w: 0 }, ...(all ? [{ w: 110 }] : [])]
  table(doc, y, cols, ["start", "end", "active", "languages", ...(all ? ["project"] : [])],
    d.sessions.slice(0, s.rows).map(x => [clock(x.start), clock(x.end), fmt(x.activeMs), x.languages.join(", ") || "—", ...(all ? [x.project] : [])]),
    s.more ? `… and ${s.more} more sessions` : "",
    [["total", "", fmt(d.totalMs), ""]])
}

function days(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "days", "newest first, active days only")
  const rows = d.daysList.filter(x => x.ms > 0).reverse().slice(0, s.rows)
  table(doc, y, [{ w: 0 }, { w: 56, right: true }, { w: 56, right: true }, { w: 56, right: true }, { w: 50 }],
    ["day", "active", "added", "removed", "target"],
    rows.map(x => [dstr(x.date), fmt(x.ms), { t: `+${x.added}`, c: PAGE.add }, { t: `−${x.deleted}`, c: PAGE.del }, x.met ? "met" : "under"]),
    s.more ? `… and ${s.more} earlier active days` : "")
}

function files(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "files", "git diff --stat")
  const rows = d.files.slice(0, s.rows)
  const max = Math.max(1, ...rows.map(f => f.added + f.deleted))
  const pathW = 230
  const numX = PAGE_X + 12 + pathW + 8 + 36
  const graphX = numX + 8
  let base = y + TITLE_H + 2
  type(doc, 9)
  const cw = doc.getTextWidth("+")
  if (!rows.length) {
    base += ROW
    say(doc, "no files changed", PAGE_X + 12, base, PAGE.mute)
  }
  for (const f of rows) {
    base += ROW
    const name = fit(doc, f.name, pathW)
    const dir = fit(doc, f.dir, Math.max(0, pathW - doc.getTextWidth(name)))
    say(doc, dir, PAGE_X + 12, base, PAGE.mute)
    say(doc, name, PAGE_X + 12 + doc.getTextWidth(dir), base, PAGE.ink)
    say(doc, String(f.added + f.deleted), numX, base, PAGE.ink, "right")
    const [na, nr] = runs(f.added, f.deleted, max, 28)
    say(doc, "+".repeat(na), graphX, base, PAGE.add)
    say(doc, "-".repeat(nr), graphX + na * cw, base, PAGE.del)
  }
  base += ROW
  say(doc, `${d.files.length} files changed, ${d.added} insertions(+), ${d.deleted} deletions(-)`, PAGE_X + 12, base, PAGE.mute)
}

function heat(doc: Doc, d: ExportData, y: number, s: Section): void {
  const h = d.heat!
  box(doc, y, s, "activity", `${h.weeks} weeks`)
  const cell = 11
  const gap = 2
  const x0 = PAGE_X + (W - (h.weeks * (cell + gap) - gap)) / 2
  const y0 = y + TITLE_H + 1
  h.cells.forEach((c, i) => {
    if (!c) return
    const x = x0 + Math.floor(i / 7) * (cell + gap)
    const cy = y0 + (i % 7) * (cell + gap)
    if (!c.level && !c.today) {
      fill(doc, PAGE.mute)
      doc.rect(x + cell / 2 - 0.75, cy + cell / 2 - 0.75, 1.5, 1.5, "F")
      return
    }
    fill(doc, c.today ? PAGE.amber : mix(PAGE.add, PAGE.bg, SHADE[c.level]))
    doc.rect(x, cy, cell, cell, "F")
  })
}

const DRAW: Record<Section["kind"], (doc: Doc, d: ExportData, y: number, s: Section) => void> = {
  tiles, tape, columns, langs, projects, sessions, days, files, heat,
}

export function reportPdf(d: ExportData): ArrayBuffer {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true })
  doc.addFileToVFS("MartianMono-NrRg.ttf", MM_REGULAR)
  doc.addFont("MartianMono-NrRg.ttf", FONT, "normal")
  doc.addFileToVFS("MartianMono-NrBd.ttf", MM_BOLD)
  doc.addFont("MartianMono-NrBd.ttf", FONT, "bold")
  const pages = reportPages(d)
  pages.forEach((sections, i) => {
    if (i) doc.addPage()
    frame(doc, d, i + 1, pages.length)
    let y = CONTENT_TOP
    for (const s of sections) {
      DRAW[s.kind](doc, d, y, s)
      y += s.h + GAP
    }
  })
  return doc.output("arraybuffer")
}

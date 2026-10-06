// Where everything goes on the share card and the report, as plain numbers, so
// the "it fits" rules are tested without a canvas or a PDF. The renderers place
// every block at the position given here and nowhere else.
import type { Texture } from "./colors"
import type { ExportData } from "./exportModel"

// ── share card (logical px; drawn at CARD_SCALE) ────────────────────────────

export const CARD_W = 420
export const CARD_H = 620
export const CARD_SCALE = 3
export const CARD_X = 24
export const CARD_TOP = 22
export const CARD_BOTTOM = 18
export const CARD_GAP = 12

export type CardKind = "header" | "hero" | "tiles" | "tape" | "columns" | "languages" | "footer"
export interface CardBlock { kind: CardKind; y: number; h: number }

const CARD_HEIGHTS: Record<Exclude<CardKind, "hero">, number> = { header: 52, tiles: 132, tape: 72, columns: 106, languages: 56, footer: 16 }

export function cardLayout(d: ExportData): CardBlock[] {
  const kinds: CardKind[] = ["header", "hero", "tiles", d.single ? "tape" : "columns", "languages"]
  const out: CardBlock[] = []
  let y = CARD_TOP
  for (const kind of kinds) {
    const h = kind === "hero" ? (d.single ? 112 : 86) : CARD_HEIGHTS[kind as Exclude<CardKind, "hero">]
    out.push({ kind, y, h })
    y += h + CARD_GAP
  }
  // the footer sits on the bottom edge, whatever is above it
  out.push({ kind: "footer", y: CARD_H - CARD_BOTTOM - CARD_HEIGHTS.footer, h: CARD_HEIGHTS.footer })
  return out
}

// ── report (pt, A4) ──────────────────────────────────────────────────────────

export const PAGE_W = 595.28
export const PAGE_H = 841.89
export const FRAME_INSET = 20
export const FRAME_RADIUS = 6
export const PAGE_X = 38
export const PAGE_TOP = 34
export const PAGE_BOTTOM = 28
export const HEADER_H = 46
export const FOOTER_H = 26
export const GAP = 12
export const ROW = 13
export const TITLE_H = 16
export const CONTENT_TOP = PAGE_TOP + HEADER_H + GAP
export const CONTENT_H = PAGE_H - PAGE_BOTTOM - FOOTER_H - GAP - CONTENT_TOP

// Caps the spec leaves open, chosen so the busiest export still fits two pages.
export const CAPS = { langs: 8, projects: 6, sessions: 20, files: 10 }
export const dayRowCap = (days: number): number => (days >= 30 ? 14 : 18)

export type SectionKind = "tiles" | "tape" | "columns" | "langs" | "projects" | "sessions" | "days" | "files" | "heat"
export interface Section { kind: SectionKind; rows: number; more: number; h: number }

const FIXED = {
  tiles: TITLE_H + 2 * 36 + 6 + 8,
  tape: TITLE_H + 26 + 12 + 8,
  columns: TITLE_H + 70 + 12 + 8,
  heat: TITLE_H + 7 * 13 + 8,
}
// title, a header row, the rows (at least one, for "none"), "… and N more", footer rows
const tableH = (rows: number, more: number, footer = 0): number =>
  TITLE_H + ROW * (1 + Math.max(1, rows) + (more ? 1 : 0) + footer) + 8
const cap = (total: number, max: number): [number, number] => [Math.min(total, max), Math.max(0, total - max)]

export function reportPages(d: ExportData): Section[][] {
  const p1: Section[] = [{ kind: "tiles", rows: 8, more: 0, h: FIXED.tiles }]
  p1.push(d.single
    ? { kind: "tape", rows: d.tapes?.report.cells.length ?? 0, more: 0, h: FIXED.tape }
    : { kind: "columns", rows: d.daysList.length, more: 0, h: FIXED.columns })
  const [lr, lm] = cap(d.langs.length, CAPS.langs)
  p1.push({ kind: "langs", rows: lr, more: lm, h: tableH(lr, lm) })
  if (d.sel === "all") {
    const [pr, pm] = cap(d.projects.length, CAPS.projects)
    p1.push({ kind: "projects", rows: pr, more: pm, h: tableH(pr, pm) })
  }

  const p2: Section[] = []
  if (d.single) {
    const [sr, sm] = cap(d.sessions.length, CAPS.sessions)
    p2.push({ kind: "sessions", rows: sr, more: sm, h: tableH(sr, sm, 1) })
  } else {
    const [dr, dm] = cap(d.activeDays, dayRowCap(d.days))
    p2.push({ kind: "days", rows: dr, more: dm, h: tableH(dr, dm) })
  }
  // files have no header row; their git-style summary line takes its place
  const [fr, fm] = cap(d.files.length, CAPS.files)
  p2.push({ kind: "files", rows: fr, more: fm, h: tableH(fr, 0) })
  if (d.heat) p2.push({ kind: "heat", rows: d.heat.weeks, more: 0, h: FIXED.heat })
  return [p1, p2]
}

export const stackHeight = (s: Section[]): number => s.reduce((t, x) => t + x.h, 0) + GAP * Math.max(0, s.length - 1)

// The dialog lists the report's sections instead of previewing its pages.
const LABEL: Record<SectionKind, string> = {
  tiles: "summary", tape: "day tape", columns: "each day", langs: "languages", projects: "projects",
  sessions: "sessions", days: "days", files: "files", heat: "activity",
}

function detail(d: ExportData, s: Section): string {
  const count = s.more ? `${s.rows} of ${s.rows + s.more}` : String(s.rows)
  switch (s.kind) {
    case "tiles": return "8 tiles"
    case "tape": return `${d.tapes?.report.win.cellMin ?? 15}-minute cells`
    case "columns": return `target met on ${d.metDays} of ${d.days} days`
    case "days": return `${count} active, newest first`
    case "files": return `${count}, git diff --stat`
    case "heat": return `${s.rows} weeks`
    default: return count
  }
}

export function reportOutline(d: ExportData): { page: number; items: string[] }[] {
  return reportPages(d).map((secs, i) => ({ page: i + 1, items: secs.map(s => `${LABEL[s.kind]} · ${detail(d, s)}`) }))
}

// ── textures ────────────────────────────────────────────────────────────────

// A textured mark as solid polygons, so the card and the report fill exact
// colours over their background: no patterns, no transparency. The same
// proportions as the dashboard's CSS fills, in `unit`s (one CSS px there).
export type Poly = [number, number][]
export interface Rect { x: number; y: number; w: number; h: number }

// Sutherland–Hodgman against one half-plane: keeps the points where f >= 0.
function clipHalf(poly: Poly, f: (p: [number, number]) => number): Poly {
  const out: Poly = []
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]
    const fa = f(a), fb = f(b)
    if (fa >= 0) out.push(a)
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  })
  return out
}

const area = (p: Poly) => Math.abs(p.reduce((t, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return t + x * y2 - x2 * y }, 0)) / 2

export function texturePolys(r: Rect, texture: Texture, unit: number): Poly[] {
  if (r.w <= 0 || r.h <= 0) return []
  const box: Poly = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]
  if (texture === "solid") return [box]
  const out: Poly[] = []
  // a band where lo <= g(p) < hi, cut to the rectangle
  const band = (g: (p: [number, number]) => number, lo: number, hi: number) => {
    const p = clipHalf(clipHalf(box, q => g(q) - lo), q => hi - g(q))
    if (p.length >= 3 && area(p) > 1e-9) out.push(p)
  }
  if (texture === "stripes" || texture === "bars") {
    // 2 units of ink in every 3.5, measured across the stripe
    const period = 3.5 * unit, ink = 2 * unit
    const k = texture === "stripes" ? Math.SQRT1_2 : 1
    const g = texture === "stripes" ? (p: [number, number]) => (p[0] - p[1]) * k : (p: [number, number]) => p[0]
    const vals = box.map(g)
    for (let s = Math.floor(Math.min(...vals) / period) * period; s < Math.max(...vals); s += period) band(g, s, s + ink)
    return out
  }
  // checks: a 4-unit tile, ink in its top-right and bottom-left quarters
  const half = 2 * unit
  for (let x = r.x; x < r.x + r.w; x += half) {
    for (let y = r.y; y < r.y + r.h; y += half) {
      const col = Math.round((x - r.x) / half), row = Math.round((y - r.y) / half)
      if ((col + row) % 2 === 0) continue
      const w = Math.min(half, r.x + r.w - x), h = Math.min(half, r.y + r.h - y)
      out.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
    }
  }
  return out
}

// Colours and names for projects and languages. Pure: the CSS custom
// properties --c1…--c6 and --c-other hold the per-theme values.
//
// Six colours run out, so past them a mark keeps a palette colour and takes a
// texture: solid, then diagonal stripes, vertical bars, checks — 24 marks
// before anything repeats.
// A texture only shows on a filled box (keys, split bars, day bars); a coloured
// glyph (tape cells, week columns) can only carry `color`, so there the tooltip
// tells two marks of the same colour apart.
import type { YearPayload } from "../shared/types"
import type { LangRow } from "./model"

export const PALETTE_SIZE = 6
export type Texture = "solid" | "stripes" | "bars" | "checks"
// Ordered by how far each reads from solid at 8 px under the CRT scanlines;
// dots were tried and read as a solid mesh.
const TEXTURES: Texture[] = ["solid", "stripes", "bars", "checks"]
export const MARKS = PALETTE_SIZE * TEXTURES.length

// `color` for text and glyphs, `fill` for a `background`.
export interface Paint { color: string; fill: string; texture: Texture }

const OTHER_COLOR = "var(--c-other)"
export const OTHER: Paint = { color: OTHER_COLOR, fill: OTHER_COLOR, texture: "solid" }

// The gaps are transparent so the panel shows through, in every theme.
function fill(c: string, t: Texture): string {
  switch (t) {
    case "solid": return c
    case "stripes": return `repeating-linear-gradient(45deg, ${c} 0 2px, transparent 2px 3.5px)`
    case "bars": return `repeating-linear-gradient(90deg, ${c} 0 2px, transparent 2px 3.5px)`
    case "checks": return `repeating-conic-gradient(${c} 0 25%, transparent 0 50%) 0 0 / 4px 4px`
  }
}

// The i-th mark: which palette colour and which texture. Shared with the
// exports, which have their own literal colours.
export function markOf(i: number): { slot: number; texture: Texture } {
  const n = i % MARKS
  return { slot: n % PALETTE_SIZE, texture: TEXTURES[Math.floor(n / PALETTE_SIZE)] }
}

function slot(i: number): Paint {
  const { slot, texture } = markOf(i)
  const color = `var(--c${slot + 1})`
  return { color, fill: fill(color, texture), texture }
}

export const paintOf = (mark: number): Paint => (mark < 0 ? OTHER : slot(mark))

const COLOR_NAMES = ["green", "blue", "amber", "pink", "violet", "olive"]
// "blue", "blue stripes": what Settings calls a mark
export function markName(mark: number): string {
  const { slot, texture } = markOf(mark)
  return texture === "solid" ? COLOR_NAMES[slot] : `${COLOR_NAMES[slot]} ${texture}`
}

const picked = (picks: Record<string, number> | undefined, key: string): number | undefined => {
  const m = picks?.[key]
  return typeof m === "number" && Number.isInteger(m) && m >= 0 && m < MARKS ? m : undefined
}

// A picked mark, else registry order, which never reorders, so a project keeps
// its mark everywhere. -1 for a project the year doesn't list.
export function projectMark(year: YearPayload | null, id: string): number {
  const i = year ? year.projects.findIndex(p => p.id === id) : -1
  if (i < 0) return -1
  return picked(year?.colors?.projects, id) ?? i
}

export const projectPaint = (year: YearPayload | null, id: string): Paint => paintOf(projectMark(year, id))

// A picked mark, else the language's rank by use over the year, so a language
// is the same colour in every view and hovering never repaints anything.
// Languages the year doesn't list yet (one seen for the first time since the
// year was sent) rank after it, in the order given. Past 24, "other" (-1).
export function languageMarks(year: YearPayload | null, rows: { name: string }[]): Map<string, number> {
  const ranked = [...(year?.languages ?? [])]
  for (const r of rows) if (!ranked.includes(r.name)) ranked.push(r.name)
  const m = new Map<string, number>()
  ranked.forEach((name, i) => m.set(name, picked(year?.colors?.languages, name) ?? (i < MARKS ? i : -1)))
  return m
}

export function languagePaints(year: YearPayload | null, rows: LangRow[]): Map<string, Paint> {
  const m = new Map<string, Paint>()
  for (const [name, mark] of languageMarks(year, rows)) m.set(name, paintOf(mark))
  return m
}

export const langPaint = (m: Map<string, Paint>, name: string): Paint => m.get(name) ?? OTHER

export interface Names {
  project(id: string): string
  paint(id: string): Paint
  root(id: string): string | undefined
}

export function namesFor(year: YearPayload): Names {
  return {
    project: id => year.projects.find(p => p.id === id)?.name ?? "unknown project",
    paint: id => projectPaint(year, id),
    root: id => year.projects.find(p => p.id === id)?.path,
  }
}

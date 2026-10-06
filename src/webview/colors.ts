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

// By registry order, which never reorders, so a project keeps its mark everywhere.
export function projectPaint(year: YearPayload | null, id: string): Paint {
  const i = year ? year.projects.findIndex(p => p.id === id) : -1
  return i < 0 ? OTHER : slot(i)
}

// By rank in the unfocused view, so hovering never repaints anything. Past
// 24 languages the rest share the muted "other".
export function languagePaints(rows: LangRow[]): Map<string, Paint> {
  const m = new Map<string, Paint>()
  rows.slice(0, MARKS).forEach((r, i) => m.set(r.name, slot(i)))
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

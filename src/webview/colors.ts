// Colours and names for projects and languages. Pure: the CSS custom
// properties --c1…--c6 and --c-other hold the per-theme values.
import type { YearPayload } from "../shared/types"
import type { LangRow } from "./model"

export const PALETTE_SIZE = 6
export const OTHER = "var(--c-other)"
const slot = (i: number): string => `var(--c${(i % PALETTE_SIZE) + 1})`

// By registry order, which never reorders, so a project keeps its colour everywhere.
export function projectColor(year: YearPayload | null, id: string): string {
  const i = year ? year.projects.findIndex(p => p.id === id) : -1
  return i < 0 ? OTHER : slot(i)
}

// By rank in the unfocused view, so hovering never recolours anything. Past
// six languages the rest share the muted "other".
export function languageColors(rows: LangRow[]): Map<string, string> {
  const m = new Map<string, string>()
  rows.slice(0, PALETTE_SIZE).forEach((r, i) => m.set(r.name, slot(i)))
  return m
}

export const langColor = (m: Map<string, string>, name: string): string => m.get(name) ?? OTHER

export interface Names {
  project(id: string): string
  color(id: string): string
  root(id: string): string | undefined
}

export function namesFor(year: YearPayload): Names {
  return {
    project: id => year.projects.find(p => p.id === id)?.name ?? "unknown project",
    color: id => projectColor(year, id),
    root: id => year.projects.find(p => p.id === id)?.path,
  }
}

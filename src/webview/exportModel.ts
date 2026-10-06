// What an export shows, computed from the same payloads and model as the
// dashboard, so a share card or report never disagrees with the screen. Pure:
// the renderers and the dialog only draw what this returns.
import type { ActivitySession, RangePayload, YearPayload } from "../shared/types"
import { MARKS, Texture, markOf } from "./colors"
import { addDaysKey, clock, dstr, shortDate, splitPath } from "./format"
import { heatCells, heatLevel, tapeCellCount } from "./layout"
import { Mark, Selection, TapeCell, TapeWindow, buildView, dayKey, recentMarks, seriesFor, storedStreak, tapeCells, tapeWindow } from "./model"

export type Format = "card" | "report" | "csv" | "json"
export type Span = "today" | "7d" | "30d" | "90d"

export const SPAN_DAYS: Record<Span, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 }
export const ALL_SPANS: Span[] = ["today", "7d", "30d", "90d"]
// The card has no 90-day layout: 90 columns don't fit 420 px.
export const SPANS: Record<Format, Span[]> = {
  card: ["today", "7d", "30d"],
  report: ALL_SPANS,
  csv: ALL_SPANS,
  json: ALL_SPANS,
}

// Switching to a format that lacks the chosen span keeps the longest one it has that isn't longer.
export function fitSpan(format: Format, span: Span): Span {
  const ok = SPANS[format]
  if (ok.includes(span)) return span
  return [...ok].reverse().find(s => SPAN_DAYS[s] <= SPAN_DAYS[span]) ?? ok[0]
}

export function spanDates(span: Span, today: string): { from: string; to: string } {
  return { from: addDaysKey(today, -(SPAN_DAYS[span] - 1)), to: today }
}

// Exports are files people post and print: literal colours, always the dark
// phosphor look whatever the editor theme. Values from the exports mockup.
export const CARD = { bg: "#050b08", panel: "#08110d", rule: "#22392d", ink: "#cfeedd", dim: "#86a596", mute: "#56705f", amber: "#ffb703", add: "#39d98a", del: "#ff6b6b" }
export const PAGE = { bg: "#06090a", rule: "#22392d", frame: "#2c4436", ink: "#dcfbe6", dim: "#86a596", mute: "#5b7468", amber: "#ffb703", add: "#39d98a", del: "#ff6b6b" }
export const LANG_COLORS = ["#1fa866", "#2a8fd0", "#b87e00", "#d0508f", "#8a6fe0", "#9a9420"]
export const OTHER_COLOR = "#4f6459"
// How much of a mark's colour shows at each activity level. Solid colours mixed
// toward the background, never transparency, which JPEG and PDF both keep exactly.
export const SHADE = [0, 0.3, 0.55, 0.8, 1]

// The dashboard's marks with literal colours: past six a language takes a
// texture, past 24 it is "other".
function langMark(i: number): { color: string; texture: Texture } {
  if (i >= MARKS) return { color: OTHER_COLOR, texture: "solid" }
  const m = markOf(i)
  return { color: LANG_COLORS[m.slot], texture: m.texture }
}

export function mix(color: string, bg: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  const k = Math.max(0, Math.min(1, t))
  return "#" + [0, 1, 2].map(i => Math.round(ch(bg, i) + (ch(color, i) - ch(bg, i)) * k).toString(16).padStart(2, "0")).join("")
}

export interface ExportDay { date: string; ms: number; met: boolean; today: boolean; added: number; deleted: number }
export interface ExportLang { name: string; ms: number; added: number; deleted: number; color: string; texture: Texture }
export interface ExportSession { start: number; end: number; activeMs: number; languages: string[]; project: string }
export interface ExportFile { dir: string; name: string; added: number; deleted: number }
export type { Mark }
export interface Tape { win: TapeWindow; cells: TapeCell[] }
export interface HeatCell { date: string; level: 0 | 1 | 2 | 3 | 4; today: boolean }

export interface ExportData {
  title: string                 // the project's name, or "all projects"
  sel: Selection
  from: string
  to: string
  today: string
  days: number                  // the span's length
  single: boolean               // one day (today)
  generatedAt: number
  totalMs: number
  activeDays: number
  perActiveMs: number
  best: ExportDay | null
  added: number
  deleted: number
  targetMs: number              // today's target for the selection
  metDays: number
  streak: number                // storage's
  marks: Mark[]                 // the last 14 days, today last
  firstStart: number | null     // single day: first session start
  lastEnd: number | null        // single day: last session end (an open one: now)
  langs: ExportLang[]           // most time first; colours by that rank, like the dashboard
  daysList: ExportDay[]         // from..to, oldest first
  sessions: ExportSession[]     // single day only, by start
  tapes: { card: Tape; report: Tape } | null   // single day only
  files: ExportFile[]           // biggest change first
  projects: { name: string; ms: number }[]     // all projects only, active ones, most time first
  heat: { weeks: number; cells: (HeatCell | null)[] } | null   // 30d: 5 weeks, 90d: 13
}

// The dashboard's own tape rules: the finest whole-minute cell that fits.
export function dayTape(sessions: ActivitySession[], maxCells: number, now: number): Tape {
  const first = tapeWindow(sessions, 1, now)
  const win = tapeWindow(sessions, tapeCellCount(first.endMin - first.startMin, maxCells), now)
  return { win, cells: tapeCells(sessions, win, now) }
}

export function exportData(range: RangePayload, year: YearPayload, sel: Selection, span: Span, now: number): ExportData {
  const { from, to } = spanDates(span, year.today)
  // the dialog fetches 90 days once; every span is a slice of that reply
  const logs = Object.fromEntries(Object.entries(range.logs).map(([id, list]) => [id, list.filter(l => l.date >= from && l.date <= to)]))
  const view = buildView({ from, to, logs }, sel, null)
  const series = seriesFor(year, sel)
  const n = series.days.length
  const at = new Map(series.days.map((d, i) => [d, i] as [string, number]))
  const liveTarget = n ? series.targetMs[n - 1] : year.globalTargetMs
  const targetOn = (date: string) => {
    const i = at.get(date)
    return i === undefined ? liveTarget : series.targetMs[i]
  }
  const daysList: ExportDay[] = view.days.map(d => ({
    date: d.date,
    ms: d.whole.activeMs,
    met: d.whole.activeMs >= targetOn(d.date),
    today: d.date === year.today,
    added: d.whole.linesAdded,
    deleted: d.whole.linesDeleted,
  }))
  const active = daysList.filter(d => d.ms > 0)
  const best = active.reduce<ExportDay | null>((b, d) => (b && b.ms >= d.ms ? b : d), null)
  const project = (id: string | undefined) => year.projects.find(p => p.id === id)
  const name = (id: string | undefined) => project(id)?.name ?? "unknown project"

  const single = span === "today"
  const last = view.days[view.days.length - 1]
  const raw = single && last ? last.whole.sessions : []
  const sessions: ExportSession[] = raw.map(s => ({
    start: s.startTime,
    end: s.endTime ?? Math.max(s.startTime, now),
    activeMs: s.activeTime,
    languages: Object.entries(s.languages ?? {}).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]).map(([l]) => l),
    project: name(s.projectId),
  }))

  const marks = recentMarks(series, 14)
  const heatWeeks = span === "90d" ? 13 : span === "30d" ? 5 : 0

  return {
    title: sel === "all" ? "all projects" : name(sel),
    sel, from, to,
    today: year.today,
    days: SPAN_DAYS[span],
    single,
    generatedAt: now,
    totalMs: view.totalMs,
    activeDays: active.length,
    perActiveMs: active.length ? view.totalMs / active.length : 0,
    best,
    added: view.linesAdded,
    deleted: view.linesDeleted,
    targetMs: liveTarget,
    metDays: daysList.filter(d => d.met).length,
    streak: storedStreak(year, sel),
    marks,
    firstStart: sessions.length ? Math.min(...sessions.map(s => s.start)) : null,
    lastEnd: sessions.length ? Math.max(...sessions.map(s => s.end)) : null,
    langs: view.languages.map((l, i) => ({ ...l, ...langMark(i) })),
    daysList,
    sessions,
    tapes: single ? { card: dayTape(raw, 24, now), report: dayTape(raw, 48, now) } : null,
    files: view.files.map(f => {
      const p = splitPath(f.path, project(f.projectId)?.path)
      return { dir: (sel === "all" ? name(f.projectId) + "/" : "") + p.dir, name: p.name, added: f.added, deleted: f.deleted }
    }),
    projects: sel === "all"
      ? Object.entries(logs)
        .map(([id, list]) => ({ name: name(id), ms: list.reduce((t, l) => t + l.activeTime, 0) }))
        .filter(p => p.ms > 0)
        .sort((a, b) => b.ms - a.ms)
      : [],
    heat: heatWeeks
      ? {
        weeks: heatWeeks,
        cells: heatCells(n, heatWeeks).map(i => (i === null ? null : { date: series.days[i], level: heatLevel(series.active[i]), today: series.days[i] === year.today })),
      }
      : null,
  }
}

export function generatedText(now: number): string {
  const k = dayKey(new Date(now))
  return `generated ${shortDate(k)} ${k.slice(0, 4)} ${clock(now)}`
}

export const rangeText = (d: ExportData): string => (d.single ? dstr(d.to) : `${dstr(d.from)} – ${dstr(d.to)}`)

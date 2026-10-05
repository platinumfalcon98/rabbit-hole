// The sidebar's numbers, from the year payload and today's log per project
// that the host sends every 10 s. Pure, like model.ts: mini.ts only draws.
import type { ActivitySession, DailyLog, YearPayload } from "../shared/types"
import { HOUR, weekday } from "./format"
import { meter } from "./layout"
import { Mark, daySlice, recentMarks, seriesFor, storedStreak, targetMetAt } from "./model"

export const EIGHTHS = " ▁▂▃▄▅▆▇█"
const ROWS = 4

export interface MiniDay { date: string; label: string; ms: number; total: number; today: boolean; rows: string[] }
export interface MiniProject { id: string; name: string; ms: number; share: number }
export interface MiniView {
  focus: string | null               // the focused project, if it still exists
  who: string                        // "all projects" or "<name> only"
  streak: number                     // storage's global streak; a focus doesn't narrow it
  marks: Mark[]                      // the last 14 days, today last
  todayMet: boolean
  todayMs: number                    // narrowed to the focus
  targetMs: number                   // the focus's own target, else the global one
  meter: [number, number]
  metAt: number | null
  remainingMs: number
  sessions: ActivitySession[]        // narrowed to the focus
  baseSessions: ActivitySession[]    // every project's: they set the tape's window
  added: number
  deleted: number
  week: MiniDay[]                    // the last 7 days, today last
  weekMax: number                    // whole hours, from the unfocused week, so a focus shows a share
  projects: MiniProject[]            // today's, most time first
  keys: { id: string; name: string }[]   // projects active this week, registry order
}

// Four rows of eighth blocks, top first: 32 steps from nothing to max. Any
// activity shows at least one step.
export function eighthRows(ms: number, max: number): string[] {
  let steps = Math.round(ms / Math.max(1, max) * ROWS * 8)
  if (ms > 0 && steps === 0) steps = 1
  return Array.from({ length: ROWS }, (_, i) => EIGHTHS[Math.max(0, Math.min(8, steps - (ROWS - 1 - i) * 8))])
}

export function miniView(year: YearPayload, logs: Record<string, DailyLog>, focus: string | null, now: number): MiniView {
  const today = year.today
  const range = { from: today, to: today, logs: Object.fromEntries(Object.entries(logs).map(([id, l]) => [id, [l]])) }
  // a project cleared since the pointer landed on it no longer narrows anything
  const known = focus !== null && year.projects.some(p => p.id === focus) ? focus : null
  const whole = daySlice(range, today, "all", null)
  const shown = known ? daySlice(range, today, "all", { kind: "project", id: known }) : whole
  const all = seriesFor(year, "all")
  const series = known ? seriesFor(year, known) : all
  const n = series.days.length
  const targetMs = n ? series.targetMs[n - 1] : year.globalTargetMs
  const name = (id: string) => year.projects.find(p => p.id === id)?.name ?? "unknown project"

  const first = Math.max(0, n - 7)
  const totals = all.active.slice(first)
  const weekMax = Math.max(1, Math.ceil(Math.max(0, ...totals) / HOUR)) * HOUR
  const week: MiniDay[] = series.days.slice(first).map((date, i) => {
    const ms = series.active[first + i]
    return { date, label: weekday(date).slice(0, 1), ms, total: totals[i], today: date === today, rows: eighthRows(ms, weekMax) }
  })

  const active = Object.entries(logs).filter(([, l]) => l.activeTime > 0)
  const total = active.reduce((t, [, l]) => t + l.activeTime, 0)
  const projects = active
    .map(([id, l]) => ({ id, name: name(id), ms: l.activeTime, share: total ? l.activeTime / total : 0 }))
    .sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name))

  return {
    focus: known,
    who: known ? `${name(known)} only` : "all projects",
    streak: storedStreak(year, "all"),
    marks: recentMarks(all, 14),
    todayMet: n > 0 && all.active[n - 1] >= all.targetMs[n - 1],
    todayMs: shown.activeMs,
    targetMs,
    meter: meter(shown.activeMs, targetMs),
    metAt: targetMetAt(shown.sessions, targetMs, now),
    remainingMs: Math.max(0, targetMs - shown.activeMs),
    sessions: shown.sessions,
    baseSessions: whole.sessions,
    added: shown.linesAdded,
    deleted: shown.linesDeleted,
    week,
    weekMax,
    projects,
    keys: year.projects.filter(p => p.active.slice(first).some(v => v > 0)).map(p => ({ id: p.id, name: p.name })),
  }
}

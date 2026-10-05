// Range presets and the two-month picker's rules. Pure.
import { addDaysKey, dayDiff, plural, shortDate } from "./format"
import { dayKey } from "./model"

export const MAX_SPAN = 92   // the host's limit (payloads.MAX_RANGE_DAYS)

export type RangeId = "today" | "yday" | "7d" | "30d"
export const PRESETS: Record<RangeId, [number, number]> = { today: [0, 0], yday: [-1, -1], "7d": [-6, 0], "30d": [-29, 0] }

export function presetRange(id: RangeId, today: string): { from: string; to: string } {
  const [a, z] = PRESETS[id]
  return { from: addDaysKey(today, a), to: addDaysKey(today, z) }
}

export function presetOf(from: string, to: string, today: string): RangeId | null {
  for (const id of Object.keys(PRESETS) as RangeId[]) {
    const r = presetRange(id, today)
    if (r.from === from && r.to === to) return id
  }
  return null
}

export interface Pick { start: string | null; end: string | null }

// Click a start day, then an end day. A click before the start becomes the
// start, keeping the old start as the end while the span still fits.
export function pickDay(p: Pick, day: string): Pick {
  if (!p.start || p.end) return { start: day, end: null }
  if (day < p.start) return { start: day, end: dayDiff(day, p.start) < MAX_SPAN ? p.start : null }
  if (dayDiff(p.start, day) >= MAX_SPAN) return p
  return { start: p.start, end: day }
}

export function dayDisabled(p: Pick, day: string, first: string, today: string): boolean {
  if (day < first || day > today) return true
  return !!p.start && !p.end && day >= p.start && dayDiff(p.start, day) >= MAX_SPAN
}

// One month, Monday first, with nulls for the blanks before the 1st.
export function monthDays(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1)
  const out: (string | null)[] = new Array<string | null>((first.getDay() + 6) % 7).fill(null)
  for (const d = new Date(first); d.getMonth() === month; d.setDate(d.getDate() + 1)) out.push(dayKey(d))
  return out
}

export function pickLabel(p: Pick): string {
  if (!p.start) return "no range"
  if (!p.end) return `${shortDate(p.start)} – …`
  return `${shortDate(p.start)} – ${shortDate(p.end)} · ${plural(dayDiff(p.start, p.end) + 1, "day")}`
}

// The calendar button's text once a range that isn't a preset is showing.
export const rangeLabel = (from: string, to: string): string =>
  (from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`).toLowerCase()

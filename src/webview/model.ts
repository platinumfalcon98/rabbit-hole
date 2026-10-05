// Pure view model for the TTY dashboard and sidebar. Every number a panel shows
// is computed here from the host's year/range/live payloads, so it is tested
// without a DOM. No vscode import and no DOM access, ever.
import type { ActivitySession, DailyLog, LivePayload, RangePayload, YearPayload } from "../shared/types"

export type Selection = "all" | string
export type Focus = null | { kind: "project"; id: string } | { kind: "language"; id: string }

export interface LangRow { name: string; ms: number; added: number; deleted: number }
export interface FileRow { projectId: string; path: string; language: string; added: number; deleted: number }
export interface DaySlice {
  date: string
  activeMs: number
  linesAdded: number
  linesDeleted: number
  sessions: ActivitySession[]   // projectId filled in; under a language focus, activeTime is that language's share
  files: FileRow[]
  languages: LangRow[]          // ms descending
}
export interface DayView { date: string; whole: DaySlice; shown: DaySlice }
export interface View {
  from: string
  to: string
  days: DayView[]
  totalMs: number               // shown (narrowed to the focus)
  wholeMs: number               // without the focus
  linesAdded: number
  linesDeleted: number
  languages: LangRow[]          // shown
  wholeLanguages: LangRow[]     // without the focus — the languages panel keeps these rows under a focus
  files: FileRow[]              // shown, merged across days per project + path, biggest change first
}
export interface LineRow { from: string; to: string; added: number; deleted: number }

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
// Longer than any range the panels show (92 days, or the 371-day year), so it
// only ever cuts off a runaway request.
const MAX_DATES = 400

// Local-date stepping (never 24h arithmetic) so DST days are not skipped or
// doubled. Malformed dates give nothing rather than a loop that never ends.
export function datesBetween(from: string, to: string): string[] {
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return []
  const [y, m, d] = from.split("-").map(Number)
  const out: string[] = []
  for (const dt = new Date(y, m - 1, d); dayKey(dt) <= to && out.length < MAX_DATES; dt.setDate(dt.getDate() + 1)) {
    out.push(dayKey(dt))
  }
  return out
}

const byMsDesc = (a: LangRow, b: LangRow) => b.ms - a.ms || a.name.localeCompare(b.name)

function addLang(map: Map<string, LangRow>, name: string, ms: number, added: number, deleted: number): void {
  const row = map.get(name) ?? { name, ms: 0, added: 0, deleted: 0 }
  row.ms += ms
  row.added += added
  row.deleted += deleted
  map.set(name, row)
}

function logOn(range: RangePayload, projectId: string, date: string): DailyLog | undefined {
  return range.logs[projectId]?.find(l => l.date === date)
}

// One day for the selected projects, narrowed to a focus (null = everything).
export function daySlice(range: RangePayload, date: string, sel: Selection, focus: Focus): DaySlice {
  const only = focus?.kind === "project" ? focus.id : null
  const lang = focus?.kind === "language" ? focus.id : null
  const pids = Object.keys(range.logs).filter(id => (sel === "all" || id === sel) && (!only || id === only))

  const langs = new Map<string, LangRow>()
  const sessions: ActivitySession[] = []
  const files: FileRow[] = []
  let activeMs = 0

  for (const pid of pids) {
    const log = logOn(range, pid, date)
    if (!log) continue
    for (const [name, st] of Object.entries(log.languages)) {
      if (lang && name !== lang) continue
      addLang(langs, name, st.time, st.linesAdded, st.linesDeleted)
    }
    for (const f of log.files) {
      if (lang && f.language !== lang) continue
      files.push({ projectId: pid, path: f.path, language: f.language, added: f.linesAdded, deleted: f.linesDeleted })
    }
    for (const s of log.sessions) {
      if (!lang) {
        sessions.push({ ...s, projectId: pid })
        continue
      }
      // Sessions recorded before per-session languages can't be split, so they
      // leave a language focus rather than being credited to a guess.
      const ms = s.languages?.[lang]
      if (ms) sessions.push({ ...s, projectId: pid, activeTime: ms, languages: { [lang]: ms } })
    }
    if (!lang) activeMs += log.activeTime
  }
  if (lang) activeMs = langs.get(lang)?.ms ?? 0

  sessions.sort((a, b) => a.startTime - b.startTime)
  return {
    date,
    activeMs,
    linesAdded: files.reduce((n, f) => n + f.added, 0),
    linesDeleted: files.reduce((n, f) => n + f.deleted, 0),
    sessions,
    files,
    languages: [...langs.values()].sort(byMsDesc),
  }
}

export function buildView(range: RangePayload, sel: Selection, focus: Focus): View {
  const days: DayView[] = datesBetween(range.from, range.to).map(date => {
    const whole = daySlice(range, date, sel, null)
    return { date, whole, shown: focus ? daySlice(range, date, sel, focus) : whole }
  })
  const shownLangs = new Map<string, LangRow>()
  const wholeLangs = new Map<string, LangRow>()
  const files = new Map<string, FileRow>()
  for (const d of days) {
    for (const l of d.shown.languages) addLang(shownLangs, l.name, l.ms, l.added, l.deleted)
    for (const l of d.whole.languages) addLang(wholeLangs, l.name, l.ms, l.added, l.deleted)
    for (const f of d.shown.files) {
      // the same path in two projects is two different files
      const key = JSON.stringify([f.projectId, f.path])
      const row = files.get(key) ?? { ...f, added: 0, deleted: 0 }
      row.added += f.added
      row.deleted += f.deleted
      files.set(key, row)
    }
  }
  return {
    from: range.from,
    to: range.to,
    days,
    totalMs: days.reduce((n, d) => n + d.shown.activeMs, 0),
    wholeMs: days.reduce((n, d) => n + d.whole.activeMs, 0),
    linesAdded: days.reduce((n, d) => n + d.shown.linesAdded, 0),
    linesDeleted: days.reduce((n, d) => n + d.shown.linesDeleted, 0),
    languages: [...shownLangs.values()].sort(byMsDesc),
    wholeLanguages: [...wholeLangs.values()].sort(byMsDesc),
    files: [...files.values()].sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted) || a.path.localeCompare(b.path)),
  }
}

// Lines per day up to 14 days; beyond that, 7-day rows counted back from the
// last day, so the newest row is always a whole week.
export function lineRows(days: DayView[]): LineRow[] {
  const row = (chunk: DayView[]): LineRow => ({
    from: chunk[0].date,
    to: chunk[chunk.length - 1].date,
    added: chunk.reduce((n, d) => n + d.shown.linesAdded, 0),
    deleted: chunk.reduce((n, d) => n + d.shown.linesDeleted, 0),
  })
  if (days.length <= 14) return days.map(d => row([d]))
  const rows: LineRow[] = []
  for (let end = days.length; end > 0; end -= 7) rows.unshift(row(days.slice(Math.max(0, end - 7), end)))
  return rows
}

// ── Year series and streaks ─────────────────────────────────────────────────

export interface Series { days: string[]; active: number[]; targetMs: number[] }

// Daily active ms and the target each day is judged against: its stamped target,
// or the current one for days recorded before stamping. Today is always judged
// against the live target, since it is still being earned.
export function seriesFor(year: YearPayload, sel: Selection): Series {
  const n = year.days.length
  if (sel === "all") {
    const targetMs = year.global.targetMs.map(t => t ?? year.globalTargetMs)
    if (n) targetMs[n - 1] = year.globalTargetMs
    return { days: year.days, active: year.global.active, targetMs }
  }
  const p = year.projects.find(q => q.id === sel)
  // settings.json takes any number; the host clamps a project target the same way
  const own = p?.dailyTargetMinutes
  const current = own !== undefined ? Math.min(1440, Math.max(1, Math.round(own))) * 60_000 : year.globalTargetMs
  if (!p) return { days: year.days, active: year.days.map(() => 0), targetMs: year.days.map(() => current) }
  const targetMs = p.targetMs.map(t => t ?? current)
  if (n) targetMs[n - 1] = current
  return { days: year.days, active: p.active, targetMs }
}

// The current streak is storage's (it self-heals and isn't limited to a year).
export function storedStreak(year: YearPayload, sel: Selection): number {
  return sel === "all" ? year.global.streak : year.projects.find(p => p.id === sel)?.streak ?? 0
}

export interface StreakInfo {
  current: number
  todayMet: boolean
  atRisk: boolean
  todayRemainingMs: number
  longest: number
  longestEnd: string | null
}

export function streakInfo(s: Series, current: number): StreakInfo {
  const n = s.active.length
  const met = (i: number) => s.active[i] >= s.targetMs[i]
  const todayMet = n > 0 && met(n - 1)
  let run = 0
  let longest = 0
  let longestEnd: string | null = null
  for (let i = 0; i < n; i++) {
    run = met(i) ? run + 1 : 0
    if (run > longest) { longest = run; longestEnd = s.days[i] }
  }
  return {
    current,
    todayMet,
    atRisk: !todayMet && current > 0,
    todayRemainingMs: n ? Math.max(0, s.targetMs[n - 1] - s.active[n - 1]) : 0,
    longest,
    longestEnd,
  }
}

export type Mark = "met" | "miss" | "today"

// The last n days against each day's own target. Today is still being earned,
// so it gets its own mark; callers show whether it is met yet.
export function recentMarks(s: Series, n: number): Mark[] {
  const len = s.days.length
  const out: Mark[] = []
  for (let i = Math.max(0, len - n); i < len; i++) out.push(i === len - 1 ? "today" : s.active[i] >= s.targetMs[i] ? "met" : "miss")
  return out
}

export interface YearStats {
  activeDays: number
  totalMs: number
  best: { date: string; ms: number } | null
  longest: number
  longestEnd: string | null
}

// Over the last 365 days of the series (the grid itself reaches back to a Monday).
export function yearStats(s: Series): YearStats {
  const from = Math.max(0, s.days.length - 365)
  const tail: Series = { days: s.days.slice(from), active: s.active.slice(from), targetMs: s.targetMs.slice(from) }
  let activeDays = 0
  let totalMs = 0
  let best: YearStats["best"] = null
  for (let i = 0; i < tail.active.length; i++) {
    const ms = tail.active[i]
    if (ms > 0) activeDays++
    totalMs += ms
    if (ms > 0 && (best === null || ms > best.ms)) best = { date: tail.days[i], ms }
  }
  const { longest, longestEnd } = streakInfo(tail, 0)
  return { activeDays, totalMs, best, longest, longestEnd }
}

// ── Day tape ────────────────────────────────────────────────────────────────

export interface TapeWindow { startMin: number; endMin: number; cells: number; cellMin: number }
export interface TapeCell { startMin: number; ms: number; level: 0 | 1 | 2 | 3 | 4; language: string | null; projectId: string | null }

// Wall-clock spans (unix ms) the session was actually accruing. Sessions record
// these; older ones fall back to start → end (an open one to now), which also
// covers any idle time inside them — unavoidable without the recording.
function segmentsOf(s: ActivitySession, now: number): [number, number][] {
  if (s.intervals?.length) return s.intervals.filter(([a, b]) => b > a)
  const end = s.endTime ?? Math.max(s.startTime, now)
  return end > s.startTime ? [[s.startTime, end]] : []
}

// Minutes since local midnight of the day the session started (sessions are split at midnight).
function minuteOf(s: ActivitySession, t: number): number {
  const day = new Date(s.startTime)
  day.setHours(0, 0, 0, 0)
  return Math.min(24 * 60, (t - day.getTime()) / 60_000)
}

// 07:00–19:00, widened to whole hours that cover every session shown, so night
// work is never cut off. Split into `cells` equal cells (48 wide, 24 narrow).
export function tapeWindow(sessions: ActivitySession[], cells: number, now: number): TapeWindow {
  let start = 7 * 60
  let end = 19 * 60
  for (const s of sessions) {
    for (const [a, b] of segmentsOf(s, now)) {
      start = Math.min(start, Math.floor(minuteOf(s, a) / 60) * 60)
      end = Math.max(end, Math.ceil(minuteOf(s, b) / 60) * 60)
    }
  }
  return { startMin: start, endMin: end, cells, cellMin: (end - start) / cells }
}

function sumCells(sessions: ActivitySession[], win: TapeWindow, now: number) {
  const ms = new Array<number>(win.cells).fill(0)
  const byLang = Array.from({ length: win.cells }, () => new Map<string, number>())
  const byProj = Array.from({ length: win.cells }, () => new Map<string, number>())
  for (const s of sessions) {
    const segs = segmentsOf(s, now)
    const spanMin = segs.reduce((n, [a, b]) => n + (b - a), 0) / 60_000
    if (spanMin <= 0 || s.activeTime <= 0) continue
    const perMin = s.activeTime / spanMin
    const langTotal = Object.values(s.languages ?? {}).reduce((n, v) => n + v, 0)
    for (const [sa, sb] of segs) {
      const a = minuteOf(s, sa)
      const b = minuteOf(s, sb)
      for (let i = 0; i < win.cells; i++) {
        const c0 = win.startMin + i * win.cellMin
        const overlap = Math.max(0, Math.min(b, c0 + win.cellMin) - Math.max(a, c0))
        if (!overlap) continue
        const v = overlap * perMin
        ms[i] += v
        if (s.projectId) byProj[i].set(s.projectId, (byProj[i].get(s.projectId) ?? 0) + v)
        if (langTotal > 0) {
          for (const [l, lm] of Object.entries(s.languages!)) byLang[i].set(l, (byLang[i].get(l) ?? 0) + v * lm / langTotal)
        }
      }
    }
  }
  return { ms, byLang, byProj }
}

const top = (m: Map<string, number>): string | null => {
  let best: string | null = null
  let bestV = 0
  for (const [k, v] of m) if (v > bestV) { best = k; bestV = v }
  return best
}

// Active time per cell. A single day is measured against the cell's length; an
// averaged range (perDays > 1) against the busiest cell of `base` (the unfocused
// sessions), so a focused tape reads as a share of the whole.
export function tapeCells(
  sessions: ActivitySession[],
  win: TapeWindow,
  now: number,
  opts: { perDays?: number; base?: ActivitySession[] } = {}
): TapeCell[] {
  const per = Math.max(1, opts.perDays ?? 1)
  const { ms, byLang, byProj } = sumCells(sessions, win, now)
  let peak = win.cellMin * 60_000
  if (per > 1) {
    const base = opts.base ? sumCells(opts.base, win, now).ms : ms
    peak = Math.max(1, ...base.map(v => v / per))
  }
  return ms.map((v, i) => {
    const f = v / per / peak
    const level: TapeCell["level"] = f >= 0.75 ? 4 : f >= 0.5 ? 3 : f >= 0.25 ? 2 : f > 0 ? 1 : 0
    return { startMin: win.startMin + i * win.cellMin, ms: v / per, level, language: top(byLang[i]), projectId: top(byProj[i]) }
  })
}

// When the day's cumulative active time reached the target, interpolated along
// the active intervals of the session that crossed it. Null if it never did.
export function targetMetAt(sessions: ActivitySession[], targetMs: number, now: number): number | null {
  let cum = 0
  for (const s of [...sessions].sort((a, b) => a.startTime - b.startTime)) {
    if (s.activeTime <= 0) continue
    if (cum + s.activeTime >= targetMs) {
      const segs = segmentsOf(s, now)
      const span = segs.reduce((n, [a, b]) => n + (b - a), 0)
      let need = (targetMs - cum) / s.activeTime * span
      for (const [a, b] of segs) {
        if (need <= b - a) return Math.round(a + need)
        need -= b - a
      }
      return segs.length ? segs[segs.length - 1][1] : s.startTime
    }
    cum += s.activeTime
  }
  return null
}

// Fold a 10-second live update into the cached payloads. It replaces today's
// values and never adds to them, so leaving the dashboard open can't inflate today.
// Returns false when the update names a project the year doesn't list yet (the
// first edit in a new folder), so the caller can ask for a fresh year.
export function mergeLive(year: YearPayload, range: RangePayload | null, live: LivePayload): boolean {
  // Streaks move when today's target is met, which can happen while the dashboard is open.
  year.global.streak = live.globalStreak
  for (const p of year.projects) {
    if (live.streaks[p.id] !== undefined) p.streak = live.streaks[p.id]
  }
  const i = year.days.indexOf(live.today)
  if (i >= 0) {
    for (const p of year.projects) {
      if (live.todayActive[p.id] !== undefined) p.active[i] = live.todayActive[p.id]
    }
    year.global.active[i] = live.globalToday
  }
  // no project open (an empty window) means no log to file under one
  if (range && live.projectId && live.today >= range.from && live.today <= range.to) {
    const logs: DailyLog[] = range.logs[live.projectId] ?? (range.logs[live.projectId] = [])
    const j = logs.findIndex(l => l.date === live.today)
    if (j >= 0) logs[j] = live.log
    else logs.push(live.log)
  }
  return !live.projectId || year.projects.some(p => p.id === live.projectId)
}

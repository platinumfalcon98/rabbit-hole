// Pure view model for the TTY dashboard and sidebar. Every number a panel shows
// is computed here from the host's year/range/live payloads, so it is tested
// without a DOM. No vscode import and no DOM access, ever.
import type { ActivitySession, DailyLog, RangePayload } from "../shared/types"

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

// Local-date stepping (never 24h arithmetic) so DST days are not skipped or doubled.
export function datesBetween(from: string, to: string): string[] {
  const [y, m, d] = from.split("-").map(Number)
  const out: string[] = []
  for (const dt = new Date(y, m - 1, d); dayKey(dt) <= to; dt.setDate(dt.getDate() + 1)) out.push(dayKey(dt))
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

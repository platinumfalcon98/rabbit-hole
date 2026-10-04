// Message payloads for the TTY webviews. Pure reads over StorageService — no
// vscode APIs — so they are unit-tested directly.
import type { DailyLog, LivePayload, ProjectYear, RangePayload, YearPayload } from "../shared/types"
import { StorageService, dateKey } from "../tracker/storageService"

// The calendar picker's limit. A range request is a full per-project read, so
// the host enforces it rather than trusting the webview.
export const MAX_RANGE_DAYS = 92
const YEAR_DAYS_BACK = 364
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function parseDay(s: string): Date | null {
  if (!DAY_RE.test(s)) return null
  const [y, m, d] = s.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  // new Date rolls 2026-02-30 over to March; refuse it rather than reading the wrong days
  return dateKey(date) === s ? date : null
}

// First day of the year grid: the Monday on or before today − 364, so the
// heatmap's columns are whole weeks.
export function yearStart(today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - YEAR_DAYS_BACK)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

export function buildYear(storage: StorageService, now: Date, globalTargetMs: number): YearPayload {
  const today = dateKey(now)
  const start = dateKey(yearStart(now))
  const global = storage.getGlobalDays(start, today)
  const projects: ProjectYear[] = storage.getProjects().map(p => {
    const logs = storage.getRangeByDates(start, today, p.id)
    let lastActive: number | undefined
    for (const l of logs) {
      for (const s of l.sessions) {
        const t = s.endTime ?? s.startTime
        if (lastActive === undefined || t > lastActive) lastActive = t
      }
    }
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      dailyTargetMinutes: p.dailyTargetMinutes,
      streak: p.streak ?? 0,
      lastActive,
      active: logs.map(l => l.activeTime),
      targetMs: logs.map(l => l.targetMs ?? null),
    }
  })
  return {
    today,
    days: global.map(g => g.date),
    globalTargetMs,
    global: {
      streak: storage.getGlobalToday().streak,
      active: global.map(g => g.activeTime),
      targetMs: global.map(g => g.targetMs ?? null),
    },
    projects,
  }
}

// Real local dates, in order, at most MAX_RANGE_DAYS apart. Every range a
// webview asks for (a view or an export) goes through this.
export function isValidRange(from: string, to: string): boolean {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b || b < a) return false
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1 <= MAX_RANGE_DAYS
}

export function buildRange(storage: StorageService, from: string, to: string): RangePayload | null {
  if (!isValidRange(from, to)) return null
  const logs: Record<string, DailyLog[]> = {}
  for (const p of storage.getProjects()) logs[p.id] = storage.getRangeByDates(from, to, p.id)
  return { from, to, logs }
}

export function buildLive(storage: StorageService, now: Date): LivePayload {
  const today = dateKey(now)
  const todayActive: Record<string, number> = {}
  const streaks: Record<string, number> = {}
  for (const p of storage.getProjects()) {
    todayActive[p.id] = storage.getRangeByDates(today, today, p.id)[0].activeTime
    streaks[p.id] = p.streak ?? 0
  }
  const global = storage.getGlobalToday()
  return {
    today,
    projectId: storage.getCurrentProjectId(),
    log: storage.getToday(),
    todayActive,
    globalToday: global.activeTime,
    globalStreak: global.streak,
    streaks,
  }
}

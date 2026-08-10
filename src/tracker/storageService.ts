import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import {
  ActivitySession,
  AgentEvent,
  AgentName,
  DailyLog,
  FileActivity,
  ProjectMeta,
} from "../shared/types"
import { clampDailyTargetMinutes, getDailyTargetMs, resolveProjectTargetMinutes } from "../shared/config"
import { MirrorSink } from "./mirrorFormat"

const ALL_AGENTS: AgentName[] = [
  "claude-code",
  "copilot",
  "cursor",
  "continue",
  "unknown-ai",
  "manual",
]

interface GlobalDay {
  date: string
  activeTime: number
  streak: number
  // The daily target this day was judged against, stamped while it was still
  // being earned. Undefined on days recorded before stamping existed — those
  // fall back to the current target. See "Streak" in CLAUDE.md.
  targetMs?: number
}

function emptyDailyLog(date: string): DailyLog {
  const agents = {} as Record<AgentName, AgentEvent[]>
  for (const a of ALL_AGENTS) agents[a] = []
  return {
    date,
    totalTime: 0,
    activeTime: 0,
    streak: 0,
    languages: {},
    agents,
    files: [],
    sessions: [],
  }
}

function emptyGlobalDay(date: string): GlobalDay {
  return { date, activeTime: 0, streak: 0 }
}

function todayKey(): string {
  return dateKey(new Date())
}

// Local-time day key. Every storage key is built from this, so any caller
// deriving its own day key must use it too — a UTC-derived key (toISOString)
// silently reads the wrong day either side of local midnight.
export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function storageKey(projectId: string, date: string): string {
  return `rabbithole:log:${projectId}:${date}`
}

function globalKey(date: string): string {
  return `rabbithole:global:${date}`
}

export const PROJECTS_KEY = "rabbithole:projects"

const GLOBAL_PREFIX = "rabbithole:global:"
const LOG_PREFIX = "rabbithole:log:"
const ANY_PREFIX = "rabbithole:"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// One-shot UI flags. A wipe must not resurrect the first-run target prompt,
// so these two survive clearAll.
const PRESERVED_KEYS = ["rabbithole:targetPrompted", "rabbithole:targetDefaultMigrated"]

export interface SnapshotSummary {
  projects: { id: string; days: number }[]
  dates: string[]
}

// Narrow a snapshot to a chosen set of projects, so restoring one project after
// a mistaken clear doesn't revert the other eleven to their state when the
// backup was taken. Legacy project-less log keys always pass through: nothing
// reads them, so they can't conflict with a scoped restore, and dropping them
// would lose history the backup holds. Non-log keys are carried along and
// ignored by importSnapshot, exactly as in an unscoped import.
export function scopeSnapshotToProjects(
  snapshot: Record<string, unknown>,
  projectIds: string[]
): Record<string, unknown> {
  const keep = new Set(projectIds)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    if (key.startsWith(LOG_PREFIX)) {
      const pid = key.slice(LOG_PREFIX.length, key.lastIndexOf(":"))
      if (pid && !keep.has(pid)) continue
      out[key] = value
    } else if (key === PROJECTS_KEY) {
      if (Array.isArray(value)) {
        out[key] = (value as ProjectMeta[]).filter(p => p && keep.has(p.id))
      }
    } else {
      out[key] = value
    }
  }
  return out
}

// A snapshot is JSON off disk that anyone could have hand-edited, so it is
// checked in full before a single write happens: a malformed log value lands
// in globalState silently and only surfaces much later as a render crash, far
// from the import that caused it. Returns what the snapshot would touch, so
// the caller can state the counts in its confirmation, or null if unusable.
export function validateSnapshot(raw: unknown): SnapshotSummary | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  if (!entries.some(([key]) => key.startsWith(ANY_PREFIX))) return null

  const projectDays = new Map<string, number>()
  const dates = new Set<string>()
  for (const [key, value] of entries) {
    if (!key.startsWith(LOG_PREFIX)) continue
    // Project ids from git remotes contain colons; dates never do, so the
    // last colon is the only reliable split point.
    const cut = key.lastIndexOf(":")
    const projectId = key.slice(LOG_PREFIX.length, cut)
    const date = key.slice(cut + 1)
    if (!DATE_RE.test(date)) return null
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    const log = value as Partial<DailyLog>
    if (typeof log.date !== "string" || typeof log.activeTime !== "number") return null
    // Pre-multi-project installs wrote `rabbithole:log:<date>` with no project
    // segment, so projectId comes out "". Those keys are inert (storageKey
    // always writes a project id, so nothing reads them back) but they exist in
    // real backups — rejecting the file over one would make every backup from
    // an install with any history unimportable.
    if (projectId) projectDays.set(projectId, (projectDays.get(projectId) ?? 0) + 1)
    dates.add(date)
  }
  const projects = [...projectDays]
    .map(([id, days]) => ({ id, days }))
    .sort((a, b) => b.days - a.days)
  return { projects, dates: [...dates] }
}

export class StorageService {
  private currentProjectId = ""
  private mirror: MirrorSink | null = null
  private lastBackupPath = ""
  private discardSession: (() => void) | null = null

  constructor(private context: vscode.ExtensionContext) {}

  // Dual-write target: globalState stays authoritative, the mirror is a
  // best-effort JSON export and must never be allowed to fail a write path.
  setMirror(mirror: MirrorSink): void {
    this.mirror = mirror
  }

  // Lets the destructive/import paths drop the tracker's live session before
  // they rewrite storage. Without it the 10s checkpoint writes the in-memory
  // session straight back into the day that was just cleared.
  setSessionDiscardHook(fn: () => void): void {
    this.discardSession = fn
  }

  setCurrentProject(id: string): void {
    this.currentProjectId = id
  }

  getCurrentProjectId(): string {
    return this.currentProjectId
  }

  registerProject(meta: ProjectMeta): void {
    const projects = this.getProjects()
    const idx = projects.findIndex(p => p.id === meta.id)
    if (idx >= 0) {
      // Preserve persisted fields that detectProject won't supply
      projects[idx] = {
        ...meta,
        streak: projects[idx].streak ?? 0,
        dailyTargetMinutes: projects[idx].dailyTargetMinutes,
      }
    } else {
      projects.push({ ...meta, streak: 0 })
    }
    this.context.globalState.update(PROJECTS_KEY, projects)
    this.mirror?.markProjectsDirty()
  }

  getProjects(): ProjectMeta[] {
    return this.context.globalState.get<ProjectMeta[]>(PROJECTS_KEY) ?? []
  }

  getToday(): DailyLog {
    // streak field in the returned log is the per-project streak (written by updateProjectStreak)
    return this.getLog(this.currentProjectId, todayKey())
  }

  getGlobalToday(): { activeTime: number; streak: number } {
    const g = this.getGlobalDay(todayKey())
    return { activeTime: g.activeTime, streak: g.streak }
  }

  getRange(days: number, projectId?: string): DailyLog[] {
    const pid = projectId ?? this.currentProjectId
    const logs: DailyLog[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      logs.push(this.getLog(pid, dateKey(d)))
    }
    return logs
  }

  // Combined active time per day across all projects — reads only the
  // per-day global records, so it's cheap enough for the 30s mini panel tick
  getGlobalActiveSeries(days: number): { date: string; activeTime: number }[] {
    const series: { date: string; activeTime: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const date = dateKey(d)
      series.push({ date, activeTime: this.getGlobalDay(date).activeTime })
    }
    return series
  }

  getAggregateRange(days: number): DailyLog[] {
    const projects = this.getProjects()
    const logs: DailyLog[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const date = dateKey(d)

      const globalDay = this.getGlobalDay(date)
      const merged = emptyDailyLog(date)
      merged.activeTime = globalDay.activeTime
      merged.streak = globalDay.streak

      for (const project of projects) {
        const pLog = this.getLog(project.id, date)
        merged.totalTime += pLog.totalTime

        for (const s of pLog.sessions) {
          merged.sessions.push({ ...s, projectId: project.id })
        }
        for (const f of pLog.files) {
          merged.files.push({ ...f, projectId: project.id })
        }
        for (const [lang, stat] of Object.entries(pLog.languages)) {
          if (!merged.languages[lang]) {
            merged.languages[lang] = { time: 0, linesAdded: 0, linesDeleted: 0 }
          }
          merged.languages[lang].time += stat.time
          merged.languages[lang].linesAdded += stat.linesAdded
          merged.languages[lang].linesDeleted += stat.linesDeleted
        }
        for (const agent of ALL_AGENTS) {
          if (pLog.agents[agent]?.length) {
            merged.agents[agent].push(...pLog.agents[agent])
          }
        }
      }

      logs.push(merged)
    }
    return logs
  }

  private iterDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = []
    const start = new Date(startDate + "T00:00:00")
    const end = new Date(endDate + "T00:00:00")
    const d = new Date(start)
    while (d <= end) {
      dates.push(dateKey(new Date(d)))
      d.setDate(d.getDate() + 1)
    }
    return dates
  }

  getRangeByDates(startDate: string, endDate: string, projectId?: string): DailyLog[] {
    const pid = projectId ?? this.currentProjectId
    // streak in each log is the per-project streak stored by updateProjectStreak
    return this.iterDateRange(startDate, endDate).map(date => this.getLog(pid, date))
  }

  getAggregateRangeByDates(startDate: string, endDate: string): DailyLog[] {
    const projects = this.getProjects()
    return this.iterDateRange(startDate, endDate).map(date => {
      const globalDay = this.getGlobalDay(date)
      const merged = emptyDailyLog(date)
      merged.activeTime = globalDay.activeTime
      merged.streak = globalDay.streak

      for (const project of projects) {
        const pLog = this.getLog(project.id, date)
        merged.totalTime += pLog.totalTime
        for (const s of pLog.sessions) merged.sessions.push({ ...s, projectId: project.id })
        for (const f of pLog.files) merged.files.push({ ...f, projectId: project.id })
        for (const [lang, stat] of Object.entries(pLog.languages)) {
          if (!merged.languages[lang]) merged.languages[lang] = { time: 0, linesAdded: 0, linesDeleted: 0 }
          merged.languages[lang].time += stat.time
          merged.languages[lang].linesAdded += stat.linesAdded
          merged.languages[lang].linesDeleted += stat.linesDeleted
        }
        for (const agent of ALL_AGENTS) {
          if (pLog.agents[agent]?.length) merged.agents[agent].push(...pLog.agents[agent])
        }
      }
      return merged
    })
  }

  getMultiProjectRangeByDates(startDate: string, endDate: string, projectIds: string[]): DailyLog[] {
    const selectedProjects = this.getProjects().filter(p => projectIds.includes(p.id))
    return this.iterDateRange(startDate, endDate).map(date => {
      const globalDay = this.getGlobalDay(date)
      const merged = emptyDailyLog(date)
      merged.streak = globalDay.streak

      for (const project of selectedProjects) {
        const pLog = this.getLog(project.id, date)
        merged.totalTime += pLog.totalTime
        merged.activeTime += pLog.activeTime
        for (const s of pLog.sessions) merged.sessions.push({ ...s, projectId: project.id })
        for (const f of pLog.files) merged.files.push({ ...f, projectId: project.id })
        for (const [lang, stat] of Object.entries(pLog.languages)) {
          if (!merged.languages[lang]) merged.languages[lang] = { time: 0, linesAdded: 0, linesDeleted: 0 }
          merged.languages[lang].time += stat.time
          merged.languages[lang].linesAdded += stat.linesAdded
          merged.languages[lang].linesDeleted += stat.linesDeleted
        }
        for (const agent of ALL_AGENTS) {
          if (pLog.agents[agent]?.length) merged.agents[agent].push(...pLog.agents[agent])
        }
      }
      return merged
    })
  }

  // On startup: close any sessions from previous days that were left open by a crash or
  // unclean shutdown (endTime === null). Sets endTime = startTime + activeTime as best estimate.
  closeStaleSessions(): void {
    for (const project of this.getProjects()) {
      for (let i = 0; i <= 7; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const date = dateKey(d)
        const log = this.getLog(project.id, date)
        let changed = false
        for (const session of log.sessions) {
          if (session.endTime === null && session.activeTime > 0) {
            session.endTime = session.startTime + session.activeTime
            session.duration = session.activeTime
            changed = true
          }
        }
        if (changed) this.saveLog(project.id, log)
      }
    }
  }

  appendSession(session: ActivitySession): void {
    this.appendSessionToDate(session, todayKey())
  }

  appendSessionToDate(session: ActivitySession, date: string): void {
    if (!this.currentProjectId) return
    const log = this.getLog(this.currentProjectId, date)
    const oldActiveTime = log.activeTime

    const existing = log.sessions.findIndex(s => s.id === session.id)
    if (existing >= 0) {
      log.sessions[existing] = session
    } else {
      log.sessions.push(session)
    }

    let totalTime = 0
    let activeTime = 0
    for (const s of log.sessions) {
      if (s.endTime !== null) totalTime += s.duration
      activeTime += s.activeTime
    }
    log.totalTime = totalTime
    log.activeTime = activeTime
    this.saveLog(this.currentProjectId, log)

    // Update global aggregate with the delta
    const delta = log.activeTime - oldActiveTime
    if (delta !== 0) {
      const globalDay = this.getGlobalDay(date)
      globalDay.activeTime = Math.max(0, globalDay.activeTime + delta)
      this.saveGlobalDay(globalDay)
    }
  }

  appendFileActivity(file: FileActivity, projectId?: string): void {
    const targetProject = projectId ?? this.currentProjectId
    if (!targetProject) return
    const log = this.getLog(targetProject, todayKey())
    const existing = log.files.findIndex(f => f.path === file.path)
    if (existing >= 0) {
      log.files[existing].linesAdded += file.linesAdded
      log.files[existing].linesDeleted += file.linesDeleted
      log.files[existing].lastModified = file.lastModified
    } else {
      log.files.push({ ...file })
    }
    if (!log.languages[file.language]) {
      log.languages[file.language] = { time: 0, linesAdded: 0, linesDeleted: 0 }
    }
    log.languages[file.language].linesAdded += file.linesAdded
    log.languages[file.language].linesDeleted += file.linesDeleted
    this.saveLog(targetProject, log)
  }

  appendAgentEvent(event: AgentEvent): void {
    if (!this.currentProjectId) return
    const log = this.getLog(this.currentProjectId, todayKey())
    if (!log.agents[event.agent]) log.agents[event.agent] = []
    log.agents[event.agent].push(event)
    this.saveLog(this.currentProjectId, log)
  }

  // Completed streak count for `date`, self-healing a provably-wrong stored 0.
  //
  // A day that met the target always has streak >= 1, so a stored 0 on a met
  // day cannot be right. Clears and restores leave those behind: getGlobalDay
  // returns streak 0 for a missing date, so an import that recreates a day's
  // record sets activeTime from the delta but leaves the chain value at the
  // empty-record default. Today's count derives from yesterday's, so one bad
  // zero caps every day after it.
  //
  // Walks back only until it finds a day that missed the target (chain broken,
  // base 0) or one with a stored non-zero value (trusted, base that), then
  // fills the gap forward and persists it. In the healthy case yesterday
  // already has a value, so this stops after a single read.
  // The global chain lives in `rabbithole:global:*`, the per-project chain in
  // each project's DailyLog, but the algorithm is identical — so it is written
  // once here over a reader and a writer.
  private chainEndingAt(
    date: string,
    fallbackTargetMs: number,
    read: (date: string) => { activeTime: number; streak?: number; targetMs?: number },
    persist: (date: string, streak: number) => void
  ): number {
    const MAX_WALK = 400
    const pending: string[] = []
    const cursor = new Date(`${date}T00:00:00`)
    let base = 0

    for (let i = 0; i < MAX_WALK; i++) {
      const key = dateKey(cursor)
      const day = read(key)
      // Judge each past day against the bar it was actually set at the time,
      // not today's. Raising the target must not un-earn a completed day.
      const bar = day.targetMs ?? fallbackTargetMs
      const streak = day.streak ?? 0
      if (day.activeTime < bar) break                // chain broken here
      if (streak > 0) { base = streak; break }       // trusted, stop walking
      pending.push(key)                              // met, but chain value lost
      cursor.setDate(cursor.getDate() - 1)
    }

    // pending is newest-first, so the oldest sits directly on top of base.
    let value = base
    for (let i = pending.length - 1; i >= 0; i--) {
      value += 1
      persist(pending[i], value)
    }
    return value
  }

  private globalChainEndingAt(date: string, targetMs: number): number {
    return this.chainEndingAt(
      date,
      targetMs,
      d => this.getGlobalDay(d),
      (d, streak) => {
        const day = this.getGlobalDay(d)
        if (day.streak === streak) return
        day.streak = streak
        this.context.globalState.update(globalKey(d), day)
        this.mirror?.markDayDirty(d)
      }
    )
  }

  private projectChainEndingAt(projectId: string, date: string, targetMs: number): number {
    return this.chainEndingAt(
      date,
      targetMs,
      d => this.getLog(projectId, d),
      (d, streak) => {
        const log = this.getLog(projectId, d)
        if (log.streak === streak) return
        log.streak = streak
        this.saveLog(projectId, log)
      }
    )
  }

  updateStreak(): void {
    const targetMs = getDailyTargetMs()

    const globalToday = this.getGlobalDay(todayKey())
    const todayMet = globalToday.activeTime >= targetMs

    const yd = new Date()
    yd.setDate(yd.getDate() - 1)
    const chainSoFar = this.globalChainEndingAt(dateKey(yd), targetMs)

    const newStreak = todayMet ? chainSoFar + 1 : chainSoFar
    // Today is still in progress, so it is always judged against the live
    // target — and the stamp is refreshed with it. Once the day is over there
    // are no more writes, so the stamp freezes at the target it ended on.
    if (globalToday.streak !== newStreak || globalToday.targetMs !== targetMs) {
      globalToday.streak = newStreak
      globalToday.targetMs = targetMs
      this.saveGlobalDay(globalToday)
    }
  }

  updateProjectStreak(projectId: string): void {
    if (!projectId) return
    const projects = this.getProjects()
    const project = projects.find(p => p.id === projectId)
    if (!project) return

    const targetMs = resolveProjectTargetMinutes(project.dailyTargetMinutes) * 60_000

    const todayLog = this.getLog(projectId, todayKey())
    const todayMet = todayLog.activeTime >= targetMs

    const yd = new Date()
    yd.setDate(yd.getDate() - 1)
    // Same walk as the global chain: yesterday is judged against the target it
    // was set at the time, and a provably-wrong stored 0 left behind by a clear
    // or restore is repaired rather than allowed to cap every later day.
    const chainSoFar = this.projectChainEndingAt(projectId, dateKey(yd), targetMs)

    const newStreak = todayMet ? chainSoFar + 1 : chainSoFar

    // Write streak into today's per-project DailyLog (enables history-based reading)
    if (todayLog.streak !== newStreak || todayLog.targetMs !== targetMs) {
      todayLog.streak = newStreak
      todayLog.targetMs = targetMs
      this.saveLog(projectId, todayLog)
    }

    // Also cache on ProjectMeta for quick access in Projects tab
    if ((project.streak ?? 0) !== newStreak) {
      project.streak = newStreak
      this.context.globalState.update(PROJECTS_KEY, projects)
      this.mirror?.markProjectsDirty()
    }
  }

  updateProjectTarget(projectId: string, minutes: number | null): void {
    const projects = this.getProjects()
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    if (minutes === null || minutes === undefined) {
      delete project.dailyTargetMinutes
    } else {
      const clamped = clampDailyTargetMinutes(minutes)
      if (clamped === null) return
      project.dailyTargetMinutes = clamped
    }
    this.context.globalState.update(PROJECTS_KEY, projects)
    this.mirror?.markProjectsDirty()
  }

  updateLanguageTime(language: string, ms: number): void {
    this.updateLanguageTimeForDate(language, ms, todayKey())
  }

  updateLanguageTimeForDate(language: string, ms: number, date: string): void {
    if (!this.currentProjectId) return
    const log = this.getLog(this.currentProjectId, date)
    if (!log.languages[language]) {
      log.languages[language] = { time: 0, linesAdded: 0, linesDeleted: 0 }
    }
    log.languages[language].time += ms
    this.saveLog(this.currentProjectId, log)
  }

  exportJSON(): string {
    return JSON.stringify(this.getAggregateRange(90), null, 2)
  }

  exportCSV(): string {
    const logs = this.getAggregateRange(90)
    const rows: string[] = ["date,totalTime,activeTime,streak,linesAdded,linesDeleted"]
    for (const log of logs) {
      const linesAdded = log.files.reduce((s, f) => s + f.linesAdded, 0)
      const linesDeleted = log.files.reduce((s, f) => s + f.linesDeleted, 0)
      rows.push(
        `${log.date},${log.totalTime},${log.activeTime},${log.streak},${linesAdded},${linesDeleted}`
      )
    }
    return rows.join("\n")
  }

  // ── Your data ─────────────────────────────────────────────────────────────

  getStoragePath(): string {
    return path.join(this.context.globalStorageUri.fsPath, "mirror")
  }

  // Path of the snapshot written by the most recent destructive op, so the
  // caller can tell the user where their data went.
  getLastBackupPath(): string {
    return this.lastBackupPath
  }

  getBackupsPath(): string {
    return path.join(this.context.globalStorageUri.fsPath, "backups")
  }

  // globalState has no undo, so every destructive path snapshots first — those
  // callers pass no argument and get the whole store. `projectIds` is for the
  // user-facing "back up some projects" action only; a destructive path must
  // never take a partial safety net.
  async backupToDisk(projectIds?: string[], label?: string): Promise<string> {
    const dir = this.getBackupsPath()
    await fs.mkdir(dir, { recursive: true })

    let snapshot: Record<string, unknown> = {}
    for (const key of this.context.globalState.keys()) {
      if (key.startsWith(ANY_PREFIX)) snapshot[key] = this.context.globalState.get(key)
    }
    if (projectIds) snapshot = scopeSnapshotToProjects(snapshot, projectIds)

    // ":" is illegal in Windows filenames, so the ISO stamp is flattened
    const stamp = new Date().toISOString().replace(/:/g, "-")
    const slug = label ? `-${label.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 40)}` : ""
    const file = path.join(dir, `backup${slug}-${stamp}.json`)
    await fs.writeFile(file, JSON.stringify(snapshot, null, 2), "utf8")
    this.lastBackupPath = file
    return file
  }

  // The backup snapshot doubles as the import format: it holds the per-project
  // logs verbatim, so a restore rebuilds every panel exactly. (The analytics
  // export is not an import source — it merges projects, drops language
  // attribution and caps at 90 days.) Because a snapshot only carries keys for
  // the projects and dates it knows about, importing one from another machine
  // merges history rather than overwriting this machine's.
  //
  // The order below is load-bearing; see the "Your data" notes in CLAUDE.md.
  async importSnapshot(snapshot: Record<string, unknown>): Promise<boolean> {
    if (!validateSnapshot(snapshot)) return false
    // Same reason as clearProject: an in-flight session checkpointing over a
    // just-restored day would mix live time into the imported values. Time
    // already written to storage is kept — only the session boundary moves.
    this.discardSession?.()
    await this.backupToDisk()

    // Per-project logs: replace wholesale, per the chosen conflict rule. The
    // per-key before/after difference is what the global day records move by —
    // see the note below on why this is a delta and not a recompute.
    const globalDelta = new Map<string, number>()
    for (const [key, value] of Object.entries(snapshot)) {
      if (!key.startsWith(LOG_PREFIX)) continue
      const date = key.slice(key.lastIndexOf(":") + 1)
      const previous = this.context.globalState.get<DailyLog>(key)
      const before = typeof previous?.activeTime === "number" ? previous.activeTime : 0
      const after = (value as DailyLog).activeTime
      await this.context.globalState.update(key, value)
      globalDelta.set(date, (globalDelta.get(date) ?? 0) + (after - before))
    }

    // The registry is union-merged, never replaced: replacing it would drop
    // the projects that only exist on this machine and orphan their logs from
    // every aggregate read — including the global recompute just below.
    const merged = this.getProjects()
    const importedProjects = snapshot[PROJECTS_KEY]
    if (Array.isArray(importedProjects)) {
      for (const p of importedProjects as ProjectMeta[]) {
        if (!p || typeof p.id !== "string") continue
        const idx = merged.findIndex(m => m.id === p.id)
        if (idx >= 0) merged[idx] = p
        else merged.push(p)
      }
      await this.context.globalState.update(PROJECTS_KEY, merged)
    }

    // rabbithole:global:* is never copied from the snapshot — those records are
    // cross-project aggregates, and a foreign machine's would erase whatever
    // this machine's other projects contributed that day.
    //
    // It is moved by the imported delta rather than recomputed as the sum over
    // the registry. A sum silently drops every contribution that isn't
    // attributable to a *currently registered* project — orphaned logs, legacy
    // project-less keys, projects not in this backup — so restoring one project
    // rewrote unrelated historical days downward. That broke streaks: a past
    // day pushed below the daily target snaps the chain, which is how a 2-day
    // global streak came back as 1 after a restore. The delta only moves days
    // by exactly what the import changed, and re-importing the same file is a
    // no-op. (`clearProject` still recomputes — it removes whole projects and
    // has to resync, and it has the registry it needs to do that correctly.)
    for (const [date, delta] of globalDelta) {
      if (delta === 0) continue
      const existing = this.context.globalState.get<GlobalDay>(globalKey(date))
      const globalDay = this.getGlobalDay(date)
      globalDay.activeTime = Math.max(0, globalDay.activeTime + delta)
      // An existing streak is this machine's and is never overwritten. But when
      // there is no record at all — the day was cleared, or came from another
      // machine — "leave it alone" would mean leaving getGlobalDay's default 0,
      // and a 0 on a day that met the target breaks every later day's chain.
      // The snapshot's value is the only evidence of what it was, so adopt it.
      if (!existing) {
        const imported = snapshot[globalKey(date)] as GlobalDay | undefined
        if (imported && typeof imported.streak === "number") {
          globalDay.streak = imported.streak
        }
      }
      await this.context.globalState.update(globalKey(date), globalDay)
      this.mirror?.markDayDirty(date)
    }

    this.mirror?.markProjectsDirty()
    this.updateStreak()
    return true
  }

  async clearProject(projectId: string): Promise<void> {
    // The tracker's live session belongs to the day being deleted, and the 10s
    // checkpoint would write it straight back — clearing the currently-open
    // project would wipe past dates but leave today intact.
    if (projectId === this.currentProjectId) this.discardSession?.()
    await this.backupToDisk()

    const prefix = `rabbithole:log:${projectId}:`
    const affectedDates: string[] = []
    for (const key of this.context.globalState.keys()) {
      if (!key.startsWith(prefix)) continue
      affectedDates.push(key.slice(prefix.length))
      await this.context.globalState.update(key, undefined)
    }

    // Clearing history must not clear identity for the project being tracked.
    // The tracker keeps writing under currentProjectId regardless of the
    // registry, so unregistering it would send later sessions into logs no
    // aggregate reads while their deltas still inflated the global day totals —
    // global would silently stop equalling the sum of its projects.
    const projects = this.getProjects()
    const remaining = projectId === this.currentProjectId
      ? projects.map(p => (p.id === projectId ? { ...p, streak: 0 } : p))
      : projects.filter(p => p.id !== projectId)
    await this.context.globalState.update(PROJECTS_KEY, remaining)

    // Global day records are maintained by delta accumulation, not derived, so
    // dropping a project's logs would otherwise leave cross-project totals
    // permanently inflated. Recompute each affected day from what's left.
    for (const date of affectedDates) {
      const globalDay = this.getGlobalDay(date)
      let activeTime = 0
      for (const p of remaining) activeTime += this.getLog(p.id, date).activeTime
      globalDay.activeTime = activeTime
      // Historical streaks can't be meaningfully recomputed — leave them alone
      await this.context.globalState.update(globalKey(date), globalDay)
      this.mirror?.markDayDirty(date)
    }

    this.mirror?.markProjectsDirty()
    this.updateStreak()
  }

  async clearAll(): Promise<void> {
    this.discardSession?.()
    await this.backupToDisk()

    const affectedDates = new Set<string>()
    for (const key of this.context.globalState.keys()) {
      if (!key.startsWith(ANY_PREFIX) || PRESERVED_KEYS.includes(key)) continue
      if (key.startsWith(GLOBAL_PREFIX)) {
        affectedDates.add(key.slice(GLOBAL_PREFIX.length))
      } else if (key.startsWith(LOG_PREFIX)) {
        affectedDates.add(key.slice(key.lastIndexOf(":") + 1))
      }
      await this.context.globalState.update(key, undefined)
    }

    for (const date of affectedDates) this.mirror?.markDayDirty(date)
    this.mirror?.markProjectsDirty()
  }

  private getLog(projectId: string, date: string): DailyLog {
    if (!projectId) return emptyDailyLog(date)
    const stored = this.context.globalState.get<DailyLog>(storageKey(projectId, date))
    if (stored) {
      // Copy before back-filling: `stored` is the memento's live cached object,
      // so filling the missing keys on `stored.agents` directly would make this
      // read mutate the cache. Harmless while the normalization is idempotent —
      // a non-idempotent one added later would silently diverge from disk.
      const agents = { ...(stored.agents ?? {}) } as Record<AgentName, AgentEvent[]>
      for (const a of ALL_AGENTS) {
        if (!agents[a]) agents[a] = []
      }
      return { ...stored, agents }
    }
    return emptyDailyLog(date)
  }

  private saveLog(projectId: string, log: DailyLog): void {
    if (!projectId) return
    this.context.globalState.update(storageKey(projectId, log.date), log)
    this.mirror?.markDayDirty(log.date)
  }

  private getGlobalDay(date: string): GlobalDay {
    return this.context.globalState.get<GlobalDay>(globalKey(date)) ?? emptyGlobalDay(date)
  }

  private saveGlobalDay(day: GlobalDay): void {
    this.context.globalState.update(globalKey(day.date), day)
    this.mirror?.markDayDirty(day.date)
  }
}

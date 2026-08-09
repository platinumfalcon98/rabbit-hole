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
const ANY_PREFIX = "rabbithole:"

// One-shot UI flags. A wipe must not resurrect the first-run target prompt,
// so these two survive clearAll.
const PRESERVED_KEYS = ["rabbithole:targetPrompted", "rabbithole:targetDefaultMigrated"]

export class StorageService {
  private currentProjectId = ""
  private mirror: MirrorSink | null = null
  private lastBackupPath = ""

  constructor(private context: vscode.ExtensionContext) {}

  // Dual-write target: globalState stays authoritative, the mirror is a
  // best-effort JSON export and must never be allowed to fail a write path.
  setMirror(mirror: MirrorSink): void {
    this.mirror = mirror
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

  updateStreak(): void {
    const targetMs = getDailyTargetMs()

    const globalToday = this.getGlobalDay(todayKey())
    const todayMet = globalToday.activeTime >= targetMs

    const yd = new Date()
    yd.setDate(yd.getDate() - 1)
    const globalYesterday = this.getGlobalDay(dateKey(yd))
    const yesterdayMet = globalYesterday.activeTime >= targetMs
    const chainSoFar = yesterdayMet ? (globalYesterday.streak || 0) : 0

    const newStreak = todayMet ? chainSoFar + 1 : chainSoFar
    if (globalToday.streak !== newStreak) {
      globalToday.streak = newStreak
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
    const ydLog = this.getLog(projectId, dateKey(yd))
    const yesterdayMet = ydLog.activeTime >= targetMs
    const chainSoFar = yesterdayMet ? (ydLog.streak ?? 0) : 0

    const newStreak = todayMet ? chainSoFar + 1 : chainSoFar

    // Write streak into today's per-project DailyLog (enables history-based reading)
    if (todayLog.streak !== newStreak) {
      todayLog.streak = newStreak
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

  // globalState has no undo, so every destructive path snapshots first.
  async backupToDisk(): Promise<string> {
    const dir = path.join(this.context.globalStorageUri.fsPath, "backups")
    await fs.mkdir(dir, { recursive: true })

    const snapshot: Record<string, unknown> = {}
    for (const key of this.context.globalState.keys()) {
      if (key.startsWith(ANY_PREFIX)) snapshot[key] = this.context.globalState.get(key)
    }

    // ":" is illegal in Windows filenames, so the ISO stamp is flattened
    const stamp = new Date().toISOString().replace(/:/g, "-")
    const file = path.join(dir, `backup-${stamp}.json`)
    await fs.writeFile(file, JSON.stringify(snapshot, null, 2), "utf8")
    this.lastBackupPath = file
    return file
  }

  async clearProject(projectId: string): Promise<void> {
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
    await this.backupToDisk()

    const affectedDates = new Set<string>()
    for (const key of this.context.globalState.keys()) {
      if (!key.startsWith(ANY_PREFIX) || PRESERVED_KEYS.includes(key)) continue
      if (key.startsWith(GLOBAL_PREFIX)) {
        affectedDates.add(key.slice(GLOBAL_PREFIX.length))
      } else if (key.startsWith("rabbithole:log:")) {
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
      const agents = stored.agents ?? ({} as Record<AgentName, AgentEvent[]>)
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

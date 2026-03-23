import * as vscode from "vscode"
import {
  ActivitySession,
  AgentEvent,
  AgentName,
  DailyLog,
  FileActivity,
  ProjectMeta,
} from "../shared/types"

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

function dateKey(d: Date): string {
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

const PROJECTS_KEY = "rabbithole:projects"

export class StorageService {
  private currentProjectId = ""

  constructor(private context: vscode.ExtensionContext) {}

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
      projects[idx] = meta
    } else {
      projects.push(meta)
    }
    this.context.globalState.update(PROJECTS_KEY, projects)
  }

  getProjects(): ProjectMeta[] {
    return this.context.globalState.get<ProjectMeta[]>(PROJECTS_KEY) ?? []
  }

  getToday(): DailyLog {
    const log = this.getLog(this.currentProjectId, todayKey())
    log.streak = this.getGlobalDay(todayKey()).streak
    return log
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
      const date = dateKey(d)
      const log = this.getLog(pid, date)
      // Always use global streak
      log.streak = this.getGlobalDay(date).streak
      logs.push(log)
    }
    return logs
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
    return this.iterDateRange(startDate, endDate).map(date => {
      const log = this.getLog(pid, date)
      log.streak = this.getGlobalDay(date).streak
      return log
    })
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

  appendFileActivity(file: FileActivity): void {
    if (!this.currentProjectId) return
    const log = this.getLog(this.currentProjectId, todayKey())
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
    this.saveLog(this.currentProjectId, log)
  }

  appendAgentEvent(event: AgentEvent): void {
    if (!this.currentProjectId) return
    const log = this.getLog(this.currentProjectId, todayKey())
    if (!log.agents[event.agent]) log.agents[event.agent] = []
    log.agents[event.agent].push(event)
    this.saveLog(this.currentProjectId, log)
  }

  updateStreak(): void {
    const targetMinutes = vscode.workspace
      .getConfiguration("rabbithole")
      .get<number>("dailyTargetMinutes") ?? 0
    const targetMs = targetMinutes * 60 * 1000

    const globalToday = this.getGlobalDay(todayKey())
    const todayMet = targetMs > 0
      ? globalToday.activeTime >= targetMs
      : globalToday.activeTime > 0

    const yd = new Date()
    yd.setDate(yd.getDate() - 1)
    const globalYesterday = this.getGlobalDay(dateKey(yd))
    const yesterdayMet = targetMs > 0
      ? globalYesterday.activeTime >= targetMs
      : globalYesterday.activeTime > 0
    const chainSoFar = yesterdayMet ? (globalYesterday.streak || 0) : 0

    const newStreak = todayMet ? chainSoFar + 1 : 0
    if (globalToday.streak !== newStreak) {
      globalToday.streak = newStreak
      this.saveGlobalDay(globalToday)
    }
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
  }

  private getGlobalDay(date: string): GlobalDay {
    return this.context.globalState.get<GlobalDay>(globalKey(date)) ?? emptyGlobalDay(date)
  }

  private saveGlobalDay(day: GlobalDay): void {
    this.context.globalState.update(globalKey(day.date), day)
  }
}

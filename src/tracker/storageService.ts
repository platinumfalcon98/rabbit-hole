import * as vscode from "vscode"
import {
  ActivitySession,
  AgentEvent,
  AgentName,
  DailyLog,
  FileActivity,
} from "../shared/types"

const ALL_AGENTS: AgentName[] = [
  "claude-code",
  "copilot",
  "cursor",
  "continue",
  "unknown-ai",
  "manual",
]

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

function todayKey(): string {
  return dateKey(new Date())
}

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function storageKey(date: string): string {
  return `rabbithole:log:${date}`
}

export class StorageService {
  constructor(private context: vscode.ExtensionContext) {}

  getToday(): DailyLog {
    return this.getLog(todayKey())
  }

  getRange(days: number): DailyLog[] {
    const logs: DailyLog[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      logs.push(this.getLog(dateKey(d)))
    }
    return logs
  }

  appendSession(session: ActivitySession): void {
    this.appendSessionToDate(session, todayKey())
  }

  appendSessionToDate(session: ActivitySession, date: string): void {
    const log = this.getLog(date)
    const existing = log.sessions.findIndex(s => s.id === session.id)
    if (existing >= 0) {
      log.sessions[existing] = session
    } else {
      log.sessions.push(session)
    }
    // Recompute totals from all sessions.
    // totalTime counts only ended sessions; activeTime counts all (open sessions
    // checkpoint their activeTime every 30s).
    let totalTime = 0
    let activeTime = 0
    for (const s of log.sessions) {
      if (s.endTime !== null) totalTime += s.duration
      activeTime += s.activeTime
    }
    log.totalTime = totalTime
    log.activeTime = activeTime
    this.saveLog(log)
  }

  appendFileActivity(file: FileActivity): void {
    const log = this.getToday()
    const existing = log.files.findIndex(f => f.path === file.path)
    if (existing >= 0) {
      log.files[existing].linesAdded += file.linesAdded
      log.files[existing].linesDeleted += file.linesDeleted
      log.files[existing].lastModified = file.lastModified
    } else {
      log.files.push({ ...file })
    }
    // Update language stats
    if (!log.languages[file.language]) {
      log.languages[file.language] = { time: 0, linesAdded: 0, linesDeleted: 0 }
    }
    log.languages[file.language].linesAdded += file.linesAdded
    log.languages[file.language].linesDeleted += file.linesDeleted
    this.saveLog(log)
  }

  appendAgentEvent(event: AgentEvent): void {
    const log = this.getToday()
    if (!log.agents[event.agent]) {
      log.agents[event.agent] = []
    }
    log.agents[event.agent].push(event)
    this.saveLog(log)
  }

  updateStreak(): void {
    const today = this.getToday()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayLog = this.context.globalState.get<DailyLog>(
      storageKey(dateKey(yesterday))
    )
    if (yesterdayLog && yesterdayLog.activeTime > 0) {
      today.streak = (yesterdayLog.streak || 0) + 1
    } else {
      today.streak = 1
    }
    this.saveLog(today)
  }

  exportJSON(): string {
    const logs = this.getRange(90)
    return JSON.stringify(logs, null, 2)
  }

  exportCSV(): string {
    const logs = this.getRange(90)
    const rows: string[] = [
      "date,totalTime,activeTime,streak,linesAdded,linesDeleted",
    ]
    for (const log of logs) {
      const linesAdded = log.files.reduce((s, f) => s + f.linesAdded, 0)
      const linesDeleted = log.files.reduce((s, f) => s + f.linesDeleted, 0)
      rows.push(
        `${log.date},${log.totalTime},${log.activeTime},${log.streak},${linesAdded},${linesDeleted}`
      )
    }
    return rows.join("\n")
  }

  updateLanguageTime(language: string, ms: number): void {
    this.updateLanguageTimeForDate(language, ms, todayKey())
  }

  updateLanguageTimeForDate(language: string, ms: number, date: string): void {
    const log = this.getLog(date)
    if (!log.languages[language]) {
      log.languages[language] = { time: 0, linesAdded: 0, linesDeleted: 0 }
    }
    log.languages[language].time += ms
    this.saveLog(log)
  }

  private getLog(date: string): DailyLog {
    const stored = this.context.globalState.get<DailyLog>(storageKey(date))
    if (stored) {
      // Ensure all agent keys are present (guard against schema evolution)
      const agents = stored.agents ?? ({} as Record<AgentName, AgentEvent[]>)
      for (const a of ALL_AGENTS) {
        if (!agents[a]) agents[a] = []
      }
      return { ...stored, agents }
    }
    return emptyDailyLog(date)
  }

  private saveLog(log: DailyLog): void {
    this.context.globalState.update(storageKey(log.date), log)
  }
}

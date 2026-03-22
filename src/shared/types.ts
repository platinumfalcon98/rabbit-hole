export interface ActivitySession {
  id: string
  startTime: number        // unix ms
  endTime: number | null   // null if session still active
  duration: number         // total elapsed ms (endTime - startTime), 0 if open
  activeTime: number       // ms of actual active time (idle gaps excluded)
}

export interface FileActivity {
  path: string
  language: string         // detected from file extension
  linesAdded: number
  linesDeleted: number
  lastModified: number     // unix ms
}

export type AgentName =
  | "claude-code"
  | "copilot"
  | "cursor"
  | "continue"
  | "unknown-ai"
  | "manual"

export interface AgentEvent {
  agent: AgentName
  model?: string           // model string if detectable
  startTime: number
  endTime: number
  linesAdded: number
  linesDeleted: number
  filesChanged: string[]
  confidence: "high" | "low"
}

export interface LanguageStat {
  time: number
  linesAdded: number
  linesDeleted: number
}

export interface DailyLog {
  date: string                              // "YYYY-MM-DD"
  totalTime: number                         // ms including idle
  activeTime: number                        // ms excluding idle
  streak: number                            // consecutive coding days
  languages: Record<string, LanguageStat>
  agents: Record<AgentName, AgentEvent[]>
  files: FileActivity[]
  sessions: ActivitySession[]
}

// ── Message Protocol ──────────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "init";     data: DailyLog[] }
  | { type: "update";   data: DailyLog }
  | { type: "settings"; agentsEnabled: boolean }

export type WebviewMessage =
  | { type: "ready" }
  | { type: "requestRange"; days: 7 | 30 | 90 }
  | { type: "export"; format: "csv" | "json" }

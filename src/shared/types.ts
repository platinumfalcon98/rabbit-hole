export interface ActivitySession {
  id: string
  startTime: number        // unix ms
  endTime: number | null   // null if session still active
  duration: number         // total elapsed ms (endTime - startTime), 0 if open
  activeTime: number       // ms of actual active time (idle gaps excluded)
  projectId?: string       // populated only in aggregate responses
}

export interface FileActivity {
  path: string
  language: string         // detected from file extension
  linesAdded: number
  linesDeleted: number
  lastModified: number     // unix ms
  projectId?: string       // populated only in aggregate responses
}

export interface ProjectMeta {
  id: string
  name: string
  path: string
  detectionMethod: "git-remote" | "folder-hash" | "user-defined"
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
  streak: number                            // consecutive coding days (global)
  languages: Record<string, LanguageStat>
  agents: Record<AgentName, AgentEvent[]>
  files: FileActivity[]
  sessions: ActivitySession[]
}

// ── Message Protocol ──────────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "init"; data: DailyLog[]; heatmapData: DailyLog[]; projects: ProjectMeta[]; currentProjectId: string; projectTimestamps: Record<string, number> }
  | { type: "update"; data: DailyLog; projectId: string }
  | { type: "settings"; agentsEnabled: boolean; dailyTargetMs: number; dailyTargetMinutes: number; idleThresholdMinutes: number; sessionExpiryMinutes: number; agentToggles: Record<string, boolean> }
  | { type: "pdfData"; logs: DailyLog[] }

export type RangePreset = "today" | "7d" | "30d" | "1y" | "custom"

export type WebviewMessage =
  | { type: "ready" }
  | { type: "requestRange"; preset: RangePreset; customStart?: string; customEnd?: string }
  | { type: "selectProjects"; projectIds: string[] }
  | { type: "export"; format: "csv" | "json" }
  | { type: "exportPdfRequest"; days: 7 | 30 | 90 }
  | { type: "writePdf"; base64: string }
  | { type: "updateSetting"; key: string; value: number | boolean | null | Record<string, boolean> }

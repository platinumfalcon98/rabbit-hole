export interface ActivitySession {
  id: string
  startTime: number        // unix ms
  endTime: number | null   // null if session still active
  duration: number         // total elapsed ms (endTime - startTime), 0 if open
  activeTime: number       // ms of actual active time (idle gaps excluded)
  projectId?: string       // populated only in aggregate responses
  languages?: Record<string, number> // active ms per language within this session; absent on sessions recorded before per-session tracking
  intervals?: [number, number][]     // wall-clock spans (unix ms) the session was accruing; a written snapshot of an open session includes the current one; absent on older sessions
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
  dailyTargetMinutes?: number   // per-project streak target; unset = inherit the global target
  streak?: number               // current streak for this project (updated every 10s)
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
  streak: number                            // global streak on aggregate logs; per-project streak on project logs
  targetMs?: number                         // daily target this day was judged against, stamped while it was still being earned; unset on days recorded before stamping existed
  languages: Record<string, LanguageStat>
  agents: Record<AgentName, AgentEvent[]>
  files: FileActivity[]
  sessions: ActivitySession[]
}

// ── Payloads for the TTY webviews ─────────────────────────────────────────
// Everything is per project; the webview builds "all projects" and focus slices
// itself, which is what lets hover focus re-render without a round trip.
export interface ProjectYear {
  id: string
  name: string
  path: string
  dailyTargetMinutes?: number
  streak: number                 // stored per-project streak (self-healed by storage)
  lastActive?: number            // unix ms of the latest session end in the year
  active: number[]               // active ms per day, aligned with YearPayload.days
  targetMs: (number | null)[]    // stamped target per day; null = recorded before stamping
}
export interface YearPayload {
  today: string
  days: string[]                 // Monday-aligned, ending today (365–371 days)
  globalTargetMs: number
  global: { streak: number; active: number[]; targetMs: (number | null)[] }
  projects: ProjectYear[]        // registry order
}
export interface RangePayload {
  from: string
  to: string
  logs: Record<string, DailyLog[]>  // projectId -> one log per day, from..to
}
export interface LivePayload {
  today: string
  projectId: string
  log: DailyLog                  // today's log for the project being worked in
  todayActive: Record<string, number>
  globalToday: number
  globalStreak: number           // storage's streaks, which update as today's target is met
  streaks: Record<string, number>
}

// ── The Activity Bar sidebar ──────────────────────────────────────────────
// Rebuilt whole on every 10 s tick while the sidebar is visible: it never
// merges updates, so a wipe, an import or midnight can't leave it stale.
export interface MiniPayload {
  year: YearPayload
  logs: Record<string, DailyLog>   // today's log for every registered project
}
export type MiniMessage = { type: "ready" } | { type: "openDashboard" }

// ── CRT display (dashboard + sidebar) ─────────────────────────────────────
export type CrtMask = "slot" | "grille" | "shadow" | "off"
export type CrtPitch = "fine" | "medium" | "coarse"
export type CrtEffect = "scanlines" | "bloom" | "convergence" | "roll" | "flicker"
export interface CrtSettings {
  mask: CrtMask
  pitch: CrtPitch
  strength: number      // 0–100
  vignette: number      // 0–100, how much the glass darkens the edges
  effects: CrtEffect[]  // canonical order, no duplicates
}

// ── Message Protocol ──────────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "settings"; dailyTargetMs: number; dailyTargetMinutes: number; idleThresholdMinutes: number; storagePath: string; crt: CrtSettings; lineNotes?: string[] }
  | ({ type: "year" } & YearPayload)
  | ({ type: "range"; for?: "export" } & RangePayload)   // for: the export dialog's own fetch, which the dashboard ignores
  | { type: "rangeRefused"; from: string; to: string; for?: "export" }
  | ({ type: "live" } & LivePayload)
  | { type: "actionResult"; ok: boolean; lines: string[] }
  | ({ type: "mini" } & MiniPayload)


export type WebviewMessage =
  | { type: "ready" }
  | { type: "requestYear" }        // a live update named a project the cached year doesn't have
  | { type: "requestDays"; from: string; to: string; for?: "export" }
  | { type: "export"; format: "csv" | "json"; from?: string; to?: string; projectId?: string; name?: string }
  | { type: "writeFile"; kind: "jpg" | "pdf"; base64: string; name: string }
  | { type: "updateSetting"; key: "dailyTargetMinutes" | "idleThresholdMinutes"; value: number }
  | { type: "updateProjectSetting"; projectId: string; key: "dailyTargetMinutes"; value: number | null }
  | { type: "updateCrtSetting"; key: "mask" | "pitch" | "strength" | "vignette" | "effects"; value: string | number | string[] }
  | { type: "revealStorage" }
  | { type: "createBackup"; scope: "projects" | "all" }
  | { type: "importData"; scope: "projects" | "all" }
  | { type: "clearProject"; projectId: string }
  | { type: "clearAll" }

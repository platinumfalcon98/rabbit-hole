import * as vscode from "vscode"
import { AgentEvent, AgentName } from "../shared/types"

const AGENT_COOLDOWN_MS = 15_000

interface ChangeProfile {
  linesAdded: number
  linesDeleted: number
  fileCount: number
  totalCharsChanged: number
  timeMs: number
  changeRatio: number
  isMultiSite: boolean
  isAtomic: boolean
  isSyntaxComplete: boolean
  language: string
  filePath: string
}

interface AgentProfile {
  maxLines: number
  maxTimeMs: number
  pattern: "bulk" | "block" | "incremental"
}

const AGENT_PROFILES: Record<string, AgentProfile> = {
  "claude-code": { maxLines: 500, maxTimeMs: 8000, pattern: "bulk" },
  "cursor":      { maxLines: 200, maxTimeMs: 3000, pattern: "bulk" },
  "continue":    { maxLines: 50,  maxTimeMs: 1500, pattern: "block" },
  "copilot":     { maxLines: 15,  maxTimeMs: 800,  pattern: "incremental" },
}

const EXTENSION_IDS: Partial<Record<AgentName, string>> = {
  "copilot":  "GitHub.copilot",
  "continue": "Continue.continue",
}

export class AgentDetector {
  private claudeCodeSignalTime = 0
  private userConfirmationCache = new Map<string, AgentName | "no">()

  constructor(private context: vscode.ExtensionContext) {
    this.initClaudeWatcher()
  }

  private initClaudeWatcher(): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/.claude/**")
    const signal = () => {
      this.claudeCodeSignalTime = Date.now()
    }
    watcher.onDidChange(signal)
    watcher.onDidCreate(signal)
    this.context.subscriptions.push(watcher)
  }

  detect(profile: ChangeProfile): AgentEvent | null {
    const config = vscode.workspace.getConfiguration("rabbithole")
    if (!config.get<boolean>("detectAgents")) {
      return this.makeEvent("manual", "high", profile)
    }

    const agentToggles = config.get<Record<string, boolean>>("agents") ?? {}

    // Layer 1 — Claude Code file watcher (HIGH confidence)
    if (agentToggles["claudeCode"] !== false) {
      if (Date.now() - this.claudeCodeSignalTime <= AGENT_COOLDOWN_MS) {
        return this.makeEvent("claude-code", "high", profile)
      }
    }

    // Layer 2 — Cursor detection via app name
    const isCursor = vscode.env.appName.toLowerCase().includes("cursor")
    if (isCursor && agentToggles["cursor"] !== false) {
      if (this.isLikelyAI(profile)) {
        return this.makeEvent("cursor", "high", profile)
      }
    }

    // Layer 3 — Extension presence
    for (const [agentName, extId] of Object.entries(EXTENSION_IDS) as [AgentName, string][]) {
      const toggleKey = agentName === "claude-code" ? "claudeCode" : agentName
      if (agentToggles[toggleKey] === false) continue
      if (this.isExtensionActive(extId)) {
        if (this.matchesProfile(agentName, profile)) {
          return this.makeEvent(agentName, "high", profile)
        }
      }
    }

    // Layer 4 — Timing fingerprint (when multiple agents installed)
    const installedAgents = this.getInstalledAgents(agentToggles)
    if (installedAgents.length > 1) {
      const matched = this.matchBestProfile(installedAgents, profile)
      if (matched) {
        return this.makeEvent(matched, "low", profile)
      }
    }

    // Layer 5 — Heuristic classifier
    if (!this.isLikelyAI(profile)) {
      return null  // manual change, not interesting
    }

    // Layer 6 — Session correlation window
    if (Date.now() - this.claudeCodeSignalTime <= AGENT_COOLDOWN_MS) {
      return this.makeEvent("claude-code", "high", profile)
    }

    // Layer 7 — User confirmation (low confidence fallback)
    const hash = this.profileHash(profile)
    const cached = this.userConfirmationCache.get(hash)
      ?? this.context.globalState.get<AgentName | "no">(`rabbithole:userConfirmation:${hash}`)

    if (cached) {
      if (cached === "no") return null
      return this.makeEvent(cached, "low", profile)
    }

    // Show one-time confirmation message
    this.askUserConfirmation(hash, profile)
    return null
  }

  private async askUserConfirmation(hash: string, profile: ChangeProfile): Promise<void> {
    const answer = await vscode.window.showInformationMessage(
      "Rabbit Hole: Detected a large change — was this AI-assisted?",
      "Yes — Claude Code",
      "Yes — Copilot",
      "Yes — Other",
      "No"
    )

    let result: AgentName | "no" = "no"
    if (answer === "Yes — Claude Code") result = "claude-code"
    else if (answer === "Yes — Copilot") result = "copilot"
    else if (answer === "Yes — Other") result = "unknown-ai"

    this.userConfirmationCache.set(hash, result)
    this.context.globalState.update(`rabbithole:userConfirmation:${hash}`, result)
  }

  private isLikelyAI(profile: ChangeProfile): boolean {
    if (profile.linesAdded > 10 && profile.timeMs < 1500) return true
    if (profile.changeRatio > 0.3 && profile.timeMs < 3000) return true
    if (profile.isMultiSite && profile.isAtomic) return true
    if (profile.isSyntaxComplete && profile.linesAdded > 5) return true
    return false
  }

  private isExtensionActive(id: string): boolean {
    return !!vscode.extensions.getExtension(id)?.isActive
  }

  private matchesProfile(agent: AgentName, profile: ChangeProfile): boolean {
    const p = AGENT_PROFILES[agent]
    if (!p) return false
    const totalLines = profile.linesAdded + profile.linesDeleted
    if (totalLines > p.maxLines) return false
    if (profile.timeMs > p.maxTimeMs && profile.timeMs < 50) return false
    switch (p.pattern) {
      case "bulk":        return profile.linesAdded > 10
      case "block":       return profile.isSyntaxComplete
      case "incremental": return profile.linesAdded <= 15 && !profile.isMultiSite
    }
  }

  private matchBestProfile(agents: AgentName[], profile: ChangeProfile): AgentName | null {
    for (const agent of agents) {
      if (this.matchesProfile(agent, profile)) return agent
    }
    return null
  }

  private getInstalledAgents(toggles: Record<string, boolean>): AgentName[] {
    const installed: AgentName[] = []
    if (toggles["claudeCode"] !== false &&
        Date.now() - this.claudeCodeSignalTime <= AGENT_COOLDOWN_MS * 10) {
      installed.push("claude-code")
    }
    for (const [agentName, extId] of Object.entries(EXTENSION_IDS) as [AgentName, string][]) {
      const toggleKey = agentName === "claude-code" ? "claudeCode" : agentName
      if (toggles[toggleKey] !== false && this.isExtensionActive(extId)) {
        installed.push(agentName)
      }
    }
    if (vscode.env.appName.toLowerCase().includes("cursor") && toggles["cursor"] !== false) {
      installed.push("cursor")
    }
    return installed
  }

  private makeEvent(
    agent: AgentName,
    confidence: "high" | "low",
    profile: ChangeProfile
  ): AgentEvent {
    const now = Date.now()
    return {
      agent,
      startTime: now - Math.max(profile.timeMs, 1),
      endTime: now,
      linesAdded: profile.linesAdded,
      linesDeleted: profile.linesDeleted,
      filesChanged: [profile.filePath],
      confidence,
    }
  }

  private profileHash(profile: ChangeProfile): string {
    return `${profile.linesAdded}:${profile.linesDeleted}:${profile.language}:${Math.round(profile.changeRatio * 10)}`
  }
}

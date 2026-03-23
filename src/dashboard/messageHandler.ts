import * as vscode from "vscode"
import { WebviewMessage } from "../shared/types"
import { StorageService } from "../tracker/storageService"
import { DashboardPanel } from "./dashboardPanel"

// Module-level view state — persists for the lifetime of the panel
let currentProjectView = ""   // "" = tracker's current project, "all" = aggregate, or a project ID
let currentDays: 7 | 30 | 90 = 30

export function handleMessage(
  msg: WebviewMessage,
  storage: StorageService,
  panel: DashboardPanel
): void {
  switch (msg.type) {
    case "ready": {
      currentDays = 30
      currentProjectView = ""
      sendInit(storage, panel)
      sendSettings(panel)
      break
    }

    case "requestRange":
      currentDays = msg.days
      sendInit(storage, panel)
      break

    case "selectProject":
      currentProjectView = msg.projectId
      sendInit(storage, panel)
      break

    case "export": {
      const content = msg.format === "csv"
        ? storage.exportCSV()
        : storage.exportJSON()
      const ext = msg.format === "csv" ? "csv" : "json"
      writeExport(content, ext)
      break
    }

    case "exportPdfRequest": {
      const logs = currentProjectView === "all"
        ? storage.getAggregateRange(msg.days)
        : storage.getRange(msg.days, currentProjectView || undefined)
      panel.postMessage({ type: "pdfData", logs })
      break
    }

    case "writePdf":
      writePdfExport(msg.base64)
      break

    case "updateSetting": {
      const cfg = vscode.workspace.getConfiguration("rabbithole")
      cfg.update(msg.key, msg.value === null ? undefined : msg.value, vscode.ConfigurationTarget.Global)
      break
    }
  }
}

function sendSettings(panel: DashboardPanel): void {
  const cfg = vscode.workspace.getConfiguration("rabbithole")
  const dailyTargetMinutes = cfg.get<number>("dailyTargetMinutes") ?? 0
  panel.postMessage({
    type: "settings",
    agentsEnabled: cfg.get<boolean>("detectAgents") ?? true,
    dailyTargetMs: dailyTargetMinutes * 60_000,
    dailyTargetMinutes,
    idleThresholdMinutes: cfg.get<number>("idleThresholdMinutes") ?? 5,
    sessionExpiryMinutes: cfg.get<number>("sessionExpiryMinutes") ?? 60,
    agentToggles: cfg.get<Record<string, boolean>>("agents") ?? {},
  })
}

function sendInit(storage: StorageService, panel: DashboardPanel): void {
  const data = currentProjectView === "all"
    ? storage.getAggregateRange(currentDays)
    : storage.getRange(currentDays, currentProjectView || undefined)

  const resolvedProjectId = currentProjectView === ""
    ? storage.getCurrentProjectId()
    : currentProjectView

  // Compute latest session timestamp per project from aggregate logs
  const projectTimestamps: Record<string, number> = {}
  const allLogs = storage.getAggregateRange(currentDays)
  for (const log of allLogs) {
    for (const session of log.sessions) {
      const pid = session.projectId
      if (!pid) continue
      const ts = session.endTime ?? session.startTime
      if (!projectTimestamps[pid] || ts > projectTimestamps[pid]) {
        projectTimestamps[pid] = ts
      }
    }
  }

  panel.postMessage({
    type: "init",
    data,
    projects: storage.getProjects(),
    currentProjectId: resolvedProjectId,
    projectTimestamps,
  })
}

async function writePdfExport(base64: string): Promise<void> {
  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri
    ? vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders[0].uri,
        "rabbit-hole-card.pdf"
      )
    : undefined

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "PDF Files": ["pdf"] },
  })

  if (!uri) return

  const bytes = Buffer.from(base64, "base64")
  await vscode.workspace.fs.writeFile(uri, bytes)
  vscode.window.showInformationMessage(`Rabbit Hole: Card exported to ${uri.fsPath}`)
}

async function writeExport(content: string, ext: string): Promise<void> {
  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri
    ? vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders[0].uri,
        `rabbit-hole-export.${ext}`
      )
    : undefined

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: ext === "csv"
      ? { "CSV Files": ["csv"] }
      : { "JSON Files": ["json"] },
  })

  if (!uri) return

  const encoder = new TextEncoder()
  await vscode.workspace.fs.writeFile(uri, encoder.encode(content))
  vscode.window.showInformationMessage(`Rabbit Hole: Exported to ${uri.fsPath}`)
}

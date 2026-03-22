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
      const cfg = vscode.workspace.getConfiguration("rabbithole")
      panel.postMessage({
        type: "settings",
        agentsEnabled: cfg.get<boolean>("detectAgents") ?? true,
        dailyTargetMs: (cfg.get<number>("dailyTargetMinutes") ?? 0) * 60_000,
      })
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
  }
}

function sendInit(storage: StorageService, panel: DashboardPanel): void {
  const data = currentProjectView === "all"
    ? storage.getAggregateRange(currentDays)
    : storage.getRange(currentDays, currentProjectView || undefined)

  const resolvedProjectId = currentProjectView === ""
    ? storage.getCurrentProjectId()
    : currentProjectView

  panel.postMessage({
    type: "init",
    data,
    projects: storage.getProjects(),
    currentProjectId: resolvedProjectId,
  })
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

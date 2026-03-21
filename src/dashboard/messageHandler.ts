import * as vscode from "vscode"
import { WebviewMessage } from "../shared/types"
import { StorageService } from "../tracker/storageService"
import { DashboardPanel } from "./dashboardPanel"

export function handleMessage(
  msg: WebviewMessage,
  storage: StorageService,
  panel: DashboardPanel
): void {
  switch (msg.type) {
    case "ready":
      panel.postMessage({ type: "init", data: storage.getRange(30) })
      break

    case "requestRange":
      panel.postMessage({ type: "init", data: storage.getRange(msg.days) })
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

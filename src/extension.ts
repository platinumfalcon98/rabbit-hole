import * as vscode from "vscode"
import { StorageService } from "./tracker/storageService"
import { AgentDetector } from "./tracker/agentDetector"
import { ActivityTracker } from "./tracker/activityTracker"
import { DashboardPanel } from "./dashboard/dashboardPanel"
import { handleMessage } from "./dashboard/messageHandler"
import { WebviewMessage } from "./shared/types"

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function activate(context: vscode.ExtensionContext): void {
  const storage = new StorageService(context)
  const detector = new AgentDetector(context)
  const tracker = new ActivityTracker(context, storage, detector)

  tracker.start()

  // Update streak on activation
  storage.updateStreak()

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  )
  statusBar.command = "rabbithole.openDashboard"
  statusBar.tooltip = "Rabbit Hole — click to open dashboard"
  const refreshStatusBar = () => {
    const today = storage.getToday()
    statusBar.text = `$(clock) ${formatDuration(today.activeTime)}`
  }
  refreshStatusBar()
  statusBar.show()
  context.subscriptions.push(statusBar)

  // Live update interval — push to dashboard every 30s if visible, refresh status bar
  const interval = setInterval(() => {
    refreshStatusBar()
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({
        type: "update",
        data: storage.getToday(),
      })
    }
  }, 30_000)

  context.subscriptions.push(
    vscode.commands.registerCommand("rabbithole.openDashboard", () => {
      DashboardPanel.createOrShow(context)
      // Wire up message handler once panel exists
      if (DashboardPanel.currentPanel) {
        DashboardPanel.currentPanel.onMessage((msg: unknown) => {
          handleMessage(msg as WebviewMessage, storage, DashboardPanel.currentPanel!)
        })
      }
    }),

    vscode.commands.registerCommand("rabbithole.toggleAgentDetection", () => {
      const config = vscode.workspace.getConfiguration("rabbithole")
      const current = config.get<boolean>("detectAgents") ?? true
      config.update("detectAgents", !current, vscode.ConfigurationTarget.Global)
      vscode.window.showInformationMessage(
        `Rabbit Hole: Agent detection ${!current ? "enabled" : "disabled"}`
      )
    }),

    { dispose: () => clearInterval(interval) }
  )
}

export function deactivate(): void {}

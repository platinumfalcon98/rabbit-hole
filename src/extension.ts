import * as vscode from "vscode"
import { StorageService } from "./tracker/storageService"
import { ActivityTracker } from "./tracker/activityTracker"
import { DashboardPanel } from "./dashboard/dashboardPanel"
import { MiniPanel } from "./dashboard/miniPanel"
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
  const tracker = new ActivityTracker(context, storage)

  tracker.start()
  storage.updateStreak()

  // First-run: prompt the user to set a daily target (fires once per install)
  const hasPrompted = context.globalState.get<boolean>("rabbithole:targetPrompted")
  if (!hasPrompted) {
    context.globalState.update("rabbithole:targetPrompted", true)
    setTimeout(() => {
      vscode.window.showInputBox({
        title: "Rabbit Hole — Daily Coding Target",
        prompt: "Set a daily active-coding target to power your streak. Leave blank to count any activity.",
        placeHolder: "Minutes per day (e.g. 60)",
        validateInput: v => {
          if (!v.trim()) return null
          const n = parseInt(v)
          return isNaN(n) || n <= 0 ? "Enter a positive number of minutes" : null
        },
      }).then(value => {
        if (!value?.trim()) return
        const mins = parseInt(value)
        if (!isNaN(mins) && mins > 0) {
          vscode.workspace
            .getConfiguration("rabbithole")
            .update("dailyTargetMinutes", mins, vscode.ConfigurationTarget.Global)
        }
      })
    }, 2000)
  }

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.command = "rabbithole.openDashboard"
  statusBar.tooltip = "Rabbit Hole — click to open dashboard"

  const refreshStatusBar = () => {
    const global = storage.getGlobalToday()
    const targetMins = vscode.workspace
      .getConfiguration("rabbithole")
      .get<number>("dailyTargetMinutes") ?? 0
    const activeText = formatDuration(global.activeTime)
    statusBar.text = targetMins > 0
      ? `🥕 ${activeText} / ${formatDuration(targetMins * 60_000)}`
      : `🥕 ${activeText}`
    statusBar.color = tracker.isActivelyTracking ? "#22c55e" : undefined
  }

  const refreshMiniPanel = () => {
    const global = storage.getGlobalToday()
    const today = storage.getToday()
    const langEntries = Object.entries(today.languages)
    const topLang = langEntries.length > 0
      ? langEntries.reduce((a, b) => a[1].time >= b[1].time ? a : b)[0]
      : ""
    miniPanel.update({
      activeTime: global.activeTime,
      streak: global.streak,
      linesAdded: today.files.reduce((s, f) => s + f.linesAdded, 0),
      linesDeleted: today.files.reduce((s, f) => s + f.linesDeleted, 0),
      topLanguage: topLang,
      sessionCount: today.sessions.length,
      isTracking: tracker.isActivelyTracking,
    })
  }

  refreshStatusBar()
  statusBar.show()
  context.subscriptions.push(statusBar)

  // Mini panel (Activity Bar sidebar) — registered after refreshMiniPanel is defined
  const miniPanel = new MiniPanel(context.extensionUri)
  miniPanel.setOnReady(() => refreshMiniPanel())
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MiniPanel.viewId, miniPanel)
  )

  // Live update interval — update streak, push to dashboard, refresh status bar & mini panel
  const interval = setInterval(() => {
    storage.updateStreak()
    refreshStatusBar()
    refreshMiniPanel()
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({
        type: "update",
        data: storage.getToday(),
        projectId: storage.getCurrentProjectId(),
      })
    }
  }, 10_000)

  context.subscriptions.push(
    vscode.commands.registerCommand("rabbithole.openDashboard", () => {
      DashboardPanel.createOrShow(context)
      if (DashboardPanel.currentPanel) {
        DashboardPanel.currentPanel.onMessage((msg: unknown) => {
          handleMessage(msg as WebviewMessage, storage, DashboardPanel.currentPanel!)
        })
      }
    }),

    { dispose: () => clearInterval(interval) }
  )
}

export function deactivate(): void {}

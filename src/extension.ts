import * as vscode from "vscode"
import { StorageService, dateKey } from "./tracker/storageService"
import { ActivityTracker } from "./tracker/activityTracker"
import { DashboardPanel } from "./dashboard/dashboardPanel"
import { MiniPanel } from "./dashboard/miniPanel"
import { handleMessage } from "./dashboard/messageHandler"
import { MirrorService } from "./tracker/mirrorService"
import { getDailyTargetMs } from "./shared/config"
import { WebviewMessage } from "./shared/types"

let mirror: MirrorService | null = null

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function activate(context: vscode.ExtensionContext): void {
  const storage = new StorageService(context)
  mirror = new MirrorService(context)
  storage.setMirror(mirror)
  mirror.start()

  const tracker = new ActivityTracker(context, storage)
  storage.setSessionDiscardHook(() => tracker.discardCurrentSession())

  tracker.start()
  storage.updateStreak()
  storage.updateProjectStreak(storage.getCurrentProjectId())

  // Prompt for a daily target once, for anyone who has never chosen one. The
  // default moved 5 → 20 in v0.4.0, so this also covers existing installs whose
  // visible streak chain is about to recompute against the higher target.
  // `rabbithole:targetPrompted` is already true everywhere and cannot carry it.
  const hasMigrated = context.globalState.get<boolean>("rabbithole:targetDefaultMigrated")
  const inspected = vscode.workspace
    .getConfiguration("rabbithole")
    .inspect<number>("dailyTargetMinutes")
  const neverChosen = inspected?.globalValue === undefined
    && inspected?.workspaceValue === undefined
    && inspected?.workspaceFolderValue === undefined
  if (!hasMigrated && neverChosen) {
    context.globalState.update("rabbithole:targetDefaultMigrated", true)
    setTimeout(() => {
      vscode.window.showInputBox({
        title: "Rabbit Hole — Daily Coding Target",
        prompt: "Set your daily active-coding target. Days that reach it extend your streak.",
        placeHolder: "Minutes per day (default 20)",
        validateInput: v => {
          if (!v.trim()) return null
          const n = parseInt(v)
          return isNaN(n) || n < 1 || n > 1440 ? "Enter a number of minutes between 1 and 1440" : null
        },
      }).then(value => {
        if (!value?.trim()) return
        const mins = parseInt(value)
        if (!isNaN(mins) && mins >= 1 && mins <= 1440) {
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
    const activeText = formatDuration(global.activeTime)
    statusBar.text = `🥕 ${activeText} / ${formatDuration(getDailyTargetMs())}`
    statusBar.color = tracker.isActivelyTracking ? "#22c55e" : undefined
  }

  const refreshMiniPanel = () => {
    const global = storage.getGlobalToday()
    const today = storage.getToday()
    const todayKey = dateKey(new Date())
    const aggregate = storage.getAggregateRangeByDates(todayKey, todayKey)
    const aggToday = aggregate[0]
    const langEntries = Object.entries(today.languages)
    const topLang = langEntries.length > 0
      ? langEntries.reduce((a, b) => a[1].time >= b[1].time ? a : b)[0]
      : ""
    const projects = storage.getProjects()
    const projectActiveTimes: Record<string, number> = {}
    const projectNames: Record<string, string> = {}
    for (const p of projects) {
      const pLog = storage.getRangeByDates(todayKey, todayKey, p.id)[0]
      if (pLog && pLog.activeTime > 0) {
        projectActiveTimes[p.id] = pLog.activeTime
        projectNames[p.id] = p.name
      }
    }
    miniPanel.update({
      activeTime: global.activeTime,
      streak: global.streak,
      linesAdded: aggToday?.files.reduce((s, f) => s + f.linesAdded, 0) ?? 0,
      linesDeleted: aggToday?.files.reduce((s, f) => s + f.linesDeleted, 0) ?? 0,
      topLanguage: topLang,
      sessionCount: today.sessions.length,
      isTracking: tracker.isActivelyTracking,
      projectActiveTimes,
      projectNames,
      dailySeries: storage.getGlobalActiveSeries(7),
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
    storage.updateProjectStreak(storage.getCurrentProjectId())
    refreshStatusBar()
    refreshMiniPanel()
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({
        type: "update",
        data: storage.getToday(),
        projectId: storage.getCurrentProjectId(),
        globalToday: storage.getGlobalToday(),
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

export function deactivate(): Thenable<void> | undefined {
  // Returned so VS Code waits for the last debounced mirror write to land.
  const pending = mirror?.dispose()
  mirror = null
  return pending
}

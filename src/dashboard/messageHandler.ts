import * as fs from "fs/promises"
import * as vscode from "vscode"
import { DailyLog, WebviewMessage } from "../shared/types"
import { getDailyTargetMinutes, getDailyTargetMs, getIdleThresholdMs } from "../shared/config"
import {
  PROJECTS_KEY,
  SnapshotSummary,
  StorageService,
  scopeSnapshotToProjects,
  validateSnapshot,
} from "../tracker/storageService"
import { DashboardPanel } from "./dashboardPanel"

// Module-level view state — persists for the lifetime of the panel
let currentStartDate = ""
let currentEndDate = ""
let currentProjectIds: string[] = []   // [] = current project, ["all"] = aggregate, [ids] = multi

function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function offsetDateStr(daysOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function presetToDates(
  preset: string,
  customStart?: string,
  customEnd?: string
): { start: string; end: string } {
  const today = todayStr()
  switch (preset) {
    case "today":  return { start: today, end: today }
    case "7d":     return { start: offsetDateStr(-6), end: today }
    case "30d":    return { start: offsetDateStr(-29), end: today }
    case "90d":    return { start: offsetDateStr(-89), end: today }
    case "1y":     return { start: offsetDateStr(-364), end: today }
    case "custom":
      if (customStart && customEnd) return { start: customStart, end: customEnd }
      return { start: today, end: today }
    default:       return { start: today, end: today }
  }
}

export function handleMessage(
  msg: WebviewMessage,
  storage: StorageService,
  panel: DashboardPanel
): void {
  switch (msg.type) {
    case "ready": {
      const today = todayStr()
      currentStartDate = today
      currentEndDate = today
      currentProjectIds = []
      // Settings first: the webview's dailyTargetMs starts at 0, and sendInit
      // triggers the first streak render, which needs the real target.
      sendSettings(storage, panel)
      sendInit(storage, panel)
      break
    }

    case "requestRange": {
      const { start, end } = presetToDates(msg.preset, msg.customStart, msg.customEnd)
      currentStartDate = start
      currentEndDate = end
      sendInit(storage, panel)
      break
    }

    case "selectProjects": {
      currentProjectIds = msg.projectIds
      sendInit(storage, panel)
      break
    }

    case "export": {
      const content = msg.format === "csv"
        ? storage.exportCSV()
        : storage.exportJSON()
      const ext = msg.format === "csv" ? "csv" : "json"
      writeExport(content, ext)
      break
    }

    case "exportPdfRequest": {
      const { start, end } = presetToDates(msg.preset, msg.customStart, msg.customEnd)

      const exportPid = msg.exportProjectId ?? currentProjectIds[0] ?? "all"
      // Fetch back to the Monday-aligned start of the report's heatmap grid
      // (5 weeks for today/30d, 13 weeks for 90d), not just the stat range.
      const heatmapStart = offsetDateStr(msg.preset === "90d" ? -96 : -34)
      const logs = exportPid === "all"
        ? storage.getAggregateRangeByDates(heatmapStart, end)
        : storage.getRangeByDates(heatmapStart, end, exportPid)

      const projects = storage.getProjects()
      const pid = exportPid
      const projectName = pid === "all" ? "All Projects"
        : projects.find(p => p.id === pid)?.name ?? "Rabbit Hole"

      const from = new Date(start + "T00:00:00").toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" })
      const to   = new Date(end   + "T00:00:00").toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" })

      panel.postMessage({ type: "pdfData", logs, projectName, dateRange: { from, to } })
      break
    }

    case "writePdf":
      writePdfExport(msg.base64, msg.projectName)
      break

    case "writeJpg":
      writeJpgExport(msg.base64, msg.projectName)
      break

    case "updateSetting": {
      const cfg = vscode.workspace.getConfiguration("rabbithole")
      cfg.update(msg.key, msg.value, vscode.ConfigurationTarget.Global).then(() => {
        // Config writes are async; re-reading before this settles returns the old value.
        storage.updateStreak()
        storage.updateProjectStreak(storage.getCurrentProjectId())
        sendSettings(storage, panel)
      })
      break
    }

    case "updateProjectSetting": {
      storage.updateProjectTarget(msg.projectId, msg.value)
      storage.updateProjectStreak(msg.projectId)
      sendInit(storage, panel)
      break
    }

    case "revealStorage": {
      const dir = storage.getStoragePath()
      // The mirror dir is created lazily on the first flush, so it may not
      // exist yet — revealFileInOS on a missing path silently does nothing.
      fs.mkdir(dir, { recursive: true }).then(() => {
        vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(dir))
      })
      break
    }

    case "createBackup": {
      runBackup(storage, msg.scope)
      break
    }

    case "importData": {
      runImport(storage, panel, msg.scope)
      break
    }

    case "clearProject": {
      const name = storage.getProjects().find(p => p.id === msg.projectId)?.name ?? "project"
      storage.clearProject(msg.projectId).then(() => {
        refreshAfterWipe(storage, panel)
        vscode.window.showInformationMessage(
          `Rabbit Hole: Cleared "${name}". Backup saved to ${storage.getLastBackupPath()}`
        )
      })
      break
    }

    case "clearAll": {
      storage.clearAll().then(() => {
        refreshAfterWipe(storage, panel)
        vscode.window.showInformationMessage(
          `Rabbit Hole: All data cleared. Backup saved to ${storage.getLastBackupPath()}`
        )
      })
      break
    }
  }
}

async function runBackup(storage: StorageService, scope: "projects" | "all"): Promise<void> {
  let projectIds: string[] | undefined
  let label: string | undefined

  if (scope === "projects") {
    const projects = storage.getProjects()
    if (projects.length === 0) {
      vscode.window.showErrorMessage("Rabbit Hole: There are no projects to back up yet.")
      return
    }
    const picks = await vscode.window.showQuickPick(
      projects.map(p => ({ label: p.name, id: p.id, picked: false })),
      {
        canPickMany: true,
        title: "Back up projects",
        placeHolder: "Tick the projects to include in this backup",
      }
    )
    if (!picks || picks.length === 0) return
    projectIds = picks.map(p => p.id)
    label = picks.length === 1 ? picks[0].label : `${picks.length}-projects`
  }

  const file = await storage.backupToDisk(projectIds, label)
  const what = projectIds
    ? `${projectIds.length} ${projectIds.length === 1 ? "project" : "projects"}`
    : "Full"
  const choice = await vscode.window.showInformationMessage(
    `Rabbit Hole: ${what} backup saved to ${file}`,
    "Reveal"
  )
  if (choice === "Reveal") {
    vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(file))
  }
}

async function runImport(
  storage: StorageService,
  panel: DashboardPanel,
  scope: "projects" | "all"
): Promise<void> {
  // Open in the backups folder — it is buried in globalStorage, and a restore
  // almost always wants a file this extension wrote. The dir is created lazily
  // by the first backup, and a defaultUri pointing at a missing path is ignored.
  const backupsDir = storage.getBackupsPath()
  await fs.mkdir(backupsDir, { recursive: true })

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(backupsDir),
    openLabel: scope === "all" ? "Restore all" : "Choose projects",
    title: scope === "all" ? "Restore everything from a backup" : "Restore projects from a backup",
    filters: { "Rabbit Hole backup": ["json"] },
  })
  if (!picked || picked.length === 0) return

  let summary: SnapshotSummary | null = null
  let snapshot: Record<string, unknown> = {}
  try {
    snapshot = JSON.parse(await fs.readFile(picked[0].fsPath, "utf8"))
    summary = validateSnapshot(snapshot)
  } catch {
    summary = null
  }
  if (!summary) {
    vscode.window.showErrorMessage(
      "Rabbit Hole: That file isn't a Rabbit Hole backup. Pick a backup-<date>.json from the backups folder."
    )
    return
  }

  // A backup is whole-store. "Restore everything" takes it as-is; "Restore some
  // projects" narrows it, because importing all of them would revert every
  // other project to its state when the backup was taken. The scope is chosen
  // in Settings before the file picker, so it is never a surprise here.
  let selectedIds = summary.projects.map(p => p.id)
  if (scope === "projects" && summary.projects.length > 1) {
    const known = new Map(storage.getProjects().map(p => [p.id, p.name]))
    const inSnapshot = new Map(
      (Array.isArray(snapshot[PROJECTS_KEY]) ? (snapshot[PROJECTS_KEY] as { id: string; name: string }[]) : [])
        .filter(p => p && typeof p.id === "string")
        .map(p => [p.id, p.name])
    )
    const picks = await vscode.window.showQuickPick(
      summary.projects.map(p => ({
        label: inSnapshot.get(p.id) ?? known.get(p.id) ?? p.id,
        description: `${p.days} ${p.days === 1 ? "day" : "days"}`,
        detail: known.has(p.id) ? undefined : "Not currently on this machine — will be added",
        id: p.id,
        // Nothing pre-selected: this row exists to restore specific projects,
        // so each one should be a deliberate tick. "Restore everything" is the
        // separate action for the all-of-it case.
        picked: false,
      })),
      {
        canPickMany: true,
        title: "Restore projects",
        placeHolder: "Tick the projects to restore — everything unticked is left untouched",
      }
    )
    if (!picks || picks.length === 0) return
    selectedIds = picks.map(p => p.id)
  }

  const scoped = scopeSnapshotToProjects(snapshot, selectedIds)
  const scopedSummary = validateSnapshot(scoped)
  if (!scopedSummary) {
    vscode.window.showErrorMessage("Rabbit Hole: Nothing to import from that selection.")
    return
  }

  const projectWord = scopedSummary.projects.length === 1 ? "project" : "projects"
  const dayWord = scopedSummary.dates.length === 1 ? "day" : "days"
  const names = scopedSummary.projects.length <= 3
    ? scopedSummary.projects
        .map(p => storage.getProjects().find(q => q.id === p.id)?.name ?? p.id)
        .join(", ")
    : `${scopedSummary.projects.length} ${projectWord}`
  const confirmLabel = scope === "all" ? "Restore all" : "Restore"
  // Native modal rather than the webview's type-to-confirm gate: the flow has
  // already left the webview for the file picker.
  const choice = await vscode.window.showWarningMessage(
    scope === "all"
      ? `Restore all ${scopedSummary.projects.length} ${projectWord} from this backup?`
      : `Restore ${names} across ${scopedSummary.dates.length} ${dayWord}?`,
    {
      modal: true,
      detail:
        scope === "all"
          ? `Every project in this backup replaces what is on this machine, across ${scopedSummary.dates.length} ${dayWord} — anything they have tracked since the backup was written is lost. Projects that are not in the backup are left untouched. A backup of your current data is written first.`
          : "Only the projects you selected are touched. Everything else on this machine — including projects in this backup that you did not select — is left exactly as it is. A backup of your current data is written first.",
    },
    confirmLabel
  )
  // Anything other than the action button — Cancel, Esc, dismiss — aborts.
  if (choice !== confirmLabel) return

  const ok = await storage.importSnapshot(scoped)
  if (!ok) {
    vscode.window.showErrorMessage("Rabbit Hole: Import failed — nothing was changed.")
    return
  }
  refreshAfterWipe(storage, panel)
  vscode.window.showInformationMessage(
    `Rabbit Hole: Restored ${names}. Previous data backed up to ${storage.getLastBackupPath()}`
  )
}

// Settings before init for the same reason as the ready case: sendInit renders
// the streak, which needs the target the settings message carries.
function refreshAfterWipe(storage: StorageService, panel: DashboardPanel): void {
  sendSettings(storage, panel)
  sendInit(storage, panel)
}

function sendSettings(storage: StorageService, panel: DashboardPanel): void {
  const dailyTargetMinutes = getDailyTargetMinutes()
  panel.postMessage({
    type: "settings",
    dailyTargetMs: getDailyTargetMs(),
    dailyTargetMinutes,
    idleThresholdMinutes: Math.round(getIdleThresholdMs() / 60_000),
    storagePath: storage.getStoragePath(),
  })
}

function sendInit(storage: StorageService, panel: DashboardPanel): void {
  const start = currentStartDate
  const end = currentEndDate

  let data: DailyLog[]
  let resolvedProjectId: string

  if (currentProjectIds.length === 0) {
    data = storage.getRangeByDates(start, end)
    resolvedProjectId = storage.getCurrentProjectId()
  } else if (currentProjectIds[0] === "all") {
    data = storage.getAggregateRangeByDates(start, end)
    resolvedProjectId = "all"
  } else if (currentProjectIds.length === 1) {
    data = storage.getRangeByDates(start, end, currentProjectIds[0])
    resolvedProjectId = currentProjectIds[0]
  } else {
    data = storage.getMultiProjectRangeByDates(start, end, currentProjectIds)
    resolvedProjectId = "all"
  }

  // Compute latest session timestamp + today's active time per project from aggregate logs
  const projectTimestamps: Record<string, number> = {}
  const projectActiveTimes: Record<string, number> = {}
  const allLogs = storage.getAggregateRangeByDates(start, end)
  const todayKey = todayStr()
  for (const log of allLogs) {
    for (const session of log.sessions) {
      const pid = session.projectId
      if (!pid) continue
      const ts = session.endTime ?? session.startTime
      if (!projectTimestamps[pid] || ts > projectTimestamps[pid]) {
        projectTimestamps[pid] = ts
      }
      if (log.date === todayKey) {
        projectActiveTimes[pid] = (projectActiveTimes[pid] ?? 0) + session.activeTime
      }
    }
  }

  const yearStart = offsetDateStr(-364)
  const today = todayStr()
  let heatmapData: DailyLog[]
  if (currentProjectIds.length === 0) {
    heatmapData = storage.getRangeByDates(yearStart, today)
  } else if (currentProjectIds[0] === "all") {
    heatmapData = storage.getAggregateRangeByDates(yearStart, today)
  } else if (currentProjectIds.length === 1) {
    heatmapData = storage.getRangeByDates(yearStart, today, currentProjectIds[0])
  } else {
    heatmapData = storage.getMultiProjectRangeByDates(yearStart, today, currentProjectIds)
  }

  panel.postMessage({
    type: "init",
    data,
    heatmapData,
    projects: storage.getProjects(),
    currentProjectId: resolvedProjectId,
    projectTimestamps,
    projectActiveTimes,
  })
}

function exportFilename(projectName: string, ext: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
  const date = todayStr().replace(/-/g, "")
  return `rabbit_hole_${slug}_${date}.${ext}`
}

async function writePdfExport(base64: string, projectName: string): Promise<void> {
  const filename = exportFilename(projectName, "pdf")
  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri
    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filename)
    : undefined

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "PDF Files": ["pdf"] },
  })

  if (!uri) return

  const bytes = Buffer.from(base64, "base64")
  await vscode.workspace.fs.writeFile(uri, bytes)
  vscode.window.showInformationMessage(`Rabbit Hole: Report exported to ${uri.fsPath}`)
}

async function writeJpgExport(base64: string, projectName: string): Promise<void> {
  const filename = exportFilename(projectName, "jpg")
  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri
    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filename)
    : undefined

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "JPEG Images": ["jpg", "jpeg"] },
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

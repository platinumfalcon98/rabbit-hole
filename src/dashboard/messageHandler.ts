import * as fs from "fs/promises"
import * as vscode from "vscode"
import { DailyLog, WebviewMessage } from "../shared/types"
import { getDailyTargetMinutes, getDailyTargetMs, getIdleThresholdMs } from "../shared/config"
import { StorageService } from "../tracker/storageService"
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

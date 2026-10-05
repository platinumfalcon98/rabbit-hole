import * as fs from "fs/promises"
import * as os from "os"
import * as vscode from "vscode"
import { ExportExt, safeFileName } from "../shared/exportName"
import { WebviewMessage } from "../shared/types"
import { crtSettingValue, getCrtSettings, getDailyTargetMinutes, getDailyTargetMs, getIdleThresholdMs } from "../shared/config"
import {
  PROJECTS_KEY,
  SnapshotSummary,
  StorageService,
  scopeSnapshotToProjects,
  validateSnapshot,
} from "../tracker/storageService"
import { DashboardPanel } from "./dashboardPanel"
import { MAX_RANGE_DAYS, buildRange, buildYear, isValidRange } from "./payloads"

// A 3× share card is about 1 MB and a report a few hundred KB; anything near
// this is not something the dialog drew.
const MAX_FILE_BASE64 = 40 * 1024 * 1024

export function handleMessage(
  msg: WebviewMessage,
  storage: StorageService,
  panel: DashboardPanel
): void {
  switch (msg.type) {
    case "ready": {
      // Settings first: the webview needs the target before it draws a streak.
      sendSettings(storage, panel)
      postYear(storage, panel)
      break
    }

    case "requestYear":
      postYear(storage, panel)
      break

    case "requestDays": {
      const range = buildRange(storage, msg.from, msg.to)
      // the export dialog's fetch is tagged so the dashboard's view never adopts it
      const tag = msg.for === "export" ? { for: "export" as const } : {}
      panel.postMessage(range
        ? { type: "range", ...range, ...tag }
        : { type: "rangeRefused", from: msg.from, to: msg.to, ...tag })
      break
    }

    case "export": {
      // No range is the long-standing 90-day export; a given range must be a real one.
      if ((msg.from !== undefined || msg.to !== undefined) && !(msg.from && msg.to && isValidRange(msg.from, msg.to))) {
        tell(panel, false, `Rabbit Hole: Export needs a date range of at most ${MAX_RANGE_DAYS} days.`)
        break
      }
      const content = msg.format === "csv"
        ? storage.exportCSV(msg.from, msg.to, msg.projectId)
        : storage.exportJSON(msg.from, msg.to, msg.projectId)
      void saveFile(panel, new TextEncoder().encode(content), safeFileName(msg.name ?? "rabbit-hole-export", msg.format), msg.format)
      break
    }

    case "writeFile": {
      // The webview is trusted with drawing, not with the file system.
      if (msg.kind !== "jpg" && msg.kind !== "pdf") {
        tell(panel, false, "Rabbit Hole: Export failed: unknown file type.")
        break
      }
      const bytes = typeof msg.base64 === "string" && msg.base64.length <= MAX_FILE_BASE64 ? Buffer.from(msg.base64, "base64") : null
      if (!bytes || bytes.length === 0) {
        tell(panel, false, "Rabbit Hole: Export failed: the file was empty or too large.")
        break
      }
      void saveFile(panel, bytes, safeFileName(msg.name, msg.kind), msg.kind)
      break
    }

    case "updateSetting": {
      const cfg = vscode.workspace.getConfiguration("rabbithole")
      cfg.update(msg.key, msg.value, vscode.ConfigurationTarget.Global).then(() => {
        // Config writes are async; re-reading before this settles returns the old value.
        storage.updateStreak()
        storage.updateProjectStreak(storage.getCurrentProjectId())
        sendSettings(storage, panel)
        postYear(storage, panel)
      })
      break
    }

    case "updateCrtSetting": {
      // a value the manifest would reject never reaches settings.json
      const value = crtSettingValue(msg.key, msg.value)
      if (value === null) break
      vscode.workspace.getConfiguration("rabbithole")
        .update(`crt.${msg.key}`, value, vscode.ConfigurationTarget.Global)
        .then(
          () => sendSettings(storage, panel),
          err => tell(panel, false, `Rabbit Hole: Couldn't save the display setting (${err instanceof Error ? err.message : String(err)}).`),
        )
      break
    }

    case "updateProjectSetting": {
      storage.updateProjectTarget(msg.projectId, msg.value)
      storage.updateProjectStreak(msg.projectId)
      postYear(storage, panel)
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
      runBackup(storage, panel, msg.scope)
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
        tell(panel, true, `Rabbit Hole: Cleared "${name}". Backup saved to ${storage.getLastBackupPath()}`)
      })
      break
    }

    case "clearAll": {
      storage.clearAll().then(() => {
        refreshAfterWipe(storage, panel)
        tell(panel, true, `Rabbit Hole: All data cleared. Backup saved to ${storage.getLastBackupPath()}`)
      })
      break
    }
  }
}

async function runBackup(storage: StorageService, panel: DashboardPanel, scope: "projects" | "all"): Promise<void> {
  let projectIds: string[] | undefined
  let label: string | undefined

  if (scope === "projects") {
    const projects = storage.getProjects()
    if (projects.length === 0) {
      tell(panel, false, "Rabbit Hole: There are no projects to back up yet.")
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
  panel.postMessage({ type: "actionResult", ok: true, lines: [`${what} backup saved to ${file}`] })
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
    tell(panel, false, "Rabbit Hole: That file isn't a Rabbit Hole backup. Pick a backup-<date>.json from the backups folder.")
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
    tell(panel, false, "Rabbit Hole: Nothing to import from that selection.")
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
    tell(panel, false, "Rabbit Hole: Import failed — nothing was changed.")
    return
  }
  refreshAfterWipe(storage, panel)
  tell(panel, true, `Rabbit Hole: Restored ${names}. Previous data backed up to ${storage.getLastBackupPath()}`)
}

// Settings before the year: the webview needs the target before it draws a streak.
function refreshAfterWipe(storage: StorageService, panel: DashboardPanel): void {
  sendSettings(storage, panel)
  postYear(storage, panel)
}

export function sendSettings(storage: StorageService, panel: DashboardPanel): void {
  const dailyTargetMinutes = getDailyTargetMinutes()
  panel.postMessage({
    type: "settings",
    dailyTargetMs: getDailyTargetMs(),
    dailyTargetMinutes,
    idleThresholdMinutes: Math.round(getIdleThresholdMs() / 60_000),
    storagePath: storage.getStoragePath(),
    crt: getCrtSettings(),
  })
}

// Settings edited outside the dashboard (settings.json, the Settings UI) must
// reach it too. A daily target change re-judges today's streak and every day of
// the year, so it updates the streaks and resends the year as well.
export function onConfigChanged(
  affects: (section: string) => boolean,
  storage: StorageService,
  panel: DashboardPanel
): void {
  if (!affects("rabbithole")) return
  const targetChanged = affects("rabbithole.dailyTargetMinutes")
  if (targetChanged) {
    storage.updateStreak()
    storage.updateProjectStreak(storage.getCurrentProjectId())
  }
  sendSettings(storage, panel)
  if (targetChanged) postYear(storage, panel)
}

export function postYear(storage: StorageService, panel: DashboardPanel): void {
  panel.postMessage({ type: "year", ...buildYear(storage, new Date(), getDailyTargetMs()) })
}

// Shows the result the way it always has, and also hands it to the dashboard's
// Settings output console so the user can see what an action actually did.
function tell(panel: DashboardPanel, ok: boolean, text: string): void {
  if (ok) vscode.window.showInformationMessage(text)
  else vscode.window.showErrorMessage(text)
  panel.postMessage({ type: "actionResult", ok, lines: [text.replace(/^Rabbit Hole: /, "")] })
}

const FILTERS: Record<ExportExt, Record<string, string[]>> = {
  jpg: { "JPEG Images": ["jpg", "jpeg"] },
  pdf: { "PDF Files": ["pdf"] },
  csv: { "CSV Files": ["csv"] },
  json: { "JSON Files": ["json"] },
}

// Every export ends in an actionResult, so the dialog and the settings console
// always hear how it went.
async function saveFile(panel: DashboardPanel, bytes: Uint8Array, name: string, ext: ExportExt): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir())
  const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(folder, name), filters: FILTERS[ext] })
  if (!uri) {
    panel.postMessage({ type: "actionResult", ok: true, lines: ["export cancelled, nothing written"] })
    return
  }
  try {
    await vscode.workspace.fs.writeFile(uri, bytes)
    tell(panel, true, `Rabbit Hole: Saved ${uri.fsPath}`)
  } catch (err) {
    tell(panel, false, `Rabbit Hole: Couldn't save ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

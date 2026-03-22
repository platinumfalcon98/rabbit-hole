import { DailyLog, ExtensionMessage, ProjectMeta } from "../shared/types"
import * as heatmap from "./heatmap"
import * as charts from "./charts"
import { generatePdf, PdfOptions } from "./pdfExport"

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

const vscode = acquireVsCodeApi()

let currentLogs: DailyLog[] = []
let dailyTargetMs = 0
let currentProjectId = ""
let projects: ProjectMeta[] = []

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function shortenPath(fullPath: string, segments = 3): string {
  const parts = fullPath.split(/[/\\]/).filter(Boolean)
  return parts.slice(-segments).join("/")
}

function projectName(projectId: string): string {
  const p = projects.find(x => x.id === projectId)
  return p ? p.name : projectId
}

// ── Tabs ───────────────────────────────────────────────────────────────────

let activeTab = "overview"

function switchTab(tab: string): void {
  activeTab = tab
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.tab === tab)
  })
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${tab}`)
  })
  // Charts need a resize call when their panel becomes visible
  if (tab === "activity" || tab === "code") {
    requestAnimationFrame(() => charts.resizeAll())
  }
  if (tab === "projects") {
    renderProjectsTab()
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("nav-items")?.addEventListener("click", e => {
    const btn = (e.target as HTMLElement).closest(".nav-item") as HTMLElement | null
    if (!btn?.dataset.tab) return
    switchTab(btn.dataset.tab)
  })
})

// ── Sidebar ────────────────────────────────────────────────────────────────

function renderSidebar(ps: ProjectMeta[], activeId: string): void {
  const list = document.getElementById("project-list")
  if (!list) return

  list.innerHTML = `<li class="project-item${activeId === "all" ? " active" : ""}" data-id="all">All Projects</li>`

  for (const p of ps) {
    const li = document.createElement("li")
    li.className = "project-item" + (activeId === p.id ? " active" : "")
    li.dataset.id = p.id
    li.title = p.path
    li.textContent = p.name
    list.appendChild(li)
  }
}

document.addEventListener("click", e => {
  // Project item click
  const projectItem = (e.target as HTMLElement).closest(".project-item") as HTMLElement | null
  if (projectItem) {
    vscode.postMessage({ type: "selectProject", projectId: projectItem.dataset.id ?? "" })
    return
  }
  // Sidebar toggle
  if ((e.target as HTMLElement).closest("#sidebar-toggle")) {
    document.getElementById("sidebar")?.classList.toggle("collapsed")
  }
})

// ── Stat cards ─────────────────────────────────────────────────────────────

function updateStatCards(log: DailyLog | undefined): void {
  if (!log) return

  const timeEl = document.getElementById("stat-time")
  const addedEl = document.getElementById("stat-added")
  const deletedEl = document.getElementById("stat-deleted")
  const streakEl = document.getElementById("streak-count")
  const streakTargetEl = document.getElementById("streak-target")

  if (timeEl) timeEl.textContent = formatDuration(log.activeTime)
  if (addedEl) {
    const total = log.files.reduce((s, f) => s + f.linesAdded, 0)
    addedEl.textContent = String(total)
  }
  if (deletedEl) {
    const total = log.files.reduce((s, f) => s + f.linesDeleted, 0)
    deletedEl.textContent = String(total)
  }
  if (streakEl) streakEl.textContent = String(log.streak)

  const pill = document.getElementById("streak-pill")
  if (dailyTargetMs > 0) {
    const met = log.activeTime >= dailyTargetMs
    pill?.classList.toggle("streak-at-risk", !met)
    if (streakTargetEl) {
      streakTargetEl.textContent = met
        ? " · ✓"
        : ` · ${formatDuration(log.activeTime)} / ${formatDuration(dailyTargetMs)}`
      streakTargetEl.className = met ? "streak-target-met" : "streak-target-pending"
    }
  } else {
    pill?.classList.remove("streak-at-risk")
    if (streakTargetEl) streakTargetEl.textContent = ""
  }
}

// ── Files ──────────────────────────────────────────────────────────────────

function aggregateFiles(logs: DailyLog[]) {
  const map = new Map<string, { path: string; language: string; linesAdded: number; linesDeleted: number; projectId?: string }>()
  for (const log of logs) {
    for (const file of log.files) {
      const key = file.projectId ? `${file.projectId}::${file.path}` : file.path
      const existing = map.get(key)
      if (existing) {
        existing.linesAdded += file.linesAdded
        existing.linesDeleted += file.linesDeleted
      } else {
        map.set(key, { path: file.path, language: file.language, linesAdded: file.linesAdded, linesDeleted: file.linesDeleted, projectId: file.projectId })
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => (b.linesAdded + b.linesDeleted) - (a.linesAdded + a.linesDeleted))
    .slice(0, 30)
}

function renderFiles(logs: DailyLog[]): void {
  const container = document.getElementById("files-list")
  if (!container) return

  const files = aggregateFiles(logs)
  if (files.length === 0) {
    container.innerHTML = `<div class="empty-state">No file activity yet</div>`
    return
  }

  const isAggregate = currentProjectId === "all"

  container.innerHTML = files.map(f => `
    <div class="file-row">
      <span class="file-path" title="${f.path}">${shortenPath(f.path)}</span>
      ${isAggregate && f.projectId ? `<span class="file-project">${projectName(f.projectId)}</span>` : ""}
      <span class="file-lang">${f.language}</span>
      <span class="file-add">+${f.linesAdded}</span>
      <span class="file-del">-${f.linesDeleted}</span>
    </div>`).join("")
}

// ── Sessions ───────────────────────────────────────────────────────────────

function renderSessions(logs: DailyLog[]): void {
  const container = document.getElementById("sessions-list")
  if (!container) return
  container.innerHTML = ""

  const isAggregate = currentProjectId === "all"
  const sorted = [...logs].reverse()
  const hasSessions = sorted.some(log => log.sessions.some(s => s.activeTime > 0 || s.endTime !== null))
  if (!hasSessions) {
    container.innerHTML = `<div class="empty-state">No sessions recorded yet</div>`
    return
  }

  for (const log of sorted) {
    const sessions = log.sessions.filter(s => s.activeTime > 0 || s.endTime !== null)
    if (sessions.length === 0) continue

    const dateHeader = document.createElement("div")
    dateHeader.className = "sessions-date"
    dateHeader.textContent = log.date
    container.appendChild(dateHeader)

    for (const session of sessions) {
      const row = document.createElement("div")
      row.className = "session-row"
      const end = session.endTime ? formatTime(session.endTime) : "ongoing"
      const projectTag = isAggregate && session.projectId
        ? `<span class="session-project">${projectName(session.projectId)}</span>`
        : ""
      row.innerHTML =
        `<span class="session-time">${formatTime(session.startTime)} – ${end}</span>` +
        projectTag +
        `<span class="session-active">${formatDuration(session.activeTime)} active</span>`
      container.appendChild(row)
    }
  }
}

// ── Projects tab ───────────────────────────────────────────────────────────

interface ProjectSummary {
  id: string
  name: string
  path: string
  activeTime: number
  linesAdded: number
  linesDeleted: number
  lastActive: string
}

function computeProjectSummaries(): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>()

  // Seed from projects registry so we show all even with zero activity
  for (const p of projects) {
    map.set(p.id, { id: p.id, name: p.name, path: p.path, activeTime: 0, linesAdded: 0, linesDeleted: 0, lastActive: "" })
  }

  for (const log of currentLogs) {
    for (const session of log.sessions) {
      const pid = session.projectId ?? currentProjectId
      if (!pid || pid === "all") continue
      if (!map.has(pid)) {
        map.set(pid, { id: pid, name: projectName(pid), path: "", activeTime: 0, linesAdded: 0, linesDeleted: 0, lastActive: "" })
      }
      const s = map.get(pid)!
      s.activeTime += session.activeTime
      if (!s.lastActive || log.date > s.lastActive) s.lastActive = log.date
    }
    for (const file of log.files) {
      const pid = file.projectId ?? currentProjectId
      if (!pid || pid === "all") continue
      if (!map.has(pid)) continue
      const s = map.get(pid)!
      s.linesAdded += file.linesAdded
      s.linesDeleted += file.linesDeleted
    }
  }

  return [...map.values()].sort((a, b) => b.activeTime - a.activeTime)
}

function renderProjectsTab(): void {
  const container = document.getElementById("project-cards")
  if (!container) return

  const summaries = computeProjectSummaries()
  if (summaries.length === 0) {
    container.innerHTML = `<div class="empty-state">No projects tracked yet</div>`
    return
  }

  container.innerHTML = summaries.map(p => `
    <div class="project-card" data-id="${p.id}" title="Click to view this project">
      <div class="project-card-header">
        <span class="project-card-name">${p.name}</span>
        ${p.lastActive ? `<span class="project-card-last">Last active ${p.lastActive}</span>` : ""}
      </div>
      <div class="project-card-path">${shortenPath(p.path, 4)}</div>
      <div class="project-card-stats">
        <span class="pstat"><span class="pstat-label">Active</span> <span class="pstat-val">${formatDuration(p.activeTime)}</span></span>
        <span class="pstat"><span class="pstat-label">Added</span> <span class="pstat-val add">+${p.linesAdded}</span></span>
        <span class="pstat"><span class="pstat-label">Deleted</span> <span class="pstat-val del">-${p.linesDeleted}</span></span>
      </div>
    </div>`).join("")

  // Click on a project card to filter
  container.querySelectorAll(".project-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = (card as HTMLElement).dataset.id ?? ""
      vscode.postMessage({ type: "selectProject", projectId: id })
      switchTab("overview")
    })
  })
}

// ── Full render ────────────────────────────────────────────────────────────

function renderAll(): void {
  heatmap.render(currentLogs)
  charts.renderAll(currentLogs)
  updateStatCards(currentLogs[currentLogs.length - 1])
  renderSessions(currentLogs)
  renderFiles(currentLogs)
  if (activeTab === "projects") renderProjectsTab()
}

// ── Message handling ───────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  vscode.postMessage({ type: "ready" })
})

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as ExtensionMessage
  switch (msg.type) {
    case "init":
      currentLogs = msg.data
      projects = msg.projects
      currentProjectId = msg.currentProjectId
      renderSidebar(projects, currentProjectId)
      renderAll()
      break

    case "update": {
      if (currentProjectId !== "all" && msg.projectId === (currentProjectId || "")) {
        const todayIdx = currentLogs.findIndex(l => l.date === msg.data.date)
        if (todayIdx >= 0) currentLogs[todayIdx] = msg.data
        charts.updateToday(msg.data)
        updateStatCards(msg.data)
        heatmap.render(currentLogs)
        renderSessions(currentLogs)
        renderFiles(currentLogs)
      }
      break
    }

    case "settings":
      dailyTargetMs = msg.dailyTargetMs
      if (currentLogs.length > 0) {
        updateStatCards(currentLogs[currentLogs.length - 1])
      }
      populateSettings(msg)
      break

    case "pdfData": {
      const options: PdfOptions = {
        streak:       (document.getElementById("pdf-streak")       as HTMLInputElement).checked,
        activeTime:   (document.getElementById("pdf-active-time")  as HTMLInputElement).checked,
        linesAdded:   (document.getElementById("pdf-lines-added")  as HTMLInputElement).checked,
        linesDeleted: (document.getElementById("pdf-lines-deleted") as HTMLInputElement).checked,
        topLanguage:  (document.getElementById("pdf-top-lang")     as HTMLInputElement).checked,
        aiEvents:     false,
        heatmap:      (document.getElementById("pdf-heatmap")      as HTMLInputElement).checked,
        days: pdfRangeDays,
      }
      const buffer = generatePdf(msg.logs, options)
      const bytes = new Uint8Array(buffer)
      let binary = ""
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      vscode.postMessage({ type: "writePdf", base64: btoa(binary) })
      closePdfModal()
      break
    }
  }
})

// Range selector
document.getElementById("range-toggle")?.addEventListener("click", (e: Event) => {
  const btn = (e.target as HTMLElement).closest(".toggle-btn") as HTMLElement | null
  if (!btn?.dataset.val) return
  const days = parseInt(btn.dataset.val) as 7 | 30 | 90
  document.querySelectorAll("#range-toggle .toggle-btn").forEach(b =>
    b.classList.toggle("active", b === btn)
  )
  vscode.postMessage({ type: "requestRange", days })
})

// ── Settings tab ────────────────────────────────────────────────────────────

type SettingsMsg = Extract<ExtensionMessage, { type: "settings" }>

function populateSettings(msg: SettingsMsg): void {
  const dailyTarget  = document.getElementById("pref-daily-target")  as HTMLInputElement
  const idleThresh   = document.getElementById("pref-idle-threshold") as HTMLInputElement
  const sessionExp   = document.getElementById("pref-session-expiry") as HTMLInputElement

  if (dailyTarget)  dailyTarget.value  = msg.dailyTargetMinutes > 0 ? String(msg.dailyTargetMinutes) : ""
  if (idleThresh)   idleThresh.value   = String(msg.idleThresholdMinutes)
  if (sessionExp)   sessionExp.value   = String(msg.sessionExpiryMinutes)
}

document.getElementById("pref-daily-target")?.addEventListener("change", (e: Event) => {
  const raw = (e.target as HTMLInputElement).value.trim()
  vscode.postMessage({ type: "updateSetting", key: "dailyTargetMinutes", value: raw === "" ? null : parseInt(raw) })
})

document.getElementById("pref-idle-threshold")?.addEventListener("change", (e: Event) => {
  const val = parseInt((e.target as HTMLInputElement).value)
  if (!isNaN(val) && val > 0) vscode.postMessage({ type: "updateSetting", key: "idleThresholdMinutes", value: val })
})

document.getElementById("pref-session-expiry")?.addEventListener("change", (e: Event) => {
  const val = parseInt((e.target as HTMLInputElement).value)
  if (!isNaN(val) && val > 0) vscode.postMessage({ type: "updateSetting", key: "sessionExpiryMinutes", value: val })
})

// ── PDF export modal ────────────────────────────────────────────────────────

let pdfRangeDays: 7 | 30 | 90 = 30

function closePdfModal(): void {
  document.getElementById("pdf-modal-overlay")?.classList.add("hidden")
  const btn = document.getElementById("pdf-generate") as HTMLButtonElement | null
  if (btn) { btn.disabled = false; btn.textContent = "Generate PDF" }
}

document.getElementById("export-pdf-btn")?.addEventListener("click", () => {
  document.getElementById("pdf-modal-overlay")?.classList.remove("hidden")
})

document.getElementById("pdf-cancel")?.addEventListener("click", closePdfModal)

document.getElementById("pdf-modal-overlay")?.addEventListener("click", (e: Event) => {
  if (e.target === document.getElementById("pdf-modal-overlay")) closePdfModal()
})

document.getElementById("pdf-range")?.addEventListener("click", (e: Event) => {
  const btn = (e.target as HTMLElement).closest(".toggle-btn") as HTMLElement | null
  if (!btn?.dataset.val) return
  pdfRangeDays = parseInt(btn.dataset.val) as 7 | 30 | 90
  document.querySelectorAll("#pdf-range .toggle-btn").forEach(b => {
    b.classList.toggle("active", (b as HTMLElement).dataset.val === btn.dataset.val)
  })
})

document.getElementById("pdf-generate")?.addEventListener("click", () => {
  const btn = document.getElementById("pdf-generate") as HTMLButtonElement
  btn.disabled = true
  btn.textContent = "Generating…"
  vscode.postMessage({ type: "exportPdfRequest", days: pdfRangeDays })
})

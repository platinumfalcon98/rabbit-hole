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
let heatmapLogs: DailyLog[] = []
let dailyTargetMs = 0
let currentProjectId = ""
let projects: ProjectMeta[] = []
let projectTimestamps: Record<string, number> = {}
let currentPreset = "today"
let selectedProjectIds: string[] = []   // [] = all, ["<id>"] = single project
let pendingSelectedId = ""              // draft while panel is open ("" = all)

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
let projectSort: "time" | "last" | "name" = "time"

function switchTab(tab: string): void {
  closeProjectPanel("proj-dropdown-panel", false)
  closeProjectPanel("act-proj-dropdown-panel", false)
  activeTab = tab
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.tab === tab)
  })
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${tab}`)
  })
  // Show filter bar on Overview and Activity
  document.getElementById("filter-bar")?.classList.toggle("hidden", tab !== "overview")

  if (tab === "overview") {
    requestAnimationFrame(() => charts.resizeAll())
  }
  if (tab === "activity") {
    requestAnimationFrame(() => heatmap.render(heatmapLogs))
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

document.addEventListener("click", e => {
  // Sidebar toggle
  if ((e.target as HTMLElement).closest("#sidebar-toggle")) {
    document.getElementById("sidebar")?.classList.toggle("collapsed")
  }
  // Close project dropdowns when clicking outside them
  if (!(e.target as HTMLElement).closest("#project-filter") && !(e.target as HTMLElement).closest("#act-project-filter")) {
    closeProjectPanel("proj-dropdown-panel", false)
    closeProjectPanel("act-proj-dropdown-panel", false)
  }
})

// ── Filter bar ─────────────────────────────────────────────────────────────

const DROPDOWN_PAIRS: [string, string, string][] = [
  // [panelId, labelId, btnId]
  ["proj-dropdown-panel",     "proj-filter-label",     "proj-filter-btn"],
  ["act-proj-dropdown-panel", "act-proj-filter-label", "act-proj-filter-btn"],
]

function buildProjectListHtml(selectedId: string, namePrefix: string): string {
  let html = `<label class="proj-dropdown-item">
      <input type="radio" name="${namePrefix}" value="" ${selectedId === "" ? "checked" : ""}>
      <span>All projects</span>
    </label>
    <div class="proj-dropdown-divider"></div>`
  html += projects.map(p => `
    <label class="proj-dropdown-item">
      <input type="radio" name="${namePrefix}" value="${p.id}" ${selectedId === p.id ? "checked" : ""}>
      <span>${p.name}</span>
    </label>`).join("")
  return html
}

function renderProjectDropdown(): void {
  const selectedId = selectedProjectIds[0] ?? ""
  const names = ["proj-select", "act-proj-select"]
  DROPDOWN_PAIRS.forEach(([panelId], i) => {
    const panel = document.getElementById(panelId)
    const list = panel?.querySelector(".proj-panel-list")
    if (!list) return
    list.innerHTML = buildProjectListHtml(selectedId, names[i])
    list.querySelectorAll("input[type='radio']").forEach(rb => {
      rb.addEventListener("change", () => {
        pendingSelectedId = (rb as HTMLInputElement).value
      })
    })
  })
  updateDropdownLabel()
}

function syncDropdownRadios(): void {
  const names = ["proj-select", "act-proj-select"]
  DROPDOWN_PAIRS.forEach(([panelId], i) => {
    const panel = document.getElementById(panelId)
    if (!panel) return
    panel.querySelectorAll(`input[name="${names[i]}"]`).forEach(rb => {
      (rb as HTMLInputElement).checked = (rb as HTMLInputElement).value === pendingSelectedId
    })
  })
}

function openProjectPanel(panelId: string): void {
  pendingSelectedId = selectedProjectIds[0] ?? ""
  const panel = document.getElementById(panelId)
  panel?.classList.remove("hidden")
  syncDropdownRadios()
}

function closeProjectPanel(panelId: string, commit: boolean): void {
  const panel = document.getElementById(panelId)
  if (!panel || panel.classList.contains("hidden")) return
  panel.classList.add("hidden")
  if (commit) {
    selectedProjectIds = pendingSelectedId === "" ? [] : [pendingSelectedId]
    vscode.postMessage({ type: "selectProjects", projectIds: selectedProjectIds })
    updateDropdownLabel()
  } else {
    pendingSelectedId = selectedProjectIds[0] ?? ""
    syncDropdownRadios()
  }
}

function updateDropdownLabel(): void {
  const selectedId = selectedProjectIds[0] ?? ""
  const text = selectedId === ""
    ? "All Projects"
    : projects.find(p => p.id === selectedId)?.name ?? selectedId
  const isActive = selectedId !== ""

  DROPDOWN_PAIRS.forEach(([, labelId, btnId]) => {
    const label = document.getElementById(labelId)
    const btn = document.getElementById(btnId)
    if (label) label.textContent = text
    btn?.classList.toggle("active", isActive)
  })
}

function handlePresetChange(preset: string): void {
  currentPreset = preset
  document.querySelectorAll(".filter-btn").forEach(b =>
    b.classList.toggle("active", (b as HTMLElement).dataset.preset === preset)
  )
  const customRange = document.getElementById("custom-range")
  customRange?.classList.toggle("hidden", preset !== "custom")
  if (preset !== "custom") {
    vscode.postMessage({ type: "requestRange", preset: preset as import("../shared/types").RangePreset })
  }
}

// ── Stat cards ─────────────────────────────────────────────────────────────

function dateLabel(dateStr: string): string {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const yd = new Date(now); yd.setDate(yd.getDate() - 1)
  const yesterdayStr = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`
  if (dateStr === todayStr) return "Today"
  if (dateStr === yesterdayStr) return "Yesterday"
  return dateStr
}

function updateRangeLabel(): void {
  const el = document.getElementById("stat-range-label")
  if (!el) return
  let label = ""
  if (currentPreset === "today") {
    label = "Today"
  } else if (currentPreset === "7d") {
    label = "Last 7 days"
  } else if (currentPreset === "30d") {
    label = "Last 30 days"
  } else if (currentPreset === "1y") {
    label = "Last year"
  } else if (currentPreset === "custom") {
    const start = (document.getElementById("custom-start") as HTMLInputElement)?.value
    const end = (document.getElementById("custom-end") as HTMLInputElement)?.value
    if (start && end) {
      label = start === end ? dateLabel(start) : `${dateLabel(start)} – ${dateLabel(end)}`
    }
  }
  el.textContent = label
}

function updateStatCards(logs: DailyLog[]): void {
  if (logs.length === 0) return
  updateRangeLabel()

  const lastLog = logs[logs.length - 1]

  const timeEl = document.getElementById("stat-time")
  const addedEl = document.getElementById("stat-added")
  const deletedEl = document.getElementById("stat-deleted")
  const streakEl = document.getElementById("streak-count")
  const streakTargetEl = document.getElementById("streak-target")

  const totalTime = logs.reduce((s, l) => s + l.activeTime, 0)
  const totalAdded = logs.reduce((s, l) => s + l.files.reduce((fs, f) => fs + f.linesAdded, 0), 0)
  const totalDeleted = logs.reduce((s, l) => s + l.files.reduce((fs, f) => fs + f.linesDeleted, 0), 0)

  const isMultiDay = logs.length > 1
  const activeDays = Math.max(1, logs.filter(l => l.activeTime > 0).length)

  const timeAvgEl = document.getElementById("stat-time-avg")
  const addedAvgEl = document.getElementById("stat-added-avg")
  const deletedAvgEl = document.getElementById("stat-deleted-avg")

  if (isMultiDay) {
    if (timeEl) timeEl.textContent = formatDuration(totalTime)
    if (addedEl) addedEl.textContent = String(totalAdded)
    if (deletedEl) deletedEl.textContent = String(totalDeleted)
    if (timeAvgEl) { timeAvgEl.textContent = `avg ${formatDuration(Math.round(totalTime / activeDays))}/day`; timeAvgEl.classList.remove("hidden") }
    if (addedAvgEl) { addedAvgEl.textContent = `avg ${Math.round(totalAdded / activeDays)}/day`; addedAvgEl.classList.remove("hidden") }
    if (deletedAvgEl) { deletedAvgEl.textContent = `avg ${Math.round(totalDeleted / activeDays)}/day`; deletedAvgEl.classList.remove("hidden") }
  } else {
    if (timeEl) timeEl.textContent = formatDuration(totalTime)
    if (addedEl) addedEl.textContent = String(totalAdded)
    if (deletedEl) deletedEl.textContent = String(totalDeleted)
    if (timeAvgEl) timeAvgEl.classList.add("hidden")
    if (addedAvgEl) addedAvgEl.classList.add("hidden")
    if (deletedAvgEl) deletedAvgEl.classList.add("hidden")
  }
  if (streakEl) streakEl.textContent = String(lastLog.streak)

  // streak > 0 means today's target was met globally (updateStreak stores 0 until earned)
  const todayEarned = lastLog.streak > 0
  const pill = document.getElementById("streak-pill")
  pill?.classList.toggle("streak-at-risk", !todayEarned && dailyTargetMs > 0)

  if (streakTargetEl) {
    if (dailyTargetMs > 0) {
      if (todayEarned) {
        streakTargetEl.textContent = " · ✓"
        streakTargetEl.className = "streak-target-met"
      } else {
        const atRisk = logs[logs.length - 2]?.streak ?? 0
        const progress = `${formatDuration(lastLog.activeTime)} / ${formatDuration(dailyTargetMs)}`
        streakTargetEl.textContent = atRisk > 0
          ? ` · ${progress} · ${atRisk}d at risk`
          : ` · ${progress}`
        streakTargetEl.className = "streak-target-pending"
      }
    } else {
      streakTargetEl.textContent = ""
    }
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

const SESSIONS_COLLAPSED = 3
const expandedSessionDates = new Set<string>()
let sessionSortOrder: "desc" | "asc" = "desc"

function buildSessionRow(session: import("../shared/types").ActivitySession, isAggregate: boolean, ongoingId: string | null): HTMLElement {
  const row = document.createElement("div")
  row.className = "session-row"
  const end = session.endTime
    ? formatTime(session.endTime)
    : session.id === ongoingId ? "ongoing" : "—"
  const projectTag = isAggregate && session.projectId
    ? `<span class="session-project">${projectName(session.projectId)}</span>`
    : ""
  row.innerHTML =
    `<span class="session-time">${formatTime(session.startTime)} – ${end}</span>` +
    projectTag +
    `<span class="session-active">${formatDuration(session.activeTime)} active</span>`
  return row
}

function renderSessions(logs: DailyLog[]): void {
  const container = document.getElementById("sessions-list")
  if (!container) return
  container.innerHTML = ""

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

  const isAggregate = currentProjectId === "all"
  const sorted = [...logs].reverse()
  const hasSessions = sorted.some(log => log.sessions.some(s => s.activeTime > 0 || s.endTime !== null))
  if (!hasSessions) {
    container.innerHTML = `<div class="empty-state">No sessions recorded yet</div>`
    return
  }

  for (const log of sorted) {
    const sessions = log.sessions
      .filter(s => s.activeTime > 0 || s.endTime !== null)
      .sort((a, b) => sessionSortOrder === "desc" ? b.startTime - a.startTime : a.startTime - b.startTime)
    if (sessions.length === 0) continue

    // At most one session can be truly ongoing: the latest open one from today
    const openSessions = log.date === todayStr
      ? sessions.filter(s => s.endTime === null)
      : []
    const ongoingId = openSessions.length > 0
      ? openSessions.reduce((a, b) => a.startTime > b.startTime ? a : b).id
      : null

    const dateHeader = document.createElement("div")
    dateHeader.className = "sessions-date"
    dateHeader.textContent = log.date
    container.appendChild(dateHeader)

    const expanded = expandedSessionDates.has(log.date)
    const visible = expanded ? sessions : sessions.slice(0, SESSIONS_COLLAPSED)
    const hidden = expanded ? [] : sessions.slice(SESSIONS_COLLAPSED)

    for (const session of visible) {
      container.appendChild(buildSessionRow(session, isAggregate, ongoingId))
    }

    if (hidden.length > 0) {
      const showMore = document.createElement("div")
      showMore.className = "sessions-show-more"
      showMore.textContent = `${hidden.length} more session${hidden.length !== 1 ? "s" : ""}`
      showMore.addEventListener("click", () => {
        expandedSessionDates.add(log.date)
        for (const session of hidden) {
          showMore.before(buildSessionRow(session, isAggregate, ongoingId))
        }
        showMore.remove()
      })
      container.appendChild(showMore)
    }
  }
}

// ── Projects tab ───────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 14) return "last week"
  return `${Math.floor(days / 7)} weeks ago`
}

interface ProjectSummary {
  id: string
  name: string
  path: string
  activeTime: number
  streak: number
  lastActiveTs: number
}

function computeProjectSummaries(): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>()
  const daysMap = new Map<string, Set<string>>()

  // Seed from projects registry so we show all even with zero activity
  for (const p of projects) {
    map.set(p.id, { id: p.id, name: p.name, path: p.path, activeTime: 0, streak: 0, lastActiveTs: projectTimestamps[p.id] ?? 0 })
    daysMap.set(p.id, new Set())
  }

  const fallbackPid = currentProjectId !== "all" ? currentProjectId : (map.size === 1 ? [...map.keys()][0] : null)

  for (const log of currentLogs) {
    for (const session of log.sessions) {
      const pid = session.projectId ?? fallbackPid
      if (!pid) continue
      if (!map.has(pid)) {
        map.set(pid, { id: pid, name: projectName(pid), path: "", activeTime: 0, streak: 0, lastActiveTs: 0 })
        daysMap.set(pid, new Set())
      }
      const s = map.get(pid)!
      s.activeTime += session.activeTime
      const sessionTs = session.endTime ?? session.startTime
      if (sessionTs > s.lastActiveTs) s.lastActiveTs = sessionTs
      daysMap.get(pid)!.add(log.date)
    }
  }

  for (const [pid, days] of daysMap) {
    const s = map.get(pid)
    if (!s || days.size === 0) continue
    const sorted = [...days].sort().reverse()
    let streak = 1
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = new Date(sorted[i]).getTime()
      const prev = new Date(sorted[i + 1]).getTime()
      if (Math.round((curr - prev) / 86_400_000) === 1) streak++
      else break
    }
    s.streak = streak
  }

  return [...map.values()].sort((a, b) => b.activeTime - a.activeTime)
}

function sortedProjectSummaries(): ProjectSummary[] {
  const summaries = computeProjectSummaries()
  if (projectSort === "last") {
    return summaries.sort((a, b) => b.lastActiveTs - a.lastActiveTs)
  }
  if (projectSort === "name") {
    return summaries.sort((a, b) => a.name.localeCompare(b.name))
  }
  return summaries // already sorted by activeTime desc from computeProjectSummaries
}

function renderProjectsTab(): void {
  const container = document.getElementById("project-cards")
  if (!container) return

  const summaries = sortedProjectSummaries()
  if (summaries.length === 0) {
    container.innerHTML = `<div class="empty-state">No projects tracked yet</div>`
    return
  }

  container.innerHTML = summaries.map(p => `
    <div class="project-card" data-id="${p.id}" title="Click to view this project">
      <div class="project-card-header">
        <span class="project-card-name">${p.name}</span>
        ${p.lastActiveTs ? `<span class="project-card-last">${timeAgo(p.lastActiveTs)}</span>` : ""}
      </div>
      <div class="project-card-path">${shortenPath(p.path, 4)}</div>
      <div class="project-card-stats">
        <span class="pstat"><span class="pstat-label">Active</span> <span class="pstat-val">${formatDuration(p.activeTime)}</span></span>
        <span class="pstat"><span class="pstat-label">Streak</span> <span class="pstat-val">${p.streak}d</span></span>
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

// ── Projects mini widget ────────────────────────────────────────────────────

function renderProjectsMini(): void {
  const container = document.getElementById("projects-mini-list")
  if (!container) return

  const summaries = computeProjectSummaries().filter(p => p.activeTime > 0)
  if (summaries.length === 0) {
    container.innerHTML = `<div class="empty-state">No projects tracked yet</div>`
    return
  }

  container.innerHTML = summaries.slice(0, 5).map(p => `
    <div class="projects-mini-row" data-id="${p.id}">
      <span class="projects-mini-name">${p.name}</span>
      <span class="projects-mini-time">${formatDuration(p.activeTime)}</span>
    </div>`).join("")

  container.querySelectorAll(".projects-mini-row").forEach(row => {
    row.addEventListener("click", () => switchTab("projects"))
  })
}

// ── Full render ────────────────────────────────────────────────────────────

function renderAll(): void {
  const heatmapProjectName = selectedProjectIds.length === 0
    ? "All Projects"
    : projects.find(p => p.id === selectedProjectIds[0])?.name ?? ""
  heatmap.render(heatmapLogs)
  heatmap.renderActivityStats(heatmapLogs, heatmapProjectName)
  charts.renderAll(currentLogs)
  updateStatCards(currentLogs)
  renderSessions(currentLogs)
  renderFiles(currentLogs)
  renderProjectsMini()
  if (activeTab === "projects") renderProjectsTab()
  requestAnimationFrame(() => charts.resizeAll())
}

// ── Message handling ───────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  vscode.postMessage({ type: "ready" })
})

window.addEventListener("resize", () => {
  requestAnimationFrame(() => {
    charts.resizeAll()
    heatmap.resize()
  })
})

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as ExtensionMessage
  switch (msg.type) {
    case "init":
      currentLogs = msg.data
      heatmapLogs = msg.heatmapData
      projects = msg.projects
      currentProjectId = msg.currentProjectId
      projectTimestamps = msg.projectTimestamps
      renderProjectDropdown()
      renderAll()
      break

    case "update": {
      const projectInScope = selectedProjectIds.length === 0
        ? msg.projectId === currentProjectId
        : selectedProjectIds[0] === msg.projectId
      const singleProject = true
      if (currentPreset === "today" && singleProject && projectInScope) {
        const todayIdx = currentLogs.findIndex(l => l.date === msg.data.date)
        if (todayIdx >= 0) currentLogs[todayIdx] = msg.data
        const heatmapTodayIdx = heatmapLogs.findIndex(l => l.date === msg.data.date)
        if (heatmapTodayIdx >= 0) heatmapLogs[heatmapTodayIdx] = msg.data
        charts.updateToday(msg.data)
        updateStatCards(currentLogs)
        heatmap.render(heatmapLogs)
        renderSessions(currentLogs)
        renderFiles(currentLogs)
        renderProjectsMini()
      }
      break
    }

    case "settings":
      dailyTargetMs = msg.dailyTargetMs
      if (currentLogs.length > 0) {
        updateStatCards(currentLogs)
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

// Filter bar — range preset buttons
document.getElementById("filter-bar")?.addEventListener("click", (e: Event) => {
  const btn = (e.target as HTMLElement).closest(".filter-btn") as HTMLElement | null
  if (!btn?.dataset.preset) return
  handlePresetChange(btn.dataset.preset)
})

// Filter bar — custom date range
function trySubmitCustomRange(): void {
  const start = (document.getElementById("custom-start") as HTMLInputElement)?.value
  const end = (document.getElementById("custom-end") as HTMLInputElement)?.value
  if (start && end && start <= end) {
    vscode.postMessage({ type: "requestRange", preset: "custom", customStart: start, customEnd: end })
  }
}
document.getElementById("custom-start")?.addEventListener("change", trySubmitCustomRange)
document.getElementById("custom-end")?.addEventListener("change", trySubmitCustomRange)

// Project dropdown toggles
document.getElementById("proj-filter-btn")?.addEventListener("click", (e: Event) => {
  e.stopPropagation()
  const panel = document.getElementById("proj-dropdown-panel")
  if (panel?.classList.contains("hidden")) {
    openProjectPanel("proj-dropdown-panel")
  } else {
    closeProjectPanel("proj-dropdown-panel", false)
  }
})
document.getElementById("act-proj-filter-btn")?.addEventListener("click", (e: Event) => {
  e.stopPropagation()
  const panel = document.getElementById("act-proj-dropdown-panel")
  if (panel?.classList.contains("hidden")) {
    openProjectPanel("act-proj-dropdown-panel")
  } else {
    closeProjectPanel("act-proj-dropdown-panel", false)
  }
})

// Apply buttons inside each panel
document.querySelectorAll(".proj-panel-apply").forEach(btn => {
  btn.addEventListener("click", (e: Event) => {
    e.stopPropagation()
    const panel = (e.target as HTMLElement).closest(".proj-dropdown-panel") as HTMLElement | null
    if (panel) closeProjectPanel(panel.id, true)
  })
})

// Escape closes any open panel without committing
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    closeProjectPanel("proj-dropdown-panel", false)
    closeProjectPanel("act-proj-dropdown-panel", false)
  }
})

// Sessions sort toggle
document.getElementById("sessions-sort")?.addEventListener("click", (e: Event) => {
  const btn = (e.target as HTMLElement).closest(".toggle-btn") as HTMLElement | null
  if (!btn?.dataset.val) return
  sessionSortOrder = btn.dataset.val as "desc" | "asc"
  document.querySelectorAll("#sessions-sort .toggle-btn").forEach(b =>
    b.classList.toggle("active", b === btn)
  )
  expandedSessionDates.clear()
  renderSessions(currentLogs)
})

// Sort toggle
document.getElementById("sort-toggle")?.addEventListener("click", (e: Event) => {
  const btn = (e.target as HTMLElement).closest(".toggle-btn") as HTMLElement | null
  if (!btn?.dataset.val) return
  projectSort = btn.dataset.val as "time" | "last" | "name"
  document.querySelectorAll("#sort-toggle .toggle-btn").forEach(b =>
    b.classList.toggle("active", b === btn)
  )
  renderProjectsTab()
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

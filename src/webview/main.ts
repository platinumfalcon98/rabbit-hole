import { DailyLog, ExtensionMessage, ProjectMeta } from "../shared/types"
import * as heatmap from "./heatmap"
import * as charts from "./charts"
import { PdfOptions } from "./pdfExport"
import { generateJpg } from "./jpgExport"

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
let projectActiveTimes: Record<string, number> = {}
let currentPreset = "today"
let selectedProjectIds: string[] = []   // [] = all, ["<id>"] = single project
let pendingSelectedId = ""              // draft while panel is open ("" = all)
let initializedProject = false          // auto-select current project only on first init

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
    requestAnimationFrame(() => {
      heatmap.render(heatmapLogs)
      charts.resizeAll()
    })
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
  // Close calendar popover when clicking outside it
  if (!(e.target as HTMLElement).closest(".date-controls")) {
    const popover = document.getElementById("calendar-popover")
    if (popover && !popover.classList.contains("hidden")) closeCalendar()
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
    vscode.postMessage({ type: "selectProjects", projectIds: selectedProjectIds.length === 0 ? ["all"] : selectedProjectIds })
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

function todayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function yesterdayDateStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// ── Calendar popover state ──────────────────────────────────────────────────

let calViewYear = 0
let calViewMonth = 0  // 0-based
let calRangeStart: string | null = null   // "YYYY-MM-DD"
let calRangeEnd: string | null = null     // "YYYY-MM-DD"
let calPickStep: 0 | 1 | 2 = 0           // 0=closed/idle, 1=awaiting end, 2=complete
let calPickMode: "single" | "range" = "single"

function fmtDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function calRenderGrid(): void {
  const grid = document.getElementById("cal-grid")
  if (!grid) return

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"]
  const label = document.getElementById("cal-month-label")
  if (label) label.textContent = `${monthNames[calViewMonth]} ${calViewYear}`

  const today = todayDateStr()
  const firstDay = new Date(calViewYear, calViewMonth, 1).getDay() // 0=Sun
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate()

  // Normalise range so start <= end for highlighting
  const rStart = calRangeStart && calRangeEnd
    ? (calRangeStart <= calRangeEnd ? calRangeStart : calRangeEnd)
    : calRangeStart
  const rEnd = calRangeStart && calRangeEnd
    ? (calRangeStart <= calRangeEnd ? calRangeEnd : calRangeStart)
    : calRangeStart

  let html = ""
  const days = ["Su","Mo","Tu","We","Th","Fr","Sa"]
  for (const d of days) html += `<span class="cal-dow">${d}</span>`

  // Leading empty cells
  for (let i = 0; i < firstDay; i++) html += `<span class="cal-day cal-day-empty"></span>`

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDateStr(calViewYear, calViewMonth, d)
    const isFuture = ds > today
    const isToday = ds === today
    const isStart = ds === rStart
    const isEnd = ds === rEnd
    const inRange = rStart && rEnd && ds > rStart && ds < rEnd
    const isSelected = isStart || isEnd

    let cls = "cal-day"
    if (isFuture) cls += " cal-day-future"
    if (isToday) cls += " cal-day-today"
    if (isSelected) cls += " cal-day-selected"
    if (inRange) cls += " cal-day-in-range"
    if (isStart && rEnd && rStart !== rEnd) cls += " cal-day-range-start"
    if (isEnd && rStart && rStart !== rEnd) cls += " cal-day-range-end"

    html += `<span class="${cls}" data-date="${ds}">${d}</span>`
  }

  grid.innerHTML = html

  // Apply button state
  const applyBtn = document.getElementById("cal-apply") as HTMLButtonElement | null
  const hint = document.getElementById("cal-hint")
  if (calPickStep === 1) {
    if (applyBtn) applyBtn.disabled = true
    if (hint) hint.textContent = calPickMode === "single" ? "Pick a day" : calRangeStart ? `Start: ${formatCalLabel(calRangeStart)} — pick end date` : "Pick start date"
  } else if (calPickStep === 2 && calRangeStart && calRangeEnd) {
    if (applyBtn) applyBtn.disabled = false
    const s = calRangeStart <= calRangeEnd ? calRangeStart : calRangeEnd
    const e = calRangeStart <= calRangeEnd ? calRangeEnd : calRangeStart
    if (hint) hint.textContent = s === e ? formatCalLabel(s) : `${formatCalLabel(s)} – ${formatCalLabel(e)}`
  } else {
    if (applyBtn) applyBtn.disabled = true
    if (hint) hint.textContent = "Click a date to start selection"
  }
}

function formatCalLabel(ds: string): string {
  const [, m, d] = ds.split("-").map(Number)
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  return `${months[m - 1]} ${d}`
}

function openCalendar(): void {
  calPickStep = 1
  calRangeStart = null
  calRangeEnd = null
  calPickMode = "single"
  // Sync mode toggle buttons
  document.getElementById("cal-mode-single")?.classList.add("active")
  document.getElementById("cal-mode-range")?.classList.remove("active")
  const today = new Date()
  calViewYear = today.getFullYear()
  calViewMonth = today.getMonth()
  calRenderGrid()
  document.getElementById("calendar-popover")?.classList.remove("hidden")
  document.getElementById("calendar-btn")?.classList.add("active")
}

function closeCalendar(): void {
  document.getElementById("calendar-popover")?.classList.add("hidden")
  document.getElementById("calendar-btn")?.classList.remove("active")
  calPickStep = 0
}

function applyCalendarRange(): void {
  if (!calRangeStart || !calRangeEnd) return
  const start = calRangeStart <= calRangeEnd ? calRangeStart : calRangeEnd
  const end   = calRangeStart <= calRangeEnd ? calRangeEnd   : calRangeStart
  currentPreset = "custom"
  document.getElementById("streak-pill")?.classList.add("hidden")
  const sel = document.getElementById("date-preset-select") as HTMLSelectElement | null
  if (sel) {
    const customOpt = sel.querySelector<HTMLOptionElement>("option[value='custom']")
    const label = start === end ? formatCalLabel(start) : `${formatCalLabel(start)} – ${formatCalLabel(end)}`
    if (customOpt) customOpt.textContent = label
    sel.value = "custom"
    sel.classList.add("custom-active")
  }
  vscode.postMessage({ type: "requestRange", preset: "custom", customStart: start, customEnd: end })
  updateRangeLabel()
  closeCalendar()
}

function handlePresetChange(preset: string): void {
  currentPreset = preset
  document.getElementById("streak-pill")?.classList.toggle("hidden", preset !== "today")
  const sel = document.getElementById("date-preset-select") as HTMLSelectElement | null
  if (sel) sel.classList.remove("custom-active")

  if (preset === "yesterday") {
    const d = yesterdayDateStr()
    vscode.postMessage({ type: "requestRange", preset: "custom", customStart: d, customEnd: d })
  } else {
    vscode.postMessage({ type: "requestRange", preset: preset as import("../shared/types").RangePreset })
  }
  updateRangeLabel()
}

// ── Streak helpers ──────────────────────────────────────────────────────────

function getEffectiveTargetMs(): number {
  const isSingle = selectedProjectIds.length > 0 && selectedProjectIds[0] !== "all"
  if (isSingle) {
    const proj = projects.find(p => p.id === selectedProjectIds[0])
    if (proj?.dailyTargetMinutes !== undefined) return proj.dailyTargetMinutes * 60_000
    return 0   // no per-project target — any activity counts, no progress bar
  }
  return dailyTargetMs   // global
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
  } else if (currentPreset === "yesterday") {
    label = "Yesterday"
  } else if (currentPreset === "7d") {
    label = "This Week"
  } else if (currentPreset === "30d") {
    label = "This Month"
  } else if (currentPreset === "1y") {
    label = "Last year"
  } else if (currentPreset === "custom") {
    if (calRangeStart && calRangeEnd) {
      const start = calRangeStart <= calRangeEnd ? calRangeStart : calRangeEnd
      const end   = calRangeStart <= calRangeEnd ? calRangeEnd   : calRangeStart
      label = start === end ? formatCalLabel(start) : `${formatCalLabel(start)} – ${formatCalLabel(end)}`
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
  const activeDays = Math.max(1, logs.length)

  const timeAvgEl = document.getElementById("stat-time-avg")
  const addedAvgEl = document.getElementById("stat-added-avg")
  const deletedAvgEl = document.getElementById("stat-deleted-avg")

  if (isMultiDay) {
    if (timeEl) timeEl.textContent = formatDuration(totalTime)
    if (addedEl) addedEl.textContent = String(totalAdded)
    if (deletedEl) deletedEl.textContent = String(totalDeleted)
    if (timeAvgEl) { timeAvgEl.textContent = `average ${formatDuration(Math.round(totalTime / activeDays))}/day`; timeAvgEl.classList.remove("hidden") }
    if (addedAvgEl) { addedAvgEl.textContent = `average ${Math.round(totalAdded / activeDays)}/day`; addedAvgEl.classList.remove("hidden") }
    if (deletedAvgEl) { deletedAvgEl.textContent = `average ${Math.round(totalDeleted / activeDays)}/day`; deletedAvgEl.classList.remove("hidden") }
  } else {
    if (timeEl) timeEl.textContent = formatDuration(totalTime)
    if (addedEl) addedEl.textContent = String(totalAdded)
    if (deletedEl) deletedEl.textContent = String(totalDeleted)
    if (timeAvgEl) timeAvgEl.classList.add("hidden")
    if (addedAvgEl) addedAvgEl.classList.add("hidden")
    if (deletedAvgEl) deletedAvgEl.classList.add("hidden")
  }
  if (streakEl) {
    const streakStr = String(lastLog.streak)
    streakEl.textContent = streakStr
    // Responsive font-size scaling for Press Start 2P — wide pixel font needs to shrink at 2+ digits
    streakEl.style.fontSize = streakStr.length >= 3 ? "1.6em" : streakStr.length === 2 ? "2em" : "2.5em"
  }

  // Update scope label: show project name when single project selected
  const scopeEl = document.getElementById("streak-scope")
  if (scopeEl) {
    const isSingle = selectedProjectIds.length > 0 && selectedProjectIds[0] !== "all"
    scopeEl.textContent = isSingle
      ? ` · ${projects.find(p => p.id === selectedProjectIds[0])?.name ?? ""}`
      : ""
  }

  const effectiveTargetMs = getEffectiveTargetMs()
  const todayEarned = effectiveTargetMs > 0
    ? lastLog.activeTime >= effectiveTargetMs
    : lastLog.activeTime > 0
  const pill = document.getElementById("streak-pill")
  pill?.classList.toggle("hidden", currentPreset !== "today")
  pill?.classList.toggle("streak-at-risk", !todayEarned && effectiveTargetMs > 0)
  document.getElementById("streak-extended")?.classList.toggle("hidden", !todayEarned)

  if (streakTargetEl) {
    if (effectiveTargetMs > 0) {
      if (todayEarned) {
        streakTargetEl.textContent = " · ✓"
        streakTargetEl.className = "streak-target-met"
      } else {
        const atRisk = lastLog.streak
        const progress = `${formatDuration(lastLog.activeTime)} / ${formatDuration(effectiveTargetMs)}`
        streakTargetEl.textContent = atRisk > 0
          ? ` · ${progress} · Streak at risk`
          : ` · ${progress}`
        streakTargetEl.className = "streak-target-pending"
      }
    } else {
      streakTargetEl.textContent = ""
    }
  }
}

// ── Files ──────────────────────────────────────────────────────────────────

let lastRenderedFilesKey = ""

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

  const cacheKey = logs.map(l => `${l.date}:${l.files.length}`).join("|")
  if (cacheKey === lastRenderedFilesKey) return
  lastRenderedFilesKey = cacheKey

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
let lastRenderedSessionsKey = ""

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

  const cacheKey = logs.map(l => `${l.date}:${l.sessions.length}`).join("|")
  if (cacheKey === lastRenderedSessionsKey) return
  lastRenderedSessionsKey = cacheKey

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

let projectCardsListenerBound = false

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
  streak: number               // from ProjectMeta — server-computed, target-aware
  dailyTargetMinutes?: number  // from ProjectMeta
  lastActiveTs: number
}

function computeProjectSummaries(): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>()

  // Seed from projects registry — use server-provided today's active times per project
  for (const p of projects) {
    map.set(p.id, {
      id: p.id,
      name: p.name,
      path: p.path,
      activeTime: projectActiveTimes[p.id] ?? 0,
      streak: p.streak ?? 0,
      dailyTargetMinutes: p.dailyTargetMinutes,
      lastActiveTs: projectTimestamps[p.id] ?? 0,
    })
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
        <span class="pstat"><span class="pstat-label">Active Today</span> <span class="pstat-val">${formatDuration(p.activeTime)}</span></span>
        ${p.streak > 0 ? `<span class="pstat"><span class="pstat-label">Streak</span> <span class="pstat-val">&#x1F525; ${p.streak}d</span></span>` : ""}
      </div>
      <div class="project-card-target" title="Per-project daily target for streak">
        <span class="project-target-label">Daily target</span>
        <div class="stepper-wrapper">
          <input
            type="number"
            class="project-target-input"
            data-project-id="${p.id}"
            value="${p.dailyTargetMinutes ?? ""}"
            min="1" max="1440" step="5"
            placeholder="global (${Math.round(dailyTargetMs / 60_000) || 5}m)"
          >
          <div class="stepper-btns">
            <button class="stepper-btn" tabindex="-1" aria-label="Increase" data-dir="up">
              <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"><polygon points="4,0 8,5 0,5"/></svg>
            </button>
            <button class="stepper-btn" tabindex="-1" aria-label="Decrease" data-dir="down">
              <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"><polygon points="0,0 8,0 4,5"/></svg>
            </button>
          </div>
        </div>
        <span class="project-target-unit">min</span>
        <button class="project-target-apply" data-project-id="${p.id}" disabled>Apply Changes</button>
      </div>
    </div>`).join("")

  // All project card interactions use delegated listeners on the container.
  // The container element persists across renderProjectsTab() calls so we
  // attach once; subsequent renders just replace innerHTML without re-binding.
  if (!projectCardsListenerBound) {
    projectCardsListenerBound = true

    container.addEventListener("click", e => {
      const target = e.target as HTMLElement

      // Stop propagation from input/stepper clicks reaching the card handler
      if (target.closest(".project-target-input")) {
        e.stopPropagation()
        return
      }

      // Apply Changes button
      const applyBtn = target.closest(".project-target-apply") as HTMLButtonElement | null
      if (applyBtn) {
        e.stopPropagation()
        const pid = applyBtn.dataset.projectId ?? ""
        const input = container.querySelector<HTMLInputElement>(`.project-target-input[data-project-id="${pid}"]`)
        if (!input) return
        const raw = input.value.trim()
        const value = raw === "" ? null : parseInt(raw)
        vscode.postMessage({ type: "updateProjectSetting", projectId: pid, key: "dailyTargetMinutes", value })
        applyBtn.textContent = "Saved ✓"
        applyBtn.disabled = true
        setTimeout(() => { applyBtn.textContent = "Apply Changes" }, 1500)
        return
      }

      // Click on card body to filter by project
      const card = target.closest(".project-card") as HTMLElement | null
      if (card && !target.closest(".project-card-target")) {
        const id = card.dataset.id ?? ""
        selectedProjectIds = [id]
        pendingSelectedId = id
        vscode.postMessage({ type: "selectProjects", projectIds: [id] })
        renderProjectDropdown()
        updateDropdownLabel()
        switchTab("overview")
      }
    })

    container.addEventListener("input", e => {
      const input = (e.target as HTMLElement).closest(".project-target-input") as HTMLInputElement | null
      if (!input) return
      e.stopPropagation()
      const pid = input.dataset.projectId ?? ""
      const btn = container.querySelector<HTMLButtonElement>(`.project-target-apply[data-project-id="${pid}"]`)
      if (btn) btn.disabled = false
    })
  }
}

// ── Projects mini widget ────────────────────────────────────────────────────

function renderProjectsMini(): void {
  const widget = document.getElementById("projects-mini")
  const isSingleProject = selectedProjectIds.length > 0 && selectedProjectIds[0] !== "all"
  if (widget) widget.style.display = isSingleProject ? "none" : ""
  if (isSingleProject) return

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

// ── Activity tab charts ────────────────────────────────────────────────────

function projectNameMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const p of projects) map[p.id] = p.name
  return map
}

function renderActivityCharts(): void {
  const today = todayDateStr()

  // Always show at least 7 days — use heatmapLogs tail when selection is < 7 days
  let chartLogs = currentLogs
  let shortRange = currentLogs.length <= 7
  if (currentLogs.length < 7) {
    chartLogs = heatmapLogs.slice(-7)
    shortRange = true
  }

  charts.renderActivityChart(chartLogs, shortRange, today)

  const isAllProjects = selectedProjectIds.length === 0
  if (isAllProjects) {
    charts.renderProjectPie(currentLogs, projectNameMap())
  } else {
    document.getElementById("project-pie-box")?.classList.add("hidden")
  }

  const subtitleEl = document.getElementById("activity-chart-subtitle")
  if (subtitleEl) {
    subtitleEl.textContent = shortRange ? "Active time per day" : "Active time trend"
  }
}

// ── Full render ────────────────────────────────────────────────────────────

function renderAll(): void {
  const heatmapProjectName = selectedProjectIds.length === 0
    ? "All Projects"
    : projects.find(p => p.id === selectedProjectIds[0])?.name ?? ""
  // Invalidate list caches so a full re-render always happens on range/project change
  lastRenderedSessionsKey = ""
  lastRenderedFilesKey = ""
  heatmap.render(heatmapLogs)
  heatmap.renderActivityStats(heatmapLogs, heatmapProjectName)
  charts.renderAll(currentLogs)
  renderActivityCharts()
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
      projectActiveTimes = msg.projectActiveTimes
      if (!initializedProject && currentProjectId && currentProjectId !== "all") {
        initializedProject = true
        selectedProjectIds = [currentProjectId]
        pendingSelectedId = currentProjectId
      }
      renderProjectDropdown()
      updateDropdownLabel()
      renderAll()
      break

    case "update": {
      if (selectedProjectIds.length === 0) {
        // All Projects view: patch today's global activeTime and streak
        const todayIdx = currentLogs.findIndex(l => l.date === msg.data.date)
        if (todayIdx >= 0) {
          currentLogs[todayIdx].activeTime = msg.globalToday.activeTime
          currentLogs[todayIdx].streak = msg.globalToday.streak
        }
        const heatmapTodayIdx = heatmapLogs.findIndex(l => l.date === msg.data.date)
        if (heatmapTodayIdx >= 0) heatmapLogs[heatmapTodayIdx].activeTime = msg.globalToday.activeTime
        updateStatCards(currentLogs)
        heatmap.render(heatmapLogs)
      } else if (currentPreset === "today" && selectedProjectIds[0] === msg.projectId) {
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
      const nameInput = document.getElementById("export-display-name") as HTMLInputElement | null
      const displayName = nameInput?.value.trim() || msg.projectName
      const options: PdfOptions = {
        projectName: displayName,
        dateRange:   msg.dateRange,
        isToday:     true,
      }
      generateJpg(msg.logs, options).then(dataUrl => {
        const base64 = dataUrl.split(",")[1]
        vscode.postMessage({ type: "writeJpg", base64, projectName: msg.projectName })
        closePdfModal()
      }).catch(() => {
        const btn = document.getElementById("pdf-generate") as HTMLButtonElement | null
        if (btn) { btn.disabled = false; btn.textContent = "Export JPG" }
      })
      break
    }
  }
})

// Date preset dropdown
document.getElementById("date-preset-select")?.addEventListener("change", (e: Event) => {
  const sel = e.target as HTMLSelectElement
  handlePresetChange(sel.value)
})

// Calendar mode toggle (Single Day / Date Range)
document.getElementById("cal-mode-single")?.addEventListener("click", (e: Event) => {
  e.stopPropagation()
  if (calPickMode === "single") return
  calPickMode = "single"
  calRangeStart = null
  calRangeEnd = null
  calPickStep = 1
  document.getElementById("cal-mode-single")?.classList.add("active")
  document.getElementById("cal-mode-range")?.classList.remove("active")
  calRenderGrid()
})
document.getElementById("cal-mode-range")?.addEventListener("click", (e: Event) => {
  e.stopPropagation()
  if (calPickMode === "range") return
  calPickMode = "range"
  calRangeStart = null
  calRangeEnd = null
  calPickStep = 1
  document.getElementById("cal-mode-range")?.classList.add("active")
  document.getElementById("cal-mode-single")?.classList.remove("active")
  calRenderGrid()
})

// Calendar button — toggle popover
document.getElementById("calendar-btn")?.addEventListener("click", (e: Event) => {
  e.stopPropagation()
  const popover = document.getElementById("calendar-popover")
  if (popover?.classList.contains("hidden")) {
    openCalendar()
  } else {
    closeCalendar()
  }
})

// Calendar grid — day cell clicks
document.getElementById("cal-grid")?.addEventListener("click", (e: Event) => {
  e.stopPropagation() // calRenderGrid() replaces innerHTML, detaching the target — stop before document handler sees a detached element and closes the popover
  const cell = (e.target as HTMLElement).closest(".cal-day") as HTMLElement | null
  if (!cell || cell.classList.contains("cal-day-empty") || cell.classList.contains("cal-day-future")) return
  const ds = cell.dataset.date
  if (!ds) return

  if (calPickMode === "single") {
    calRangeStart = ds
    calRangeEnd = ds
    calPickStep = 2
    calRenderGrid()
    applyCalendarRange()
    return
  }
  // Range mode: two-click flow
  if (calPickStep === 1) {
    calRangeStart = ds
    calRangeEnd = null
    calPickStep = 2
  } else {
    calRangeEnd = ds
  }
  calRenderGrid()
})

// Calendar navigation
document.getElementById("cal-prev")?.addEventListener("click", () => {
  calViewMonth--
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear-- }
  calRenderGrid()
})
document.getElementById("cal-next")?.addEventListener("click", () => {
  calViewMonth++
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++ }
  calRenderGrid()
})

// Calendar Apply
document.getElementById("cal-apply")?.addEventListener("click", () => {
  applyCalendarRange()
})

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
    closeCalendar()
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
  lastRenderedSessionsKey = ""
  renderSessions(currentLogs)
})

// Sort dropdown
document.getElementById("sort-select")?.addEventListener("change", (e: Event) => {
  projectSort = (e.target as HTMLSelectElement).value as "time" | "last" | "name"
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

function flashSaved(el: HTMLInputElement): void {
  el.classList.remove("saved")
  // Force reflow so removing+adding the class re-triggers the animation
  void el.offsetWidth
  el.classList.add("saved")
}

// Enable Apply button when a settings input changes
;["pref-daily-target", "pref-idle-threshold", "pref-session-expiry"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", () => {
    const btn = document.querySelector<HTMLButtonElement>(`.setting-apply[data-for="${id}"]`)
    if (btn) btn.disabled = false
  })
})

// Settings Apply buttons
document.addEventListener("click", (e: Event) => {
  const btn = (e.target as HTMLElement).closest(".setting-apply") as HTMLButtonElement | null
  if (!btn || btn.disabled) return
  const inputId = btn.dataset.for ?? ""
  const input = document.getElementById(inputId) as HTMLInputElement | null
  if (!input) return

  if (inputId === "pref-daily-target") {
    const raw = input.value.trim()
    vscode.postMessage({ type: "updateSetting", key: "dailyTargetMinutes", value: raw === "" ? null : parseInt(raw) })
  } else if (inputId === "pref-idle-threshold") {
    const val = parseInt(input.value)
    if (isNaN(val) || val <= 0) return
    vscode.postMessage({ type: "updateSetting", key: "idleThresholdMinutes", value: val })
  } else if (inputId === "pref-session-expiry") {
    const val = parseInt(input.value)
    if (isNaN(val) || val <= 0) return
    vscode.postMessage({ type: "updateSetting", key: "sessionExpiryMinutes", value: val })
  }

  flashSaved(input)
  btn.disabled = true
})

// Stepper buttons for number inputs
document.addEventListener("click", (e: Event) => {
  const btn = (e.target as HTMLElement).closest(".stepper-btn") as HTMLElement | null
  if (!btn) return
  const input = (
    (btn.dataset.for ? document.getElementById(btn.dataset.for) : null) ??
    btn.closest(".stepper-wrapper")?.querySelector("input")
  ) as HTMLInputElement | null
  if (!input) return
  const step = parseFloat(input.step) || 1
  const min  = input.min !== "" ? parseFloat(input.min) : -Infinity
  const max  = input.max !== "" ? parseFloat(input.max) :  Infinity
  const cur  = input.value !== "" ? parseFloat(input.value) : (min !== -Infinity ? min : 0)
  const next = btn.dataset.dir === "up"
    ? Math.min(max, cur + step)
    : Math.max(min, cur - step)
  input.value = String(next)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
})

// ── Export modal (JPG) ──────────────────────────────────────────────────────

function closePdfModal(): void {
  document.getElementById("pdf-modal-overlay")?.classList.add("hidden")
  const btn = document.getElementById("pdf-generate") as HTMLButtonElement | null
  if (btn) { btn.disabled = false; btn.textContent = "Export JPG" }
}

function syncExportName(): void {
  const sel = document.getElementById("export-project-select") as HTMLSelectElement | null
  const nameInput = document.getElementById("export-display-name") as HTMLInputElement | null
  if (!sel || !nameInput) return
  const pid = sel.value
  const raw = pid === "all" ? "All Projects" : (projects.find(p => p.id === pid)?.name ?? "")
  nameInput.value = raw.length > 20 ? raw.slice(0, 17) + "..." : raw
}

document.getElementById("export-project-select")?.addEventListener("change", syncExportName)

document.getElementById("export-pdf-btn")?.addEventListener("click", () => {
  const sel = document.getElementById("export-project-select") as HTMLSelectElement | null
  if (sel) {
    sel.innerHTML = ""
    const allOpt = document.createElement("option")
    allOpt.value = "all"
    allOpt.textContent = "All Projects"
    sel.appendChild(allOpt)
    for (const p of projects) {
      const opt = document.createElement("option")
      opt.value = p.id
      opt.textContent = p.name
      sel.appendChild(opt)
    }
    const current = selectedProjectIds.length > 0 ? selectedProjectIds[0] : "all"
    sel.value = current
  }
  syncExportName()
  document.getElementById("pdf-modal-overlay")?.classList.remove("hidden")
})

const exportNameInput = document.getElementById("export-display-name") as HTMLInputElement | null
const exportNameHint  = document.getElementById("export-name-hint")
const exportNameCount = document.getElementById("export-name-count")

exportNameInput?.addEventListener("focus", () => {
  exportNameHint?.classList.remove("hidden")
  if (exportNameCount) exportNameCount.textContent = String(exportNameInput?.value.length ?? 0)
})
exportNameInput?.addEventListener("blur", () => exportNameHint?.classList.add("hidden"))
exportNameInput?.addEventListener("input", () => {
  if (exportNameCount) exportNameCount.textContent = String(exportNameInput?.value.length ?? 0)
})

document.getElementById("pdf-cancel")?.addEventListener("click", closePdfModal)

document.getElementById("pdf-modal-overlay")?.addEventListener("click", (e: Event) => {
  if (e.target === document.getElementById("pdf-modal-overlay")) closePdfModal()
})

document.getElementById("pdf-generate")?.addEventListener("click", () => {
  const btn = document.getElementById("pdf-generate") as HTMLButtonElement
  btn.disabled = true
  btn.textContent = "Generating…"
  const sel = document.getElementById("export-project-select") as HTMLSelectElement | null
  vscode.postMessage({ type: "exportPdfRequest", preset: "today", exportProjectId: sel?.value ?? "all" })
})

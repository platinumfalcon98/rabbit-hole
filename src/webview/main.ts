import { DailyLog, ExtensionMessage } from "../shared/types"
import * as heatmap from "./heatmap"
import * as charts from "./charts"

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

const vscode = acquireVsCodeApi()

let currentLogs: DailyLog[] = []

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

function aggregateFiles(logs: DailyLog[]) {
  const map = new Map<string, { path: string; language: string; linesAdded: number; linesDeleted: number }>()
  for (const log of logs) {
    for (const file of log.files) {
      const existing = map.get(file.path)
      if (existing) {
        existing.linesAdded += file.linesAdded
        existing.linesDeleted += file.linesDeleted
      } else {
        map.set(file.path, { path: file.path, language: file.language, linesAdded: file.linesAdded, linesDeleted: file.linesDeleted })
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
    container.innerHTML = `<span class="empty-state">No file activity yet</span>`
    return
  }

  container.innerHTML = files.map(f => `
    <div class="file-row">
      <span class="file-path" title="${f.path}">${shortenPath(f.path)}</span>
      <span class="file-lang">${f.language}</span>
      <span class="file-add">+${f.linesAdded}</span>
      <span class="file-del">-${f.linesDeleted}</span>
    </div>`).join("")
}

function renderSessions(logs: DailyLog[]): void {
  const container = document.getElementById("sessions-list")
  if (!container) return
  container.innerHTML = ""

  // Most recent date first
  const sorted = [...logs].reverse()
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
      row.innerHTML =
        `<span class="session-time">${formatTime(session.startTime)} – ${end}</span>` +
        `<span class="session-active">${formatDuration(session.activeTime)} active</span>`
      container.appendChild(row)
    }
  }
}

function updateStatCards(log: DailyLog | undefined): void {
  if (!log) return

  const timeEl = document.getElementById("stat-time")
  const addedEl = document.getElementById("stat-added")
  const deletedEl = document.getElementById("stat-deleted")
  const aiEl = document.getElementById("stat-ai")
  const streakEl = document.getElementById("streak-count")

  if (timeEl) timeEl.textContent = formatDuration(log.activeTime)
  if (addedEl) {
    const total = log.files.reduce((s, f) => s + f.linesAdded, 0)
    addedEl.textContent = String(total)
  }
  if (deletedEl) {
    const total = log.files.reduce((s, f) => s + f.linesDeleted, 0)
    deletedEl.textContent = String(total)
  }
  if (aiEl) {
    const aiEvents = Object.entries(log.agents)
      .filter(([k]) => k !== "manual")
      .flatMap(([, v]) => v)
    aiEl.textContent = String(aiEvents.length)
  }
  if (streakEl) {
    streakEl.textContent = String(log.streak)
  }
}

// On load — signal ready
window.addEventListener("DOMContentLoaded", () => {
  vscode.postMessage({ type: "ready" })
})

// Receive messages from extension
window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as ExtensionMessage
  switch (msg.type) {
    case "init":
      currentLogs = msg.data
      heatmap.render(currentLogs)
      charts.renderAll(currentLogs)
      updateStatCards(currentLogs[currentLogs.length - 1])
      renderSessions(currentLogs)
      renderFiles(currentLogs)
      break
    case "update": {
      // Replace today's entry in currentLogs, keep the rest
      const todayIdx = currentLogs.findIndex(l => l.date === msg.data.date)
      if (todayIdx >= 0) currentLogs[todayIdx] = msg.data
      charts.updateToday(msg.data)
      updateStatCards(msg.data)
      renderSessions(currentLogs)
      renderFiles(currentLogs)
      break
    }
    case "settings":
      // Could toggle UI state based on settings
      break
  }
})

// Range selector
document.getElementById("range")?.addEventListener("change", (e: Event) => {
  const days = parseInt((e.target as HTMLSelectElement).value) as 7 | 30 | 90
  vscode.postMessage({ type: "requestRange", days })
})

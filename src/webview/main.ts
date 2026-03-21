import { DailyLog, ExtensionMessage } from "../shared/types"
import * as heatmap from "./heatmap"
import * as charts from "./charts"

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

const vscode = acquireVsCodeApi()

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
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
      heatmap.render(msg.data)
      charts.renderAll(msg.data)
      updateStatCards(msg.data[msg.data.length - 1])
      break
    case "update":
      charts.updateToday(msg.data)
      updateStatCards(msg.data)
      break
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

import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  PieController,
  ArcElement,
} from "chart.js"
import { AgentName, DailyLog } from "../shared/types"

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  PieController,
  ArcElement
)

const AGENT_COLORS: Record<AgentName, string> = {
  "claude-code": "#9b59b6",
  "copilot":     "#3498db",
  "cursor":      "#1abc9c",
  "continue":    "#2ecc71",
  "unknown-ai":  "#e67e22",
  "manual":      "#95a5a6",
}

let linesChart: Chart | null = null
let langChart: Chart | null = null
let agentChart: Chart | null = null

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim()
}

const gridColor = () =>
  getCssVar("--vscode-editorWidget-border") || "rgba(128,128,128,0.2)"
const labelColor = () =>
  getCssVar("--vscode-editor-foreground") || "#ccc"

function destroyAll(): void {
  linesChart?.destroy()
  langChart?.destroy()
  agentChart?.destroy()
  linesChart = null
  langChart = null
  agentChart = null
}

export function renderAll(logs: DailyLog[]): void {
  destroyAll()
  renderLinesChart(logs)
  renderLangChart(logs)
  renderAgentChart(logs)
}

export function updateToday(log: DailyLog): void {
  if (!linesChart || !langChart || !agentChart) return
  // Just re-render everything for simplicity
  // This is called with a single DailyLog update, but we don't have the full range
  // in this context. A light update to the last data point is done.
  updateLinesChartToday(log)
  updateAgentChartToday(log)
}

// ── Lines Bar Chart ────────────────────────────────────────────────────────

function renderLinesChart(logs: DailyLog[]): void {
  const canvas = document.getElementById("lines-chart") as HTMLCanvasElement | null
  if (!canvas) return

  const labels = logs.map(l => l.date.slice(5)) // MM-DD
  const added = logs.map(l => l.files.reduce((s, f) => s + f.linesAdded, 0))
  const deleted = logs.map(l => l.files.reduce((s, f) => s + f.linesDeleted, 0))

  linesChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Lines Added",
          data: added,
          backgroundColor: "rgba(46, 204, 113, 0.7)",
          borderColor: "rgba(46, 204, 113, 1)",
          borderWidth: 1,
        },
        {
          label: "Lines Deleted",
          data: deleted,
          backgroundColor: "rgba(231, 76, 60, 0.7)",
          borderColor: "rgba(231, 76, 60, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: labelColor() } },
        tooltip: { mode: "index" },
      },
      scales: {
        x: {
          ticks: { color: labelColor(), maxRotation: 45 },
          grid: { color: gridColor() },
        },
        y: {
          ticks: { color: labelColor() },
          grid: { color: gridColor() },
        },
      },
    },
  })
}

function updateLinesChartToday(log: DailyLog): void {
  if (!linesChart) return
  const lastIdx = (linesChart.data.labels?.length ?? 1) - 1
  if (linesChart.data.datasets[0]) {
    linesChart.data.datasets[0].data[lastIdx] = log.files.reduce(
      (s, f) => s + f.linesAdded,
      0
    )
  }
  if (linesChart.data.datasets[1]) {
    linesChart.data.datasets[1].data[lastIdx] = log.files.reduce(
      (s, f) => s + f.linesDeleted,
      0
    )
  }
  linesChart.update()
}

// ── Language Pie Chart ─────────────────────────────────────────────────────

function renderLangChart(logs: DailyLog[]): void {
  const canvas = document.getElementById("lang-chart") as HTMLCanvasElement | null
  if (!canvas) return

  // Sum language time across all logs
  const langTime = new Map<string, number>()
  for (const log of logs) {
    for (const [lang, stat] of Object.entries(log.languages)) {
      langTime.set(lang, (langTime.get(lang) ?? 0) + stat.time)
    }
  }

  const sorted = [...langTime.entries()].sort((a, b) => b[1] - a[1])
  const labels = sorted.map(([l]) => l)
  const data = sorted.map(([, t]) => t)
  const total = data.reduce((s, v) => s + v, 0)

  // Generate deterministic colours
  const colors = labels.map((_, i) => `hsl(${(i * 47) % 360}, 65%, 55%)`)

  langChart = new Chart(canvas, {
    type: "pie",
    data: {
      labels: labels.map((l, i) => {
        const pct = total > 0 ? Math.round((data[i] / total) * 100) : 0
        return `${l} (${pct}%)`
      }),
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderColor: getCssVar("--vscode-editor-background") || "#1e1e1e",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "right",
          labels: { color: labelColor(), boxWidth: 14 },
        },
      },
    },
  })
}

// ── Agent Stacked Bar ──────────────────────────────────────────────────────

const AGENT_NAMES: AgentName[] = [
  "claude-code",
  "copilot",
  "cursor",
  "continue",
  "unknown-ai",
  "manual",
]

function renderAgentChart(logs: DailyLog[]): void {
  const canvas = document.getElementById("agent-chart") as HTMLCanvasElement | null
  if (!canvas) return

  const labels = logs.map(l => l.date.slice(5))

  const datasets = AGENT_NAMES.map(agent => ({
    label: agent,
    data: logs.map(log => log.agents[agent]?.length ?? 0),
    backgroundColor: AGENT_COLORS[agent],
    stack: "agents",
  }))

  agentChart = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: labelColor() } },
        tooltip: { mode: "index" },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: labelColor(), maxRotation: 45 },
          grid: { color: gridColor() },
        },
        y: {
          stacked: true,
          ticks: { color: labelColor() },
          grid: { color: gridColor() },
        },
      },
    },
  })
}

function updateAgentChartToday(log: DailyLog): void {
  if (!agentChart) return
  const lastIdx = (agentChart.data.labels?.length ?? 1) - 1
  for (let i = 0; i < AGENT_NAMES.length; i++) {
    const agent = AGENT_NAMES[i]
    const ds = agentChart.data.datasets[i]
    if (ds) {
      ds.data[lastIdx] = log.agents[agent]?.length ?? 0
    }
  }
  agentChart.update()
}

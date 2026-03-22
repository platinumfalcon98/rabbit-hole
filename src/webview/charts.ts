import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  DoughnutController,
  PieController,
  ArcElement,
} from "chart.js"
import { AgentName, DailyLog, LanguageStat } from "../shared/types"

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  DoughnutController,
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

// Lang panel state — persists across range changes and 30s updates
let langChartType: "bar" | "donut" = "bar"
let langMetric: "time" | "lines" = "time"
let langTogglesBound = false
let storedLogs: DailyLog[] = []

interface LangData extends LanguageStat {
  name: string
}

function aggregateLangs(logs: DailyLog[]): LangData[] {
  const map = new Map<string, { time: number; linesAdded: number; linesDeleted: number }>()
  for (const log of logs) {
    for (const [lang, stat] of Object.entries(log.languages)) {
      const existing = map.get(lang) ?? { time: 0, linesAdded: 0, linesDeleted: 0 }
      existing.time += stat.time
      existing.linesAdded += stat.linesAdded
      existing.linesDeleted += stat.linesDeleted
      map.set(lang, existing)
    }
  }
  return [...map.entries()]
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) =>
      langMetric === "time" ? b.time - a.time : (b.linesAdded + b.linesDeleted) - (a.linesAdded + a.linesDeleted)
    )
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

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
  storedLogs = logs
  destroyAll()
  renderLinesChart(logs)
  renderLangPanel(logs)
  renderAgentChart(logs)
}

export function resizeAll(): void {
  linesChart?.resize()
  langChart?.resize()
  agentChart?.resize()
}

export function updateToday(log: DailyLog): void {
  if (!linesChart || !agentChart) return
  updateLinesChartToday(log)
  updateAgentChartToday(log)
  // Re-render lang panel with updated today entry
  const idx = storedLogs.findIndex(l => l.date === log.date)
  if (idx >= 0) storedLogs[idx] = log
  renderLangPanel(storedLogs)
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

// ── Language Panel (Bar / Donut + legend) ──────────────────────────────────

function renderLangPanel(logs: DailyLog[]): void {
  const canvas = document.getElementById("lang-chart") as HTMLCanvasElement | null
  const legendEl = document.getElementById("lang-legend")
  if (!canvas) return

  langChart?.destroy()
  langChart = null

  const langs = aggregateLangs(logs)
  const colors = langs.map((_, i) => `hsl(${(i * 47) % 360}, 65%, 55%)`)

  if (langs.length === 0) {
    if (legendEl) legendEl.innerHTML = ""
    return
  }

  const metricValues = langs.map(l =>
    langMetric === "time" ? l.time : l.linesAdded + l.linesDeleted
  )
  const total = metricValues.reduce((s, v) => s + v, 0)

  if (langChartType === "bar") {
    langChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: langs.map(l => l.name),
        datasets: [{
          data: metricValues,
          backgroundColor: colors,
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const l = langs[ctx.dataIndex]
                return langMetric === "time"
                  ? ` ${formatDuration(l.time)}`
                  : ` ${l.linesAdded + l.linesDeleted} lines`
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: labelColor(),
              callback: v =>
                langMetric === "time" ? formatDuration(v as number) : String(v),
            },
            grid: { color: gridColor() },
          },
          y: { ticks: { color: labelColor() }, grid: { color: gridColor() } },
        },
      },
    })
  } else {
    langChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: langs.map((l, i) => {
          const pct = total > 0 ? Math.round((metricValues[i] / total) * 100) : 0
          return `${l.name} (${pct}%)`
        }),
        datasets: [{
          data: metricValues,
          backgroundColor: colors,
          borderColor: getCssVar("--vscode-editor-background") || "#1e1e1e",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
      },
    })
  }

  // Legend table — always shows time + lines regardless of metric toggle
  if (legendEl) {
    const rows = langs.map((l, i) => `
      <tr>
        <td><span class="color-dot" style="background:${colors[i]}"></span></td>
        <td class="legend-name">${l.name}</td>
        <td class="legend-val">${formatDuration(l.time)}</td>
        <td class="legend-val legend-add">+${l.linesAdded}</td>
        <td class="legend-val legend-del">-${l.linesDeleted}</td>
      </tr>`).join("")
    legendEl.innerHTML = `
      <table class="lang-legend-table">
        <thead>
          <tr>
            <th></th><th>Language</th><th>Time</th><th>Added</th><th>Deleted</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  // Bind toggle buttons once
  if (!langTogglesBound) {
    langTogglesBound = true
    document.getElementById("lang-chart-type")?.addEventListener("click", e => {
      const btn = (e.target as HTMLElement).closest("[data-val]") as HTMLElement | null
      if (!btn) return
      langChartType = btn.dataset.val as "bar" | "donut"
      document.querySelectorAll("#lang-chart-type .toggle-btn").forEach(b =>
        b.classList.toggle("active", b === btn)
      )
      renderLangPanel(storedLogs)
    })
    document.getElementById("lang-metric")?.addEventListener("click", e => {
      const btn = (e.target as HTMLElement).closest("[data-val]") as HTMLElement | null
      if (!btn) return
      langMetric = btn.dataset.val as "time" | "lines"
      document.querySelectorAll("#lang-metric .toggle-btn").forEach(b =>
        b.classList.toggle("active", b === btn)
      )
      renderLangPanel(storedLogs)
    })
  }
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

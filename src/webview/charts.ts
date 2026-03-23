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
import { DailyLog, LanguageStat } from "../shared/types"

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

let linesChart: Chart | null = null
let langChart: Chart | null = null
let resizeObservers: ResizeObserver[] = []

// Lang panel state — persists across range changes and 30s updates
let langMetric: "time" | "lines" = "time"
let langMetricBound = false
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
  resizeObservers.forEach(o => o.disconnect())
  resizeObservers = []
  linesChart?.destroy()
  langChart?.destroy()
  linesChart = null
  langChart = null
}

function watchResize(el: Element, fn: () => void): void {
  const obs = new ResizeObserver(fn)
  obs.observe(el)
  resizeObservers.push(obs)
}

export function renderAll(logs: DailyLog[]): void {
  storedLogs = logs
  destroyAll()
  renderLinesChart(logs)
  renderLangPanel(logs)
}

export function resizeAll(): void {
  linesChart?.resize()
  langChart?.resize()
}

export function updateToday(log: DailyLog): void {
  if (!linesChart) return
  updateLinesChartToday(log)
  renderLangPanel(storedLogs)
}

// ── Lines Bar Chart ────────────────────────────────────────────────────────

function renderLinesChart(logs: DailyLog[]): void {
  const canvas = document.getElementById("lines-chart") as HTMLCanvasElement | null
  if (!canvas) return

  const added   = logs.reduce((s, l) => s + l.files.reduce((fs, f) => fs + f.linesAdded, 0), 0)
  const deleted = logs.reduce((s, l) => s + l.files.reduce((fs, f) => fs + f.linesDeleted, 0), 0)

  linesChart = new Chart(canvas, {
    type: "pie",
    data: {
      labels: ["Lines Added", "Lines Deleted"],
      datasets: [{
        data: [added, deleted],
        backgroundColor: ["rgba(46, 204, 113, 0.75)", "rgba(231, 76, 60, 0.75)"],
        borderColor: getCssVar("--vscode-editor-background") || "#1e1e1e",
        borderWidth: added === 0 || deleted === 0 ? 0 : 2,
      }],
    },
    options: {
      responsive: true,
      aspectRatio: 1.6,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: labelColor(), boxWidth: 10, padding: 12, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed}`,
          },
        },
      },
    },
  })
  if (canvas.parentElement) watchResize(canvas.parentElement, () => linesChart?.resize())
}

function updateLinesChartToday(log: DailyLog): void {
  if (!linesChart) return
  const idx = storedLogs.findIndex(l => l.date === log.date)
  if (idx >= 0) storedLogs[idx] = log
  const added   = storedLogs.reduce((s, l) => s + l.files.reduce((fs, f) => fs + f.linesAdded, 0), 0)
  const deleted = storedLogs.reduce((s, l) => s + l.files.reduce((fs, f) => fs + f.linesDeleted, 0), 0)
  linesChart.data.datasets[0].data = [added, deleted]
  ;(linesChart.data.datasets[0] as any).borderWidth = added === 0 || deleted === 0 ? 0 : 2
  linesChart.update()
}

// ── Language Panel (Bar / Donut + legend) ──────────────────────────────────

function renderLangPanel(logs: DailyLog[]): void {
  const canvas = document.getElementById("lang-chart") as HTMLCanvasElement | null
  const legendEl = document.getElementById("lang-legend")
  if (!canvas) return

  langChart?.destroy()
  langChart = null

  const langs = aggregateLangs(logs).filter(l =>
    langMetric === "time" ? l.time >= 60_000 : (l.linesAdded + l.linesDeleted) > 0
  )
  const colors = langs.map((_, i) => `hsl(${(i * 47) % 360}, 65%, 55%)`)

  if (langs.length === 0) {
    if (legendEl) legendEl.innerHTML = ""
    return
  }

  const metricValues = langs.map(l =>
    langMetric === "time" ? l.time : l.linesAdded + l.linesDeleted
  )
  const total = metricValues.reduce((s, v) => s + v, 0)

  langChart = new Chart(canvas, {
    type: "pie",
    data: {
      labels: langs.map(l => l.name),
      datasets: [{
        data: metricValues,
        backgroundColor: colors,
        borderColor: getCssVar("--vscode-editor-background") || "#1e1e1e",
        borderWidth: langs.length === 1 ? 0 : 2,
      }],
    },
    options: {
      responsive: true,
      aspectRatio: 1.6,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: labelColor(), boxWidth: 10, padding: 12, font: { size: 11 } },
        },
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
    },
  })

  if (canvas.parentElement) watchResize(canvas.parentElement, () => langChart?.resize())

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

  // Bind metric toggle once
  if (!langMetricBound) {
    langMetricBound = true
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


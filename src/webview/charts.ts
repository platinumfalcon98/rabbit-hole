import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Filler,
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
  LineController,
  LineElement,
  PointElement,
  Filler,
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
let activityChart: Chart | null = null
let activityChartType: "bar" | "line" | null = null
let projectPieChart: Chart | null = null
let resizeObservers: ResizeObserver[] = []
let langResizeObs: ResizeObserver | null = null

interface LangData extends LanguageStat {
  name: string
}

// Lang panel state — persists across range changes and 30s updates
let langMetric: "time" | "lines" = "time"
let langMetricBound = false
let storedLogs: DailyLog[] = []
let currentLangData: LangData[] = []

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
  if (ms <= 0) return "—"
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
  langResizeObs?.disconnect()
  langResizeObs = null
  linesChart?.destroy()
  langChart?.destroy()
  activityChart?.destroy()
  projectPieChart?.destroy()
  linesChart = null
  langChart = null
  activityChart = null
  activityChartType = null
  projectPieChart = null
}

function watchResize(el: Element, fn: () => void): void {
  const obs = new ResizeObserver(fn)
  obs.observe(el)
  resizeObservers.push(obs)
}

export function renderAll(logs: DailyLog[]): void {
  storedLogs = logs
  renderLinesChart(logs)
  renderLangPanel(logs)
}

export function resizeAll(): void {
  linesChart?.resize()
  langChart?.resize()
  activityChart?.resize()
  projectPieChart?.resize()
}

export function updateToday(log: DailyLog): void {
  updateLinesChartToday(log)
  renderLangPanel(storedLogs)
}

// ── Lines Bar Chart ────────────────────────────────────────────────────────

function renderLinesChart(logs: DailyLog[]): void {
  const canvas = document.getElementById("lines-chart") as HTMLCanvasElement | null
  if (!canvas) return

  const added   = logs.reduce((s, l) => s + l.files.reduce((fs, f) => fs + f.linesAdded, 0), 0)
  const deleted = logs.reduce((s, l) => s + l.files.reduce((fs, f) => fs + f.linesDeleted, 0), 0)

  if (linesChart) {
    linesChart.data.datasets[0].data = [added, deleted]
    ;(linesChart.data.datasets[0] as any).borderWidth = added === 0 || deleted === 0 ? 0 : 2
    linesChart.update()
    return
  }

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
  const idx = storedLogs.findIndex(l => l.date === log.date)
  if (idx >= 0) storedLogs[idx] = log
  renderLinesChart(storedLogs)
}

// ── Language Panel (Bar / Donut + legend) ──────────────────────────────────

function renderLangPanel(logs: DailyLog[]): void {
  const canvas = document.getElementById("lang-chart") as HTMLCanvasElement | null
  const legendEl = document.getElementById("lang-legend")
  if (!canvas) return

  currentLangData = aggregateLangs(logs).filter(l =>
    langMetric === "time" ? l.time >= 60_000 : (l.linesAdded + l.linesDeleted) > 0
  )
  const langs = currentLangData
  const colors = langs.map((_, i) => `hsl(${(i * 47) % 360}, 65%, 55%)`)

  if (langs.length === 0) {
    langChart?.destroy()
    langChart = null
    if (legendEl) legendEl.innerHTML = ""
    return
  }

  const metricValues = langs.map(l =>
    langMetric === "time" ? l.time : l.linesAdded + l.linesDeleted
  )

  // Update in place when same languages are displayed; recreate on structural change
  const newLabels = langs.map(l => l.name)
  const existingLabels = langChart?.data.labels as string[] | undefined
  const sameStructure = langChart
    && existingLabels
    && existingLabels.length === newLabels.length
    && existingLabels.every((lbl, i) => lbl === newLabels[i])

  if (sameStructure && langChart) {
    langChart.data.datasets[0].data = metricValues
    ;(langChart.data.datasets[0] as any).borderWidth = langs.length === 1 ? 0 : 2
    langChart.update()
  } else {
    langChart?.destroy()
    langChart = null

    // Tooltip reads from currentLangData (module-level) so it stays current
    // even when the chart is updated in place after a metric toggle.
    langChart = new Chart(canvas, {
      type: "pie",
      data: {
        labels: newLabels,
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
                const l = currentLangData[ctx.dataIndex]
                if (!l) return ""
                return langMetric === "time"
                  ? ` ${formatDuration(l.time)}`
                  : ` ${l.linesAdded + l.linesDeleted} lines`
              },
            },
          },
        },
      },
    })

    if (canvas.parentElement) {
      langResizeObs?.disconnect()
      langResizeObs = new ResizeObserver(() => langChart?.resize())
      langResizeObs.observe(canvas.parentElement)
    }
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

// ── Daily Active Time Chart (bar ≤7 days, line >7 days) ───────────────────

// Day abbreviations for x-axis labels
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return WEEKDAY_SHORT[d.getDay()]
}

function formatYAxis(ms: number): string | null {
  if (ms <= 0) return "0"
  const totalMinutes = ms / 60_000
  const hours = totalMinutes / 60
  if (hours % 1 !== 0) return null   // skip fractional hours
  return `${hours}h`
}

export function renderActivityChart(
  logs: DailyLog[],
  isShortRange: boolean,
  todayStr: string
): void {
  const canvas = document.getElementById("activity-chart") as HTMLCanvasElement | null
  if (!canvas) return

  if (logs.length === 0) {
    activityChart?.destroy()
    activityChart = null
    activityChartType = null
    return
  }

  const neededType: "bar" | "line" = isShortRange ? "bar" : "line"
  const labels = logs.map(l => isShortRange ? dayLabel(l.date) : l.date.slice(5))
  const values = logs.map(l => l.activeTime)
  const todayIdx = logs.findIndex(l => l.date === todayStr)

  // If the chart type needs to change (or doesn't exist), destroy and recreate
  if (!activityChart || activityChartType !== neededType) {
    activityChart?.destroy()
    activityChart = null
    activityChartType = null

    if (isShortRange) {
      const barBg = logs.map((_, i) =>
        i === todayIdx ? "#f97316" : "rgba(249,115,22,0.45)"
      )
      const barBorder = logs.map((_, i) =>
        i === todayIdx ? "#fb923c" : "rgba(249,115,22,0.7)"
      )
      activityChart = new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: barBg,
            borderColor: barBorder,
            borderWidth: 1,
            borderRadius: 3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => logs[ctx[0].dataIndex].date,
                label: ctx => ` ${formatDuration(ctx.raw as number)}`,
              },
            },
          },
          scales: {
            x: {
              grid: { color: gridColor() },
              ticks: { color: labelColor(), font: { size: 11 } },
            },
            y: {
              grid: { color: gridColor() },
              ticks: {
                color: labelColor(),
                font: { size: 11 },
                callback: (val) => formatYAxis(val as number),
                stepSize: 3_600_000,
              },
              beginAtZero: true,
            },
          },
        },
      })
    } else {
      const lineColor = "#f97316"
      const fillColor = "rgba(249,115,22,0.12)"
      activityChart = new Chart(canvas, {
        type: "line",
        data: {
          labels,
          datasets: [{
            data: values,
            borderColor: lineColor,
            backgroundColor: fillColor,
            borderWidth: 2,
            pointRadius: logs.map((_, i) => i === todayIdx ? 5 : 2),
            pointBackgroundColor: logs.map((_, i) =>
              i === todayIdx ? "#f97316" : "rgba(249,115,22,0.6)"
            ),
            tension: 0.35,
            fill: true,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => logs[ctx[0].dataIndex].date,
                label: ctx => ` ${formatDuration(ctx.raw as number)}`,
              },
            },
          },
          scales: {
            x: {
              grid: { color: gridColor() },
              ticks: {
                color: labelColor(),
                font: { size: 10 },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 12,
              },
            },
            y: {
              grid: { color: gridColor() },
              ticks: {
                color: labelColor(),
                font: { size: 11 },
                callback: (val) => formatYAxis(val as number),
                stepSize: 3_600_000,
              },
              beginAtZero: true,
            },
          },
        },
      })
    }

    activityChartType = neededType
    if (canvas.parentElement) watchResize(canvas.parentElement, () => activityChart?.resize())
    return
  }

  // Same type — update data in place
  activityChart.data.labels = labels
  activityChart.data.datasets[0].data = values
  if (isShortRange) {
    activityChart.data.datasets[0].backgroundColor = logs.map((_, i) =>
      i === todayIdx ? "#f97316" : "rgba(249,115,22,0.45)"
    )
    activityChart.data.datasets[0].borderColor = logs.map((_, i) =>
      i === todayIdx ? "#fb923c" : "rgba(249,115,22,0.7)"
    )
  } else {
    ;(activityChart.data.datasets[0] as any).pointRadius = logs.map((_, i) => i === todayIdx ? 5 : 2)
    ;(activityChart.data.datasets[0] as any).pointBackgroundColor = logs.map((_, i) =>
      i === todayIdx ? "#f97316" : "rgba(249,115,22,0.6)"
    )
  }
  activityChart.update()
}

// ── Project Pie (Activity tab, All Projects view) ─────────────────────────

// Orange palette — varies hue so adjacent slices are visually distinct
const PROJECT_COLORS = [
  "#f97316", "#fb923c", "#fdba74", "#c2410c",
  "#ea580c", "#ff6b35", "#ffa552", "#e86b00",
]

export function renderProjectPie(
  logs: DailyLog[],
  projectNames: Record<string, string>
): void {
  const canvas = document.getElementById("project-pie-chart") as HTMLCanvasElement | null
  const legendEl = document.getElementById("project-pie-legend")
  if (!canvas) return

  // Aggregate active time per project across all logs
  const map = new Map<string, number>()
  for (const log of logs) {
    for (const session of log.sessions) {
      if (!session.projectId) continue
      map.set(session.projectId, (map.get(session.projectId) ?? 0) + session.activeTime)
    }
  }

  const entries = [...map.entries()]
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])

  if (entries.length < 2) {
    projectPieChart?.destroy()
    projectPieChart = null
    document.getElementById("project-pie-box")?.classList.add("hidden")
    if (legendEl) legendEl.innerHTML = ""
    return
  }

  document.getElementById("project-pie-box")?.classList.remove("hidden")

  const labels = entries.map(([id]) => projectNames[id] ?? id)
  const values = entries.map(([, ms]) => ms)
  const colors = entries.map((_, i) => PROJECT_COLORS[i % PROJECT_COLORS.length])
  const total = values.reduce((s, v) => s + v, 0)

  // Update in place when the project set is unchanged
  const existingLabels = projectPieChart?.data.labels as string[] | undefined
  const sameStructure = projectPieChart
    && existingLabels
    && existingLabels.length === labels.length
    && existingLabels.every((lbl, i) => lbl === labels[i])

  if (sameStructure && projectPieChart) {
    projectPieChart.data.datasets[0].data = values
    projectPieChart.update()
  } else {
    projectPieChart?.destroy()
    projectPieChart = null

    projectPieChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: getCssVar("--vscode-editor-background") || "#1e1e1e",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "60%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const ms = values[ctx.dataIndex]
                const pct = total > 0 ? Math.round((ms / total) * 100) : 0
                return ` ${formatDuration(ms)} · ${pct}%`
              },
            },
          },
        },
      },
    })

    if (canvas.parentElement) watchResize(canvas.parentElement, () => projectPieChart?.resize())
  }

  if (legendEl) {
    const rows = entries.map(([id, ms], i) => {
      const pct = total > 0 ? Math.round((ms / total) * 100) : 0
      const name = projectNames[id] ?? id
      return `<tr>
        <td><span class="color-dot" style="background:${colors[i]}"></span></td>
        <td class="legend-name">${name}</td>
        <td class="legend-val">${formatDuration(ms)}</td>
        <td class="legend-val" style="color:var(--vscode-descriptionForeground)">${pct}%</td>
      </tr>`
    }).join("")
    legendEl.innerHTML = `
      <table class="lang-legend-table">
        <thead><tr><th></th><th>Project</th><th>Time</th><th>Share</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  }
}


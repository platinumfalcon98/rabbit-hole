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
import {
  accentColor, accentRgb, successColor, successRgb, dangerRgb,
  infoColor, infoRgb, textColor, surfaceRaisedColor, getCssVar,
  CHART_FONT_MONO, CHART_FONT_LABEL,
} from "./theme"

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
const LANG_TOP_N = 8
const LANG_OTHER_COLOR = "hsl(0, 0%, 45%)"
let langLegendExpanded = false

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

// vscode-tracked border color for gridlines — intentionally not an --rh-* token
const gridColor = () => getCssVar("--vscode-editorWidget-border", "rgba(128,128,128,0.2)")
const labelColor = textColor

// Highlight color for "today" across bar/line/point series, with a dim rgba
// variant for all other data points — hoisted outside the per-day .map()
// callers so we read the CSS custom properties once per render, not once
// per day in the range.
function highlightColors(count: number, todayIdx: number, dimAlpha: number): string[] {
  const accent = accentColor()
  const dim = `rgba(${accentRgb()}, ${dimAlpha})`
  return Array.from({ length: count }, (_, i) => i === todayIdx ? accent : dim)
}

// Phosphor glow for the activity chart's data marks only. The CSS
// #rh-phosphor filter would bloom the whole canvas including axis ticks,
// so this chart is exempt from it and glows bars/line/points here instead:
// a canvas shadow is enabled just while datasets draw.
const phosphorDatasetGlow = {
  id: "phosphorDatasetGlow",
  beforeDatasetDraw(chart: Chart) {
    const ctx = chart.ctx
    ctx.save()
    // No bloom on the light "paper" theme ── matches the CSS-side
    // `filter: none` override on the other chart canvases.
    if (document.body.classList.contains("vscode-light")
      || document.body.classList.contains("vscode-high-contrast-light")) return
    ctx.shadowColor = accentColor()
    ctx.shadowBlur = 5
  },
  afterDatasetDraw(chart: Chart) {
    chart.ctx.restore()
  },
}

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
        backgroundColor: [`rgba(${successRgb()}, 0.75)`, `rgba(${dangerRgb()}, 0.75)`],
        borderColor: surfaceRaisedColor(),
        borderWidth: added === 0 || deleted === 0 ? 0 : 2,
        hoverOffset: 10,
      }],
    },
    options: {
      responsive: true,
      aspectRatio: 1.6,
      layout: { padding: 8 },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: labelColor(), boxWidth: 10, padding: 12, font: { size: 11, family: CHART_FONT_LABEL } },
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

  const allLangs = aggregateLangs(logs).filter(l =>
    langMetric === "time" ? l.time >= 60_000 : (l.linesAdded + l.linesDeleted) > 0
  )

  // Chart shows top N slices; the tail is combined into one muted "Other"
  // slice so a long language tail (agents touch yaml/json/md/…) stays readable
  const topLangs = allLangs.slice(0, LANG_TOP_N)
  const tailLangs = allLangs.slice(LANG_TOP_N)
  const langs: LangData[] = tailLangs.length > 0
    ? [...topLangs, tailLangs.reduce(
        (acc, l) => ({
          name: `Other (${tailLangs.length})`,
          time: acc.time + l.time,
          linesAdded: acc.linesAdded + l.linesAdded,
          linesDeleted: acc.linesDeleted + l.linesDeleted,
        }),
        { name: "", time: 0, linesAdded: 0, linesDeleted: 0 } as LangData
      )]
    : topLangs
  currentLangData = langs
  const colors = langs.map((_, i) =>
    tailLangs.length > 0 && i === langs.length - 1 ? LANG_OTHER_COLOR : `hsl(${(i * 47) % 360}, 65%, 55%)`
  )

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
          borderColor: surfaceRaisedColor(),
          borderWidth: langs.length === 1 ? 0 : 2,
          hoverOffset: 10,
        }],
      },
      options: {
        responsive: true,
        aspectRatio: 1.6,
        layout: { padding: 8 },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: labelColor(), boxWidth: 10, padding: 12, font: { size: 11, family: CHART_FONT_LABEL } },
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

  // Legend table — always shows time + lines regardless of metric toggle.
  // Top N languages always listed; the tail collapses behind a "+N more" row.
  if (legendEl) {
    const legendRow = (l: LangData, color: string) => `
      <tr>
        <td><span class="color-dot" style="background:${color}"></span></td>
        <td class="legend-name">${l.name}</td>
        <td class="legend-val">${formatDuration(l.time)}</td>
        <td class="legend-val legend-add">+${l.linesAdded}</td>
        <td class="legend-val legend-del">-${l.linesDeleted}</td>
      </tr>`

    let rows = topLangs.map((l, i) => legendRow(l, colors[i])).join("")
    if (tailLangs.length > 0) {
      if (langLegendExpanded) {
        rows += tailLangs.map(l => legendRow(l, LANG_OTHER_COLOR)).join("")
        rows += `<tr class="legend-toggle"><td colspan="5">Show less</td></tr>`
      } else {
        rows += `<tr class="legend-toggle"><td colspan="5">${tailLangs.length} more language${tailLangs.length !== 1 ? "s" : ""}</td></tr>`
      }
    }
    legendEl.innerHTML = `
      <table class="lang-legend-table">
        <thead>
          <tr>
            <th></th><th>Language</th><th>Time</th><th>Added</th><th>Deleted</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
    legendEl.querySelector(".legend-toggle")?.addEventListener("click", () => {
      langLegendExpanded = !langLegendExpanded
      renderLangPanel(storedLogs)
    })
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
      const barBg = highlightColors(logs.length, todayIdx, 0.45)
      const barBorder = highlightColors(logs.length, todayIdx, 0.7)
      activityChart = new Chart(canvas, {
        type: "bar",
        plugins: [phosphorDatasetGlow],
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: barBg,
            borderColor: barBorder,
            borderWidth: 1,
            borderRadius: 3,
            hoverBackgroundColor: barBorder,
            hoverBorderWidth: 2,
            // Inflate the hovered bar's rect so it physically pops bigger,
            // matching the pie hoverOffset / heatmap cell scale
            inflateAmount: (ctx: any) => (ctx.active ? 3 : "auto"),
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
              ticks: { color: labelColor(), font: { size: 11, family: CHART_FONT_MONO } },
            },
            y: {
              grid: { color: gridColor() },
              ticks: {
                color: labelColor(),
                font: { size: 11, family: CHART_FONT_MONO },
                callback: (val) => formatYAxis(val as number),
                stepSize: 3_600_000,
              },
              beginAtZero: true,
            },
          },
        },
      })
    } else {
      const lineColor = accentColor()
      const fillColor = `rgba(${accentRgb()}, 0.12)`
      activityChart = new Chart(canvas, {
        type: "line",
        plugins: [phosphorDatasetGlow],
        data: {
          labels,
          datasets: [{
            data: values,
            borderColor: lineColor,
            backgroundColor: fillColor,
            borderWidth: 2,
            pointRadius: logs.map((_, i) => i === todayIdx ? 5 : 2),
            pointBackgroundColor: highlightColors(logs.length, todayIdx, 0.6),
            pointHoverRadius: logs.map((_, i) => i === todayIdx ? 8 : 6),
            pointHoverBackgroundColor: lineColor,
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
                font: { size: 10, family: CHART_FONT_MONO },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 12,
              },
            },
            y: {
              grid: { color: gridColor() },
              ticks: {
                color: labelColor(),
                font: { size: 11, family: CHART_FONT_MONO },
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
    activityChart.data.datasets[0].backgroundColor = highlightColors(logs.length, todayIdx, 0.45)
    activityChart.data.datasets[0].borderColor = highlightColors(logs.length, todayIdx, 0.7)
  } else {
    ;(activityChart.data.datasets[0] as any).pointRadius = logs.map((_, i) => i === todayIdx ? 5 : 2)
    ;(activityChart.data.datasets[0] as any).pointBackgroundColor = highlightColors(logs.length, todayIdx, 0.6)
  }
  activityChart.update()
}

// ── Project Pie (Activity tab, All Projects view) ─────────────────────────

// Phosphor palette — accent/info first, then a few amber/cyan/green variants
// so adjacent project slices stay distinguishable on the dark terminal background
function projectColors(): string[] {
  const accent = accentRgb()
  const info = infoRgb()
  const success = successRgb()
  return [
    accentColor(),
    infoColor(),
    successColor(),
    `rgba(${accent}, 0.55)`,
    `rgba(${info}, 0.55)`,
    `rgba(${success}, 0.55)`,
    `rgba(${accent}, 0.8)`,
    `rgba(${info}, 0.8)`,
  ]
}

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
  const palette = projectColors()
  const colors = entries.map((_, i) => palette[i % palette.length])
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
          borderColor: surfaceRaisedColor(),
          borderWidth: 2,
          hoverOffset: 10,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "60%",
        layout: { padding: 8 },
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
        <td class="legend-val" style="color:var(--rh-text-muted)">${pct}%</td>
      </tr>`
    }).join("")
    legendEl.innerHTML = `
      <table class="lang-legend-table">
        <thead><tr><th></th><th>Project</th><th>Time</th><th>Share</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  }
}


import * as d3 from "d3"
import { DailyLog } from "../shared/types"

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""]

let storedLogs: DailyLog[] = []

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function dateKey(d: Date): string {
  return d3.timeFormat("%Y-%m-%d")(d)
}

function isToday(d: Date, today: Date): boolean {
  return dateKey(d) === dateKey(today)
}

function isFuture(d: Date, today: Date): boolean {
  return d.getTime() > today.getTime()
}

function friendlyDate(d: Date, today: Date): string {
  if (isToday(d, today)) return "Today"
  const yd = new Date(today)
  yd.setDate(yd.getDate() - 1)
  if (dateKey(d) === dateKey(yd)) return "Yesterday"
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

export function resize(): void {
  if (storedLogs.length > 0) render(storedLogs)
}

export function renderActivityStats(logs: DailyLog[], projectName: string): void {
  const titleEl = document.getElementById("heatmap-title")
  const subtitleEl = document.getElementById("heatmap-subtitle")
  if (titleEl) titleEl.textContent = projectName || "Activity"
  if (subtitleEl) subtitleEl.textContent = "Daily active time · past year"

  const activeDaysEl = document.getElementById("act-active-days")
  const totalTimeEl = document.getElementById("act-total-time")
  const longestStreakEl = document.getElementById("act-longest-streak")
  const bestDayEl = document.getElementById("act-best-day")

  const activeDays = logs.filter(l => l.activeTime > 0).length
  const totalTime = logs.reduce((s, l) => s + l.activeTime, 0)

  let longestStreak = 0
  let cur = 0
  for (const log of logs) {
    if (log.activeTime > 0) {
      cur++
      if (cur > longestStreak) longestStreak = cur
    } else {
      cur = 0
    }
  }

  let bestDay: DailyLog | null = null
  for (const log of logs) {
    if (!bestDay || log.activeTime > bestDay.activeTime) bestDay = log
  }

  if (activeDaysEl) activeDaysEl.textContent = String(activeDays)
  if (totalTimeEl) totalTimeEl.textContent = totalTime > 0 ? formatDuration(totalTime) : "—"
  if (longestStreakEl) longestStreakEl.textContent = longestStreak > 0 ? `${longestStreak}d` : "—"
  if (bestDayEl && bestDay && bestDay.activeTime > 0) {
    const d = new Date(bestDay.date + "T00:00:00")
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    bestDayEl.textContent = friendlyDate(d, today)
  } else if (bestDayEl) {
    bestDayEl.textContent = "—"
  }
}

export function render(logs: DailyLog[]): void {
  storedLogs = logs
  const container = document.getElementById("heatmap-canvas")
  if (!container) return
  container.innerHTML = ""

  const logByDate = new Map<string, DailyLog>()
  for (const log of logs) {
    logByDate.set(log.date, log)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const cellSize = 14
  const cellPad = 3
  const step = cellSize + cellPad
  const marginLeft = 32

  const availableWidth = container.clientWidth || 320
  const weeks = Math.min(52, Math.max(8, Math.floor((availableWidth - marginLeft - cellPad) / step)))
  const totalDays = weeks * 7

  const todayDow = (today.getDay() + 6) % 7
  const currentWeekMonday = new Date(today)
  currentWeekMonday.setDate(today.getDate() - todayDow)
  const startDate = new Date(currentWeekMonday)
  startDate.setDate(currentWeekMonday.getDate() - (weeks - 1) * 7)

  const dates: Date[] = []
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + i)
    dates.push(d)
  }

  const marginTop = 26
  const legendHeight = 28
  const marginBottom = legendHeight + 8

  const svgWidth = marginLeft + weeks * step + cellPad
  const svgHeight = marginTop + 7 * step + marginBottom

  const maxTime = d3.max(
    dates.filter(d => !isFuture(d, today)),
    d => logByDate.get(dateKey(d))?.activeTime ?? 0
  ) ?? 1

  // Theme-aware color scale: transparent orange → full orange (works on light and dark themes)
  const colorScale = d3.scaleSequential()
    .domain([0, maxTime])
    .interpolator((t: number) => `rgba(249, 115, 22, ${0.18 + t * 0.82})`)

  const emptyColor  = "rgba(128,128,128,0.12)"
  const futureColor = "rgba(128,128,128,0.05)"

  const svg = d3.select(container)
    .append("svg")
    .attr("width", svgWidth)
    .attr("height", svgHeight)
    .style("font-family", "var(--vscode-font-family)")
    .style("font-size", "11px")

  // Day labels
  svg.selectAll(".day-label")
    .data(DAY_LABELS)
    .enter()
    .append("text")
    .attr("class", "day-label")
    .attr("x", marginLeft - cellPad - 4)
    .attr("y", (_, i) => marginTop + i * step + cellSize - 2)
    .attr("text-anchor", "end")
    .attr("fill", "var(--vscode-descriptionForeground)")
    .text(d => d)

  // Month labels — skip if too close to the previous one
  const currentMonth = today.getMonth()
  const monthGroups = d3.timeMonths(startDate, new Date(today.getFullYear(), today.getMonth() + 1, 1))
  let lastLabelX = -Infinity
  for (const d of monthGroups) {
    const dayOffset = Math.floor((d.getTime() - startDate.getTime()) / 86_400_000)
    const x = marginLeft + Math.floor(dayOffset / 7) * step
    if (x - lastLabelX < step * 3) continue
    lastLabelX = x
    svg.append("text")
      .attr("x", x)
      .attr("y", marginTop - 8)
      .attr("fill", "var(--vscode-descriptionForeground)")
      .attr("font-weight", d.getMonth() === currentMonth ? "700" : "400")
      .text(d3.timeFormat("%b")(d))
  }

  // Tooltip
  const tooltip = d3.select(container)
    .append("div")
    .style("position", "fixed")
    .style("background", "var(--vscode-editorHoverWidget-background)")
    .style("border", "1px solid var(--vscode-editorHoverWidget-border)")
    .style("padding", "6px 10px")
    .style("border-radius", "6px")
    .style("font-size", "12px")
    .style("line-height", "1.5")
    .style("pointer-events", "none")
    .style("display", "none")
    .style("z-index", "1000")
    .style("box-shadow", "0 2px 8px rgba(0,0,0,0.3)")

  const cellX = (d: Date) => {
    const dayOffset = Math.floor((d.getTime() - startDate.getTime()) / 86_400_000)
    return marginLeft + Math.floor(dayOffset / 7) * step
  }
  const cellY = (d: Date) => marginTop + ((d.getDay() + 6) % 7) * step

  // Draw cells
  svg.selectAll(".day-cell")
    .data(dates)
    .enter()
    .append("rect")
    .attr("class", "day-cell")
    .attr("width", cellSize)
    .attr("height", cellSize)
    .attr("rx", 3)
    .attr("ry", 3)
    .attr("x", cellX)
    .attr("y", cellY)
    .attr("fill", d => {
      if (isFuture(d, today)) return futureColor
      const t = logByDate.get(dateKey(d))?.activeTime ?? 0
      return t === 0 ? emptyColor : colorScale(t)
    })
    .attr("opacity", d => isFuture(d, today) ? 0.4 : 1)
    .on("mouseover", function(event: MouseEvent, d: Date) {
      if (isFuture(d, today)) return
      const key = dateKey(d)
      const t = logByDate.get(key)?.activeTime ?? 0
      const label = `<strong>${friendlyDate(d, today)}</strong>`
      tooltip
        .style("display", "block")
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY - 36}px`)
        .html(t > 0
          ? `${label}<br>${formatDuration(t)} active`
          : `${label}<br><span style="opacity:0.5">No activity</span>`)
    })
    .on("mousemove", function(event: MouseEvent) {
      tooltip
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY - 36}px`)
    })
    .on("mouseout", function() {
      tooltip.style("display", "none")
    })

  // Today ring
  const todayDate = dates.find(d => isToday(d, today))
  if (todayDate) {
    svg.append("rect")
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("rx", 3)
      .attr("ry", 3)
      .attr("x", cellX(todayDate))
      .attr("y", cellY(todayDate))
      .attr("fill", "none")
      .attr("stroke", "var(--vscode-focusBorder, #f97316)")
      .attr("stroke-width", 1.5)
  }

  // Legend — right-aligned below the grid
  const legendBoxCount = 5
  const legendBoxSize = 10
  const legendGap = 3
  const legendTotalBoxWidth = legendBoxCount * (legendBoxSize + legendGap) - legendGap
  const legendY = marginTop + 7 * step + 14
  const legendTextY = legendY + legendBoxSize - 1

  // Measure approximate text width for right-alignment
  const moreTextWidth = 26
  const lessTextWidth = 22
  const legendRightEdge = svgWidth - cellPad
  const boxesX = legendRightEdge - moreTextWidth - legendGap - legendTotalBoxWidth

  svg.append("text")
    .attr("x", boxesX - legendGap)
    .attr("y", legendTextY)
    .attr("text-anchor", "end")
    .attr("fill", "var(--vscode-descriptionForeground)")
    .attr("font-size", "10px")
    .text("Less")

  for (let i = 0; i < legendBoxCount; i++) {
    const t = i / (legendBoxCount - 1)
    const fill = i === 0 ? emptyColor : `rgba(249, 115, 22, ${0.18 + t * 0.82})`
    svg.append("rect")
      .attr("x", boxesX + i * (legendBoxSize + legendGap))
      .attr("y", legendY)
      .attr("width", legendBoxSize)
      .attr("height", legendBoxSize)
      .attr("rx", 2)
      .attr("fill", fill)
  }

  svg.append("text")
    .attr("x", boxesX + legendTotalBoxWidth + legendGap)
    .attr("y", legendTextY)
    .attr("fill", "var(--vscode-descriptionForeground)")
    .attr("font-size", "10px")
    .text("More")
}

import * as d3 from "d3"
import { DailyLog } from "../shared/types"

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""]

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

export function render(logs: DailyLog[]): void {
  const container = document.getElementById("heatmap")
  if (!container) return
  container.innerHTML = ""

  const logByDate = new Map<string, DailyLog>()
  for (const log of logs) {
    logByDate.set(log.date, log)
  }

  // Always start on a Monday so column boundaries align with calendar weeks
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weeks = 18
  const totalDays = weeks * 7

  const todayDow = (today.getDay() + 6) % 7  // Mon=0 … Sun=6
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

  const cellSize = 13
  const cellPad = 3
  const step = cellSize + cellPad
  const marginLeft = 32
  const marginTop = 24
  const marginBottom = 8

  const svgWidth = marginLeft + weeks * step + cellPad
  const svgHeight = marginTop + 7 * step + marginBottom

  const maxTime = d3.max(
    dates.filter(d => !isFuture(d, today)),
    d => logByDate.get(dateKey(d))?.activeTime ?? 0
  ) ?? 1

  // Warm gradient: empty → amber → orange (matches the PDF card accent)
  const colorScale = d3.scaleSequential()
    .domain([0, maxTime])
    .interpolator(d3.interpolateRgb("#2a2a2a", "#f97316"))

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
    .attr("x", marginLeft - cellPad - 2)
    .attr("y", (_, i) => marginTop + i * step + cellSize - 2)
    .attr("text-anchor", "end")
    .attr("fill", "var(--vscode-descriptionForeground)")
    .text(d => d)

  // Month labels — bold the current month
  const currentMonth = today.getMonth()
  const monthGroups = d3.timeMonths(startDate, new Date(today.getFullYear(), today.getMonth() + 1, 1))
  svg.selectAll(".month-label")
    .data(monthGroups)
    .enter()
    .append("text")
    .attr("class", "month-label")
    .attr("x", d => {
      const dayOffset = Math.floor((d.getTime() - startDate.getTime()) / 86_400_000)
      return marginLeft + Math.floor(dayOffset / 7) * step
    })
    .attr("y", marginTop - 6)
    .attr("fill", "var(--vscode-descriptionForeground)")
    .attr("font-weight", (d: Date) => d.getMonth() === currentMonth ? "700" : "400")
    .text((d: Date) => d3.timeFormat("%b")(d))

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

  // Cells
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
      const dow = DAYS[(d.getDay() + 6) % 7]
      const label = isToday(d, today) ? `<strong>${dow}, ${key}</strong> · today` : `<strong>${dow}, ${key}</strong>`
      tooltip
        .style("display", "block")
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY - 36}px`)
        .html(t > 0 ? `${label}<br>${formatDuration(t)} active` : `${label}<br><span style="opacity:0.6">No activity</span>`)
    })
    .on("mousemove", function(event: MouseEvent) {
      tooltip
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY - 36}px`)
    })
    .on("mouseout", function() {
      tooltip.style("display", "none")
    })

  // Today ring — drawn on top as a separate rect with no fill, just stroke
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
}

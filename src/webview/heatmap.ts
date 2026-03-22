import * as d3 from "d3"
import { DailyLog } from "../shared/types"

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function render(logs: DailyLog[]): void {
  const container = document.getElementById("heatmap")
  if (!container) return
  container.innerHTML = ""

  const logByDate = new Map<string, DailyLog>()
  for (const log of logs) {
    logByDate.set(log.date, log)
  }

  // Determine date range — last N weeks ending today
  const today = new Date()
  const weeks = 18
  const totalDays = weeks * 7

  const startDate = new Date(today)
  startDate.setDate(today.getDate() - totalDays + 1)

  // Build list of all dates
  const dates: Date[] = []
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + i)
    dates.push(d)
  }

  const cellSize = 14
  const cellPad = 3
  const step = cellSize + cellPad
  const dayLabels = ["Mon", "", "Wed", "", "Fri", "", ""]
  const marginLeft = 32
  const marginTop = 24
  const marginBottom = 8

  const svgWidth = marginLeft + weeks * step + cellPad
  const svgHeight = marginTop + 7 * step + marginBottom

  const maxTime = d3.max(dates, d => {
    const key = d3.timeFormat("%Y-%m-%d")(d)
    return logByDate.get(key)?.activeTime ?? 0
  }) ?? 1

  const colorScale = d3.scaleSequential()
    .domain([0, maxTime])
    .interpolator(d3.interpolateBlues)

  const emptyColor = "var(--vscode-badge-background)"

  const svg = d3.select(container)
    .append("svg")
    .attr("width", svgWidth)
    .attr("height", svgHeight)
    .style("font-family", "var(--vscode-font-family)")
    .style("font-size", "11px")

  // Day labels (Mon–Sun)
  svg.selectAll(".day-label")
    .data(dayLabels)
    .enter()
    .append("text")
    .attr("class", "day-label")
    .attr("x", marginLeft - cellPad - 2)
    .attr("y", (_, i) => marginTop + i * step + cellSize - 2)
    .attr("text-anchor", "end")
    .attr("fill", "var(--vscode-descriptionForeground)")
    .text(d => d)

  // Month labels
  const monthGroups = d3.timeMonths(startDate, new Date(today.getFullYear(), today.getMonth() + 1, 1))
  svg.selectAll(".month-label")
    .data(monthGroups)
    .enter()
    .append("text")
    .attr("class", "month-label")
    .attr("x", d => {
      const dayOffset = Math.floor((d.getTime() - startDate.getTime()) / (86_400_000))
      const weekOffset = Math.floor(dayOffset / 7)
      return marginLeft + weekOffset * step
    })
    .attr("y", marginTop - 6)
    .attr("fill", "var(--vscode-descriptionForeground)")
    .text(d => d3.timeFormat("%b")(d))

  // Cells
  const tooltip = d3.select(container)
    .append("div")
    .style("position", "fixed")
    .style("background", "var(--vscode-editorHoverWidget-background)")
    .style("border", "1px solid var(--vscode-editorHoverWidget-border)")
    .style("padding", "4px 8px")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("pointer-events", "none")
    .style("display", "none")
    .style("z-index", "1000")

  svg.selectAll(".day-cell")
    .data(dates)
    .enter()
    .append("rect")
    .attr("class", "day-cell")
    .attr("width", cellSize)
    .attr("height", cellSize)
    .attr("rx", 2)
    .attr("x", d => {
      const dayOffset = Math.floor((d.getTime() - startDate.getTime()) / 86_400_000)
      const week = Math.floor(dayOffset / 7)
      return marginLeft + week * step
    })
    .attr("y", d => {
      // getDay(): 0=Sun, so shift so Mon=0
      const dow = (d.getDay() + 6) % 7
      return marginTop + dow * step
    })
    .attr("fill", d => {
      const key = d3.timeFormat("%Y-%m-%d")(d)
      const t = logByDate.get(key)?.activeTime ?? 0
      if (t === 0) return emptyColor
      return colorScale(t)
    })
    .on("mouseover", function(event: MouseEvent, d: Date) {
      const key = d3.timeFormat("%Y-%m-%d")(d)
      const t = logByDate.get(key)?.activeTime ?? 0
      tooltip
        .style("display", "block")
        .style("left", `${event.clientX + 12}px`)
        .style("top", `${event.clientY - 28}px`)
        .html(`<strong>${key}</strong><br>${formatDuration(t)}`)
    })
    .on("mousemove", function(event: MouseEvent) {
      tooltip
        .style("left", `${event.clientX + 12}px`)
        .style("top", `${event.clientY - 28}px`)
    })
    .on("mouseout", function() {
      tooltip.style("display", "none")
    })
}

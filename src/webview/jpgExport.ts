import { DailyLog } from "../shared/types"
import { PdfOptions, computeStats } from "./pdfExport"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

// ── Logo rect data (shared with pdfExport) ───────────────────────────────────
// [x, y, w, h] in the 48×34 SVG coordinate space, fill color

type LogoRect = [number, number, number, number, string]

const LOGO_RECTS: LogoRect[] = [
  [0,       27.2, 3.429, 3.4, "#A5510C"],
  [30.857,  10.2, 3.429, 3.4, "#FF8B00"],
  [27.428,  10.2, 3.429, 3.4, "#FF8B00"],
  [34.286,  17,   3.429, 3.4, "#FF8B00"],
  [34.286,  13.6, 3.429, 3.4, "#FF8B00"],
  [24,      10.2, 3.429, 3.4, "#FF8B00"],
  [20.571,  10.2, 3.429, 3.4, "#FF8B00"],
  [13.714,  13.6, 6.857, 3.4, "#A5510C"],
  [13.714,  17,   3.429, 3.4, "#FF8B00"],
  [10.286,  20.4, 3.429, 3.4, "#FF8B00"],
  [6.857,   23.8, 3.429, 3.4, "#A5510C"],
  [3.428,   27.2, 3.429, 3.4, "#FF8B00"],
  [30.857,  20.4, 3.429, 3.4, "#FF8B00"],
  [27.428,  23.8, 3.429, 3.4, "#FF8B00"],
  [24,      27.2, 6.857, 3.4, "#A5510C"],
  [20.571,  27.2, 3.429, 3.4, "#FF8B00"],
  [13.714,  27.2, 3.429, 3.4, "#A5510C"],
  [6.857,   27.2, 3.429, 3.4, "#FF8B00"],
  [10.286,  27.2, 3.429, 3.4, "#FF8B00"],
  [17.143,  27.2, 3.429, 3.4, "#FF8B00"],
  [10.286,  23.8, 3.429, 3.4, "#FF8B00"],
  [13.714,  23.8, 3.429, 3.4, "#FF8B00"],
  [17.143,  20.4, 3.429, 3.4, "#FF8B00"],
  [13.714,  20.4, 3.429, 3.4, "#A5510C"],
  [17.143,  23.8, 3.429, 3.4, "#FF8B00"],
  [20.571,  23.8, 3.429, 3.4, "#A5510C"],
  [17.143,  17,   3.429, 3.4, "#FF8B00"],
  [20.571,  17,   3.429, 3.4, "#A5510C"],
  [20.571,  13.6, 3.429, 3.4, "#FF8B00"],
  [24,      17,   3.429, 3.4, "#FF8B00"],
  [24,      20.4, 3.429, 3.4, "#FF8B00"],
  [24,      23.8, 3.429, 3.4, "#FF8B00"],
  [20.571,  20.4, 3.429, 3.4, "#FF8B00"],
  [27.428,  20.4, 3.429, 3.4, "#FF8B00"],
  [27.428,  17,   3.429, 3.4, "#FF8B00"],
  [30.857,  17,   3.429, 3.4, "#FF8B00"],
  [30.857,  13.6, 3.429, 3.4, "#FF8B00"],
  [27.428,  13.6, 3.429, 3.4, "#FF8B00"],
  [24,      13.6, 3.429, 3.4, "#FF8B00"],
  [41.143,  3.4,  3.429, 3.4, "#01FF00"],
  [37.714,  6.8,  3.429, 3.4, "#01FF00"],
  [34.286,  10.2, 3.429, 3.4, "#01FF00"],
  [37.714,  13.6, 3.429, 3.4, "#01FF00"],
  [41.143,  13.6, 3.429, 3.4, "#01FF00"],
  [44.571,  13.6, 3.429, 3.4, "#01FF00"],
  [30.857,  6.8,  3.429, 3.4, "#01FF00"],
  [30.857,  3.4,  3.429, 3.4, "#01FF00"],
  [30.857,  0,    3.429, 3.4, "#01FF00"],
  [17.143,  10.2, 3.429, 3.4, "#A5510C"],
  [20.571,  6.8, 10.286, 3.4, "#A5510C"],
  [10.286,  17,   3.429, 3.4, "#A5510C"],
  [6.857,   20.4, 3.429, 3.4, "#A5510C"],
  [3.428,   23.8, 3.429, 3.4, "#A5510C"],
  [0,       30.6, 27.428, 3.4, "#A5510C"],
  [30.857,  23.8, 3.429, 3.4, "#A5510C"],
  [34.286,  20.4, 3.429, 3.4, "#A5510C"],
  [34.286,  13.6, 3.429, 6.8, "#A5510C"],
  [30.857,  10.2, 3.429, 3.4, "#A5510C"],
]

function drawLogoCanvas(
  ctx: CanvasRenderingContext2D,
  originX: number, originY: number,
  logoScale: number
): void {
  for (const [x, y, w, h, fill] of LOGO_RECTS) {
    ctx.fillStyle = fill
    ctx.fillRect(originX + x * logoScale, originY + y * logoScale, w * logoScale, h * logoScale)
  }
}

// ── Calendar heatmap ──────────────────────────────────────────────────────────

function drawCalendarHeatmap(
  ctx: CanvasRenderingContext2D,
  logs: DailyLog[],
  startY: number,
  W: number,
  s: (v: number) => number,
  MUTED: string
): number {
  if (logs.length === 0) return startY

  const logByDate = new Map<string, number>()
  for (const log of logs) logByDate.set(log.date, log.activeTime)
  const maxActive = Math.max(...logs.map(l => l.activeTime), 1)

  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  const rangeStart = new Date(sorted[0].date + "T00:00:00")
  const rangeEnd   = new Date(sorted[sorted.length - 1].date + "T00:00:00")

  // Collect months in range
  const months: { year: number; month: number }[] = []
  const cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  while (cur <= rangeEnd) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() })
    cur.setMonth(cur.getMonth() + 1)
  }

  const monthGap   = s(10)
  const numMonths  = months.length
  const cellGap    = s(2)
  // Cell size based on available width for the most months we'll ever show (3)
  const maxMonthW  = (W - s(56) - 2 * monthGap) / 3
  const cellSize   = Math.min(s(16), Math.floor((maxMonthW - 6 * cellGap) / 7))
  const step       = cellSize + cellGap
  const monthW     = 7 * cellSize + 6 * cellGap   // actual content width per month
  const totalW     = numMonths * monthW + (numMonths - 1) * monthGap
  const startX     = (W - totalW) / 2             // center the whole group

  // DOW header labels (Mon…Sun)
  const DOW = ["M", "T", "W", "T", "F", "S", "S"]
  const headerH = s(11)   // month name
  const dowH    = s(10)   // day-of-week row

  // Max rows needed across all months (for uniform height)
  let maxRows = 0
  for (const { year, month } of months) {
    const firstDow  = (new Date(year, month, 1).getDay() + 6) % 7
    const daysInMon = new Date(year, month + 1, 0).getDate()
    maxRows = Math.max(maxRows, Math.ceil((firstDow + daysInMon) / 7))
  }

  const blockH = headerH + dowH + maxRows * step

  months.forEach(({ year, month }, mi) => {
    const mx = startX + mi * (monthW + monthGap)
    const my = startY

    // Month + year label
    const label = new Date(year, month, 1)
      .toLocaleDateString(undefined, { month: "long", year: "numeric" })
    ctx.fillStyle = MUTED
    ctx.font = `bold ${s(7.5)}px 'Electrolize', sans-serif`
    ctx.textAlign = "center"
    ctx.fillText(label.toUpperCase(), mx + monthW / 2, my + s(8))

    // DOW headers
    ctx.font = `${s(6.5)}px 'Electrolize', sans-serif`
    ctx.fillStyle = MUTED
    for (let d = 0; d < 7; d++) {
      ctx.textAlign = "center"
      ctx.fillText(DOW[d], mx + d * step + cellSize / 2, my + headerH + s(7))
    }

    // Day cells
    const firstDow  = (new Date(year, month, 1).getDay() + 6) % 7
    const daysInMon = new Date(year, month + 1, 0).getDate()
    const cellTop   = my + headerH + dowH

    for (let day = 1; day <= daysInMon; day++) {
      const dow     = (new Date(year, month, day).getDay() + 6) % 7
      const weekIdx = Math.floor((firstDow + day - 1) / 7)
      const cx      = mx + dow * step
      const cy      = cellTop + weekIdx * step

      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      const dayDate = new Date(year, month, day)
      const inRange = dayDate >= rangeStart && dayDate <= rangeEnd
      const active  = logByDate.get(dateKey) ?? 0

      if (!inRange) {
        ctx.fillStyle = "rgba(128,128,128,0.06)"
      } else if (active === 0) {
        ctx.fillStyle = "rgba(128,128,128,0.18)"
      } else {
        const t = active / maxActive
        ctx.fillStyle = `rgba(249,115,22,${(0.18 + t * 0.82).toFixed(2)})`
      }

      roundRect(ctx, cx, cy, cellSize, cellSize, s(2))
      ctx.fill()
    }
  })

  // Legend (right-aligned to calendar group)
  const legendY   = startY + blockH + s(6)
  const boxSize   = s(7)
  const boxGap    = s(3)
  const boxCount  = 5
  const legendW   = boxCount * (boxSize + boxGap) - boxGap
  const boxStartX = startX + totalW - legendW - s(22)

  ctx.font = `${s(6.5)}px 'Electrolize', sans-serif`
  ctx.fillStyle = MUTED
  ctx.textAlign = "right"
  ctx.fillText("Less", boxStartX - s(3), legendY + boxSize - s(1))
  ctx.textAlign = "left"
  ctx.fillText("More", boxStartX + legendW + s(3), legendY + boxSize - s(1))

  for (let i = 0; i < boxCount; i++) {
    const t = i / (boxCount - 1)
    ctx.fillStyle = i === 0
      ? "rgba(128,128,128,0.18)"
      : `rgba(249,115,22,${(0.18 + t * 0.82).toFixed(2)})`
    roundRect(ctx, boxStartX + i * (boxSize + boxGap), legendY, boxSize, boxSize, s(1.5))
    ctx.fill()
  }

  return legendY + boxSize
}

// ── Stat grid ─────────────────────────────────────────────────────────────────

function drawStatGrid(
  ctx: CanvasRenderingContext2D,
  items: { label: string; value: string; color: string }[],
  startY: number,
  W: number,
  s: (v: number) => number,
  SURFACE: string,
  MUTED: string
): number {
  const margin = s(28)
  const gap = s(10)
  const colW = (W - margin * 2 - gap) / 2
  const cellH = s(58)
  const rowGap = s(10)

  items.forEach((item, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * (colW + gap)
    const y = startY + row * (cellH + rowGap)

    ctx.fillStyle = SURFACE
    roundRect(ctx, x, y, colW, cellH, s(6))
    ctx.fill()

    ctx.fillStyle = item.color
    ctx.font = `bold ${s(20)}px 'Quantico', sans-serif`
    ctx.textAlign = "left"
    ctx.fillText(item.value, x + s(12), y + s(28))

    ctx.fillStyle = MUTED
    ctx.font = `${s(8)}px 'Quantico', sans-serif`
    ctx.fillText(item.label, x + s(12), y + s(45))
  })

  const rows = Math.ceil(items.length / 2)
  return startY + rows * (cellH + rowGap) - rowGap
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateJpg(logs: DailyLog[], options: PdfOptions): Promise<string> {
  await document.fonts.ready

  const SCALE = 2
  const W = 420 * SCALE
  const H = 620 * SCALE
  const s = (v: number) => v * SCALE

  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")!

  const BG      = "#0f172a"
  const SURFACE = "#1e293b"
  const ACCENT  = "#f97316"
  const TEXT    = "#f8fafc"
  const MUTED   = "#64748b"
  const GREEN   = "#22c55e"
  const RED     = "#ef4444"

  // Background
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  // Top accent bar
  ctx.fillStyle = ACCENT
  ctx.fillRect(0, 0, W, s(5))

  // ── Header: logo + "RABBIT HOLE" ─────────────────────────────────────────

  const logoH = s(26)
  const logoW = logoH * (48 / 34)   // maintain aspect ratio → logoScale = logoH/34
  const logoScale = logoH / 34
  const brandFontSize = s(15)
  ctx.font = `bold ${brandFontSize}px 'Electrolize', sans-serif`
  const textW = ctx.measureText("RABBIT HOLE").width
  const gap = s(8)
  const groupW = logoW + gap + textW
  const groupX = (W - groupW) / 2
  const headerCenterY = s(30)

  // Logo drawn as rects (no image loading — avoids CSP)
  drawLogoCanvas(ctx, groupX, headerCenterY - logoH / 2, logoScale)

  // Brand text
  ctx.fillStyle = ACCENT
  ctx.font = `bold ${brandFontSize}px 'Electrolize', sans-serif`
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillText("RABBIT HOLE", groupX + logoW + gap, headerCenterY)
  ctx.textBaseline = "alphabetic"

  // ── Subtitle ──────────────────────────────────────────────────────────────

  let yPos = s(54)
  const rangeLabel = `ACTIVITY FROM ${options.dateRange.from} TO ${options.dateRange.to}`
  ctx.fillStyle = TEXT
  ctx.font = `bold ${s(10)}px 'Quantico', sans-serif`
  ctx.textAlign = "center"
  ctx.fillText(rangeLabel, W / 2, yPos)
  yPos += s(20)

  // ── Project name ─────────────────────────────────────────────────────────

  const stats = computeStats(logs)

  ctx.fillStyle = TEXT
  ctx.font = `bold ${s(13)}px 'Quantico', sans-serif`
  ctx.textAlign = "center"
  ctx.fillText(options.projectName.toUpperCase(), W / 2, yPos)
  yPos += s(20)

  // Divider
  ctx.strokeStyle = SURFACE
  ctx.lineWidth = s(1)
  ctx.beginPath()
  ctx.moveTo(s(28), yPos)
  ctx.lineTo(W - s(28), yPos)
  ctx.stroke()
  yPos += s(16)

  // ── Streak hero ───────────────────────────────────────────────────────────

  if (options.streak) {
    ctx.fillStyle = ACCENT
    ctx.font = `bold ${s(64)}px 'Press Start 2P', monospace`
    ctx.textAlign = "center"
    ctx.fillText(String(stats.streak), W / 2, yPos + s(56))

    ctx.font = `bold ${s(13)}px 'Quantico', sans-serif`
    ctx.fillText(`🔥 Day Streak`, W / 2, yPos + s(80))
    yPos += s(100)

    // Divider
    ctx.strokeStyle = SURFACE
    ctx.lineWidth = s(1)
    ctx.beginPath()
    ctx.moveTo(s(28), yPos)
    ctx.lineTo(W - s(28), yPos)
    ctx.stroke()
    yPos += s(16)
  }

  // ── Stats grid ────────────────────────────────────────────────────────────

  const statItems: { label: string; value: string; color: string }[] = []
  if (options.activeTime)   statItems.push({ label: "ACTIVE TIME",   value: formatDuration(stats.totalActiveTime),  color: TEXT })
  if (options.linesAdded)   statItems.push({ label: "LINES ADDED",   value: `+${stats.totalLinesAdded}`,            color: GREEN })
  if (options.linesDeleted) statItems.push({ label: "LINES DELETED", value: `-${stats.totalLinesDeleted}`,          color: RED })
  if (options.topLanguage)  statItems.push({ label: "TOP LANGUAGE",  value: stats.topLanguage,                      color: TEXT })

  if (statItems.length > 0) {
    yPos = drawStatGrid(ctx, statItems, yPos, W, s, SURFACE, MUTED) + s(20)
  }

  // ── Heatmap ───────────────────────────────────────────────────────────────

  if (options.heatmap && logs.length > 0) {
    ctx.fillStyle = MUTED
    ctx.font = `${s(7.5)}px 'Electrolize', sans-serif`
    ctx.textAlign = "center"
    ctx.fillText("ACTIVITY", W / 2, yPos)
    yPos += s(10)

    yPos = drawCalendarHeatmap(ctx, logs, yPos, W, s, MUTED) + s(16)
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  const now = new Date()
  const dateStr = now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  const timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  ctx.fillStyle = MUTED
  ctx.font = `${s(7.5)}px 'Electrolize', sans-serif`
  ctx.textAlign = "center"
  ctx.fillText(`Generated ${dateStr} at ${timeStr}  ·  Rabbit Hole`, W / 2, H - s(18))

  return canvas.toDataURL("image/jpeg", 0.93)
}

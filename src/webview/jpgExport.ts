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

// ── Heatmap (GitHub-style: weeks as columns, Mon–Sun rows) ───────────────────

function drawCalendarHeatmap(
  ctx: CanvasRenderingContext2D,
  logs: DailyLog[],
  startY: number,
  W: number,
  s: (v: number) => number,
  MUTED: string
): number {
  const logByDate = new Map<string, number>()
  for (const log of logs) logByDate.set(log.date, log.activeTime)
  const maxActive = Math.max(...logs.map(l => l.activeTime), 1)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayDow = (today.getDay() + 6) % 7  // Mon=0
  const weekMonday = new Date(today); weekMonday.setDate(today.getDate() - todayDow)

  const weeks = 5
  const gridStart = new Date(weekMonday); gridStart.setDate(weekMonday.getDate() - (weeks - 1) * 7)

  const cellSize = s(15)
  const cellGap  = s(3.5)
  const step     = cellSize + cellGap
  const labelW   = s(26)
  const totalGridW = weeks * step - cellGap
  const gridX    = (W - labelW - totalGridW) / 2 + labelW

  // Day-of-week labels
  const DOW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"]
  ctx.font = `${s(7)}px 'Electrolize', sans-serif`
  ctx.fillStyle = MUTED
  ctx.textAlign = "right"
  for (let d = 0; d < 7; d++) {
    if (DOW_LABELS[d]) {
      ctx.fillText(DOW_LABELS[d], gridX - s(4), startY + d * step + cellSize - s(1))
    }
  }

  // Cells
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cell = new Date(gridStart); cell.setDate(gridStart.getDate() + w * 7 + d)
      if (cell > today) continue
      const key = `${cell.getFullYear()}-${String(cell.getMonth()+1).padStart(2,"0")}-${String(cell.getDate()).padStart(2,"0")}`
      const active = logByDate.get(key) ?? 0
      const t = active / maxActive
      ctx.fillStyle = active === 0
        ? "rgba(128,128,128,0.18)"
        : `rgba(249,115,22,${(0.18 + t * 0.82).toFixed(2)})`
      roundRect(ctx, gridX + w * step, startY + d * step, cellSize, cellSize, s(2))
      ctx.fill()
    }
  }

  // Legend
  const legendY  = startY + 7 * step + s(4)
  const boxSize  = s(7)
  const boxGap   = s(3)
  const boxCount = 5
  const legendW  = boxCount * (boxSize + boxGap) - boxGap
  const boxX     = gridX + totalGridW - legendW

  ctx.font = `${s(6.5)}px 'Electrolize', sans-serif`
  ctx.fillStyle = MUTED
  ctx.textAlign = "right"
  ctx.fillText("Less", boxX - s(3), legendY + boxSize - s(1))
  ctx.textAlign = "left"
  ctx.fillText("More", boxX + legendW + s(3), legendY + boxSize - s(1))

  for (let i = 0; i < boxCount; i++) {
    const t = i / (boxCount - 1)
    ctx.fillStyle = i === 0 ? "rgba(128,128,128,0.18)" : `rgba(249,115,22,${(0.18 + t * 0.82).toFixed(2)})`
    roundRect(ctx, boxX + i * (boxSize + boxGap), legendY, boxSize, boxSize, s(1.5))
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
  const cellH = s(64)
  const rowGap = s(12)

  items.forEach((item, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * (colW + gap)
    const y = startY + row * (cellH + rowGap)

    ctx.fillStyle = SURFACE
    roundRect(ctx, x, y, colW, cellH, s(6))
    ctx.fill()

    ctx.fillStyle = item.color
    ctx.font = `bold ${s(22)}px 'Quantico', sans-serif`
    ctx.textAlign = "left"
    ctx.fillText(item.value, x + s(12), y + s(32))

    ctx.fillStyle = MUTED
    ctx.font = `${s(9)}px 'Quantico', sans-serif`
    ctx.fillText(item.label, x + s(12), y + s(50))
  })

  const rows = Math.ceil(items.length / 2)
  return startY + rows * (cellH + rowGap) - rowGap
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateJpg(logs: DailyLog[], options: PdfOptions): Promise<string> {
  await document.fonts.ready

  const SCALE = 3
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

  const today = new Date(); today.setHours(0,0,0,0)
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`
  const stats = computeStats(logs.filter(l => l.date === todayKey))

  // ── Project name (vertically centered in header section) ─────────────────

  const headerSectionH = s(46)          // px — from accent bar base to divider
  const headerDividerY = s(5) + headerSectionH
  const headerTextY    = s(5) + headerSectionH / 2 + s(10)  // baseline centered

  ctx.fillStyle = TEXT
  ctx.font = `bold ${s(20)}px 'Quantico', sans-serif`
  ctx.textAlign = "center"
  ctx.fillText(options.projectName.toUpperCase(), W / 2, headerTextY)

  ctx.strokeStyle = SURFACE
  ctx.lineWidth = s(1)
  ctx.beginPath()
  ctx.moveTo(s(28), headerDividerY)
  ctx.lineTo(W - s(28), headerDividerY)
  ctx.stroke()

  let yPos = headerDividerY + s(18)

  // ── Streak hero ───────────────────────────────────────────────────────────

  if (options.isToday) {
    ctx.fillStyle = ACCENT
    ctx.font = `bold ${s(72)}px 'Press Start 2P', monospace`
    ctx.textAlign = "center"
    ctx.fillText(String(stats.streak), W / 2, yPos + s(62))

    ctx.font = `bold ${s(14)}px 'Quantico', sans-serif`
    ctx.fillText("Day Streak", W / 2, yPos + s(80))
    yPos += s(98)

    // Divider
    ctx.strokeStyle = SURFACE
    ctx.lineWidth = s(1)
    ctx.beginPath()
    ctx.moveTo(s(28), yPos)
    ctx.lineTo(W - s(28), yPos)
    ctx.stroke()
    yPos += s(18)
  }

  // ── Stats grid ────────────────────────────────────────────────────────────

  const statItems: { label: string; value: string; color: string }[] = [
    { label: "ACTIVE TIME",   value: formatDuration(stats.totalActiveTime), color: TEXT },
    { label: "LINES ADDED",   value: `+${stats.totalLinesAdded}`,           color: GREEN },
    { label: "LINES DELETED", value: `-${stats.totalLinesDeleted}`,         color: RED },
    { label: "TOP LANGUAGE",  value: stats.topLanguage,                     color: TEXT },
  ]
  yPos = drawStatGrid(ctx, statItems, yPos, W, s, SURFACE, MUTED) + s(24)

  // ── Heatmap ───────────────────────────────────────────────────────────────

  if (logs.length > 0) {
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
  const footerPrefix = `Generated ${dateStr} at ${timeStr}  ·  `
  const footerSuffix = `Rabbit Hole`

  ctx.font = `${s(7.5)}px 'Electrolize', sans-serif`
  const prefixW = ctx.measureText(footerPrefix).width
  const suffixW = ctx.measureText(footerSuffix).width
  const footerLogoScale = s(8) / 34   // logo ~8px logical tall
  const footerLogoW = 48 * footerLogoScale
  const footerGap = s(4)
  const groupW = prefixW + footerLogoW + footerGap + suffixW
  const groupX = (W - groupW) / 2
  const footerY = H - s(18)

  ctx.fillStyle = MUTED
  ctx.textAlign = "left"
  ctx.fillText(footerPrefix, groupX, footerY)

  drawLogoCanvas(ctx, groupX + prefixW, footerY - s(7), footerLogoScale)

  ctx.fillStyle = TEXT
  ctx.fillText(footerSuffix, groupX + prefixW + footerLogoW + footerGap, footerY)

  return canvas.toDataURL("image/jpeg", 0.93)
}

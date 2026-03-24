import { jsPDF } from "jspdf"
import { DailyLog } from "../shared/types"

export interface PdfOptions {
  streak: boolean
  activeTime: boolean
  linesAdded: boolean
  linesDeleted: boolean
  topLanguage: boolean
  aiEvents: boolean
  heatmap: boolean
  days: 7 | 30 | 90
  projectName: string
  dateRange: { from: string; to: string }
}

export { computeStats }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function setFill(doc: jsPDF, hex: string): void {
  doc.setFillColor(parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16))
}

function setDraw(doc: jsPDF, hex: string): void {
  doc.setDrawColor(parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16))
}

function setText(doc: jsPDF, hex: string): void {
  doc.setTextColor(parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16))
}

// ── Compute stats ─────────────────────────────────────────────────────────────

function computeStats(logs: DailyLog[]) {
  const streak = logs.length > 0 ? logs[logs.length - 1].streak : 0
  const totalActiveTime = logs.reduce((s, l) => s + l.activeTime, 0)
  const totalLinesAdded = logs.reduce((s, l) => s + l.files.reduce((a, f) => a + f.linesAdded, 0), 0)
  const totalLinesDeleted = logs.reduce((s, l) => s + l.files.reduce((a, f) => a + f.linesDeleted, 0), 0)
  const aiEvents = logs.reduce(
    (s, l) => s + Object.entries(l.agents).filter(([k]) => k !== "manual").flatMap(([, v]) => v).length, 0
  )
  const langTotals: Record<string, number> = {}
  for (const log of logs) {
    for (const [lang, stat] of Object.entries(log.languages)) {
      langTotals[lang] = (langTotals[lang] ?? 0) + stat.time
    }
  }
  const topLanguage = Object.entries(langTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"
  return { streak, totalActiveTime, totalLinesAdded, totalLinesDeleted, aiEvents, topLanguage }
}

// ── Logo rects ────────────────────────────────────────────────────────────────
// Each entry: [x, y, w, h, fillHex] — drawn in order (later entries paint over earlier)

type LogoRect = [number, number, number, number, string]

const LOGO_RECTS: LogoRect[] = [
  [0,       27.2, 3.429, 3.4, "#A5510C"],
  [30.857,  10.2, 3.429, 3.4, "#FF8B00"],
  [27.428,  10.2, 3.429, 3.4, "#FF8B00"],
  [34.286,  17,   3.429, 3.4, "#FF8B00"],
  [34.286,  13.6, 3.429, 3.4, "#FF8B00"],
  [24,      10.2, 3.429, 3.4, "#FF8B00"],
  [20.571,  10.2, 3.429, 3.4, "#FF8B00"],
  [13.714,  13.6, 6.857, 3.4, "#A5510C"],  // path → rect
  [13.714,  17,   3.429, 3.4, "#FF8B00"],
  [10.286,  20.4, 3.429, 3.4, "#FF8B00"],
  [6.857,   23.8, 3.429, 3.4, "#A5510C"],
  [3.428,   27.2, 3.429, 3.4, "#FF8B00"],
  [30.857,  20.4, 3.429, 3.4, "#FF8B00"],
  [27.428,  23.8, 3.429, 3.4, "#FF8B00"],
  [24,      27.2, 6.857, 3.4, "#A5510C"],  // path → rect
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
  [20.571,  6.8, 10.286, 3.4, "#A5510C"],  // path → rect
  [10.286,  17,   3.429, 3.4, "#A5510C"],
  [6.857,   20.4, 3.429, 3.4, "#A5510C"],
  [3.428,   23.8, 3.429, 3.4, "#A5510C"],
  [0,       30.6, 27.428, 3.4, "#A5510C"], // path → rect
  [30.857,  23.8, 3.429, 3.4, "#A5510C"],
  [34.286,  20.4, 3.429, 3.4, "#A5510C"],
  [34.286,  13.6, 3.429, 6.8, "#A5510C"],  // path → tall rect
  [30.857,  10.2, 3.429, 3.4, "#A5510C"],
]

function drawLogoRects(doc: jsPDF, originX: number, originY: number, scale: number): void {
  for (const [x, y, w, h, fill] of LOGO_RECTS) {
    setFill(doc, fill)
    doc.rect(originX + x * scale, originY + y * scale, w * scale, h * scale, "F")
  }
}

// ── Calendar heatmap ──────────────────────────────────────────────────────────

function renderCalendarHeatmap(
  doc: jsPDF,
  logs: DailyLog[],
  startY: number,
  W: number,
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

  const monthGap   = 9
  const numMonths  = months.length
  const cellGap    = 1.5
  const maxMonthW  = (W - 56 - 2 * monthGap) / 3
  const cellSize   = Math.min(14, Math.floor((maxMonthW - 6 * cellGap) / 7))
  const step       = cellSize + cellGap
  const monthW     = 7 * cellSize + 6 * cellGap
  const totalW     = numMonths * monthW + (numMonths - 1) * monthGap
  const startX     = (W - totalW) / 2

  const DOW = ["M", "T", "W", "T", "F", "S", "S"]
  const headerH = 10
  const dowH    = 9

  const [ar, ag, ab] = [0xf9, 0x73, 0x16]
  const [sr, sg, sb] = [0x1e, 0x29, 0x3b]

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

    // Month label
    const label = new Date(year, month, 1)
      .toLocaleDateString(undefined, { month: "long", year: "numeric" })
    doc.setFont("helvetica", "bold")
    doc.setFontSize(6)
    setText(doc, MUTED)
    doc.text(label.toUpperCase(), mx + monthW / 2, my + 7, { align: "center" })

    // DOW headers
    doc.setFont("helvetica", "normal")
    doc.setFontSize(5.5)
    for (let d = 0; d < 7; d++) {
      doc.text(DOW[d], mx + d * step + cellSize / 2, my + headerH + 7, { align: "center" })
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
        doc.setFillColor(20, 30, 48)
      } else if (active === 0) {
        doc.setFillColor(40, 52, 70)
      } else {
        const t = active / maxActive
        const alpha = 0.18 + t * 0.82
        doc.setFillColor(
          Math.round(sr + alpha * (ar - sr)),
          Math.round(sg + alpha * (ag - sg)),
          Math.round(sb + alpha * (ab - sb))
        )
      }

      doc.roundedRect(cx, cy, cellSize, cellSize, 1, 1, "F")
    }
  })

  // Legend
  const legendY   = startY + blockH + 5
  const boxSize   = 5.5
  const boxGap    = 2.5
  const boxCount  = 5
  const legendW   = boxCount * (boxSize + boxGap) - boxGap
  const boxStartX = startX + totalW - legendW - 20

  doc.setFont("helvetica", "normal")
  doc.setFontSize(5)
  setText(doc, MUTED)
  doc.text("Less", boxStartX - 2, legendY + boxSize, { align: "right" })
  doc.text("More", boxStartX + legendW + 2, legendY + boxSize)

  for (let i = 0; i < boxCount; i++) {
    const t = i / (boxCount - 1)
    const alpha = 0.18 + t * 0.82
    if (i === 0) {
      doc.setFillColor(40, 52, 70)
    } else {
      doc.setFillColor(
        Math.round(sr + alpha * (ar - sr)),
        Math.round(sg + alpha * (ag - sg)),
        Math.round(sb + alpha * (ab - sb))
      )
    }
    doc.roundedRect(boxStartX + i * (boxSize + boxGap), legendY, boxSize, boxSize, 0.8, 0.8, "F")
  }

  return legendY + boxSize
}

// ── Stat grid ─────────────────────────────────────────────────────────────────

interface StatItem { label: string; value: string; color: string }

function renderStatGrid(
  doc: jsPDF,
  items: StatItem[],
  startY: number,
  W: number,
  colors: { surface: string; text: string; muted: string }
): number {
  const margin = 28
  const gap = 10
  const colW = (W - margin * 2 - gap) / 2
  const cellH = 54
  const rowGap = 10

  items.forEach((item, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * (colW + gap)
    const y = startY + row * (cellH + rowGap)

    setFill(doc, colors.surface)
    doc.roundedRect(x, y, colW, cellH, 5, 5, "F")

    doc.setFont("helvetica", "bold")
    doc.setFontSize(18)
    setText(doc, item.color)
    doc.text(item.value, x + 10, y + 22)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    setText(doc, colors.muted)
    doc.text(item.label, x + 10, y + 40)
  })

  const rows = Math.ceil(items.length / 2)
  return startY + rows * (cellH + rowGap) - rowGap
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generatePdf(logs: DailyLog[], options: PdfOptions): ArrayBuffer {
  const W = 420
  const H = 620

  const BG      = "#0f172a"
  const SURFACE = "#1e293b"
  const ACCENT  = "#f97316"
  const TEXT    = "#f8fafc"
  const MUTED   = "#64748b"
  const GREEN   = "#22c55e"
  const RED     = "#ef4444"

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: [W, H] })

  // Background
  setFill(doc, BG)
  doc.rect(0, 0, W, H, "F")

  // Accent bar
  setFill(doc, ACCENT)
  doc.rect(0, 0, W, 5, "F")

  // ── Header: logo + "RABBIT HOLE" ─────────────────────────────────────────

  const logoScale = 0.62           // 48×34 → ~29.8×21.1
  const logoW = 48 * logoScale
  const logoH = 34 * logoScale
  const brandFontSize = 13

  doc.setFont("helvetica", "bold")
  doc.setFontSize(brandFontSize)
  const textW = doc.getTextWidth("RABBIT HOLE")
  const headerGap = 7
  const groupW = logoW + headerGap + textW
  const groupX = (W - groupW) / 2
  const headerCenterY = 29

  drawLogoRects(doc, groupX, headerCenterY - logoH / 2, logoScale)

  setText(doc, ACCENT)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(brandFontSize)
  doc.text("RABBIT HOLE", groupX + logoW + headerGap, headerCenterY + brandFontSize * 0.35)

  // ── Subtitle ──────────────────────────────────────────────────────────────

  let yPos = 52
  const rangeLabel = `ACTIVITY FROM ${options.dateRange.from} TO ${options.dateRange.to}`
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  setText(doc, TEXT)
  doc.text(rangeLabel, W / 2, yPos, { align: "center" })
  yPos += 18

  // ── Project name ─────────────────────────────────────────────────────────

  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  setText(doc, TEXT)
  doc.text(options.projectName.toUpperCase(), W / 2, yPos, { align: "center" })
  yPos += 12

  // Divider
  setDraw(doc, SURFACE)
  doc.setLineWidth(1)
  doc.line(28, yPos, W - 28, yPos)
  yPos += 14

  // ── Streak hero ───────────────────────────────────────────────────────────

  const stats = computeStats(logs)

  if (options.streak) {
    doc.setFont("courier", "bold")
    doc.setFontSize(60)
    setText(doc, ACCENT)
    doc.text(String(stats.streak), W / 2, yPos + 52, { align: "center" })

    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    setText(doc, MUTED)
    doc.text("Day Streak", W / 2, yPos + 72, { align: "center" })

    yPos += 92

    setDraw(doc, SURFACE)
    doc.setLineWidth(1)
    doc.line(28, yPos, W - 28, yPos)
    yPos += 14
  }

  // ── Stats grid ────────────────────────────────────────────────────────────

  const statItems: StatItem[] = []
  if (options.activeTime)   statItems.push({ label: "ACTIVE TIME",   value: formatDuration(stats.totalActiveTime),  color: TEXT })
  if (options.linesAdded)   statItems.push({ label: "LINES ADDED",   value: `+${stats.totalLinesAdded}`,            color: GREEN })
  if (options.linesDeleted) statItems.push({ label: "LINES DELETED", value: `-${stats.totalLinesDeleted}`,          color: RED })
  if (options.topLanguage)  statItems.push({ label: "TOP LANGUAGE",  value: stats.topLanguage,                      color: TEXT })

  if (statItems.length > 0) {
    yPos = renderStatGrid(doc, statItems, yPos, W, { surface: SURFACE, text: TEXT, muted: MUTED }) + 18
  }

  // ── Heatmap ───────────────────────────────────────────────────────────────

  if (options.heatmap && logs.length > 0) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    setText(doc, MUTED)
    doc.text("ACTIVITY", W / 2, yPos, { align: "center" })
    yPos += 8

    yPos = renderCalendarHeatmap(doc, logs, yPos, W, MUTED) + 14
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  const now = new Date()
  const dateStr = now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  const timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  setText(doc, MUTED)
  doc.text(`Generated ${dateStr} at ${timeStr}  ·  Rabbit Hole`, W / 2, H - 16, { align: "center" })

  return doc.output("arraybuffer") as ArrayBuffer
}

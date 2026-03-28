import { jsPDF } from "jspdf"
import { DailyLog } from "../shared/types"

export interface PdfOptions {
  projectName: string
  dateRange: { from: string; to: string }
  isToday: boolean
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
  const logByDate = new Map<string, number>()
  for (const log of logs) logByDate.set(log.date, log.activeTime)
  const maxActive = Math.max(...logs.map(l => l.activeTime), 1)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayDow = (today.getDay() + 6) % 7
  const weekMonday = new Date(today); weekMonday.setDate(today.getDate() - todayDow)

  const weeks = 5
  const gridStart = new Date(weekMonday); gridStart.setDate(weekMonday.getDate() - (weeks - 1) * 7)

  const cellSize = 13
  const cellGap  = 2.5
  const step     = cellSize + cellGap
  const labelW   = 22
  const totalGridW = weeks * step - cellGap
  const gridX    = (W - labelW - totalGridW) / 2 + labelW

  const [ar, ag, ab] = [0xf9, 0x73, 0x16]
  const [sr, sg, sb] = [0x1e, 0x29, 0x3b]

  const DOW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"]
  doc.setFont("helvetica", "normal")
  doc.setFontSize(5.5)
  setText(doc, MUTED)
  for (let d = 0; d < 7; d++) {
    if (DOW_LABELS[d]) {
      doc.text(DOW_LABELS[d], gridX - 3, startY + d * step + cellSize - 1, { align: "right" })
    }
  }

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cell = new Date(gridStart); cell.setDate(gridStart.getDate() + w * 7 + d)
      if (cell > today) continue
      const key = `${cell.getFullYear()}-${String(cell.getMonth()+1).padStart(2,"0")}-${String(cell.getDate()).padStart(2,"0")}`
      const active = logByDate.get(key) ?? 0
      if (active === 0) {
        doc.setFillColor(40, 52, 70)
      } else {
        const alpha = 0.18 + (active / maxActive) * 0.82
        doc.setFillColor(
          Math.round(sr + alpha * (ar - sr)),
          Math.round(sg + alpha * (ag - sg)),
          Math.round(sb + alpha * (ab - sb))
        )
      }
      doc.roundedRect(gridX + w * step, startY + d * step, cellSize, cellSize, 1, 1, "F")
    }
  }

  const legendY  = startY + 7 * step + 4
  const boxSize  = 5
  const boxGap   = 2.5
  const boxCount = 5
  const legendW  = boxCount * (boxSize + boxGap) - boxGap
  const boxX     = gridX + totalGridW - legendW

  doc.setFont("helvetica", "normal")
  doc.setFontSize(5)
  setText(doc, MUTED)
  doc.text("Less", boxX - 2, legendY + boxSize, { align: "right" })
  doc.text("More", boxX + legendW + 2, legendY + boxSize)

  for (let i = 0; i < boxCount; i++) {
    const alpha = 0.18 + (i / (boxCount - 1)) * 0.82
    if (i === 0) {
      doc.setFillColor(40, 52, 70)
    } else {
      doc.setFillColor(
        Math.round(sr + alpha * (ar - sr)),
        Math.round(sg + alpha * (ag - sg)),
        Math.round(sb + alpha * (ab - sb))
      )
    }
    doc.roundedRect(boxX + i * (boxSize + boxGap), legendY, boxSize, boxSize, 0.8, 0.8, "F")
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

  const today = new Date(); today.setHours(0,0,0,0)
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`
  const stats = computeStats(logs.filter(l => l.date === todayKey))

  // ── Project name (vertically centered in header section) ─────────────────

  const headerSectionH = 40           // pt — from accent bar base to divider
  const headerDividerY = 5 + headerSectionH
  const headerTextY    = 5 + headerSectionH / 2 + 6   // baseline centered in section

  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  setText(doc, TEXT)
  doc.text(options.projectName.toUpperCase(), W / 2, headerTextY, { align: "center" })

  setDraw(doc, SURFACE)
  doc.setLineWidth(1)
  doc.line(28, headerDividerY, W - 28, headerDividerY)

  let yPos = headerDividerY + 14

  // ── Streak hero ───────────────────────────────────────────────────────────

  if (options.isToday) {
    doc.setFont("courier", "bold")
    doc.setFontSize(60)
    setText(doc, ACCENT)
    doc.text(String(stats.streak), W / 2, yPos + 52, { align: "center" })

    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    setText(doc, MUTED)
    doc.text("Day Streak", W / 2, yPos + 65, { align: "center" })

    yPos += 84

    setDraw(doc, SURFACE)
    doc.setLineWidth(1)
    doc.line(28, yPos, W - 28, yPos)
    yPos += 14
  }

  // ── Stats grid ────────────────────────────────────────────────────────────

  const statItems: StatItem[] = [
    { label: "ACTIVE TIME",   value: formatDuration(stats.totalActiveTime), color: TEXT },
    { label: "LINES ADDED",   value: `+${stats.totalLinesAdded}`,           color: GREEN },
    { label: "LINES DELETED", value: `-${stats.totalLinesDeleted}`,         color: RED },
    { label: "TOP LANGUAGE",  value: stats.topLanguage,                     color: TEXT },
  ]

  yPos = renderStatGrid(doc, statItems, yPos, W, { surface: SURFACE, text: TEXT, muted: MUTED }) + 18

  // ── Heatmap ───────────────────────────────────────────────────────────────

  if (logs.length > 0) {
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
  const footerPrefix = `Generated ${dateStr} at ${timeStr}  ·  `
  const footerSuffix = `Rabbit Hole`

  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  setText(doc, MUTED)

  const footerLogoScale = 7 / 34      // logo ~7pt tall
  const footerLogoW = 48 * footerLogoScale
  const footerGap = 2.5
  const prefixW = doc.getTextWidth(footerPrefix)
  const suffixW = doc.getTextWidth(footerSuffix)
  const footerGroupW = prefixW + footerLogoW + footerGap + suffixW
  const footerGroupX = (W - footerGroupW) / 2
  const footerY = H - 16

  doc.text(footerPrefix, footerGroupX, footerY)
  drawLogoRects(doc, footerGroupX + prefixW, footerY - 6, footerLogoScale)
  setText(doc, TEXT)
  doc.text(footerSuffix, footerGroupX + prefixW + footerLogoW + footerGap, footerY)

  return doc.output("arraybuffer") as ArrayBuffer
}

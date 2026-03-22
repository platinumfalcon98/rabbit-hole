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
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function setFill(doc: jsPDF, hex: string): void {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  doc.setFillColor(r, g, b)
}

function setDraw(doc: jsPDF, hex: string): void {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  doc.setDrawColor(r, g, b)
}

function setText(doc: jsPDF, hex: string): void {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  doc.setTextColor(r, g, b)
}

// ── Compute stats from logs ──────────────────────────────────────────────────

function computeStats(logs: DailyLog[]) {
  const streak = logs.length > 0 ? logs[logs.length - 1].streak : 0
  const totalActiveTime = logs.reduce((s, l) => s + l.activeTime, 0)
  const totalLinesAdded = logs.reduce(
    (s, l) => s + l.files.reduce((a, f) => a + f.linesAdded, 0), 0
  )
  const totalLinesDeleted = logs.reduce(
    (s, l) => s + l.files.reduce((a, f) => a + f.linesDeleted, 0), 0
  )
  const aiEvents = logs.reduce(
    (s, l) =>
      s +
      Object.entries(l.agents)
        .filter(([k]) => k !== "manual")
        .flatMap(([, v]) => v).length,
    0
  )

  const langTotals: Record<string, number> = {}
  for (const log of logs) {
    for (const [lang, stat] of Object.entries(log.languages)) {
      langTotals[lang] = (langTotals[lang] ?? 0) + stat.time
    }
  }
  const topLanguage =
    Object.entries(langTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"

  return { streak, totalActiveTime, totalLinesAdded, totalLinesDeleted, aiEvents, topLanguage }
}

// ── Stat grid ────────────────────────────────────────────────────────────────

interface StatItem {
  label: string
  value: string
  color: string
}

function renderStatGrid(
  doc: jsPDF,
  items: StatItem[],
  startY: number,
  W: number,
  colors: { surface: string; text: string; muted: string }
): number {
  if (items.length === 0) return startY

  const margin = 28
  const gap = 10
  const colW = (W - margin * 2 - gap) / 2
  const cellH = 60
  const rowGap = 10

  items.forEach((item, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * (colW + gap)
    const y = startY + row * (cellH + rowGap)

    setFill(doc, colors.surface)
    doc.roundedRect(x, y, colW, cellH, 6, 6, "F")

    doc.setFont("helvetica", "bold")
    doc.setFontSize(20)
    setText(doc, item.color)
    doc.text(item.value, x + 12, y + 26)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    setText(doc, colors.muted)
    doc.text(item.label, x + 12, y + 44)
  })

  const rows = Math.ceil(items.length / 2)
  return startY + rows * (cellH + rowGap) - rowGap
}

// ── Heatmap strip ─────────────────────────────────────────────────────────────

function renderHeatmap(
  doc: jsPDF,
  logs: DailyLog[],
  y: number,
  W: number,
  accentHex: string,
  surfaceHex: string
): number {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return y

  const inner = W - 56
  const n = sorted.length
  const cellPlusGap = Math.max(4, Math.floor(inner / n))
  const cellSize = Math.min(10, cellPlusGap - 1)
  const gap = cellPlusGap - cellSize
  const totalW = n * cellPlusGap - gap
  const startX = Math.max(28, (W - totalW) / 2)
  const maxActive = Math.max(...sorted.map(l => l.activeTime), 1)

  const ar = parseInt(accentHex.slice(1, 3), 16)
  const ag = parseInt(accentHex.slice(3, 5), 16)
  const ab = parseInt(accentHex.slice(5, 7), 16)
  const sr = parseInt(surfaceHex.slice(1, 3), 16)
  const sg = parseInt(surfaceHex.slice(3, 5), 16)
  const sb = parseInt(surfaceHex.slice(5, 7), 16)

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i].activeTime / maxActive
    const r = Math.round(sr + t * (ar - sr))
    const g = Math.round(sg + t * (ag - sg))
    const b = Math.round(sb + t * (ab - sb))
    doc.setFillColor(r, g, b)
    const x = startX + i * cellPlusGap
    doc.roundedRect(x, y, cellSize, cellSize, 1.5, 1.5, "F")
  }

  return y + cellSize
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generatePdf(logs: DailyLog[], options: PdfOptions): ArrayBuffer {
  const W = 420
  const H = 580

  const BG      = "#0f172a"
  const SURFACE  = "#1e293b"
  const ACCENT   = "#f97316"
  const TEXT     = "#f8fafc"
  const MUTED    = "#64748b"
  const GREEN    = "#22c55e"
  const RED      = "#ef4444"

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: [W, H] })

  // Background
  setFill(doc, BG)
  doc.rect(0, 0, W, H, "F")

  // Top accent bar
  setFill(doc, ACCENT)
  doc.rect(0, 0, W, 5, "F")

  // Brand
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  setText(doc, ACCENT)
  doc.text("RABBIT HOLE", W / 2, 34, { align: "center" })

  // Subtitle
  const rangeLabel = `LAST ${options.days} DAYS`
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  setText(doc, MUTED)
  doc.text(rangeLabel, W / 2, 50, { align: "center" })

  const stats = computeStats(logs)

  // Build stat items
  const allItems: StatItem[] = []
  if (options.streak)      allItems.push({ label: "DAY STREAK",    value: String(stats.streak),                    color: ACCENT })
  if (options.activeTime)  allItems.push({ label: "ACTIVE TIME",   value: formatDuration(stats.totalActiveTime),   color: TEXT })
  if (options.linesAdded)  allItems.push({ label: "LINES ADDED",   value: `+${stats.totalLinesAdded}`,             color: GREEN })
  if (options.linesDeleted)allItems.push({ label: "LINES DELETED", value: `-${stats.totalLinesDeleted}`,            color: RED })
  if (options.topLanguage) allItems.push({ label: "TOP LANGUAGE",  value: stats.topLanguage,                       color: TEXT })
  if (options.aiEvents)    allItems.push({ label: "AI ASSISTS",    value: String(stats.aiEvents),                  color: TEXT })

  let yPos = 70

  // Hero block — streak gets the big treatment if it's first
  if (options.streak && allItems.length > 0 && allItems[0].label === "DAY STREAK") {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(80)
    setText(doc, ACCENT)
    doc.text(String(stats.streak), W / 2, yPos + 68, { align: "center" })

    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    setText(doc, MUTED)
    doc.text("DAY STREAK", W / 2, yPos + 88, { align: "center" })

    yPos += 106

    // Divider
    setDraw(doc, SURFACE)
    doc.setLineWidth(1)
    doc.line(28, yPos, W - 28, yPos)
    yPos += 18

    const remaining = allItems.slice(1)
    if (remaining.length > 0) {
      yPos = renderStatGrid(doc, remaining, yPos, W, { surface: SURFACE, text: TEXT, muted: MUTED }) + 18
    }
  } else {
    yPos += 10
    if (allItems.length > 0) {
      yPos = renderStatGrid(doc, allItems, yPos, W, { surface: SURFACE, text: TEXT, muted: MUTED }) + 18
    }
  }

  // Heatmap strip
  if (options.heatmap && logs.length > 0) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    setText(doc, MUTED)
    doc.text("ACTIVITY", W / 2, yPos, { align: "center" })
    yPos += 12

    yPos = renderHeatmap(doc, logs, yPos, W, ACCENT, SURFACE) + 18
  }

  // Footer
  const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  setText(doc, MUTED)
  doc.text(`Generated ${dateStr}  ·  Rabbit Hole`, W / 2, H - 18, { align: "center" })

  return doc.output("arraybuffer") as ArrayBuffer
}

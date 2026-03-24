import { DailyLog } from "../shared/types"
import { PdfOptions, computeStats } from "./pdfExport"

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
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

export async function generateJpg(logs: DailyLog[], options: PdfOptions): Promise<string> {
  await document.fonts.ready

  const SCALE = 2
  const W = 420 * SCALE
  const H = 580 * SCALE
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

  // Brand
  ctx.fillStyle = ACCENT
  ctx.font = `bold ${s(12)}px 'Electrolize', sans-serif`
  ctx.textAlign = "center"
  ctx.fillText("RABBIT HOLE", W / 2, s(34))

  // Date range subtitle
  ctx.fillStyle = MUTED
  ctx.font = `${s(8)}px 'Electrolize', sans-serif`
  ctx.fillText(
    `ACTIVITY FROM ${options.dateRange.from} TO ${options.dateRange.to}`,
    W / 2,
    s(50)
  )

  const stats = computeStats(logs)

  interface StatItem { label: string; value: string; color: string }
  const allItems: StatItem[] = []
  if (options.streak)       allItems.push({ label: "DAY STREAK",    value: String(stats.streak),                   color: ACCENT })
  if (options.activeTime)   allItems.push({ label: "ACTIVE TIME",   value: formatDuration(stats.totalActiveTime),  color: TEXT })
  if (options.linesAdded)   allItems.push({ label: "LINES ADDED",   value: `+${stats.totalLinesAdded}`,            color: GREEN })
  if (options.linesDeleted) allItems.push({ label: "LINES DELETED", value: `-${stats.totalLinesDeleted}`,          color: RED })
  if (options.topLanguage)  allItems.push({ label: "TOP LANGUAGE",  value: stats.topLanguage,                      color: TEXT })
  if (options.aiEvents)     allItems.push({ label: "AI ASSISTS",    value: String(stats.aiEvents),                 color: TEXT })

  let yPos = s(70)

  // Hero streak block
  if (options.streak && allItems[0]?.label === "DAY STREAK") {
    ctx.fillStyle = ACCENT
    ctx.font = `bold ${s(80)}px 'Press Start 2P', monospace`
    ctx.textAlign = "center"
    ctx.fillText(String(stats.streak), W / 2, yPos + s(68))

    ctx.fillStyle = MUTED
    ctx.font = `bold ${s(10)}px 'Electrolize', sans-serif`
    ctx.fillText("DAY STREAK", W / 2, yPos + s(88))

    yPos += s(106)

    // Divider
    ctx.strokeStyle = SURFACE
    ctx.lineWidth = s(1)
    ctx.beginPath()
    ctx.moveTo(s(28), yPos)
    ctx.lineTo(W - s(28), yPos)
    ctx.stroke()
    yPos += s(18)

    const remaining = allItems.slice(1)
    if (remaining.length > 0) yPos = drawStatGrid(ctx, remaining, yPos, W, s, SURFACE, MUTED) + s(18)
  } else {
    yPos += s(10)
    if (allItems.length > 0) yPos = drawStatGrid(ctx, allItems, yPos, W, s, SURFACE, MUTED) + s(18)
  }

  // Heatmap
  if (options.heatmap && logs.length > 0) {
    ctx.fillStyle = MUTED
    ctx.font = `${s(8)}px 'Electrolize', sans-serif`
    ctx.textAlign = "center"
    ctx.fillText("ACTIVITY", W / 2, yPos)
    yPos += s(12)
    yPos = drawHeatmap(ctx, logs, yPos, W, s, ACCENT, SURFACE) + s(18)
  }

  // Footer
  const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  ctx.fillStyle = MUTED
  ctx.font = `${s(8)}px 'Electrolize', sans-serif`
  ctx.textAlign = "center"
  ctx.fillText(`Generated ${dateStr}  ·  Rabbit Hole`, W / 2, H - s(18))

  return canvas.toDataURL("image/jpeg", 0.93)
}

function drawStatGrid(
  ctx: CanvasRenderingContext2D,
  items: { label: string; value: string; color: string }[],
  startY: number,
  W: number,
  s: (v: number) => number,
  surfaceColor: string,
  mutedColor: string
): number {
  const margin = s(28)
  const gap = s(10)
  const colW = (W - margin * 2 - gap) / 2
  const cellH = s(60)
  const rowGap = s(10)

  items.forEach((item, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * (colW + gap)
    const y = startY + row * (cellH + rowGap)

    ctx.fillStyle = surfaceColor
    roundRect(ctx, x, y, colW, cellH, s(6))
    ctx.fill()

    ctx.fillStyle = item.color
    ctx.font = `bold ${s(20)}px 'Unica One', sans-serif`
    ctx.textAlign = "left"
    ctx.fillText(item.value, x + s(12), y + s(26))

    ctx.fillStyle = mutedColor
    ctx.font = `bold ${s(8)}px 'Electrolize', sans-serif`
    ctx.fillText(item.label, x + s(12), y + s(44))
  })

  const rows = Math.ceil(items.length / 2)
  return startY + rows * (cellH + rowGap) - rowGap
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  logs: DailyLog[],
  y: number,
  W: number,
  s: (v: number) => number,
  accentHex: string,
  surfaceHex: string
): number {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return y

  const inner = W - s(56)
  const n = sorted.length
  const cellPlusGap = Math.max(s(4), Math.floor(inner / n))
  const cellSize = Math.min(s(10), cellPlusGap - 1)
  const gap = cellPlusGap - cellSize
  const totalW = n * cellPlusGap - gap
  const startX = Math.max(s(28), (W - totalW) / 2)
  const maxActive = Math.max(...sorted.map(l => l.activeTime), 1)

  const [ar, ag, ab] = hexToRgb(accentHex)
  const [sr, sg, sb] = hexToRgb(surfaceHex)

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i].activeTime / maxActive
    const r = Math.round(sr + t * (ar - sr))
    const g = Math.round(sg + t * (ag - sg))
    const b = Math.round(sb + t * (ab - sb))
    ctx.fillStyle = `rgb(${r},${g},${b})`
    roundRect(ctx, startX + i * cellPlusGap, y, cellSize, cellSize, s(1.5))
    ctx.fill()
  }

  return y + cellSize
}

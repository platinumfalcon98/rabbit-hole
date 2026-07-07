import { DailyLog } from "../shared/types"
import {
  EXPORT_COLORS as C,
  ExportOptions,
  LOGO_RECTS,
  LOGO_W,
  computeStats,
  formatDuration,
  todayKey,
} from "./exportShared"

// Share card renderer — a 420×620 phosphor-terminal stat card meant for
// posting, drawn on canvas at 3× and exported as JPEG. Styling follows
// DESIGN.md: void background, bordered card tiles, amber chrome, green
// streak/positive, Press Start 2P hero / Unica One numerals / Electrolize
// labels, tight phosphor bloom on the hero numeral.

// ── Canvas helpers ────────────────────────────────────────────────────────────

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

/** Text with the tight phosphor bloom from DESIGN.md (--rh-glow-text-strong). */
function glowText(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number,
  color: string, blur: number
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  ctx.fillText(text, x, y)
  ctx.fillText(text, x, y) // second pass stacks the bloom, matching the CSS recipe
  ctx.restore()
}

// ── Heatmap (GitHub-style: weeks as columns, Mon–Sun rows) ────────────────────

function drawCalendarHeatmap(
  ctx: CanvasRenderingContext2D,
  logs: DailyLog[],
  startY: number,
  W: number,
  s: (v: number) => number
): number {
  const logByDate = new Map<string, number>()
  for (const log of logs) logByDate.set(log.date, log.activeTime)
  const maxActive = Math.max(...logs.map(l => l.activeTime), 1)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayDow = (today.getDay() + 6) % 7  // Mon=0
  const weekMonday = new Date(today); weekMonday.setDate(today.getDate() - todayDow)

  const weeks = 5
  const gridStart = new Date(weekMonday); gridStart.setDate(weekMonday.getDate() - (weeks - 1) * 7)

  const cellSize = s(16.5)
  const cellGap  = s(3.5)
  const step     = cellSize + cellGap
  const labelW   = s(26)
  const totalGridW = weeks * step - cellGap
  const gridX    = (W - labelW - totalGridW) / 2 + labelW

  // Day-of-week labels
  const DOW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"]
  ctx.font = `${s(7)}px 'Electrolize', sans-serif`
  ctx.fillStyle = C.textDim
  ctx.textAlign = "right"
  for (let d = 0; d < 7; d++) {
    if (DOW_LABELS[d]) {
      ctx.fillText(DOW_LABELS[d], gridX - s(4), startY + d * step + cellSize - s(1))
    }
  }

  // Cells — phosphor-green ramp, same as heatmap.ts
  const tk = todayKey()
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cell = new Date(gridStart); cell.setDate(gridStart.getDate() + w * 7 + d)
      if (cell > today) continue
      const key = `${cell.getFullYear()}-${String(cell.getMonth()+1).padStart(2,"0")}-${String(cell.getDate()).padStart(2,"0")}`
      const active = logByDate.get(key) ?? 0
      const t = active / maxActive
      ctx.fillStyle = active === 0
        ? "rgba(128,128,128,0.12)"
        : `rgba(57,255,106,${(0.18 + t * 0.82).toFixed(2)})`
      roundRect(ctx, gridX + w * step, startY + d * step, cellSize, cellSize, s(2))
      ctx.fill()
      if (key === tk) {
        // Amber today ring, matching the dashboard heatmap
        ctx.strokeStyle = C.accent
        ctx.lineWidth = s(1.2)
        roundRect(ctx, gridX + w * step, startY + d * step, cellSize, cellSize, s(2))
        ctx.stroke()
      }
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
  ctx.fillStyle = C.textDim
  ctx.textAlign = "right"
  ctx.fillText("Less", boxX - s(3), legendY + boxSize - s(1))
  ctx.textAlign = "left"
  ctx.fillText("More", boxX + legendW + s(3), legendY + boxSize - s(1))

  for (let i = 0; i < boxCount; i++) {
    const t = i / (boxCount - 1)
    ctx.fillStyle = i === 0 ? "rgba(128,128,128,0.12)" : `rgba(57,255,106,${(0.18 + t * 0.82).toFixed(2)})`
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
  s: (v: number) => number
): number {
  const margin = s(28)
  const gap = s(10)
  const colW = (W - margin * 2 - gap) / 2
  const cellH = s(72)
  const rowGap = s(14)

  items.forEach((item, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * (colW + gap)
    const y = startY + row * (cellH + rowGap)

    // Card tile: darker-than-page fill + bright border (DESIGN.md card recipe)
    ctx.fillStyle = C.card
    roundRect(ctx, x, y, colW, cellH, s(8))
    ctx.fill()
    ctx.strokeStyle = C.borderBright
    ctx.lineWidth = s(1)
    roundRect(ctx, x, y, colW, cellH, s(8))
    ctx.stroke()

    ctx.textAlign = "left"
    ctx.font = `${s(24)}px 'Unica One', sans-serif`
    glowText(ctx, item.value, x + s(12), y + s(38), item.color, s(2))

    ctx.fillStyle = C.textDim
    ctx.font = `${s(9)}px 'Electrolize', sans-serif`
    ctx.fillText(item.label, x + s(12), y + s(57))
  })

  const rows = Math.ceil(items.length / 2)
  return startY + rows * (cellH + rowGap) - rowGap
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateJpg(logs: DailyLog[], options: ExportOptions): Promise<string> {
  // fonts.ready alone isn't enough: a face only loads once something uses it,
  // and the canvas isn't in the DOM. Request all three explicitly.
  await Promise.all([
    document.fonts.load("12px 'Electrolize'"),
    document.fonts.load("12px 'Press Start 2P'"),
    document.fonts.load("12px 'Unica One'"),
  ])
  await document.fonts.ready

  const SCALE = 3
  const W = 420 * SCALE
  const H = 620 * SCALE
  const s = (v: number) => v * SCALE

  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")!

  // Background — void, not slate
  ctx.fillStyle = C.void
  ctx.fillRect(0, 0, W, H)

  // Top chrome bar — amber with a soft bloom below it
  ctx.save()
  ctx.shadowColor = C.accent
  ctx.shadowBlur = s(6)
  ctx.fillStyle = C.accent
  ctx.fillRect(0, 0, W, s(4))
  ctx.restore()

  const stats = computeStats(logs.filter(l => l.date === todayKey()))

  // ── Header: project name + date ────────────────────────────────────────────

  const headerSectionH = s(60)
  const headerDividerY = s(4) + headerSectionH
  const headerTextY    = s(4) + s(30)

  ctx.textAlign = "center"
  ctx.font = `${s(19)}px 'Electrolize', sans-serif`
  glowText(ctx, options.projectName.toUpperCase(), W / 2, headerTextY, C.text, s(2))

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  })
  ctx.fillStyle = C.textDim
  ctx.font = `${s(8.5)}px 'Electrolize', sans-serif`
  ctx.fillText(dateLabel.toUpperCase(), W / 2, headerTextY + s(16))

  ctx.strokeStyle = C.border
  ctx.lineWidth = s(1)
  ctx.beginPath()
  ctx.moveTo(s(28), headerDividerY)
  ctx.lineTo(W - s(28), headerDividerY)
  ctx.stroke()

  let yPos = headerDividerY + s(20)

  // ── Streak hero — phosphor green, Press Start 2P, strong bloom ─────────────

  if (options.isToday) {
    ctx.textAlign = "center"
    ctx.font = `${s(58)}px 'Press Start 2P', monospace`
    glowText(ctx, String(stats.streak), W / 2, yPos + s(66), C.success, s(7))

    ctx.fillStyle = C.textDim
    ctx.font = `${s(11)}px 'Electrolize', sans-serif`
    ctx.fillText("DAY STREAK", W / 2, yPos + s(90))
    yPos += s(110)

    ctx.strokeStyle = C.border
    ctx.lineWidth = s(1)
    ctx.beginPath()
    ctx.moveTo(s(28), yPos)
    ctx.lineTo(W - s(28), yPos)
    ctx.stroke()
    yPos += s(20)
  }

  // ── Stats grid ──────────────────────────────────────────────────────────────

  const statItems: { label: string; value: string; color: string }[] = [
    { label: "ACTIVE TIME",   value: formatDuration(stats.totalActiveTime), color: C.text },
    { label: "LINES ADDED",   value: `+${stats.totalLinesAdded}`,           color: C.success },
    { label: "LINES DELETED", value: `-${stats.totalLinesDeleted}`,         color: C.danger },
    { label: "TOP LANGUAGE",  value: stats.topLanguage,                     color: C.text },
  ]
  yPos = drawStatGrid(ctx, statItems, yPos, W, s) + s(30)

  // ── Heatmap ─────────────────────────────────────────────────────────────────

  if (logs.length > 0) {
    ctx.fillStyle = C.textDim
    ctx.font = `${s(7.5)}px 'Electrolize', sans-serif`
    ctx.textAlign = "center"
    ctx.fillText("ACTIVITY · LAST 5 WEEKS", W / 2, yPos)
    yPos += s(12)

    yPos = drawCalendarHeatmap(ctx, logs, yPos, W, s) + s(16)
  }

  // ── Footer ──────────────────────────────────────────────────────────────────

  const now = new Date()
  const dateStr = now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  const timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  const footerPrefix = `Generated ${dateStr} at ${timeStr}  ·  `
  const footerSuffix = `Rabbit Hole`

  ctx.font = `${s(7.5)}px 'Electrolize', sans-serif`
  const prefixW = ctx.measureText(footerPrefix).width
  const suffixW = ctx.measureText(footerSuffix).width
  const footerLogoScale = s(8) / 34   // logo ~8px logical tall
  const footerLogoW = LOGO_W * footerLogoScale
  const footerGap = s(4)
  const groupW = prefixW + footerLogoW + footerGap + suffixW
  const groupX = (W - groupW) / 2
  const footerY = H - s(18)

  ctx.fillStyle = C.textMuted
  ctx.textAlign = "left"
  ctx.fillText(footerPrefix, groupX, footerY)

  drawLogoCanvas(ctx, groupX + prefixW, footerY - s(7), footerLogoScale)

  ctx.fillStyle = C.text
  ctx.fillText(footerSuffix, groupX + prefixW + footerLogoW + footerGap, footerY)

  // ── CRT scanlines — faint, drawn over the phosphor like the dashboard ──────

  ctx.fillStyle = "rgba(0, 0, 0, 0.10)"
  for (let y = 0; y < H; y += s(3)) {
    ctx.fillRect(0, y, W, SCALE)
  }

  return canvas.toDataURL("image/jpeg", 0.93)
}

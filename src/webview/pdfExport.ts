import { jsPDF } from "jspdf"
import { ActivitySession, DailyLog, FileActivity, LanguageStat } from "../shared/types"
import {
  EXPORT_COLORS as C,
  ExportOptions,
  LOGO_RECTS,
  ReportPreset,
  computeStats,
  formatDuration,
  heatmapCellRgb,
  todayKey,
} from "./exportShared"
// esbuild --loader:.ttf=base64 turns this import into the font's base64 string
import ELECTROLIZE_TTF from "./fonts/Electrolize-Regular.ttf"

// Full report renderer — a multi-section A4 PDF ("Today's Report") with
// today / 30-day / 90-day presets. Follows DESIGN.md's phosphor palette but
// restrained for a document: no scanlines or glow, flat fills, hierarchy
// carried by size and color. Electrolize is embedded (the design system's
// label/mono face); it ships one weight, so emphasis is size/color only.

const W = 595.28   // A4 portrait, pt
const H = 841.89
const MARGIN = 48
const FRAME_INSET = 20

const PRESET_META: Record<ReportPreset, { title: string; days: number; heatmapWeeks: number; heatmapLabel: string }> = {
  today: { title: "DAILY REPORT",  days: 1,  heatmapWeeks: 5,  heatmapLabel: "ACTIVITY · LAST 5 WEEKS" },
  "30d": { title: "30-DAY REPORT", days: 30, heatmapWeeks: 5,  heatmapLabel: "ACTIVITY · LAST 30 DAYS" },
  "90d": { title: "90-DAY REPORT", days: 90, heatmapWeeks: 13, heatmapLabel: "ACTIVITY · LAST 90 DAYS" },
}

// ── jsPDF color helpers ───────────────────────────────────────────────────────

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function setFill(doc: jsPDF, hex: string): void { doc.setFillColor(...hexRgb(hex)) }
function setDraw(doc: jsPDF, hex: string): void { doc.setDrawColor(...hexRgb(hex)) }
function setText(doc: jsPDF, hex: string): void { doc.setTextColor(...hexRgb(hex)) }

function drawLogoRects(doc: jsPDF, originX: number, originY: number, scale: number): void {
  for (const [x, y, w, h, fill] of LOGO_RECTS) {
    setFill(doc, fill)
    doc.rect(originX + x * scale, originY + y * scale, w * scale, h * scale, "F")
  }
}

// ── Page / layout plumbing ────────────────────────────────────────────────────

interface Page {
  doc: jsPDF
  y: number
}

function paintPageBg(doc: jsPDF): void {
  setFill(doc, C.void)
  doc.rect(0, 0, W, H, "F")
  // Hairline terminal frame on every page
  setDraw(doc, C.border)
  doc.setLineWidth(0.75)
  doc.roundedRect(FRAME_INSET, FRAME_INSET, W - FRAME_INSET * 2, H - FRAME_INSET * 2, 6, 6, "D")
}

/** Start a new page if fewer than `needed` pt remain above the footer zone. */
function ensure(p: Page, needed: number): void {
  if (p.y + needed <= H - 48) return
  p.doc.addPage()
  paintPageBg(p.doc)
  p.y = MARGIN
}

/** Section header: small amber tick, spaced uppercase label, rule to the right edge. */
function sectionHeader(p: Page, label: string): void {
  ensure(p, 40)
  const { doc } = p
  setFill(doc, C.accent)
  doc.rect(MARGIN, p.y - 6.5, 3, 8, "F")
  doc.setFontSize(9)
  doc.setCharSpace(1.4)
  setText(doc, C.textDim)
  doc.text(label, MARGIN + 9, p.y)
  const labelEnd = MARGIN + 9 + doc.getTextWidth(label) + 1.4 * label.length
  doc.setCharSpace(0)
  setDraw(doc, C.border)
  doc.setLineWidth(0.75)
  doc.line(labelEnd + 8, p.y - 3, W - MARGIN, p.y - 3)
  p.y += 16
}

// Plain "..." rather than U+2026 — the ellipsis glyph doesn't render in the
// embedded Electrolize subset.

/** Truncate from the front, keeping the tail (right rule for file paths). */
function truncateToWidth(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth("..." + t) > maxW) t = t.slice(1)
  return "..." + t
}

/** Truncate from the end, keeping the start (right rule for names/labels). */
function truncateEndToWidth(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth(t + "...") > maxW) t = t.slice(0, -1)
  return t + "..."
}

/**
 * Fit a tile value into maxW: step the font size down first (long project or
 * language names stay whole where possible), truncate only as a last resort.
 * Leaves the chosen size set on the doc.
 */
function fitTileValue(doc: jsPDF, text: string, maxW: number): string {
  for (let size = 17; size >= 11; size--) {
    doc.setFontSize(size)
    if (doc.getTextWidth(text) <= maxW) return text
  }
  return truncateEndToWidth(doc, text, maxW)
}

/** Key/value row with a faint dashed leader — terminal directory-listing flavor. */
function kvRow(p: Page, label: string, value: string, valueColor: string = C.text): void {
  ensure(p, 20)
  const { doc } = p
  doc.setFontSize(8)
  doc.setCharSpace(0.8)
  setText(doc, C.textDim)
  doc.text(label, MARGIN, p.y)
  const labelEnd = MARGIN + doc.getTextWidth(label) + 0.8 * label.length
  doc.setCharSpace(0)

  doc.setFontSize(9.5)
  setText(doc, valueColor)
  const valueW = doc.getTextWidth(value)
  doc.text(value, W - MARGIN, p.y, { align: "right" })

  setDraw(doc, C.border)
  doc.setLineWidth(0.5)
  doc.setLineDashPattern([1, 2.5], 0)
  doc.line(labelEnd + 10, p.y - 2.5, W - MARGIN - valueW - 10, p.y - 2.5)
  doc.setLineDashPattern([], 0)
  p.y += 18
}

// ── Range helpers ─────────────────────────────────────────────────────────────

function dateKeyOffset(offset: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function rangeLabel(preset: ReportPreset): string {
  const today = new Date()
  if (preset === "today") {
    return today.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
  }
  const start = new Date()
  start.setDate(start.getDate() - (PRESET_META[preset].days - 1))
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: start.getFullYear() === today.getFullYear() ? undefined : "numeric" })
  const endLabel = today.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  return `${startLabel} – ${endLabel}`
}

function friendlyDay(dateKey: string): string {
  return new Date(dateKey + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// ── Sections ──────────────────────────────────────────────────────────────────

function renderSummaryTiles(
  p: Page,
  preset: ReportPreset,
  rangeLogs: DailyLog[],
  stats: ReturnType<typeof computeStats>,
  projectNames: Record<string, string>
): void {
  const { doc } = p
  const sessionCount = rangeLogs.reduce((s, l) => s + l.sessions.length, 0)
  const activeDays = rangeLogs.filter(l => l.activeTime > 0).length

  // Top project by active time — sessions carry projectId only on aggregate
  // ("All Projects") data, so this tile self-omits on single-project exports.
  const projectTime: Record<string, number> = {}
  for (const log of rangeLogs) {
    for (const session of log.sessions) {
      if (session.projectId) {
        projectTime[session.projectId] = (projectTime[session.projectId] ?? 0) + session.activeTime
      }
    }
  }
  const topProjectId = Object.entries(projectTime).sort((a, b) => b[1] - a[1])[0]?.[0]

  const items: { label: string; value: string; color: string }[] = [
    { label: "ACTIVE TIME", value: formatDuration(stats.totalActiveTime), color: C.text },
    preset === "today"
      ? { label: "DAY STREAK",  value: String(stats.streak),                             color: C.success }
      : { label: "ACTIVE DAYS", value: `${activeDays} / ${PRESET_META[preset].days}`,    color: C.success },
    { label: "SESSIONS",      value: String(sessionCount),                               color: C.text },
    { label: "LINES ADDED",   value: `+${stats.totalLinesAdded.toLocaleString()}`,       color: C.success },
    { label: "LINES DELETED", value: `-${stats.totalLinesDeleted.toLocaleString()}`,     color: C.danger },
    { label: "TOP LANGUAGE",  value: stats.topLanguage,                                  color: C.text },
  ]
  if (preset !== "today") {
    items.splice(2, 0, {
      label: "AVG / ACTIVE DAY",
      value: activeDays > 0 ? formatDuration(stats.totalActiveTime / activeDays) : "—",
      color: C.text,
    })
  }
  if (topProjectId) {
    items.push({
      label: "TOP PROJECT",
      value: projectNames[topProjectId] ?? topProjectId,
      color: C.accent,
    })
  }

  const cols = items.length <= 6 ? 3 : 4
  const gap = 10
  const tileW = (W - MARGIN * 2 - gap * (cols - 1)) / cols
  const tileH = 52
  const rows = Math.ceil(items.length / cols)
  const lastRowCount = items.length - (rows - 1) * cols
  // Center an incomplete last row so a 7-tile grid doesn't look truncated
  const lastRowOffset = (cols - lastRowCount) * (tileW + gap) / 2

  items.forEach((item, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = MARGIN + col * (tileW + gap) + (row === rows - 1 ? lastRowOffset : 0)
    const y = p.y + row * (tileH + gap)

    setFill(doc, C.card)
    setDraw(doc, C.borderBright)
    doc.setLineWidth(0.75)
    doc.roundedRect(x, y, tileW, tileH, 5, 5, "FD")

    setText(doc, item.color)
    doc.text(fitTileValue(doc, item.value, tileW - 22), x + 11, y + 24)

    doc.setFontSize(7)
    doc.setCharSpace(0.8)
    setText(doc, C.textDim)
    doc.text(item.label, x + 11, y + 41)
    doc.setCharSpace(0)
  })

  p.y += rows * (tileH + gap) - gap + 26
}

function renderLanguages(p: Page, rangeLogs: DailyLog[]): void {
  sectionHeader(p, "LANGUAGES")
  const { doc } = p

  // Aggregate across the range
  const totals: Record<string, LanguageStat> = {}
  for (const log of rangeLogs) {
    for (const [lang, stat] of Object.entries(log.languages)) {
      const t = totals[lang] ?? (totals[lang] = { time: 0, linesAdded: 0, linesDeleted: 0 })
      t.time += stat.time
      t.linesAdded += stat.linesAdded
      t.linesDeleted += stat.linesDeleted
    }
  }

  const entries = Object.entries(totals)
    .filter(([, s]) => s.time > 0 || s.linesAdded > 0 || s.linesDeleted > 0)
    .sort((a, b) => b[1].time - a[1].time)

  if (entries.length === 0) {
    doc.setFontSize(9)
    setText(doc, C.textMuted)
    doc.text("No language activity recorded in this range.", MARGIN, p.y + 4)
    p.y += 26
    return
  }

  const MAX_ROWS = 8
  const shown = entries.slice(0, MAX_ROWS)
  const rest = entries.slice(MAX_ROWS)

  const maxTime = Math.max(...shown.map(([, s]) => s.time), 1)
  const nameW = 108
  const timeW = 52
  const diffW = 88
  const barX = MARGIN + nameW
  const barW = W - MARGIN * 2 - nameW - timeW - diffW
  const rowH = 19

  const drawRow = (name: string, stat: LanguageStat, dim: boolean) => {
    ensure(p, rowH + 4)
    const y = p.y

    doc.setFontSize(9.5)
    setText(doc, dim ? C.textMuted : C.text)
    doc.text(truncateToWidth(doc, name, nameW - 12), MARGIN, y + 3)

    // Bar: dim track + amber fill. The "+N more" overflow row gets no bar —
    // its combined time isn't comparable to a single language's.
    if (!dim) {
      setFill(doc, C.border)
      doc.roundedRect(barX, y - 3, barW, 7, 2, 2, "F")
      const w = Math.max(3, Math.min(1, stat.time / maxTime) * barW)
      setFill(doc, C.accent)
      doc.roundedRect(barX, y - 3, w, 7, 2, 2, "F")
    }

    doc.setFontSize(9)
    setText(doc, C.textDim)
    doc.text(formatDuration(stat.time), barX + barW + timeW - 6, y + 3, { align: "right" })

    setText(doc, dim ? C.textMuted : C.success)
    doc.text(`+${stat.linesAdded.toLocaleString()}`, W - MARGIN - 42, y + 3, { align: "right" })
    setText(doc, dim ? C.textMuted : C.danger)
    doc.text(`-${stat.linesDeleted.toLocaleString()}`, W - MARGIN, y + 3, { align: "right" })

    p.y += rowH
  }

  for (const [lang, stat] of shown) drawRow(lang, stat, false)

  if (rest.length > 0) {
    const combined = rest.reduce(
      (acc, [, s]) => ({
        time: acc.time + s.time,
        linesAdded: acc.linesAdded + s.linesAdded,
        linesDeleted: acc.linesDeleted + s.linesDeleted,
      }),
      { time: 0, linesAdded: 0, linesDeleted: 0 }
    )
    drawRow(`+ ${rest.length} more`, combined, true)
  }
  p.y += 22
}

function renderSessionsDaily(p: Page, todayLog: DailyLog | undefined): void {
  sectionHeader(p, "SESSIONS")
  const { doc } = p

  const sessions = [...(todayLog?.sessions ?? [])].sort((a, b) => a.startTime - b.startTime)

  if (sessions.length === 0) {
    doc.setFontSize(9)
    setText(doc, C.textMuted)
    doc.text("No sessions recorded today.", MARGIN, p.y + 4)
    p.y += 26
    return
  }

  const fmtTime = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

  const colX = {
    idx:    MARGIN,
    start:  MARGIN + 34,
    end:    MARGIN + 110,
    active: W - MARGIN - 110,
    total:  W - MARGIN,
  }

  doc.setFontSize(7)
  doc.setCharSpace(0.8)
  setText(doc, C.textMuted)
  doc.text("#", colX.idx, p.y)
  doc.text("START", colX.start, p.y)
  doc.text("END", colX.end, p.y)
  doc.text("ACTIVE", colX.active, p.y, { align: "right" })
  doc.text("ELAPSED", colX.total, p.y, { align: "right" })
  doc.setCharSpace(0)
  p.y += 6
  setDraw(doc, C.border)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, p.y, W - MARGIN, p.y)
  p.y += 12

  const MAX_ROWS = 20
  const rowH = 16
  sessions.slice(0, MAX_ROWS).forEach((sess: ActivitySession, i: number) => {
    ensure(p, rowH + 4)
    const y = p.y
    const open = sess.endTime === null

    doc.setFontSize(9)
    setText(doc, C.textMuted)
    doc.text(String(i + 1).padStart(2, "0"), colX.idx, y)

    setText(doc, C.text)
    doc.text(fmtTime(sess.startTime), colX.start, y)
    if (open) {
      setText(doc, C.success)
      doc.text("in progress", colX.end, y)
    } else {
      setText(doc, C.text)
      doc.text(fmtTime(sess.endTime!), colX.end, y)
    }

    setText(doc, C.text)
    doc.text(formatDuration(sess.activeTime), colX.active, y, { align: "right" })
    setText(doc, C.textDim)
    doc.text(open ? "—" : formatDuration(sess.duration), colX.total, y, { align: "right" })

    p.y += rowH
  })

  if (sessions.length > MAX_ROWS) {
    ensure(p, 18)
    doc.setFontSize(8.5)
    setText(doc, C.textMuted)
    doc.text(`… and ${sessions.length - MAX_ROWS} more`, colX.start, p.y)
    p.y += 16
  }

  // Totals row
  ensure(p, 22)
  setDraw(doc, C.border)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, p.y - 8, W - MARGIN, p.y - 8)
  doc.setFontSize(9)
  setText(doc, C.textDim)
  doc.text("TOTAL", colX.start, p.y + 2)
  setText(doc, C.text)
  const totalActive = sessions.reduce((s, x) => s + x.activeTime, 0)
  doc.text(formatDuration(totalActive), colX.active, p.y + 2, { align: "right" })
  p.y += 26
}

function renderSessionsRange(p: Page, rangeLogs: DailyLog[], days: number): void {
  sectionHeader(p, "SESSIONS")
  const { doc } = p

  interface Dated { session: ActivitySession; date: string }
  const all: Dated[] = []
  for (const log of rangeLogs) {
    for (const session of log.sessions) all.push({ session, date: log.date })
  }

  if (all.length === 0) {
    doc.setFontSize(9)
    setText(doc, C.textMuted)
    doc.text("No sessions recorded in this range.", MARGIN, p.y + 4)
    p.y += 26
    return
  }

  const activeDays = rangeLogs.filter(l => l.activeTime > 0).length
  const longest = all.reduce((best, x) => x.session.activeTime > best.session.activeTime ? x : best, all[0])
  const bestDay = rangeLogs.reduce((best, l) => l.activeTime > best.activeTime ? l : best, rangeLogs[0])
  const avgLength = all.reduce((s, x) => s + x.session.activeTime, 0) / all.length

  const fmtTime = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  const longestWhen = longest.session.endTime !== null
    ? `${fmtTime(longest.session.startTime)} – ${fmtTime(longest.session.endTime)}`
    : `from ${fmtTime(longest.session.startTime)}`

  kvRow(p, "TOTAL SESSIONS", String(all.length))
  kvRow(p, "AVG PER ACTIVE DAY", activeDays > 0 ? (all.length / activeDays).toFixed(1) : "—")
  kvRow(p, "AVG SESSION LENGTH", formatDuration(avgLength))
  kvRow(p, "LONGEST SESSION",
    `${formatDuration(longest.session.activeTime)}  ·  ${friendlyDay(longest.date)}, ${longestWhen}`, C.success)
  kvRow(p, "MOST ACTIVE DAY",
    `${formatDuration(bestDay.activeTime)}  ·  ${friendlyDay(bestDay.date)}`, C.success)
  p.y += 12
}

function renderFiles(p: Page, rangeLogs: DailyLog[], projectNames: Record<string, string>): void {
  sectionHeader(p, "TOP FILES")
  const { doc } = p

  // Merge by path across the range (same rule as the dashboard Files panel).
  // Key includes the project so identically-named paths in different projects
  // stay separate rows in aggregate exports.
  const merged = new Map<string, FileActivity>()
  for (const log of rangeLogs) {
    for (const file of log.files) {
      const key = `${file.projectId ?? ""}::${file.path}`
      const prev = merged.get(key)
      if (prev) {
        prev.linesAdded += file.linesAdded
        prev.linesDeleted += file.linesDeleted
      } else {
        merged.set(key, { ...file })
      }
    }
  }

  const files = [...merged.values()]
    .sort((a, b) => (b.linesAdded + b.linesDeleted) - (a.linesAdded + a.linesDeleted))
    .slice(0, 10)

  if (files.length === 0) {
    doc.setFontSize(9)
    setText(doc, C.textMuted)
    doc.text("No file activity recorded in this range.", MARGIN, p.y + 4)
    p.y += 26
    return
  }

  const rowH = 16
  const availW = W - MARGIN * 2 - 110
  for (const file of files) {
    ensure(p, rowH + 4)
    const y = p.y
    const shortPath = file.path.split(/[\\/]/).slice(-3).join("/")
    // projectId is only populated on aggregate ("All Projects") data — on
    // single-project exports the header already names the project. Cap the
    // tag width so a long project name can't crowd out the path.
    let projectLabel = file.projectId ? projectNames[file.projectId] ?? file.projectId : ""
    if (projectLabel) {
      doc.setFontSize(7.5)
      projectLabel = truncateEndToWidth(doc, projectLabel, 85)
    }

    doc.setFontSize(9)
    let pathMaxW = availW
    if (projectLabel) {
      doc.setFontSize(7.5)
      pathMaxW -= doc.getTextWidth(`·  ${projectLabel}`) + 14
      doc.setFontSize(9)
    }
    setText(doc, C.text)
    const drawnPath = truncateToWidth(doc, shortPath, pathMaxW)
    doc.text(drawnPath, MARGIN, y)

    if (projectLabel) {
      const pathEnd = MARGIN + doc.getTextWidth(drawnPath)
      doc.setFontSize(7.5)
      setText(doc, C.textMuted)
      doc.text(`·  ${projectLabel}`, pathEnd + 8, y)
    }

    doc.setFontSize(9)
    setText(doc, C.success)
    doc.text(`+${file.linesAdded.toLocaleString()}`, W - MARGIN - 42, y, { align: "right" })
    setText(doc, C.danger)
    doc.text(`-${file.linesDeleted.toLocaleString()}`, W - MARGIN, y, { align: "right" })

    p.y += rowH
  }
  p.y += 22
}

function renderHeatmap(p: Page, logs: DailyLog[], preset: ReportPreset): void {
  const { doc } = p
  const { heatmapWeeks: weeks, heatmapLabel } = PRESET_META[preset]

  const logByDate = new Map<string, number>()
  for (const log of logs) logByDate.set(log.date, log.activeTime)
  const maxActive = Math.max(...logs.map(l => l.activeTime), 1)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayDow = (today.getDay() + 6) % 7
  const weekMonday = new Date(today); weekMonday.setDate(today.getDate() - todayDow)
  const gridStart = new Date(weekMonday); gridStart.setDate(weekMonday.getDate() - (weeks - 1) * 7)

  // Wider grids get smaller cells so 13 weeks still sits inside the margins
  const cellSize = weeks > 8 ? 15 : 16
  const cellGap = 3
  const step = cellSize + cellGap
  const labelW = 30

  sectionHeader(p, heatmapLabel)
  ensure(p, 7 * step + 34)

  // Center the grid block (labels + cells) in the content width — a 5-week
  // grid left-aligned strands the whole right half of the page.
  const blockW = labelW + weeks * step - cellGap
  const gridX = MARGIN + labelW + (W - MARGIN * 2 - blockW) / 2
  const startY = p.y

  const DOW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"]
  doc.setFontSize(7)
  setText(doc, C.textDim)
  for (let d = 0; d < 7; d++) {
    if (DOW_LABELS[d]) {
      doc.text(DOW_LABELS[d], gridX - 6, startY + d * step + cellSize - 4, { align: "right" })
    }
  }

  const tk = todayKey()
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cell = new Date(gridStart); cell.setDate(gridStart.getDate() + w * 7 + d)
      if (cell > today) continue
      const key = `${cell.getFullYear()}-${String(cell.getMonth()+1).padStart(2,"0")}-${String(cell.getDate()).padStart(2,"0")}`
      const active = logByDate.get(key) ?? 0
      if (active === 0) {
        doc.setFillColor(24, 30, 28)   // empty cell ≈ rgba gray flattened on void
      } else {
        const { r, g, b } = heatmapCellRgb(active / maxActive)
        doc.setFillColor(r, g, b)
      }
      doc.roundedRect(gridX + w * step, startY + d * step, cellSize, cellSize, 2, 2, "F")
      if (key === tk) {
        setDraw(doc, C.accent)
        doc.setLineWidth(1)
        doc.roundedRect(gridX + w * step, startY + d * step, cellSize, cellSize, 2, 2, "D")
      }
    }
  }

  // Legend, right-aligned under the grid
  const legendY = startY + 7 * step + 6
  const boxSize = 6
  const boxGap = 3
  const boxCount = 5
  const legendW = boxCount * (boxSize + boxGap) - boxGap
  const gridRight = gridX + weeks * step - cellGap
  const boxX = gridRight - legendW

  doc.setFontSize(6.5)
  setText(doc, C.textDim)
  doc.text("Less", boxX - 4, legendY + boxSize - 1, { align: "right" })
  doc.text("More", boxX + legendW + 4, legendY + boxSize - 1)
  for (let i = 0; i < boxCount; i++) {
    if (i === 0) {
      doc.setFillColor(24, 30, 28)
    } else {
      const { r, g, b } = heatmapCellRgb(i / (boxCount - 1))
      doc.setFillColor(r, g, b)
    }
    doc.roundedRect(boxX + i * (boxSize + boxGap), legendY, boxSize, boxSize, 1.5, 1.5, "F")
  }

  p.y = legendY + boxSize + 24
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateReportPdf(logs: DailyLog[], options: ExportOptions): ArrayBuffer {
  const preset = options.preset
  const meta = PRESET_META[preset]

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" })

  doc.addFileToVFS("Electrolize-Regular.ttf", ELECTROLIZE_TTF)
  doc.addFont("Electrolize-Regular.ttf", "Electrolize", "normal")
  doc.setFont("Electrolize", "normal")

  paintPageBg(doc)
  const p: Page = { doc, y: MARGIN + 8 }

  const startKey = dateKeyOffset(-(meta.days - 1))
  const rangeLogs = logs.filter(l => l.date >= startKey && l.date <= todayKey())
  const todayLog = logs.find(l => l.date === todayKey())
  const stats = computeStats(rangeLogs)

  // ── Header: logo + wordmark block left, title + meta block right ───────────

  const logoScale = 30 / 34   // logo ~30pt tall
  drawLogoRects(doc, MARGIN, p.y, logoScale)

  doc.setFontSize(8)
  doc.setCharSpace(1.6)
  setText(doc, C.textDim)
  doc.text("RABBIT HOLE", MARGIN, p.y + 44)
  doc.setCharSpace(0)

  doc.setFontSize(23)
  doc.setCharSpace(2.2)
  setText(doc, C.text)
  doc.text(meta.title, W - MARGIN, p.y + 16, { align: "right" })
  doc.setCharSpace(0)

  doc.setFontSize(10.5)
  setText(doc, C.accent)
  doc.text(options.projectName.toUpperCase(), W - MARGIN, p.y + 34, { align: "right" })

  doc.setFontSize(9)
  setText(doc, C.textDim)
  doc.text(rangeLabel(preset), W - MARGIN, p.y + 48, { align: "right" })

  p.y += 62
  setFill(doc, C.accent)
  doc.rect(MARGIN, p.y, W - MARGIN * 2, 1.5, "F")
  p.y += 28

  // ── Sections ────────────────────────────────────────────────────────────────

  // Heatmap right after the tiles: the at-a-glance content leads, and any
  // page spill lands on the lists instead of stranding the heatmap alone.
  renderSummaryTiles(p, preset, rangeLogs, stats, options.projectNames ?? {})
  renderHeatmap(p, logs, preset)
  renderLanguages(p, rangeLogs)
  if (preset === "today") {
    renderSessionsDaily(p, todayLog)
  } else {
    renderSessionsRange(p, rangeLogs, meta.days)
  }
  renderFiles(p, rangeLogs, options.projectNames ?? {})

  // ── Centered footer on every page ───────────────────────────────────────────

  const now = new Date()
  const dateStr = now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  const timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  const footerPrefix = `Generated ${dateStr} at ${timeStr}  ·  `
  const footerSuffix = "Rabbit Hole"
  const footerY = H - FRAME_INSET - 12

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5)

    const footerLogoScale = 8 / 34
    const footerLogoW = 48 * footerLogoScale
    const footerGap = 3
    const prefixW = doc.getTextWidth(footerPrefix)
    const suffixW = doc.getTextWidth(footerSuffix)
    const groupW = prefixW + footerLogoW + footerGap + suffixW
    const groupX = (W - groupW) / 2

    setText(doc, C.textMuted)
    doc.text(footerPrefix, groupX, footerY)
    drawLogoRects(doc, groupX + prefixW, footerY - 7, footerLogoScale)
    setText(doc, C.text)
    doc.text(footerSuffix, groupX + prefixW + footerLogoW + footerGap, footerY)

    if (pages > 1) {
      setText(doc, C.textMuted)
      doc.text(`${i} / ${pages}`, W - MARGIN, footerY, { align: "right" })
    }
  }

  return doc.output("arraybuffer") as ArrayBuffer
}

import { DailyLog } from "../shared/types"

// ── Export palette ────────────────────────────────────────────────────────────
// Exports render outside the DOM (canvas / jsPDF), so they can't read the
// --rh-* custom properties. These literals mirror the :root tokens in
// style.css / DESIGN.md — change them there first, then here.

export const EXPORT_COLORS = {
  void:         "#06090a",  // --rh-void
  card:         "#0b100e",  // ≈ --rh-card-bg (color-mix resolved)
  border:       "#1e2b25",  // --rh-border
  borderBright: "#2c4436",  // --rh-border-bright
  text:         "#dcfbe6",  // --rh-text
  textDim:      "#86a596",  // --rh-text-dim
  textMuted:    "#5b7468",  // --rh-text-muted
  accent:       "#ffb703",  // --rh-accent
  success:      "#39ff6a",  // --rh-success
  danger:       "#ff5c5c",  // --rh-danger
  info:         "#4fd8ff",  // --rh-info
} as const

// Phosphor-green activity ramp shared with heatmap.ts: alpha 0.18 → 1.0 of
// --rh-success over the void background.
export const HEATMAP_RGB = { r: 0x39, g: 0xff, b: 0x6a }

/** Heatmap cell color for intensity t (0–1), flattened onto the void bg. */
export function heatmapCellRgb(t: number): { r: number; g: number; b: number } {
  const alpha = 0.18 + t * 0.82
  const bg = { r: 0x06, g: 0x09, b: 0x0a }
  return {
    r: Math.round(bg.r + alpha * (HEATMAP_RGB.r - bg.r)),
    g: Math.round(bg.g + alpha * (HEATMAP_RGB.g - bg.g)),
    b: Math.round(bg.b + alpha * (HEATMAP_RGB.b - bg.b)),
  }
}

export type ReportPreset = "today" | "30d" | "90d"

export interface ExportOptions {
  projectName: string
  dateRange: { from: string; to: string }
  isToday: boolean
  preset: ReportPreset
  /** id → display name, for labeling per-project rows in aggregate exports */
  projectNames?: Record<string, string>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function todayKey(): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function computeStats(logs: DailyLog[]) {
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
// [x, y, w, h] in the 48×34 SVG coordinate space, fill color.
// Drawn in order (later entries paint over earlier).

export type LogoRect = [number, number, number, number, string]

export const LOGO_W = 48
export const LOGO_H = 34

export const LOGO_RECTS: LogoRect[] = [
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

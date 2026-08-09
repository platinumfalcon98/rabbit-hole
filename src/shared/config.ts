// Imports `vscode` — never import this from `src/webview/*`. It sits beside
// types.ts, which IS webview-shared; the proximity invites the mistake.
import * as vscode from "vscode"

export const DAILY_TARGET_DEFAULT = 20
export const SESSION_EXPIRY_MS = 60 * 60_000

const DAILY_TARGET_MIN = 1
const DAILY_TARGET_MAX = 1440
const IDLE_THRESHOLD_DEFAULT = 5
const IDLE_THRESHOLD_MIN = 1
const IDLE_THRESHOLD_MAX = 60

// VS Code does not enforce `minimum`/`maximum` on a hand-edited settings.json —
// it draws a squiggle and hands the value over anyway, including a string.
function clampMinutes(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, Math.round(raw)))
}

export function getDailyTargetMinutes(): number {
  const raw = vscode.workspace.getConfiguration("rabbithole").get("dailyTargetMinutes")
  return clampMinutes(raw, DAILY_TARGET_DEFAULT, DAILY_TARGET_MIN, DAILY_TARGET_MAX)
}

export function getDailyTargetMs(): number {
  return getDailyTargetMinutes() * 60_000
}

export function getIdleThresholdMs(): number {
  const raw = vscode.workspace.getConfiguration("rabbithole").get("idleThresholdMinutes")
  return clampMinutes(raw, IDLE_THRESHOLD_DEFAULT, IDLE_THRESHOLD_MIN, IDLE_THRESHOLD_MAX) * 60_000
}

// undefined = inherit the global target (that mode survives, unlike "no target").
export function resolveProjectTargetMinutes(override: number | undefined): number {
  if (override === undefined) return getDailyTargetMinutes()
  return clampMinutes(override, getDailyTargetMinutes(), DAILY_TARGET_MIN, DAILY_TARGET_MAX)
}

export function clampDailyTargetMinutes(raw: unknown): number | null {
  if (typeof raw !== "number" || !isFinite(raw)) return null
  return Math.min(DAILY_TARGET_MAX, Math.max(DAILY_TARGET_MIN, Math.round(raw)))
}

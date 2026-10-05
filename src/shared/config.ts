// Imports `vscode` — never import this from `src/webview/*`. It sits beside
// types.ts, which IS webview-shared; the proximity invites the mistake.
import * as vscode from "vscode"
import type { CrtEffect, CrtMask, CrtPitch, CrtSettings } from "./types"

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

const CRT_MASKS: readonly CrtMask[] = ["slot", "grille", "shadow", "off"]
const CRT_PITCHES: readonly CrtPitch[] = ["fine", "medium", "coarse"]
const CRT_EFFECTS: readonly CrtEffect[] = ["scanlines", "bloom", "convergence", "roll", "flicker"]

// Subtle by default: enough to read as a tube, never enough to cost legibility.
export const CRT_DEFAULTS: CrtSettings = { mask: "slot", pitch: "fine", strength: 23, vignette: 35, effects: ["scanlines", "bloom"] }

export function getCrtSettings(): CrtSettings {
  const cfg = vscode.workspace.getConfiguration("rabbithole")
  const mask = cfg.get("crt.mask")
  const pitch = cfg.get("crt.pitch")
  const effects = cfg.get("crt.effects")
  return {
    mask: CRT_MASKS.includes(mask as CrtMask) ? (mask as CrtMask) : CRT_DEFAULTS.mask,
    pitch: CRT_PITCHES.includes(pitch as CrtPitch) ? (pitch as CrtPitch) : CRT_DEFAULTS.pitch,
    // clampMinutes is a generic integer clamp despite its name
    strength: clampMinutes(cfg.get("crt.strength"), CRT_DEFAULTS.strength, 0, 100),
    vignette: clampMinutes(cfg.get("crt.vignette"), CRT_DEFAULTS.vignette, 0, 100),
    effects: Array.isArray(effects)
      ? CRT_EFFECTS.filter(e => effects.includes(e))
      : [...CRT_DEFAULTS.effects],
  }
}

// What the dashboard may write for one CRT key: the value normalised the way
// getCrtSettings reads it, or null when the manifest would reject it.
export function crtSettingValue(key: string, value: unknown): CrtMask | CrtPitch | number | CrtEffect[] | null {
  switch (key) {
    case "mask":
      return CRT_MASKS.includes(value as CrtMask) ? (value as CrtMask) : null
    case "pitch":
      return CRT_PITCHES.includes(value as CrtPitch) ? (value as CrtPitch) : null
    case "strength":
    case "vignette":
      return typeof value === "number" && isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null
    case "effects":
      return Array.isArray(value) ? CRT_EFFECTS.filter(e => value.includes(e)) : null
    default:
      return null
  }
}

// The beat grid and the scene boundaries, snapped to bar lines.
//
// Measured by scripts/measure-beat.mjs on Quartz 198 s → 268 s (2026-10-08):
//   period 0.60150 s (99.75 BPM; the phase in 4–25 / 25–46 / 46–70 s is
//   0.3725 / 0.3650 / 0.3675 s, so the grid does not drift), downbeat on beat 0,
//   PHASE_SECONDS = 0.3675 → PHASE_FRAMES = 22.05.
// A flat 0.600 s grid drifts by ~80 ms over the film, so the measured period is
// kept as a fractional frame count and every grid frame is rounded.
import { DURATION, FPS } from "./constants"

export const BPM = 60 / 0.6015
export const BEAT_FRAMES = 0.6015 * FPS          // 36.09
export const BAR_FRAMES = BEAT_FRAMES * 4         // 144.36
const PHASE = 0.3675 * FPS                        // 22.05
export const PHASE_FRAMES = Math.round(PHASE)     // 22

export const beatFrame = (n: number): number => Math.round(PHASE + n * BEAT_FRAMES)
export const barFrame = (n: number): number => Math.round(PHASE + n * BAR_FRAMES)
export const snapToBar = (frame: number): number => barFrame(Math.round((frame - PHASE) / BAR_FRAMES))
/** Nearest beat line. */
export const snapToBeat = (frame: number): number => beatFrame(Math.round((frame - PHASE) / BEAT_FRAMES))

export type SceneId = "powerOn" | "hook" | "today" | "month" | "agent" | "year" | "streaks" | "share" | "local" | "end"
export interface Scene { id: SceneId; from: number; to: number }

const IDS: SceneId[] = ["powerOn", "hook", "today", "month", "agent", "year", "streaks", "share", "local", "end"]
const TARGET_SECONDS = [5, 14, 24, 34, 44, 52, 58, 63, 66]   // the spec's inner boundaries
const bounds = [0, ...TARGET_SECONDS.map(s => snapToBar(s * FPS)), DURATION]

export const SCENES: Scene[] = IDS.map((id, i) => ({ id, from: bounds[i], to: bounds[i + 1] }))
export const scene = (id: SceneId): Scene => SCENES.find(s => s.id === id)!

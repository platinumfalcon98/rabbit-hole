// Scene-relative helpers on the measured beat grid.
import { type SceneId, scene, snapToBeat } from "../timeline"

/** The scene-relative frame of the beat nearest to scene-relative frame `f`. */
export const onBeat = (id: SceneId, f: number): number => snapToBeat(scene(id).from + f) - scene(id).from
export const len = (id: SceneId): number => scene(id).to - scene(id).from
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
export const ramp = (f: number, a: number, b: number): number => clamp01((f - a) / Math.max(1, b - a))
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3)
export const easeIn = (t: number): number => Math.pow(clamp01(t), 3)
export const outBack = (t: number, s = 1.7): number => { const x = clamp01(t); return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2) }

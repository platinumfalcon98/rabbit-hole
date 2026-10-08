// Measures the beat grid of the music excerpt (Quartz, 198 s → 268 s): the
// period (expected 0.600 s at 100 BPM), the beat phase and which beat is the
// downbeat. Prints PHASE_SECONDS / PHASE_FRAMES for src/timeline.ts.
// Usage: node scripts/measure-beat.mjs ["<path to Quartz.mp3>"]
import { spawnSync } from "node:child_process"
import path from "node:path"

const src = path.resolve(process.argv[2] ?? "C:/Users/shb/Music/for edits/Quartz.mp3")
const SR = 11025
const r = spawnSync("ffmpeg", ["-v", "error", "-ss", "198", "-t", "70", "-i", src, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 })
if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1) }
const buf = r.stdout
const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4))

// onset envelope: positive change in log energy over 10 ms hops (23 ms windows)
const HOP = Math.round(SR * 0.01), WIN = 256
const n = Math.floor((x.length - WIN) / HOP)
const e = new Float64Array(n)
for (let i = 0; i < n; i++) {
  let s = 0
  for (let j = 0; j < WIN; j++) { const v = x[i * HOP + j]; s += v * v }
  e[i] = Math.log(1e-9 + s)
}
const onset = new Float64Array(n)
for (let i = 1; i < n; i++) onset[i] = Math.max(0, e[i] - e[i - 1])

// strength of a pulse train at period P (s) and phase ph (s), from t0 on
const at = t => { const i = Math.round(t / 0.01); return i >= 0 && i < n ? Math.max(onset[i], onset[i - 1] ?? 0, onset[i + 1] ?? 0) : 0 }
const train = (P, ph, t0 = 4, step = 1) => { let s = 0, k = 0; for (let t = ph; t < 70; t += P * step) if (t >= t0) { s += at(t); k++ } return s / Math.max(1, k) }

// period: scan 0.59–0.61 s in 0.25 ms steps, best phase (2.5 ms steps) for each
let best = { P: 0, ph: 0, s: -1 }
for (let P = 0.59; P <= 0.61; P += 0.00025) for (let ph = 0; ph < P; ph += 0.0025) {
  const s = train(P, ph)
  if (s > best.s) best = { P, ph, s }
}
const P = best.P
console.log(`period ${P.toFixed(5)} s (${(60 / P).toFixed(2)} BPM), beat phase ${best.ph.toFixed(4)} s`)
// drift check: the phase measured in three windows should agree at the true period
for (const [a, z] of [[4, 25], [25, 46], [46, 70]]) {
  let c = { s: -1, p: 0 }
  for (let p = 0; p < P; p += 0.0025) { let s = 0, k = 0; for (let t = p; t < 70; t += P) if (t >= a && t < z) { s += at(t); k++ } s /= k; if (s > c.s) c = { s, p } }
  console.log(`  phase in ${a}–${z} s: ${c.p.toFixed(4)}`)
}
// downbeat: which of the 4 beats carries the most onset strength
const beats = [0, 1, 2, 3].map(b => train(P, best.ph + b * P, 4, 4))
const down = beats.indexOf(Math.max(...beats))
const phase = best.ph + down * P
console.log(`per-beat strength ${beats.map(v => v.toFixed(3)).join(" ")}; downbeat = beat ${down}`)
console.log(`BEAT_SECONDS = ${P.toFixed(5)}`)
console.log(`PHASE_SECONDS = ${phase.toFixed(4)}`)
console.log(`PHASE_FRAMES = ${(phase * 60).toFixed(2)}`)
// energy per second (for the dips)
const sec = []
for (let s = 0; s < 70; s++) { let a = 0; for (let i = s * SR; i < (s + 1) * SR && i < x.length; i++) a += x[i] * x[i]; sec.push((10 * Math.log10(a / SR + 1e-12)).toFixed(1)) }
console.log("RMS dB per second:", sec.join(" "))

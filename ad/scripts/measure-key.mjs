// Estimates the key of the music excerpt (Quartz 198 s → 268 s): a chroma pass
// (FFT magnitudes folded to 12 pitch classes) correlated with the
// Krumhansl–Kessler major and minor profiles. Prints the best few keys.
// Usage: node scripts/measure-key.mjs ["<Quartz.mp3>"]
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const src = path.resolve(process.argv[2] ?? path.join(os.homedir(), "Music", "for edits", "Quartz.mp3"))
const SR = 11025, N = 4096
const r = spawnSync("ffmpeg", ["-v", "error", "-ss", "198", "-t", "70", "-i", src, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 })
if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1) }
const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4))

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k)
      const ur = re[i + k], ui = im[i + k]
      const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
      const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
      re[i + k] = ur + vr; im[i + k] = ui + vi
      re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
    }
  }
}
const chroma = new Float64Array(12)
const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
for (let s = 0; s + N < x.length; s += N / 2) {
  const re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < N; i++) re[i] = x[s + i] * hann[i]
  fft(re, im)
  for (let b = 1; b < N / 2; b++) {
    const f = b * SR / N
    if (f < 60 || f > 2000) continue
    const midi = 69 + 12 * Math.log2(f / 440)
    const pc = ((Math.round(midi) % 12) + 12) % 12
    chroma[pc] += Math.sqrt(re[b] * re[b] + im[b] * im[b])
  }
}
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const corr = (a, b) => {
  const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12
  let n = 0, da = 0, db = 0
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
  return n / Math.sqrt(da * db)
}
const keys = []
for (let t = 0; t < 12; t++) {
  const rot = p => Array.from({ length: 12 }, (_, i) => p[(i - t + 12) % 12])
  keys.push({ key: `${NAMES[t]} major`, tonic: t, mode: "major", r: corr([...chroma], rot(MAJ)) })
  keys.push({ key: `${NAMES[t]} minor`, tonic: t, mode: "minor", r: corr([...chroma], rot(MIN)) })
}
keys.sort((a, b) => b.r - a.r)
const total = chroma.reduce((s, v) => s + v, 0)
console.log("chroma:", NAMES.map((n, i) => `${n} ${(chroma[i] / total * 100).toFixed(1)}%`).join("  "))
for (const k of keys.slice(0, 4)) console.log(`${k.key.padEnd(9)} r=${k.r.toFixed(3)}`)
console.log(`KEY = ${keys[0].key} (tonic pitch class ${keys[0].tonic})`)

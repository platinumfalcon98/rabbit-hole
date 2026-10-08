// Offline synthesis of the film's musical sound effects, in pure Node: oscillators,
// envelopes, a one-pole filter and a short delay, written to 16-bit PCM WAV in
// public/sfx/synth/. Tuned to the music: scripts/measure-key.mjs measured
// Quartz (198–268 s) as D#/Eb minor, so pitched sounds use the Eb minor
// pentatonic (Eb Gb Ab Bb Db) and the thud sits on Eb1.
// Usage: node scripts/synth.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ad = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ad, "public", "sfx", "synth")
fs.mkdirSync(OUT, { recursive: true })
const SR = 48000
const TAU = Math.PI * 2

// ── tuning ──
const EB4 = 311.127
const PENTA = [0, 3, 5, 7, 10]                       // minor pentatonic, from the tonic
export const degreeHz = n => EB4 * Math.pow(2, (PENTA[((n % 5) + 5) % 5] + 12 * Math.floor(n / 5)) / 12)

// ── a seeded PRNG, so the files are byte-identical on every run ──
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── building blocks ──
const buf = seconds => new Float64Array(Math.round(seconds * SR))
const env = (t, a, tau) => (t < a ? t / a : Math.exp(-(t - a) / tau))
function lowpass(x, cutoff /* Hz or (i) => Hz */) {
  let y = 0
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const fc = typeof cutoff === "function" ? cutoff(i) : cutoff
    const k = 1 - Math.exp(-TAU * fc / SR)
    y += k * (x[i] - y)
    out[i] = y
  }
  return out
}
function highpass(x, cutoff) {
  const lp = lowpass(x, cutoff)
  return x.map((v, i) => v - lp[i])
}
function delay(x, seconds, feedback, mix) {
  const d = Math.round(seconds * SR)
  const out = Float64Array.from(x)
  for (let i = d; i < out.length; i++) out[i] += out[i - d] * feedback * (mix / Math.max(mix, 1e-9))
  return x.map((v, i) => v * (1 - mix) + out[i] * mix)
}
function fadeEdges(x, inS = 0.002, outS = 0.01) {
  const a = Math.round(inS * SR), b = Math.round(outS * SR)
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b
  return x
}
function normalize(x, peakDb = -3) {
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1
  const g = Math.pow(10, peakDb / 20) / peak
  return x.map(v => v * g)
}
function write(name, x, peakDb = -3) {
  const y = normalize(fadeEdges(x), peakDb)
  const data = Buffer.alloc(y.length * 2)
  y.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2))
  const h = Buffer.alloc(44)
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8)
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write("data", 36); h.writeUInt32LE(data.length, 40)
  fs.writeFileSync(path.join(OUT, `${name}.wav`), Buffer.concat([h, data]))
  return name
}
const tri = ph => 2 * Math.abs(2 * (ph - Math.floor(ph + 0.5))) - 1
const square = (ph, harmonics) => { let s = 0; for (let k = 1; k <= harmonics; k += 2) s += Math.sin(TAU * k * ph) / k; return s * 4 / Math.PI }
const saw = (ph, harmonics) => { let s = 0; for (let k = 1; k <= harmonics; k++) s += Math.sin(TAU * k * ph) / k; return s * 2 / Math.PI }

const made = []

// blip_<n>: a soft phosphor bell per day column, climbing the pentatonic (n = 0..14)
for (let n = 0; n < 15; n++) {
  const f = degreeHz(n)
  const x = buf(0.5)
  let ph = 0, ph2 = 0
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    const fi = f * (1 + 0.03 * Math.exp(-t / 0.012))         // a tiny pitch drop on the attack
    ph += fi / SR; ph2 += 2 * fi / SR
    x[i] = (Math.sin(TAU * ph) * 0.75 + tri(ph2) * 0.18) * env(t, 0.003, 0.085)
  }
  made.push(write(`blip_${n}`, delay(x, 0.15, 0.35, 0.3), -6))
}

// pixel_<n>: an 8-bit square blip, an octave up, for the carrot drawing itself
for (let n = 0; n < 15; n++) {
  const f = degreeHz(n) * 2
  const x = buf(0.07)
  let ph = 0
  const H = Math.max(1, Math.floor(9000 / f))
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    ph += f / SR
    x[i] = square(ph, H) * env(t, 0.001, 0.02) * 0.6
  }
  made.push(write(`pixel_${n}`, x, -9))
}

// tick_a / tick_b: tape cells and counters
for (const [name, f, seed] of [["tick_a", 3400, 1], ["tick_b", 2600, 2]]) {
  const r = rng(seed)
  const x = buf(0.03)
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    x[i] = Math.sin(TAU * f * t) * env(t, 0.0005, 0.003) * 0.7 + (r() * 2 - 1) * env(t, 0.0002, 0.0015) * 0.5
  }
  made.push(write(name, highpass(x, 900), -10))
}

// type_a/b/c: keyboard clicks for the agent's terminal
for (const [name, seed, thock] of [["type_a", 11, 190], ["type_b", 12, 230], ["type_c", 13, 160]]) {
  const r = rng(seed)
  const x = buf(0.05)
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    x[i] = (r() * 2 - 1) * env(t, 0.0003, 0.004) * 0.8 + Math.sin(TAU * thock * t) * env(t, 0.001, 0.012) * 0.5
  }
  made.push(write(name, lowpass(highpass(x, 400), 6000), -12))
}

// thud: a sub drop onto Eb1 under every caption slam
{
  const r = rng(3)
  const x = buf(0.8)
  let ph = 0
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    const f = 38.89 + (95 - 38.89) * Math.exp(-t / 0.045)
    ph += f / SR
    x[i] = Math.sin(TAU * ph) * env(t, 0.002, 0.26) + (r() * 2 - 1) * env(t, 0.0005, 0.006) * 0.35
  }
  made.push(write("thud", lowpass(x, 2500), -2))
}

// riser_0 (0.9 s) / riser_1 (1.8 s): detuned saws an octave up, a lowpass opening, noise
for (const [name, len, seed] of [["riser_0", 0.9, 4], ["riser_1", 1.8, 5]]) {
  const r = rng(seed)
  const n = Math.round(len * SR)
  const raw = new Float64Array(n), noise = new Float64Array(n)
  let p1 = 0, p2 = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    const f = 155.56 * Math.pow(2, u * 1.0)                    // Eb3 → Eb4
    p1 += f / SR; p2 += f * 1.007 / SR
    raw[i] = (saw(p1, 24) + saw(p2, 24)) * 0.5
    noise[i] = r() * 2 - 1
  }
  const toned = lowpass(raw, i => 250 + 5500 * Math.pow(i / n, 2))
  const hiss = highpass(lowpass(noise, i => 800 + 9000 * Math.pow(i / n, 1.5)), 500)
  const x = toned.map((v, i) => (v * 0.8 + hiss[i] * 0.35) * Math.pow(i / n, 1.8))
  made.push(write(name, x, -4))
}

// sweep_0: an air swipe (band-passed noise up then down); sweep_1: a long fall, "pulled back in"
{
  const r = rng(6)
  const x = buf(0.55)
  for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1
  const n = x.length
  const centre = i => { const u = i / n; return 500 + 3200 * Math.sin(Math.PI * Math.min(1, u * 1.25)) }
  const bp = highpass(lowpass(x, centre), 300)
  made.push(write("sweep_0", bp.map((v, i) => v * Math.sin(Math.PI * i / n) ** 1.5), -6))
}
{
  const r = rng(7)
  const len = 1.4, n = Math.round(len * SR)
  const raw = new Float64Array(n), noise = new Float64Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    const f = 311.13 * Math.pow(2, -u * 2)                    // Eb4 → Eb2
    ph += f / SR
    raw[i] = saw(ph, 16)
    noise[i] = r() * 2 - 1
  }
  const toned = lowpass(raw, i => 6000 * Math.pow(1 - i / n, 2) + 150)
  const hiss = lowpass(noise, i => 7000 * Math.pow(1 - i / n, 2) + 100)
  made.push(write("sweep_1", toned.map((v, i) => (v * 0.7 + hiss[i] * 0.3) * Math.pow(1 - i / n, 0.6)), -5))
}

// glitch_a / glitch_b: bit-crushed stutters for a flickering caption
for (const [name, seed] of [["glitch_a", 8], ["glitch_b", 9]]) {
  const r = rng(seed)
  const x = buf(0.32)
  let i = 0
  while (i < x.length) {
    const seg = Math.round((0.012 + r() * 0.03) * SR)
    const kind = r()
    const f = degreeHz(Math.floor(r() * 10) + 5)
    let ph = 0
    for (let j = 0; j < seg && i < x.length; j++, i++) {
      ph += f / SR
      if (kind < 0.4) x[i] = Math.sign(Math.sin(TAU * ph)) * 0.5
      else if (kind < 0.75) x[i] = Math.round((r() * 2 - 1) * 4) / 4 * 0.6
      else x[i] = 0
    }
  }
  made.push(write(name, lowpass(x, 7000), -8))
}

// boot: the CRT warming up — a thump, static rising and settling, a soft whine
{
  const r = rng(10)
  const x = buf(1.6)
  let ph = 0
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    ph += (60 + 40 * Math.exp(-t / 0.05)) / SR
    const thump = Math.sin(TAU * ph) * env(t, 0.003, 0.18)
    const stat = (r() * 2 - 1) * (t < 0.6 ? t / 0.6 : Math.exp(-(t - 0.6) / 0.3)) * 0.25
    const whine = Math.sin(TAU * 7800 * t) * 0.03 * Math.min(1, t / 0.3) * Math.exp(-t / 1.2)
    x[i] = thump + stat + whine
  }
  made.push(write("boot", lowpass(x, 9000), -4))
}

// chime: the end card, an Eb minor arpeggio of bells (Eb4 Gb4 Bb4 Eb5)
{
  const x = buf(3.2)
  const notes = [EB4, EB4 * Math.pow(2, 3 / 12), EB4 * Math.pow(2, 7 / 12), EB4 * 2]
  notes.forEach((f, k) => {
    const start = Math.round(k * 0.09 * SR)
    for (let i = start; i < x.length; i++) {
      const t = (i - start) / SR
      x[i] += (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t / 0.3)) * env(t, 0.004, 0.9) * 0.4
    }
  })
  made.push(write("chime", delay(x, 0.21, 0.3, 0.25), -4))
}

console.log(`wrote ${made.length} files to ${path.relative(ad, OUT)}: ${made.join(" ")}`)

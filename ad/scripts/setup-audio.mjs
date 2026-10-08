// Copies the two local-only sounds into public/local/ (gitignored, never committed):
//   quartz.wav — Quartz.mp3, 198 s → 268 s (70 s), 48 kHz stereo, fading out over the last 5 s
//   drone.wav  — the Mixkit "technological futuristic hum" (6 s), 48 kHz stereo
// Usage: node scripts/setup-audio.mjs ["<Quartz.mp3>"] ["<hum.wav>"]
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ad = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const home = os.homedir()
const music = path.resolve(process.argv[2] ?? path.join(home, "Music", "for edits", "Quartz.mp3"))
const hum = path.resolve(process.argv[3] ?? path.join(home, "Downloads", "mixkit-technological-futuristic-hum-2133.wav"))
const out = path.join(ad, "public", "local")
fs.mkdirSync(out, { recursive: true })

function ff(args) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`)
}
for (const f of [music, hum]) if (!fs.existsSync(f)) throw new Error(`missing: ${f}`)
ff(["-ss", "198", "-t", "70", "-i", music, "-af", "afade=t=out:st=65:d=5", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path.join(out, "quartz.wav")])
ff(["-i", hum, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path.join(out, "drone.wav")])
console.log("wrote", path.join(out, "quartz.wav"), "and", path.join(out, "drone.wav"))

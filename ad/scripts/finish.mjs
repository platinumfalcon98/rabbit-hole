// After `npm run render` (out/promo-raw.mp4): the loudness pass and every
// deliverable that is cut from the final video, so each matches it exactly.
//   out/rabbit-hole-promo.mp4   two-pass loudnorm to −14 LUFS / −1 dBTP, video stream copied
//   out/poster.png              the end card
//   out/storyboard/NN-<id>.png  one still per scene
//   out/contact-sheet.png       a frame every 2 s, timecoded (360 px tiles)
//   out/contact-sheet-phone.png the same at 400 px per frame
// Usage: node scripts/finish.mjs
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ad = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = p => path.join(ad, "out", p)
const raw = out("promo-raw.mp4")
const final = out("rabbit-hole-promo.mp4")
if (!fs.existsSync(raw)) throw new Error(`missing ${raw}: run npm run render first`)

function ff(args, capture = false) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-y", ...args], { encoding: "utf8", maxBuffer: 1 << 26, stdio: capture ? "pipe" : ["ignore", "inherit", "inherit"] })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}\n${r.stderr ?? ""}`)
  return r.stderr ?? ""
}
const loudness = file => {
  const err = ff(["-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], true)
  return JSON.parse(err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1))
}

// 1. loudness, two passes (the second uses the first's measurements, linear where possible)
const m = loudness(raw)
console.log(`raw: ${m.input_i} LUFS, true peak ${m.input_tp} dBTP, LRA ${m.input_lra}`)
ff(["-i", raw, "-c:v", "copy", "-af",
  `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
  "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart", final])
const f = loudness(final)
console.log(`final: ${f.input_i} LUFS integrated, true peak ${f.input_tp} dBTP, LRA ${f.input_lra}`)

// 2. stills cut from the final video
const FPS = 60
const still = (frame, file, vf = null) => ff(["-ss", (frame / FPS).toFixed(4), "-i", final, "-frames:v", "1", ...(vf ? ["-vf", vf] : []), file])
still(4150, out("poster.png"))
const BOARD = [["powerOn", 262], ["hook", 460], ["today", 1075], ["month", 1730], ["agent", 2420], ["year", 2950], ["streaks", 3420], ["share", 3700], ["local", 3900], ["end", 4150]]
fs.mkdirSync(out("storyboard"), { recursive: true })
BOARD.forEach(([id, frame], i) => still(frame, out(`storyboard/${String(i + 1).padStart(2, "0")}-${id}.png`)))

// 3. contact sheets: one frame every 2 s (0:00 … 1:08), 6 across, timecoded
const font = "C\\:/Windows/Fonts/consola.ttf"
const sheet = (w, file) => {
  const fs_ = Math.round(w / 14)
  ff(["-i", final, "-vf",
    `fps=1/2:start_time=0,scale=${w}:-1,drawtext=fontfile='${font}':text='%{pts\\:hms}':x=8:y=8:fontsize=${fs_}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6,tile=6x6:padding=6:margin=6:color=0x050b08`,
    "-frames:v", "1", "-update", "1", file])
}
sheet(360, out("contact-sheet.png"))
sheet(400, out("contact-sheet-phone.png"))

// 4. what was made
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration,size", "-of", "compact", final], { encoding: "utf8" })
console.log(probe.stdout.trim())
console.log("wrote", ["rabbit-hole-promo.mp4", "poster.png", "storyboard/", "contact-sheet.png", "contact-sheet-phone.png"].join(", "))

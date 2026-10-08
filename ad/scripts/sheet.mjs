// Development helper: renders stills of the Promo at the given frames (4 at a
// time) into out/checks/<name>-<frame>.png and tiles them 4 across into
// out/checks/sheet-<name>.png (1600 px wide).
// Usage: node scripts/sheet.mjs <name> <frame> [<frame> …]
import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ad = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const [name, ...frames] = process.argv.slice(2)
const out = f => path.join(ad, "out", "checks", `${name}-${f}.png`)
const run = f => new Promise((res, rej) => {
  const p = spawn("npx", ["remotion", "still", "src/index.ts", "Promo", out(f), `--frame=${f}`, "--log=error"], { cwd: ad, shell: true, stdio: ["ignore", "ignore", "inherit"] })
  p.on("exit", c => (c === 0 ? res() : rej(new Error(`still ${f} failed`))))
})
const queue = [...frames]
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()) }))
const n = frames.length
const cols = Math.min(4, n)
const rows = Math.ceil(n / cols)
const inputs = frames.flatMap(f => ["-i", out(f)])
const pads = Array.from({ length: rows * cols - n }, () => ["-f", "lavfi", "-i", "color=c=black:s=1440x1080"]).flat()
const all = n + (rows * cols - n)
const filter = Array.from({ length: rows }, (_, r) => `${Array.from({ length: cols }, (_, c) => `[${r * cols + c}:v]`).join("")}hstack=inputs=${cols}[r${r}]`).join(";")
  + `;${Array.from({ length: rows }, (_, r) => `[r${r}]`).join("")}${rows > 1 ? `vstack=inputs=${rows}` : "null"},scale=1600:-1`
const ff = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, ...pads, "-filter_complex", cols > 1 ? filter : "scale=1600:-1", "-frames:v", "1", path.join(ad, "out", "checks", `sheet-${name}.png`)], { stdio: "inherit" })
if (ff.status !== 0) process.exit(1)
console.log(`sheet-${name}.png (${all} tiles)`)

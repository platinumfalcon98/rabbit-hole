// Measures where the real UI puts things, so the cursor can aim at them: for
// every shot in src/scenes/shots.ts, loads the host page at the shot's size in
// Remotion's own headless Chrome, applies the shot's view and records the
// bounding box of each named selector. Writes src/scenes/layout.json.
// Usage: npx tsx scripts/measure-ui.ts   (after node scripts/build-ui.mjs)
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { SHOTS } from "../src/scenes/shots"

const ad = path.resolve(__dirname, "..")
const pub = path.join(ad, "public")
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml" }

const server = http.createServer((req, res) => {
  const p = path.join(pub, decodeURIComponent((req.url ?? "/").split("?")[0]))
  if (!p.startsWith(pub) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] ?? "application/octet-stream" })
  fs.createReadStream(p).pipe(res)
})

function findChrome(): string {
  const base = path.join(ad, "node_modules", ".remotion", "chrome-headless-shell")
  const walk = (d: string): string | null => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { const r = walk(p); if (r) return r }
      else if (/^chrome-headless-shell(\.exe)?$/.test(e.name)) return p
    }
    return null
  }
  const found = walk(base)
  if (!found) throw new Error("Remotion's headless Chrome not found; run a still once first")
  return found
}

class Cdp {
  private id = 0
  private pending = new Map<number, (v: any) => void>()
  private events: ((m: any) => void)[] = []
  constructor(private ws: WebSocket) {
    ws.onmessage = e => {
      const m = JSON.parse(String(e.data))
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)!(m); this.pending.delete(m.id) }
      else this.events.forEach(f => f(m))
    }
  }
  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params, sessionId }))
    return new Promise(res => this.pending.set(id, res))
  }
  once(method: string): Promise<any> { return new Promise(res => { const f = (m: any) => { if (m.method === method) { this.events = this.events.filter(x => x !== f); res(m) } }; this.events.push(f) }) }
}

async function main(): Promise<void> {
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()))
  const port = (server.address() as any).port
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "measure-ui-"))
  const chrome = spawn(findChrome(), ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
  const wsUrl: string = await new Promise((res, rej) => {
    let buf = ""
    chrome.stderr!.on("data", d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]) })
    setTimeout(() => rej(new Error("chrome did not start")), 20000)
  })
  const ws = new WebSocket(wsUrl)
  await new Promise(r => { ws.onopen = r })
  const cdp = new Cdp(ws)
  const out: Record<string, Record<string, { x: number; y: number; w: number; h: number }>> = {}
  for (const shot of SHOTS) {
    const { result } = await cdp.send("Target.createTarget", { url: "about:blank" })
    const { result: att } = await cdp.send("Target.attachToTarget", { targetId: result.targetId, flatten: true })
    const s = att.sessionId
    await cdp.send("Page.enable", {}, s)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: 1, mobile: false }, s)
    const loaded = cdp.once("Page.loadEventFired")
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/ui/${shot.page}.html` }, s)
    await loaded
    const expr = `(async () => {
      for (let i = 0; i < 200 && !window.__apply; i++) await new Promise(r => setTimeout(r, 25))
      await window.__apply(${JSON.stringify(shot.view)})
      const out = {}
      for (const [k, sel] of Object.entries(${JSON.stringify(shot.targets)})) {
        const el = document.querySelector(sel)
        if (!el) { out[k] = null; continue }
        const r = el.getBoundingClientRect()
        out[k] = { x: r.left, y: r.top, w: r.width, h: r.height }
      }
      return JSON.stringify(out)
    })()`
    const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s)
    if (r.result?.exceptionDetails) throw new Error(`${shot.id}: ${JSON.stringify(r.result.exceptionDetails)}`)
    out[shot.id] = JSON.parse(r.result.result.value)
    for (const [k, v] of Object.entries(out[shot.id])) if (!v) console.warn(`  ${shot.id}.${k}: not found`)
    await cdp.send("Target.closeTarget", { targetId: result.targetId })
  }
  fs.writeFileSync(path.join(ad, "src", "scenes", "layout.json"), JSON.stringify(out, null, 2) + "\n")
  console.log("measured", Object.keys(out).length, "shots")
  ws.close()
  chrome.kill()
  server.close()
}
main().catch(e => { console.error(e); process.exit(1) })

// The CRT: a phosphor mask (canvas, multiplied over the page), scanlines, a
// refresh roll and the glass, all fixed layers that take no pointer events.
// crtParams is pure; the rest draws.
import type { CrtMask, CrtSettings } from "../shared/types"

export type Theme = "dark" | "light" | "hc"

export function themeOf(classes: string): Theme {
  if (/\bvscode-high-contrast/.test(classes)) return "hc"
  return /\bvscode-light\b/.test(classes) ? "light" : "dark"
}

export interface CrtParams {
  off: boolean
  s: number        // mask strength, 0–1
  vig: number      // edge darkening, 0–1
  unit: number     // one phosphor column, in CSS px before devicePixelRatio
  boost: number    // brightness given back for what the mask removes
  line: number     // scanline period, px
  fx: { scan: boolean; roll: boolean; flicker: boolean; conv: boolean; glow: boolean }
}

const PITCH = { fine: 1, medium: 2, coarse: 3 }

export function crtParams(c: CrtSettings, theme: Theme): CrtParams {
  const unit = PITCH[c.pitch] ?? 1
  // paper screens get about half the mask (the mockup's .28 against .55)
  const s = theme === "hc" ? 0 : Math.max(0, Math.min(100, c.strength)) / 100 * (theme === "light" ? 0.5 : 1)
  const off = theme === "hc" || c.mask === "off" || s === 0
  const on = (e: CrtSettings["effects"][number]) => theme !== "hc" && c.effects.includes(e)
  return {
    off,
    s,
    // independent of the mask: the glass is there with the mask off too
    vig: theme === "hc" ? 0 : Math.max(0, Math.min(100, c.vignette)) / 100,
    unit,
    boost: off ? 1 : Number((1 + s * (c.mask === "shadow" ? 1.1 : 0.85)).toFixed(3)),
    line: 3 * unit,
    fx: { scan: on("scanlines"), roll: on("roll"), flicker: on("flicker"), conv: on("convergence"), glow: on("bloom") },
  }
}

let current: CrtSettings | null = null

export function applyCrt(next: CrtSettings | null): void {
  if (next) current = next
  if (!current) return
  const p = crtParams(current, themeOf(document.body.className))
  const root = document.documentElement
  const body = document.body
  root.classList.toggle("fx-scan", p.fx.scan)
  root.classList.toggle("fx-roll", p.fx.roll)
  root.classList.toggle("fx-flicker", p.fx.flicker)
  root.classList.toggle("mask-off", p.off)
  // set on body: the theme tokens live on body classes, and inline beats them
  body.style.setProperty("--boost", String(p.boost))
  body.style.setProperty("--line", `${p.line}px`)
  body.style.setProperty("--vig-k", String(p.vig))
  body.style.setProperty("--conv", p.fx.conv ? "-.6px 0 0 rgba(255,40,70,.32), .6px 0 0 rgba(40,150,255,.32)" : "0 0 0 transparent")
  if (p.fx.glow) body.style.removeProperty("--glow")
  else body.style.setProperty("--glow", "0 0 0 transparent")
  drawMask(current.mask, p)
}

function drawMask(mask: CrtMask, p: CrtParams): void {
  const c = document.getElementById("mask") as HTMLCanvasElement | null
  if (!c || p.off) return
  const dpr = window.devicePixelRatio || 1
  c.width = Math.round(innerWidth * dpr)
  c.height = Math.round(innerHeight * dpr)
  const ctx = c.getContext("2d")
  if (!ctx) return
  const hi = 255
  const lo = Math.round(255 * (1 - p.s))
  const dark = Math.round(255 * (1 - p.s * 0.9))
  const R = `rgb(${hi},${lo},${lo})`
  const G = `rgb(${lo},${hi},${lo})`
  const B = `rgb(${lo},${lo},${hi})`
  const K = `rgb(${dark},${dark},${dark})`
  const u = Math.max(1, Math.round(p.unit * dpr))   // drawn per device pixel
  const t = document.createElement("canvas")
  const x = t.getContext("2d")
  if (!x) return
  if (mask === "grille") {
    t.width = 3 * u
    t.height = 1
    ;[R, G, B].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * u, 0, u, 1) })
  } else if (mask === "slot") {
    const P = 4 * u
    t.width = 6 * u
    t.height = P
    ;[R, G, B, R, G, B].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * u, 0, u, P) })
    x.fillStyle = K
    x.fillRect(0, 0, 3 * u, u)            // staggered slot breaks
    x.fillRect(3 * u, P / 2, 3 * u, u)
  } else {
    // shadow mask: delta triads
    const cell = 2 * u
    t.width = 3 * cell
    t.height = 2 * cell
    x.fillStyle = K
    x.fillRect(0, 0, t.width, t.height)
    const dot = (cx: number, cy: number, col: string) => {
      x.fillStyle = col
      x.beginPath()
      x.arc(cx, cy, cell * 0.46, 0, Math.PI * 2)
      x.fill()
    }
    ;[R, G, B].forEach((col, i) => dot(i * cell + cell / 2, cell / 2, col))
    ;[B, R, G].forEach((col, i) => {
      const cx = (i + 1) * cell
      dot(cx % t.width, cell * 1.5, col)
      if (cx === t.width) dot(t.width, cell * 1.5, col)
    })
  }
  const pattern = ctx.createPattern(t, "repeat")
  if (!pattern) return
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, c.width, c.height)
}

export function initCrt(): void {
  window.addEventListener("resize", () => applyCrt(null))
  // VS Code swaps the body class on a theme change; only "class" is watched,
  // so the style writes above can't retrigger it.
  new MutationObserver(() => applyCrt(null)).observe(document.body, { attributes: true, attributeFilter: ["class"] })
}

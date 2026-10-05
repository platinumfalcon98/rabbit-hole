// The share card: 420×620, drawn at 3× on a canvas, always the phosphor
// screen with faint scanlines and no mask (a mask moirés once a social site
// rescales the image). Tape cells, columns and streak marks are shapes, not
// block glyphs: Martian Mono has none, and an image must look the same on
// every machine whatever its fallback fonts.
import { CARROT_W, carrotPixels } from "./carrot"
import { CARD, ExportData, OTHER_COLOR, SHADE, generatedText, mix, rangeText } from "./exportModel"
import { CARD_H, CARD_SCALE, CARD_W, CARD_X, CardBlock, cardLayout } from "./exportLayout"
import { clock, dstr, fmt, hhmm, hours, pct, shortDate } from "./format"
import { tapeTicks } from "./layout"
import { ellipsize } from "./textFit"

type Ctx = CanvasRenderingContext2D
const FAMILY = '"Martian Mono", "Cascadia Mono", Consolas, monospace'
const INNER = CARD_W - 2 * CARD_X

function font(ctx: Ctx, size: number, weight = 400, narrow = false): void {
  ctx.font = `${weight} ${size}px ${FAMILY}`
  // wdth 75 for the big numerals, 87.5 for text: the dashboard's two widths
  ctx.fontStretch = narrow ? "condensed" : "semi-condensed"
}

function text(ctx: Ctx, s: string, x: number, y: number, color: string, align: CanvasTextAlign = "left"): void {
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(s, x, y)
}

const fit = (ctx: Ctx, s: string, w: number) => ellipsize(s, w, t => ctx.measureText(t).width)

// The phosphor bloom, kept to the big numbers so small text stays crisp.
function glow(ctx: Ctx, color: string, blur: number, draw: () => void): void {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  draw()
  ctx.restore()
}

function carrot(ctx: Ctx, x: number, y: number, px: number): void {
  for (const p of carrotPixels()) {
    ctx.fillStyle = p.c
    ctx.fillRect(x + p.x * px, y + p.y * px, px, px)
  }
}

// A boxed panel with its title set into the top rule, like the dashboard's fieldsets.
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, title: string, sub = ""): void {
  ctx.fillStyle = CARD.panel
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = CARD.rule
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  font(ctx, 11)
  const titleW = ctx.measureText(title + (sub ? " " : "")).width
  const subW = sub ? ctx.measureText(sub).width : 0
  ctx.fillStyle = CARD.panel
  ctx.fillRect(x + 8, y - 1, titleW + subW + 12, 3)
  ctx.textBaseline = "middle"
  text(ctx, title, x + 14, y, CARD.amber)
  if (sub) text(ctx, sub, x + 14 + titleW, y, CARD.dim)
  ctx.textBaseline = "alphabetic"
}

const langColor = (d: ExportData) => {
  const m = new Map(d.langs.map(l => [l.name, l.color]))
  // a session recorded before per-session languages has no language: plain green
  return (name: string | null) => (name ? m.get(name) ?? OTHER_COLOR : CARD.add)
}

function header(ctx: Ctx, d: ExportData, b: CardBlock): void {
  glow(ctx, "rgba(255,139,0,.55)", 3, () => carrot(ctx, CARD_X, b.y + 1, 5))
  const tx = CARD_X + CARROT_W * 5 + 14
  const right = d.single ? "today" : `${d.days} days`
  font(ctx, 11)
  const rw = ctx.measureText(right).width
  text(ctx, right, CARD_X + INNER, b.y + 22, CARD.dim, "right")
  text(ctx, fit(ctx, rangeText(d), CARD_X + INNER - tx), tx, b.y + 40, CARD.dim)
  font(ctx, 16, 700)
  text(ctx, fit(ctx, d.title, CARD_X + INNER - rw - 14 - tx), tx, b.y + 22, CARD.ink)
}

function marks(ctx: Ctx, d: ExportData, x: number, y: number, w: number): void {
  const step = w / 14
  d.marks.forEach((m, i) => {
    const cx = x + step * (i + 14 - d.marks.length) + step / 2
    if (m === "today") {
      ctx.fillStyle = CARD.amber
      ctx.beginPath()
      ctx.moveTo(cx, y)
      ctx.lineTo(cx + 5.5, y + 5.5)
      ctx.lineTo(cx, y + 11)
      ctx.lineTo(cx - 5.5, y + 5.5)
      ctx.closePath()
      ctx.fill()
    } else if (m === "met") {
      ctx.fillStyle = CARD.add
      ctx.fillRect(cx - 4.5, y + 1, 9, 9)
    } else {
      ctx.strokeStyle = CARD.mute
      ctx.lineWidth = 1
      ctx.strokeRect(cx - 4, y + 1.5, 8, 8)
    }
  })
}

function hero(ctx: Ctx, d: ExportData, b: CardBlock): void {
  panel(ctx, CARD_X, b.y, INNER, b.h, d.single ? "streak" : `${d.days} days`)
  const big = d.single ? String(d.streak) : hours(d.totalMs)
  const color = d.single ? CARD.add : CARD.ink
  font(ctx, 64, 700, true)
  const w = ctx.measureText(big).width
  glow(ctx, color, 7, () => text(ctx, big, CARD_X + 12, b.y + 68, color))
  font(ctx, 12.5)
  const key = d.single ? "days in a row" : `active · ${d.activeDays}/${d.days} days`
  text(ctx, fit(ctx, key, INNER - 34 - w), CARD_X + 22 + w, b.y + 68, CARD.dim)
  if (d.single) marks(ctx, d, CARD_X + 12, b.y + 84, INNER - 24)
}

function tiles(ctx: Ctx, d: ExportData, b: CardBlock): void {
  const top = d.langs[0]
  const list: [string, string, string, string][] = d.single
    ? [
      ["active", fmt(d.totalMs), CARD.ink, `of ${fmt(d.targetMs)} target`],
      ["sessions", String(d.sessions.length), CARD.ink, d.firstStart !== null && d.lastEnd !== null ? `${clock(d.firstStart)} – ${clock(d.lastEnd)}` : "none yet"],
    ]
    : [
      ["per active day", fmt(d.perActiveMs), CARD.ink, `${d.activeDays} active days`],
      ["best day", d.best ? fmt(d.best.ms) : "—", CARD.ink, d.best ? dstr(d.best.date) : "no activity"],
    ]
  list.push(
    ["lines", `+${d.added}`, CARD.add, `−${d.deleted} removed`],
    ["top language", top ? top.name : "—", CARD.ink, top ? hours(top.ms) : "no activity"],
  )
  const w = (INNER - 10) / 2
  const h = (b.h - 10) / 2
  list.forEach(([title, value, color, key], i) => {
    const x = CARD_X + (i % 2) * (w + 10)
    const y = b.y + Math.floor(i / 2) * (h + 10)
    panel(ctx, x, y, w, h, title)
    font(ctx, 26, 600, true)
    const v = fit(ctx, value, w - 24)
    glow(ctx, color, 5, () => text(ctx, v, x + 12, y + 34, color))
    font(ctx, 11)
    text(ctx, fit(ctx, key, w - 24), x + 12, y + 51, CARD.dim)
  })
}

function tape(ctx: Ctx, d: ExportData, b: CardBlock): void {
  const t = d.tapes!.card
  panel(ctx, CARD_X, b.y, INNER, b.h, "day", `${hhmm(t.win.startMin)}–${hhmm(t.win.endMin)}`)
  const x0 = CARD_X + 12
  const w = INNER - 24
  const cw = w / t.cells.length
  const top = b.y + 18
  const h = 30
  const color = langColor(d)
  t.cells.forEach((c, i) => {
    const x = x0 + i * cw
    if (!c.level) {
      ctx.fillStyle = CARD.mute
      ctx.fillRect(x + cw / 2 - 1, top + h - 2, 2, 2)
      return
    }
    ctx.fillStyle = mix(color(c.language), CARD.panel, SHADE[c.level])
    ctx.fillRect(x + 1, top, cw - 2, h)
  })
  font(ctx, 9.5)
  const ticks = tapeTicks(t.win, t.cells.length)
  ticks.forEach((label, i) => { if (label) text(ctx, label, x0 + i * (w / ticks.length), top + h + 14, CARD.mute) })
}

function columns(ctx: Ctx, d: ExportData, b: CardBlock): void {
  panel(ctx, CARD_X, b.y, INNER, b.h, "each day", `target met on ${d.metDays}`)
  const list = d.daysList
  const gap = list.length > 20 ? 2 : 4
  const x0 = CARD_X + 12
  const w = INNER - 24
  const cw = (w - gap * (list.length - 1)) / list.length
  const base = b.y + 18 + 74
  const max = Math.max(1, ...list.map(x => x.ms))
  list.forEach((day, i) => {
    if (!day.ms) return
    const h = Math.max(2, day.ms / max * 74)
    ctx.fillStyle = day.today ? CARD.amber : day.met ? CARD.add : CARD.mute
    ctx.fillRect(x0 + i * (cw + gap), base - h, cw, h)
  })
  font(ctx, 9.5)
  text(ctx, shortDate(list[0].date), x0, base + 12, CARD.mute)
  text(ctx, shortDate(list[list.length - 1].date), x0 + w, base + 12, CARD.mute, "right")
}

function languages(ctx: Ctx, d: ExportData, b: CardBlock): void {
  panel(ctx, CARD_X, b.y, INNER, b.h, "languages")
  const x0 = CARD_X + 12
  const w = INNER - 24
  const y = b.y + 16
  const shown = d.langs.filter(l => l.ms > 0)
  const total = shown.reduce((t, l) => t + l.ms, 0)
  font(ctx, 10.5)
  if (!total) {
    text(ctx, "no activity", x0, y + 10, CARD.mute)
    return
  }
  let x = x0
  for (const l of shown) {
    const lw = l.ms / total * w
    ctx.fillStyle = l.color
    ctx.fillRect(x, y, Math.max(0, lw - 2), 10)
    x += lw
  }
  const kw = w / 3
  shown.slice(0, 3).forEach((l, i) => {
    const kx = x0 + i * kw
    ctx.fillStyle = l.color
    ctx.fillRect(kx, y + 19, 7, 7)
    const share = ` ${pct(l.ms, total)}%`
    const name = fit(ctx, l.name, kw - 16 - ctx.measureText(share).width)
    text(ctx, name + share, kx + 12, y + 26, CARD.dim)
  })
}

function footer(ctx: Ctx, d: ExportData, b: CardBlock): void {
  const left = `${generatedText(d.generatedAt)} ·`
  font(ctx, 10)
  const lw = ctx.measureText(left).width
  font(ctx, 10, 600)
  const bw = ctx.measureText("rabbit hole").width
  const cw = CARROT_W * 2
  let x = (CARD_W - (lw + 6 + cw + 6 + bw)) / 2
  const base = b.y + 12
  font(ctx, 10)
  text(ctx, left, x, base, CARD.mute)
  x += lw + 6
  carrot(ctx, x, base - 15, 2)
  x += cw + 6
  font(ctx, 10, 600)
  text(ctx, "rabbit hole", x, base, CARD.ink)
}

function scanlines(ctx: Ctx): void {
  ctx.fillStyle = "rgba(0,0,0,0.28)"
  for (let y = 2; y < CARD_H; y += 3) ctx.fillRect(0, y, CARD_W, 1)
}

const DRAW: Record<CardBlock["kind"], (ctx: Ctx, d: ExportData, b: CardBlock) => void> = { header, hero, tiles, tape, columns, languages, footer }

export function drawCard(canvas: HTMLCanvasElement, d: ExportData): void {
  canvas.width = CARD_W * CARD_SCALE
  canvas.height = CARD_H * CARD_SCALE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("this webview has no 2D canvas")
  ctx.setTransform(CARD_SCALE, 0, 0, CARD_SCALE, 0, 0)
  ctx.fillStyle = CARD.bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  for (const b of cardLayout(d)) DRAW[b.kind](ctx, d, b)
  scanlines(ctx)
}

// The dashboard's @font-face loads Martian Mono lazily; a canvas drawn before
// it arrives silently uses the fallback font.
export async function cardFontsReady(): Promise<void> {
  await Promise.all([document.fonts.load(`400 12px ${FAMILY}`), document.fonts.load(`700 12px ${FAMILY}`)])
}

export async function cardJpegBase64(d: ExportData): Promise<string> {
  await cardFontsReady()
  const canvas = document.createElement("canvas")
  drawCard(canvas, d)
  return canvas.toDataURL("image/jpeg", 0.92).split(",")[1]
}

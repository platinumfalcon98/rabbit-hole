// A range's hero: one segmented column per day, like a VU meter. Green when the
// day met its target; under a focus, the focused project's or language's colour.
// Clicking a column opens that day.
import { $, el } from "./dom"
import { MIN, dstr, fmt, pct, plural } from "./format"
import { colAxis, colGap, colSegments } from "./layout"
import { delegateTip, hideTip, tipLine, tipSub } from "./tooltip"

export interface ColDay {
  date: string
  shownMs: number                 // narrowed to the focus
  wholeMs: number
  targetMs: number
  sessions: number
  added: number
  deleted: number
  byProject: [string, number][]   // filled for all projects without a focus, for the tooltip
}
export interface ColOpts {
  today: string
  focusColor: string | null
  focusName: string | null
  projName: (id: string) => string
  onOpen: (date: string) => void
}

let list: ColDay[] = []
let opts: ColOpts | null = null

export function renderCols(days: ColDay[], o: ColOpts): void {
  list = days
  opts = o
  const n = days.length
  const max = Math.max(1, ...days.map(d => d.wholeMs))
  const cols = $("cols")
  const axis = $("cols-axis")
  for (const h of [cols, axis]) {
    h.style.setProperty("--n", String(n))
    h.style.setProperty("--gap", `${colGap(n)}px`)
  }
  cols.replaceChildren(...days.map((d, i) => {
    const c = el("span", "c " + (o.focusColor ? "hl" : d.date === o.today ? "now" : d.wholeMs >= d.targetMs ? "met" : "under"))
    if (o.focusColor) c.style.color = o.focusColor
    c.dataset.i = String(i)
    // scaled to the whole day's peak, so a focused column reads as a share
    for (const f of colSegments(d.shownMs, max)) {
      const seg = el("i", f >= 1 ? "on" : f > 0 ? "part" : "")
      if (f > 0 && f < 1) seg.style.setProperty("--f", `${Math.round(f * 100)}%`)
      c.append(seg)
    }
    return c
  }))
  axis.replaceChildren(...colAxis(days.map(d => d.date), o.today).map(a => {
    const s = el("span", a.cls || null, a.text)
    s.style.gridColumn = `${a.col} / span ${a.span}`
    return s
  }))
}

export function initCols(): void {
  const cols = $("cols")
  delegateTip(cols, c => {
    const d = list[Number(c.dataset.i)]
    const o = opts
    if (!d || !o) return null
    const out = [tipLine(d.shownMs ? fmt(d.shownMs) : "no activity", (o.focusName ? o.focusName + " · " : "") + dstr(d.date))]
    if (o.focusName && d.wholeMs) out.push(tipSub(`of ${fmt(d.wholeMs)} that day (${pct(d.shownMs, d.wholeMs)}%)`))
    if (d.shownMs) out.push(tipSub(`${plural(d.sessions, "session")} · +${d.added} −${d.deleted}`))
    for (const [id, ms] of d.byProject) out.push(tipSub(`${o.projName(id)} ${fmt(ms)}`))
    if (d.shownMs && d.wholeMs < d.targetMs && !o.focusName) out.push(tipSub(`under the ${Math.round(d.targetMs / MIN)}m target`))
    out.push(tipSub("click to open this day"))
    return out
  })
  cols.addEventListener("click", e => {
    const c = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-i]") : null
    const d = c ? list[Number(c.dataset.i)] : undefined
    if (d && opts) {
      hideTip()
      opts.onOpen(d.date)
    }
  })
}

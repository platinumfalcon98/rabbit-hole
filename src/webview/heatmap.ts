// The year as block glyphs in one hue: density carries the magnitude.
// 53 weeks, or 26 when narrow; glyphs size to the cell width.
import { $, el, onWidth } from "./dom"
import { MIN, dstr, fmt } from "./format"
import { TAPE_GLYPHS, heatCells, heatLevel, heatMonths, heatWeeksFor } from "./layout"
import { delegateTip, tipLine, tipSub } from "./tooltip"

export interface HeatData {
  days: string[]
  active: number[]
  targetMs: number[]
  today: string
  who: string | null                             // the hovered project, when narrowed to one
  breakdown: (i: number) => [string, number][]   // per-project time on a day, for all projects
}

let data: HeatData | null = null
let weeks = 0

export function renderHeat(d: HeatData): void {
  data = d
  weeks = 0
  sizeHeat()
}

function sizeHeat(): void {
  const wrap = $("heat-wrap")
  if (!data || !wrap.clientWidth) return   // hidden tab: drawn when it is shown
  const want = heatWeeksFor(wrap.clientWidth)
  if (want !== weeks) {
    weeks = want
    draw(data)
  }
  const heat = $("heat")
  const cw = (heat.clientWidth - (weeks - 1) * 2) / weeks
  heat.style.fontSize = `${Math.max(4, Math.min(24, cw / 0.6))}px`
}

function draw(d: HeatData): void {
  $("heat-range").textContent = `daily active time, past ${weeks === 53 ? "12" : "6"} months` + (d.who ? ` · ${d.who} only` : "")
  $("heat").replaceChildren(...heatCells(d.days.length, weeks).map(i => {
    if (i === null) return el("span", "fut", "█")
    const ms = d.active[i]
    const c = el("span", d.days[i] === d.today ? "now" : ms > 0 ? null : "z", TAPE_GLYPHS[heatLevel(ms)])
    c.dataset.i = String(i)
    return c
  }))
  const months = $("months")
  months.style.setProperty("--weeks", String(weeks))
  months.replaceChildren(...heatMonths(d.days, weeks).map(m => {
    const s = el("span", null, m.text)
    s.style.gridColumn = `${m.col} / span 4`
    return s
  }))
}

export function initHeat(): void {
  onWidth($("heat-wrap"), sizeHeat)
  delegateTip($("heat"), c => {
    const d = data
    if (!d) return null
    const i = Number(c.dataset.i)
    const ms = d.active[i]
    const out = [tipLine(ms ? fmt(ms) : "no activity", (d.who ? `${d.who} · ` : "") + dstr(d.days[i]))]
    for (const [name, v] of d.breakdown(i)) out.push(tipSub(`${name} ${fmt(v)}`))
    if (ms && ms < d.targetMs[i]) out.push(tipSub(`under the ${Math.round(d.targetMs[i] / MIN)}m target`))
    return out
  })
}

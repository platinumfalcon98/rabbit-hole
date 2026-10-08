// The dashboard host: answers the real main.ts bundle from the showcase data
// and applies one UiView per film frame (window.__apply). Every view is
// absolute; state the real UI keeps between frames is either reset (data,
// focus) or set explicitly (tab, range, project), so frames can be rendered in
// any order.
import type { UiView } from "../src/ui/view"
import {
  applyReveals, clone, countUp, data, deliver, ease, fontsReady, frames, installApi, itemT, liveMsg, pointer, realText, resetCounts, writeText, setShotCss, settingsMsg, showTooltip,
} from "./stub"

installApi((m: any) => {
  if (m.type === "ready") { deliver(settingsMsg as any); deliver({ type: "year", ...clone(data.year) }) }
  if (m.type === "requestYear") deliver({ type: "year", ...clone(data.year) })
  if (m.type === "requestDays") {
    const r = clone(data.range)
    const logs = m.for ? Object.fromEntries(Object.entries(r.logs).map(([id, l]) => [id, l.filter(x => x.date >= m.from && x.date <= m.to)])) : r.logs
    // the dashboard's own fetches get all 92 days, so no later view needs another
    deliver({ type: "range", from: m.for ? m.from : r.from, to: m.for ? m.to : r.to, logs, ...(m.for ? { for: m.for } : {}) })
  }
  if (m.type === "writeFile" || m.type === "export") deliver({ type: "actionResult", ok: true, lines: [`saved ${m.name}`] })
})

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel))

let lastJson = ""
let dataKey = "\u0000"   // what the data was last reset for

function resetData(view: UiView): void {
  const key = JSON.stringify(view.live ?? null)
  if (key === dataKey) return
  dataKey = key
  resetCounts()
  deliver({ type: "year", ...clone(data.year) })
  if (view.live) deliver(liveMsg(view.live))
}

function setTab(tab: string): void {
  const b = $<HTMLButtonElement>(`#tabs button[data-tab="${tab}"]`)
  if (b && b.getAttribute("aria-pressed") !== "true") b.click()
}
function setRange(r: string): void {
  const b = $<HTMLButtonElement>(`#range button[data-range="${r}"]`)
  if (b && b.getAttribute("aria-pressed") !== "true") b.click()
}
function setSelection(id: string): void {
  const want = id === "all" ? "all projects" : data.year.projects.find(p => p.id === id)?.name ?? "all projects"
  if ($("#proj-name")?.textContent === want) return
  $<HTMLButtonElement>("#proj-btn")!.click()
  const item = $$<HTMLButtonElement>("#pmenu .pm-item").find(b => b.querySelector(".pm-name > span")?.textContent === want)
  item?.click()
  ;(document.activeElement as HTMLElement | null)?.blur()
}
function setExport(open: boolean): void {
  const shown = !$("#xd")!.hidden
  if (open && !shown) $<HTMLButtonElement>('[data-act="export"]')!.click()
  if (!open && shown) $<HTMLButtonElement>("#xd-cancel")!.click()
  ;(document.activeElement as HTMLElement | null)?.blur()
}
function setFocus(view: UiView): void {
  const f = view.focus ?? null
  const tab = view.tab ?? "overview"
  if (tab === "overview") {
    const root = $("#ov")!
    pointer("pointerleave", root)
    const t = f && $(`[data-hl="${f.kind === "project" ? "p" : "l"}:${CSS.escape(f.id)}"]`, root)
    if (t) pointer("pointerover", t)
  } else if (tab === "activity") {
    const box = $("#prows-box")!
    pointer("pointerleave", box)
    const t = f && $(`.prow[data-ap="${CSS.escape(f.id)}"]`, box)
    if (t) pointer("pointerover", t)
  }
}

// ── reveals ──

const COUNTED = ["#hero-head .big", "#ln-add", "#ln-del", "#ln-net", "#streak-n", ".ystat .v", ".pcard .stats .v"]

function reveal(view: UiView): void {
  applyReveals(view, {
    count: p => COUNTED.forEach(sel => $$(sel).forEach(e => countUp(e, p))),
    tape: p => {
      const cells = $$("#tape span")
      cells.forEach((c, i) => {
        const t = ease(itemT(p, i, cells.length, 1.5))
        if (t >= 1) { c.style.opacity = ""; c.style.transform = ""; return }
        const off = c.classList.contains("off")
        c.style.opacity = String(off ? 0.15 + 0.4 * t : t)
        c.style.transform = off ? "" : `scaleY(${(2.2 * (0.15 + 0.85 * t)).toFixed(3)})`
      })
    },
    meter: p => {
      const target = $("#target")
      const m = target?.querySelector<HTMLElement>(".meter")
      if (!target || !m) return
      const on = m.firstChild
      const off = m.querySelector("i")
      if (!on || !off) return
      const onText = realText(on)
      const offText = realText(off)
      const total = onText.length + offText.length
      const k = Math.round(onText.length * ease(p))
      writeText(on, "█".repeat(k))
      writeText(off, "░".repeat(total - k))
      // the "met at …" tail appears once the meter is full
      const tail = m.nextSibling
      if (tail) writeText(tail, p >= 1 ? realText(tail) : "")
    },
    cols: p => {
      const cs = $$("#cols .c")
      cs.forEach((c, i) => {
        const t = itemT(p, i, cs.length, 2)
        if (t >= 1) { c.style.transform = ""; c.style.opacity = ""; return }
        const e = 1 - Math.pow(1 - t, 3)
        const bounce = t < 1 ? Math.sin(t * Math.PI) * 6 : 0
        c.style.transform = `translateY(${(-(1 - e) * 220 + bounce).toFixed(1)}px)`
        c.style.opacity = String(Math.min(1, t * 3))
      })
    },
    heat: p => {
      const cells = $$("#heat span")
      const weeks = Math.ceil(cells.length / 7)
      cells.forEach((c, k) => {
        const t = itemT(p, Math.floor(k / 7), weeks, 3)
        c.style.opacity = t >= 1 ? "" : String(t)
        c.style.transform = t >= 1 ? "" : `scale(${(0.4 + 0.6 * t).toFixed(3)})`
      })
    },
    bars: p => {
      const e = ease(p)
      $$(".lang .fill, .prows .fill").forEach(f => { f.style.transformOrigin = "left"; f.style.transform = e >= 1 ? "" : `scaleX(${e.toFixed(3)})` })
      const split = $("#split")
      if (split) split.style.clipPath = e >= 1 ? "" : `inset(0 ${((1 - e) * 100).toFixed(2)}% 0 0)`
    },
    cards: p => {
      const cs = $$(".pcard")
      cs.forEach((c, i) => {
        const t = ease(itemT(p, i, cs.length, 2))
        c.style.transform = t >= 1 ? "" : `perspective(900px) rotateX(${((1 - t) * 88).toFixed(1)}deg)`
        c.style.transformOrigin = "50% 0"
        c.style.opacity = t >= 1 ? "" : String(Math.min(1, t * 2))
      })
    },
    week: p => {
      $$("#week .bars").forEach((b, i, all) => {
        const t = ease(itemT(p, i, all.length, 2))
        b.style.clipPath = t >= 1 ? "" : `inset(0 ${((1 - t) * 100).toFixed(1)}% 0 0)`
      })
    },
    spark: p => $$(".spark").forEach(s => { s.style.clipPath = p >= 1 ? "" : `inset(0 ${((1 - ease(p)) * 100).toFixed(1)}% 0 0)` }),
    rows: p => {
      const rows = $$("#stat tr, #log li, .prows .prow:not(.hdr), .lang .row:not(.hdr)")
      rows.forEach((r, i) => {
        const t = ease(itemT(p, i, rows.length, 3))
        r.style.opacity = t >= 1 ? "" : String(t)
        r.style.transform = t >= 1 ? "" : `translateX(${((1 - t) * -40).toFixed(1)}px)`
      })
    },
  })
}

async function apply(view: UiView): Promise<void> {
  const json = JSON.stringify(view)
  if (json === lastJson) return frames(1)
  lastJson = json
  setShotCss(view)
  resetData(view)
  setTab(view.tab ?? "overview")
  if ((view.tab ?? "overview") === "overview") setRange(view.range ?? "today")
  setSelection(view.sel ?? "all")
  setExport(!!view.exportOpen)
  window.scrollTo(0, view.scrollY ?? 0)
  await frames(1)          // width observers (tape, heatmap) redraw for the zoom
  setFocus(view)
  await frames(1)
  showTooltip(view)
  reveal(view)
  await frames(2)
}

let ready: Promise<void> | null = null
;(window as any).__apply = async (view: UiView): Promise<void> => {
  ready ??= (async () => { await fontsReady(); await frames(2) })()
  await ready
  await apply(view)
}

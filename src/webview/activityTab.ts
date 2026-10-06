// The activity tab: the year's stats, the heatmap and each project's share.
// Hovering (or tabbing to) a project row narrows the stats and the heatmap to it.
import type { YearPayload } from "../shared/types"
import { namesFor, projectPaint } from "./colors"
import { $, el, keyBox, press } from "./dom"
import { MIN, dstr, fmt, hours, pct, shortDate } from "./format"
import { renderHeat } from "./heatmap"
import { Selection, seriesFor, yearStats } from "./model"
import type { Store } from "./state"
import { bindTip, tipLine, tipSub } from "./tooltip"

let hover: string | null = null

function renderYear(year: YearPayload, sel: Selection): void {
  const who = hover ?? sel
  const names = namesFor(year)
  const s = seriesFor(year, who)
  const st = yearStats(s)
  const target = s.targetMs.length ? s.targetMs[s.targetMs.length - 1] : year.globalTargetMs
  const cells: [string, string, string][] = [
    [String(st.activeDays), "active days", `of ${Math.min(365, s.days.length)}`],
    [hours(st.totalMs), "total time", `${fmt(st.totalMs / Math.max(1, st.activeDays))} per active day`],
    [`${st.longest}d`, "longest streak", st.longestEnd ? `ended ${shortDate(st.longestEnd)}, target ${Math.round(target / MIN)}m` : "no streak yet"],
    [st.best ? fmt(st.best.ms) : "0m", "most active day", st.best ? dstr(st.best.date) : "—"],
  ]
  $("ystats").replaceChildren(...cells.map(([v, k, sub]) => {
    const d = el("div", "ystat")
    d.append(el("div", "v", v), el("div", "k", k), el("div", "s", sub))
    return d
  }))
  $("ystats-who").textContent = hover ? ` · ${names.project(hover)} only` : ""
  renderHeat({
    days: s.days,
    active: s.active,
    targetMs: s.targetMs,
    today: year.today,
    who: hover ? names.project(hover) : null,
    breakdown: i => (who === "all" ? year.projects.filter(p => p.active[i] > 0).map(p => [p.name, p.active[i]] as [string, number]) : []),
  })
}

function dimRows(): void {
  $("prows-box").querySelectorAll<HTMLElement>("[data-ap]").forEach(n => n.classList.toggle("dim", !!hover && n.dataset.ap !== hover))
}

export function renderActivity(store: Store): void {
  const year = store.year
  if (!year) return
  const sel = store.view.sel
  const filter = $("act-filter")
  filter.replaceChildren(...[{ id: "all", name: "all projects" }, ...year.projects].map(p => {
    const b = el("button", null, p.name)
    b.dataset.v = p.id
    b.addEventListener("click", () => store.setSelection(p.id))
    return b
  }))
  press(filter, b => b.dataset.v === sel)
  renderYear(year, sel)

  const from = Math.max(0, year.days.length - 365)
  const totals = year.projects.map(p => {
    let t = 0
    let d = 0
    for (let i = from; i < p.active.length; i++) {
      t += p.active[i]
      if (p.active[i] > 0) d++
    }
    return { p, t, d }
  })
  const all = totals.reduce((s, r) => s + r.t, 0)
  const max = Math.max(1, ...totals.map(r => r.t))
  $("split").replaceChildren(...totals.filter(r => r.t > 0).map(r => {
    const s = el("span")
    s.dataset.ap = r.p.id
    s.style.flex = String(r.t)
    s.style.background = projectPaint(year, r.p.id).fill
    return s
  }))
  const hdr = el("div", "prow hdr")
  hdr.append(el("span", null, "project"), el("span"), el("span", "t", "time"), el("span", "pct", "share"), el("span", "dd", "active days"))
  $("prows").replaceChildren(hdr, ...totals.map(r => {
    const paint = projectPaint(year, r.p.id)
    const row = el("div", sel === r.p.id ? "prow sel" : "prow")
    row.dataset.ap = r.p.id
    const name = el("span", "name")
    name.append(keyBox(paint.fill), r.p.name)
    const track = el("span", "track")
    const fill = el("span", "fill")
    fill.style.width = `${r.t / max * 100}%`
    fill.style.background = paint.fill
    track.append(fill)
    row.append(name, track, el("span", "t", hours(r.t)), el("span", "pct", `${pct(r.t, all)}%`), el("span", "dd", r.d))
    bindTip(row, () => [tipLine(hours(r.t), r.p.name), tipSub(`${pct(r.t, all)}% of all time · active on ${r.d} days`)])
    return row
  }))
  if (!totals.length) $("prows").append(el("div", "hint", "no projects yet"))
  dimRows()
}

export function initActivity(store: Store): void {
  const box = $("prows-box")
  const set = (id: string | null) => {
    if (id === hover) return
    hover = id
    if (store.year) renderYear(store.year, store.view.sel)
    dimRows()
  }
  const apOf = (t: EventTarget | null): string | null =>
    (t instanceof Element ? t.closest<HTMLElement>("[data-ap]")?.dataset.ap ?? null : null)
  box.addEventListener("pointerover", e => {
    const id = apOf(e.target)
    if (id) set(id)
  })
  box.addEventListener("pointerleave", () => set(null))
  box.addEventListener("focusin", e => set(apOf(e.target)))
  box.addEventListener("focusout", e => { if (!box.contains(e.relatedTarget as Node | null)) set(null) })
}

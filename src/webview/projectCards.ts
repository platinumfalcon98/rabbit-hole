// The projects tab: one card per project with today, the streak, a 14-day
// sparkline and the project's own daily target.
import type { WebviewMessage } from "../shared/types"
import { projectColor } from "./colors"
import { $, el, press } from "./dom"
import { MIN, ago, dstr, fmt } from "./format"
import { sparkGlyphs } from "./layout"
import { seriesFor, streakInfo } from "./model"
import type { Store } from "./state"
import { wireSteppers } from "./stepper"
import { delegateTip, tipLine } from "./tooltip"

type SortBy = "time" | "last" | "name"
let sortBy: SortBy = "time"

// The tab re-renders every 10 s; that must not wipe a target being typed.
function busy(host: HTMLElement): boolean {
  if (document.activeElement instanceof HTMLInputElement && host.contains(document.activeElement)) return true
  return Array.from(host.querySelectorAll<HTMLInputElement>("input")).some(i => i.value.trim() !== (i.dataset.saved ?? ""))
}

export function renderCards(store: Store, openInOverview: (id: string) => void): void {
  const year = store.year
  const host = $("pcards")
  if (!year || busy(host)) return
  const last = year.days.length - 1
  const globalMin = Math.round(year.globalTargetMs / MIN)
  const now = Date.now()
  const list = year.projects.map((p, rank) => ({ p, rank, today: p.active[last] ?? 0, s: seriesFor(year, p.id) }))
  list.sort((a, b) => sortBy === "name" ? a.p.name.localeCompare(b.p.name)
    : sortBy === "last" ? (b.p.lastActive ?? 0) - (a.p.lastActive ?? 0) || a.rank - b.rank
    : b.today - a.today || a.rank - b.rank)

  host.replaceChildren(...list.map(({ p, rank, today, s }) => {
    const info = streakInfo(s, p.streak)
    const color = projectColor(year, p.id)
    const card = el("fieldset", "pcard span-6")
    const legend = el("legend")
    legend.append(el("b", null, p.name), el("span", "ago", ` · ${ago(p.lastActive, now)}`))
    card.append(legend, el("div", "path", p.path))

    const stats = el("div", "stats")
    const todayBox = el("div")
    todayBox.append(el("div", today ? "v" : "v zero", fmt(today)), el("div", "k", "today"))
    const streakBox = el("div")
    streakBox.append(
      el("div", info.current ? "v" : "v zero", `${info.current}d`),
      el("div", info.atRisk ? "k risk" : "k", info.atRisk ? "streak, at risk today" : "streak"),
    )
    stats.append(todayBox, streakBox)
    card.append(stats)

    const from = Math.max(0, s.days.length - 14)
    const spark = el("div", "spark")
    spark.setAttribute("role", "img")
    spark.setAttribute("aria-label", `${p.name}, active time over the last 14 days`)
    sparkGlyphs(s.active.slice(from)).forEach((g, i) => {
      const c = el("span", g.zero ? "z" : null, g.glyph)
      if (!g.zero) c.style.color = color
      c.dataset.i = String(i)
      spark.append(c)
    })
    delegateTip(spark, c => {
      const i = from + Number(c.dataset.i)
      return [tipLine(s.active[i] ? fmt(s.active[i]) : "no activity", dstr(s.days[i]))]
    })
    const axis = el("div", "spark-axis")
    axis.append(el("span", null, "14 days ago"), el("span", null, "today"))
    card.append(spark, axis)

    // ids by registry position: project ids may hold characters a selector can't
    const inputId = `pt-${rank}`
    const own = p.dailyTargetMinutes === undefined ? "" : String(p.dailyTargetMinutes)
    const target = el("div", "target")
    const lbl = el("label", "lbl", "daily target")
    lbl.htmlFor = inputId
    const inp = el("input", "tin")
    inp.id = inputId
    inp.type = "number"
    inp.min = "1"
    inp.max = "1440"
    inp.step = "5"
    inp.placeholder = String(globalMin)
    inp.value = own
    inp.dataset.saved = own
    inp.dataset.optional = ""
    inp.dataset.project = p.id
    const down = el("button", "btn step", "−")
    const up = el("button", "btn step", "+")
    down.dataset.for = inputId
    up.dataset.for = inputId
    down.dataset.step = "-5"
    up.dataset.step = "5"
    down.setAttribute("aria-label", `Decrease ${p.name} target`)
    up.setAttribute("aria-label", `Increase ${p.name} target`)
    const apply = el("button", "btn", "apply")
    apply.dataset.apply = inputId
    apply.dataset.label = `${p.name} target`
    apply.disabled = true
    const hint = el("span", "hint", own ? `own target; clear it to use the global ${globalMin}m` : `empty: uses the global ${globalMin}m`)
    target.append(lbl, down, inp, up, el("span", "unit", "min"), apply, hint)

    const foot = el("div", "foot")
    const open = el("button", "btn", "open in overview")
    open.addEventListener("click", () => openInOverview(p.id))
    foot.append(open)
    card.append(target, foot)
    return card
  }))
  if (!list.length) host.append(el("p", "hint", "No projects yet. Open a folder and start typing."))
}

export function initCards(store: Store, post: (m: WebviewMessage) => void, rerender: () => void): void {
  $("sort").addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button[data-v]") : null
    if (!b) return
    sortBy = (b.dataset.v as SortBy | undefined) ?? "time"
    press($("sort"), x => x === b)
    rerender()
  })
  wireSteppers($("pcards"), (inp, value, was, button) => {
    const projectId = inp.dataset.project
    if (!projectId) return
    post({ type: "updateProjectSetting", projectId, key: "dailyTargetMinutes", value })
    store.note("ok", `${button.dataset.label} set to ${value === null ? "global" : `${value}m`} (was ${was === "" ? "global" : `${was}m`})`)
  })
}

// Range buttons and the two-month calendar dropped from the status line.
// The rules (presets, 92-day limit, click order) are calendar.ts's.
import { Pick, RangeId, dayDisabled, monthDays, pickDay, pickLabel, presetOf, presetRange, rangeLabel } from "./calendar"
import { $, el, press } from "./dom"
import { MON, dstr, fmt, fromKey } from "./format"
import { closeMenu } from "./projectPicker"
import type { Store } from "./state"

let pick: Pick = { start: null, end: null }
let hover: string | null = null
let right = 0   // the right-hand month, as year * 12 + month

const ym = (key: string): number => {
  const d = fromKey(key)
  return d.getFullYear() * 12 + d.getMonth()
}

export function renderRangeButtons(store: Store): void {
  const v = store.view
  const picked = v.preset === null && !!v.from
  press($("range"), b => (b.dataset.range ? b.dataset.range === v.preset : picked))
  $("r-cal").textContent = picked ? rangeLabel(v.from, v.to) : "pick…"
}

export function closePicker(): void {
  $("picker").hidden = true
  $("r-cal").setAttribute("aria-expanded", "false")
}

function openPicker(store: Store): void {
  const year = store.year
  if (!year || !store.view.from) return
  closeMenu()
  pick = { start: store.view.from, end: store.view.to }
  hover = null
  right = Math.min(ym(year.today), Math.max(ym(year.days[0]) + 1, ym(store.view.to)))
  $("picker").hidden = false
  $("r-cal").setAttribute("aria-expanded", "true")
  renderMonths(store)
}

function renderMonths(store: Store): void {
  const year = store.year
  if (!year) return
  const active = new Map(year.days.map((d, i) => [d, year.global.active[i]] as [string, number]))
  $("pk-months").replaceChildren(...[right - 1, right].map(k => {
    const y = Math.floor(k / 12)
    const m = k % 12
    const box = el("div")
    box.append(el("div", "pk-title", `${MON[m].toLowerCase()} ${y}`))
    const grid = el("div", "pk-grid")
    for (const w of ["mo", "tu", "we", "th", "fr", "sa", "su"]) grid.append(el("span", "pk-wd", w))
    for (const key of monthDays(y, m)) {
      if (!key) {
        grid.append(el("span"))
        continue
      }
      const b = el("button", "pk-d", fromKey(key).getDate())
      b.dataset.key = key
      const ms = active.get(key)
      if (ms === 0) b.classList.add("z")
      if (key === year.today) b.classList.add("today")
      b.setAttribute("aria-label", dstr(key) + (ms === undefined ? "" : ms ? `, ${fmt(ms)} active` : ", no activity"))
      grid.append(b)
    }
    box.append(grid)
    return box
  }))
  $<HTMLButtonElement>("pk-prev").disabled = right - 1 <= ym(year.days[0])
  $<HTMLButtonElement>("pk-next").disabled = right >= ym(year.today)
  paint(store)
}

function paint(store: Store): void {
  const year = store.year
  if (!year) return
  const a = pick.start
  const z = pick.end ?? (hover && a && hover >= a ? hover : null)
  $("pk-months").querySelectorAll<HTMLButtonElement>(".pk-d").forEach(b => {
    const d = b.dataset.key ?? ""
    b.disabled = dayDisabled(pick, d, year.days[0], year.today)
    b.classList.toggle("end", !!a && (d === a || d === z))
    b.classList.toggle("in", !!a && !!z && d > a && d < z)
  })
  $("pk-sel").textContent = pickLabel(pick)
  $<HTMLButtonElement>("pk-apply").disabled = !(pick.start && pick.end)
}

const dayButton = (t: EventTarget | null): HTMLButtonElement | null =>
  t instanceof Element ? t.closest<HTMLButtonElement>(".pk-d") : null

export function initDatePicker(store: Store): void {
  $("range").addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button") : null
    if (!b || !store.year) return
    if (b.id === "r-cal") {
      if ($("picker").hidden) openPicker(store)
      else closePicker()
      return
    }
    const id = b.dataset.range as RangeId | undefined
    if (!id) return
    closePicker()
    const r = presetRange(id, store.year.today)
    store.setView(r.from, r.to, id)
  })
  $("pk-months").addEventListener("click", e => {
    const b = dayButton(e.target)
    if (!b || b.disabled || !b.dataset.key) return
    pick = pickDay(pick, b.dataset.key)
    paint(store)
  })
  $("pk-months").addEventListener("pointerover", e => {
    const b = dayButton(e.target)
    if (!b || pick.end || !b.dataset.key) return
    hover = b.dataset.key
    paint(store)
  })
  $("pk-prev").addEventListener("click", () => { right--; renderMonths(store) })
  $("pk-next").addEventListener("click", () => { right++; renderMonths(store) })
  $("pk-cancel").addEventListener("click", closePicker)
  $("pk-apply").addEventListener("click", () => {
    const { start, end } = pick
    if (!store.year || !start || !end) return
    closePicker()
    store.setView(start, end, presetOf(start, end, store.year.today))
  })
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("picker").hidden) {
      closePicker()
      $("r-cal").focus()
    }
  })
  window.addEventListener("pointerdown", e => {
    const t = e.target as Node
    if (!$("picker").hidden && !$("picker").contains(t) && t !== $("r-cal")) closePicker()
  })
}

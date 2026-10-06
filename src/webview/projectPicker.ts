// The project name in the status line opens every project with today's time.
// One choice, shared by the overview, the activity tab and the streak.
import { projectPaint } from "./colors"
import { closePicker } from "./datePicker"
import { $, el, keyBox } from "./dom"
import { fmt, plural } from "./format"
import type { Store } from "./state"

export function renderProjectButton(store: Store): void {
  const year = store.year
  const p = year?.projects.find(q => q.id === store.view.sel)
  $("proj-name").textContent = p ? p.name : "all projects"
  const k = $("proj-key")
  k.style.background = p && year ? projectPaint(year, p.id).fill : ""
  k.classList.toggle("hollow", !p)
}

function renderMenu(store: Store): void {
  const year = store.year
  if (!year) return
  const last = year.days.length - 1
  const items = [
    { id: "all", name: "all projects", color: null as string | null, sub: plural(year.projects.length, "project"), ms: year.global.active[last] ?? 0 },
    ...year.projects.map(p => ({
      id: p.id,
      name: p.name,
      color: projectPaint(year, p.id).fill as string | null,
      sub: p.path + (p.id === store.here ? "  · open here" : ""),
      ms: p.active[last] ?? 0,
    })),
  ]
  $("pmenu").replaceChildren(el("div", "pm-h", "today"), ...items.map(it => {
    const b = el("button", "pm-item")
    b.setAttribute("role", "option")
    b.setAttribute("aria-selected", String(it.id === store.view.sel))
    const name = el("span", "pm-name")
    name.append(el("span", null, it.name), el("small", null, it.sub))
    b.append(keyBox(it.color), name, el("span", it.ms ? "pm-t" : "pm-t z", it.ms ? fmt(it.ms) : "·"))
    b.addEventListener("click", () => {
      closeMenu()
      store.setSelection(it.id)
      $("proj-btn").focus()
    })
    return b
  }))
}

export function openMenu(store: Store): void {
  closePicker()
  renderMenu(store)
  $("pmenu").hidden = false
  $("proj-btn").setAttribute("aria-expanded", "true")
  const first = $("pmenu").querySelector<HTMLElement>('[aria-selected="true"]') ?? $("pmenu").querySelector<HTMLElement>(".pm-item")
  first?.focus()
}

export function closeMenu(): void {
  $("pmenu").hidden = true
  $("proj-btn").setAttribute("aria-expanded", "false")
}

export function initProjectPicker(store: Store): void {
  $("proj-btn").addEventListener("click", () => ($("pmenu").hidden ? openMenu(store) : closeMenu()))
  $("pmenu").addEventListener("keydown", e => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const items = Array.from($("pmenu").querySelectorAll<HTMLElement>(".pm-item"))
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus()
  })
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("pmenu").hidden) {
      closeMenu()
      $("proj-btn").focus()
    }
  })
  window.addEventListener("pointerdown", e => {
    const t = e.target as Node
    if (!$("pmenu").hidden && !$("pmenu").contains(t) && !$("proj-btn").contains(t)) closeMenu()
  })
}

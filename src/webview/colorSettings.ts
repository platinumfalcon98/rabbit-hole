// Settings → colours: every project and language with its mark, and a grid of
// the 24 marks to pick from. The pick is written to rabbithole.colors by the
// host, and comes back in the next year, which every panel paints from.
import type { WebviewMessage, YearPayload } from "../shared/types"
import { MARKS, languageMarks, markName, paintOf, projectMark } from "./colors"
import { $, el, keyBox } from "./dom"
import type { Store } from "./state"

type Kind = "project" | "language"
interface Item { kind: Kind; id: string; label: string; mark: number; picked: boolean }

let open: string | null = null   // "<kind>:<id>" whose grid is showing
let built = ""                   // what the lists were last built from

const keyOf = (i: { kind: Kind; id: string }): string => `${i.kind}:${i.id}`

function items(year: YearPayload): { projects: Item[]; languages: Item[] } {
  const picks = year.colors ?? { projects: {}, languages: {} }
  const marks = languageMarks(year, [])
  return {
    projects: year.projects.map(p => ({ kind: "project", id: p.id, label: p.name, mark: projectMark(year, p.id), picked: p.id in picks.projects })),
    languages: (year.languages ?? []).map(name => ({ kind: "language", id: name, label: name, mark: marks.get(name) ?? -1, picked: name in picks.languages })),
  }
}

function row(item: Item, n: number, all: Item[]): HTMLElement {
  const r = el("div", "cl-row")
  const isOpen = open === keyOf(item)
  const b = el("button", "cl-btn")
  b.id = `cl-${item.kind}-${n}`
  b.dataset.cl = keyOf(item)
  b.setAttribute("aria-expanded", String(isOpen))
  b.append(keyBox(paintOf(item.mark).fill), el("span", "cl-n", item.label),
    el("span", "cl-m", item.mark < 0 ? "other" : item.picked ? markName(item.mark) : `${markName(item.mark)} · auto`))
  r.append(b)
  if (!isOpen) return r

  const grid = el("div", "cl-grid")
  grid.setAttribute("role", "group")
  grid.setAttribute("aria-label", `Colour for ${item.label}`)
  for (let m = 0; m < MARKS; m++) {
    const sw = el("button", "cl-sw")
    sw.id = `${b.id}-${m}`
    sw.dataset.mark = String(m)
    sw.dataset.for = keyOf(item)
    const others = all.filter(o => o !== item && o.mark === m).map(o => o.label)
    sw.setAttribute("aria-pressed", String(item.mark === m))
    sw.setAttribute("aria-label", markName(m) + (others.length ? `, also ${others.join(", ")}` : ""))
    sw.title = markName(m) + (others.length ? ` · also ${others.slice(0, 4).join(", ")}${others.length > 4 ? "…" : ""}` : "")
    if (others.length) sw.classList.add("used")
    sw.append(keyBox(paintOf(m).fill))
    grid.append(sw)
  }
  const auto = el("button", "btn cl-auto", "automatic")
  auto.id = `${b.id}-auto`
  auto.dataset.for = keyOf(item)
  auto.dataset.mark = "auto"
  auto.disabled = !item.picked
  grid.append(auto)
  r.append(grid)
  return r
}

export function renderColorSettings(store: Store): void {
  const year = store.year
  if (!year) return
  const { projects, languages } = items(year)
  // live ticks don't change any of this; rebuilding on them would close nothing
  // but would reset scroll and re-announce the rows
  const sig = JSON.stringify([open, projects.map(i => [i.id, i.label, i.mark, i.picked]), languages.map(i => [i.id, i.mark, i.picked])])
  if (sig === built) return
  built = sig
  $("cl-projects").replaceChildren(...projects.map((i, n) => row(i, n, projects)))
  const langList = $("cl-langs")
  langList.replaceChildren(...(languages.length ? languages.map((i, n) => row(i, n, languages)) : [el("p", "hint", "No languages tracked yet.")]))
}

export function initColorSettings(store: Store, post: (m: WebviewMessage) => void): void {
  $("set-colors").addEventListener("keydown", e => {
    if (e.key !== "Escape" || !open) return
    const was = open
    open = null
    renderColorSettings(store)
    document.querySelector<HTMLElement>(`#set-colors [data-cl="${CSS.escape(was)}"]`)?.focus()
  })
  $("set-colors").addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button") : null
    if (!b) return
    if (b.dataset.cl) {
      const key = b.dataset.cl
      open = open === key ? null : key
      renderColorSettings(store)
      // the rebuild replaced the button; keep the keyboard where it was
      document.querySelector<HTMLElement>(`#set-colors [data-cl="${CSS.escape(key)}"]`)?.focus()
      return
    }
    const target = b.dataset.for
    if (!target || b.disabled) return
    const [kind, ...rest] = target.split(":")
    const id = rest.join(":")   // project ids can contain colons
    const mark = b.dataset.mark === "auto" ? null : Number(b.dataset.mark)
    const label = kind === "project" ? store.year?.projects.find(p => p.id === id)?.name ?? id : id
    post({ type: "setColor", kind: kind as Kind, id, mark })
    store.note("ok", `${label}: ${mark === null ? "automatic colour" : markName(mark)}`)
    open = null
    renderColorSettings(store)
    document.querySelector<HTMLElement>(`#set-colors [data-cl="${CSS.escape(target)}"]`)?.focus()
  })
}

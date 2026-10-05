// Hover focus: pointing at a project or a language (anything carrying
// data-hl="p:<id>" or "l:<name>") narrows the other panels to it. The panel
// under the pointer keeps its rows; panels hold their height while a focus is
// shown, so nothing moves under the pointer. Leaving the item clears it.
import type { Focus } from "./model"

export function parseHl(v: string | undefined): Focus {
  if (!v) return null
  const i = v.indexOf(":")
  if (i < 0) return null
  const k = v.slice(0, i)
  const id = v.slice(i + 1)   // project ids can contain colons themselves
  if (!id) return null
  if (k === "p") return { kind: "project", id }
  if (k === "l") return { kind: "language", id }
  return null
}

export const hlOf = (f: NonNullable<Focus>): string => `${f.kind === "project" ? "p" : "l"}:${f.id}`

export const sameFocus = (a: Focus, b: Focus): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id)

export function lockHeights(root: HTMLElement, on: boolean): void {
  root.querySelectorAll<HTMLElement>(".grid > fieldset").forEach(f => { f.style.minHeight = on ? `${f.offsetHeight}px` : "" })
}

const CLEAR_GRACE_MS = 120

export interface FocusWiring {
  allowProject: () => boolean   // a project focus only means something with all projects shown
  current: () => Focus
  set: (f: Focus) => void
}

export function wireFocus(root: HTMLElement, w: FocusWiring): void {
  const read = (t: EventTarget | null): NonNullable<Focus> | null => {
    const h = t instanceof Element ? t.closest<HTMLElement>("[data-hl]") : null
    if (!h || !root.contains(h)) return null
    const f = parseHl(h.dataset.hl)
    if (!f || (f.kind === "project" && !w.allowProject())) return null
    return f
  }
  const apply = (f: Focus) => {
    const cur = w.current()
    if (sameFocus(cur, f)) return
    // measure before the focused render changes anything
    if (f && !cur) lockHeights(root, true)
    if (!f) lockHeights(root, false)
    w.set(f)
  }
  // Leaving a hoverable item clears its focus, after a short grace so that
  // crossing the gap to a neighbouring key doesn't flash the unfocused view.
  let clearing: ReturnType<typeof setTimeout> | undefined
  const cancelClear = () => { clearTimeout(clearing); clearing = undefined }
  root.addEventListener("pointerover", e => {
    const hit = read(e.target)
    if (hit) {
      cancelClear()
      return apply(hit)
    }
    if (w.current() && clearing === undefined) clearing = setTimeout(() => { clearing = undefined; apply(null) }, CLEAR_GRACE_MS)
  })
  root.addEventListener("pointerleave", () => {
    cancelClear()
    apply(null)
  })
  root.addEventListener("focusin", e => {
    if (restoring) return
    const hit = read(e.target)
    apply(hit)
  })
  // Tabbing out of the overview clears a keyboard focus, as leaving it with the
  // pointer does. A focused element removed by a re-render is not leaving.
  root.addEventListener("focusout", e => {
    if (restoring) return
    const next = e.relatedTarget
    if (!(e.target instanceof Node) || !e.target.isConnected) return
    if (next instanceof Node && root.contains(next)) return
    apply(null)
  })
}

// Panels are rebuilt on every 10 s live tick and on every focus change, which
// throws away the element holding keyboard focus. These find its replacement.
const KEY_ATTRS = ["hl", "ap", "v", "key", "range", "tab", "i"]

// Set while keepFocus hands focus back. That element already showed the current
// focus, so it is not a new one: reading it again re-rendered, which restored
// focus again, and recursed until the stack overflowed.
let restoring = false

export function focusSelector(id: string, data: Record<string, string | undefined>): string | null {
  const q = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  if (id) return `[id=${q(id)}]`
  for (const k of KEY_ATTRS) {
    const v = data[k]
    if (v !== undefined) return `[data-${k}=${q(v)}]`
  }
  return null
}

const TAB_STOPS = "[tabindex], button, input, select, a[href]"

// Runs a render and, if it removed the focused element, focuses the element
// that took its place (looked up within the nearest ancestor that has an id;
// by position there when the element carries nothing that identifies it).
export function keepFocus(render: () => void): void {
  const a = document.activeElement
  if (!(a instanceof HTMLElement) || a === document.body) return render()
  const sel = focusSelector(a.id, { ...a.dataset })
  const scopeEl = a.parentElement?.closest<HTMLElement>("[id]")
  const scopeId = scopeEl?.id
  const index = scopeEl ? Array.from(scopeEl.querySelectorAll(TAB_STOPS)).indexOf(a) : -1
  render()
  if (a.isConnected) return
  const scope = (scopeId && document.getElementById(scopeId)) || null
  const next = sel
    ? (scope ?? document).querySelector<HTMLElement>(sel)
    : scope && index >= 0 ? scope.querySelectorAll<HTMLElement>(TAB_STOPS)[index] : null
  if (!next) return
  restoring = true
  try { next.focus({ preventScroll: true }) } finally { restoring = false }
}

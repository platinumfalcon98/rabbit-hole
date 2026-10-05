// Hover focus: pointing at a project or a language (anything carrying
// data-hl="p:<id>" or "l:<name>") narrows the other panels to it. The panel
// under the pointer keeps its rows; panels hold their height while a focus is
// shown, so nothing moves under the pointer.
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

export interface FocusWiring {
  allowProject: () => boolean   // a project focus only means something with all projects shown
  current: () => Focus
  set: (f: Focus) => void
}

export function wireFocus(root: HTMLElement, w: FocusWiring): void {
  let src: HTMLElement | null = null
  const read = (t: EventTarget | null): { f: NonNullable<Focus>; src: HTMLElement | null } | null => {
    const h = t instanceof Element ? t.closest<HTMLElement>("[data-hl]") : null
    if (!h || !root.contains(h)) return null
    const f = parseHl(h.dataset.hl)
    if (!f || (f.kind === "project" && !w.allowProject())) return null
    return { f, src: h.closest<HTMLElement>("fieldset") }
  }
  const apply = (f: Focus, from: HTMLElement | null) => {
    src = from
    const cur = w.current()
    if (sameFocus(cur, f)) return
    // measure before the focused render changes anything
    if (f && !cur) lockHeights(root, true)
    if (!f) lockHeights(root, false)
    w.set(f)
  }
  root.addEventListener("pointerover", e => {
    const hit = read(e.target)
    if (hit) return apply(hit.f, hit.src)
    // leaving the source panel clears the focus; moving within it does not
    if (w.current() && !(src && e.target instanceof Node && src.contains(e.target))) apply(null, null)
  })
  root.addEventListener("pointerleave", () => apply(null, null))
  root.addEventListener("focusin", e => {
    const hit = read(e.target)
    apply(hit ? hit.f : null, hit ? hit.src : null)
  })
}

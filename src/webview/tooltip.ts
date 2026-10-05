// One tooltip for the whole dashboard: the same text on hover and on keyboard focus.
import { el } from "./dom"

let tip: HTMLElement | null = null

export function initTooltip(node: HTMLElement): void { tip = node }

export function hideTip(): void { if (tip) tip.hidden = true }

export function showTip(x: number, y: number, nodes: Node[]): void {
  if (!tip) return
  tip.replaceChildren(...nodes)
  tip.hidden = false
  const r = tip.getBoundingClientRect()
  tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - r.width - 8))}px`
  tip.style.top = `${Math.max(8, y - r.height - 10)}px`
}

export function bindTip(node: HTMLElement, build: () => Node[]): void {
  node.tabIndex = 0
  node.addEventListener("pointermove", e => showTip(e.clientX, e.clientY, build()))
  node.addEventListener("pointerleave", hideTip)
  node.addEventListener("focus", () => {
    const r = node.getBoundingClientRect()
    showTip(r.left, r.top, build())
  })
  node.addEventListener("blur", hideTip)
}

// Dense marks (heatmap cells, sparklines, range columns) share one listener and
// no tab stop per cell. Cells carry data-i; build returns null for "no tip".
export function delegateTip(host: HTMLElement, build: (cell: HTMLElement) => Node[] | null): void {
  host.addEventListener("pointermove", e => {
    const c = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-i]") : null
    const nodes = c && host.contains(c) ? build(c) : null
    if (nodes) showTip(e.clientX, e.clientY, nodes)
    else hideTip()
  })
  host.addEventListener("pointerleave", hideTip)
}

export function tipLine(strong: string, sub?: string): HTMLElement {
  const d = el("div")
  d.append(el("strong", null, strong))
  if (sub) d.append(el("span", "sub", " " + sub))
  return d
}

export const tipSub = (text: string): HTMLElement => el("div", "sub", text)

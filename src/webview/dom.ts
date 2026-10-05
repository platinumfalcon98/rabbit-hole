// Small element helpers. DOM work happens only inside these functions.

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const n = document.getElementById(id)
  if (!n) throw new Error(`#${id} is missing from the dashboard shell`)
  return n as T
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | number | null): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined && text !== null) n.textContent = String(text)
  return n
}

export function kv(k: string, v: string | number): HTMLElement {
  const s = el("span", "kv", k + " ")
  s.append(el("b", null, v))
  return s
}

// The 8px colour square; hollow stands for "all projects".
export function keyBox(color: string | null): HTMLElement {
  const k = el("i", color ? "key" : "key hollow")
  if (color) k.style.background = color
  return k
}

// Width of one monospace character in this element's font, for the +/- runs.
export function charWidth(host: HTMLElement): number {
  const probe = el("span", null, "+".repeat(40))
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre"
  host.append(probe)
  const w = probe.getBoundingClientRect().width / 40
  probe.remove()
  return w || 8
}

// Calls fn when the node's width changes. Height is ignored on purpose: a panel
// that grows taller as it redraws must not trigger itself again.
export function onWidth(node: HTMLElement, fn: (width: number) => void): void {
  let last = -1
  new ResizeObserver(() => {
    const w = node.clientWidth
    if (w !== last) {
      last = w
      fn(w)
    }
  }).observe(node)
}

export function press(group: HTMLElement, on: (b: HTMLButtonElement) => boolean): void {
  group.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.setAttribute("aria-pressed", String(on(b))))
}

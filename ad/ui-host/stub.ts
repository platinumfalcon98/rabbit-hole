// Shared by both hosts: the frozen clock, the stub VS Code API that answers the
// real webview from the showcase data, and the reveal helpers. Loaded before
// the real bundle (host.html / mini.html), so Date is frozen before it runs.
import type { ExtensionMessage, LivePayload } from "../../src/shared/types"
import { NOW, showcase } from "../src/data/showcase"
import { fmt } from "../../src/webview/format"
import type { RevealKind, UiView } from "../src/ui/view"

// ── a frozen clock: the dashboard reads Date.now() for "now" ──
const RealDate = Date
class FrozenDate extends RealDate {
  constructor(...a: any[]) {
    if (a.length === 0) super(NOW)
    else super(...(a as [any]))
  }
  static now(): number { return NOW }
}
;(window as any).Date = FrozenDate

export const data = showcase()
const UI_CRT = { mask: "off", pitch: "fine", strength: 0, vignette: 0, effects: ["bloom"] } as const
export const settingsMsg = { ...data.settings, crt: { ...UI_CRT, effects: [...UI_CRT.effects] } }
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

// Delivered synchronously, so a frame's view is fully applied before it is captured.
export function deliver(msg: ExtensionMessage): void {
  window.dispatchEvent(new MessageEvent("message", { data: msg }))
}

export function installApi(onMessage: (m: any) => void): void {
  ;(window as any).acquireVsCodeApi = () => ({
    getState: () => null,
    setState: () => undefined,
    postMessage: onMessage,
  })
}

export const frames = (n = 2): Promise<void> => new Promise(res => {
  const step = (k: number) => (k <= 0 ? res() : requestAnimationFrame(() => step(k - 1)))
  step(n)
})

export async function fontsReady(): Promise<void> {
  await document.fonts.load('400 16px "Martian Mono"')
  await document.fonts.load('700 16px "Martian Mono"')
  await document.fonts.ready
}

export function setShotCss(view: UiView): void {
  const st = document.getElementById("shot")!
  const css = view.css ?? ""
  if (st.textContent !== css) st.textContent = css
  const z = String(view.zoom ?? 1)
  if (document.documentElement.style.zoom !== z) document.documentElement.style.zoom = z
}

// ── pointer events, as the real hover focus listens for them ──
export function pointer(type: string, target: Element, x?: number, y?: number): void {
  const r = target.getBoundingClientRect()
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: type !== "pointerleave" && type !== "pointerenter",
    // The film zooms the page with CSS zoom, under which element boxes are in
    // zoomed px but positions the page writes (the tooltip's left/top) are
    // zoomed again; VS Code's window zoom has no such split. Hand the page
    // unzoomed coordinates, as it would get them at zoom 1.
    clientX: (x ?? r.left + r.width / 2) / zoomOf(), clientY: (y ?? r.top + r.height / 2) / zoomOf(), pointerType: "mouse",
  }))
}

export function showTooltip(view: UiView): void {
  const tip = document.getElementById("tip")
  if (tip) tip.hidden = true
  if (!view.tooltipAt) return
  const el = document.querySelector(view.tooltipAt.selector)
  if (!el) return
  const r = el.getBoundingClientRect()
  pointer("pointermove", el, r.left + r.width * (view.tooltipAt.fx ?? 0.5), r.top + r.height * (view.tooltipAt.fy ?? 0.5))
}

// ── reveals: inline styles and text on the real elements, from progress alone ──
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3)

// Count every number in a text up from 0. "3h40m" counts as minutes. The real
// text is whatever the element holds unless it still holds what we last wrote:
// the panels re-render fixed elements (#ln-add …) with new text on a focus.
const ORIGINAL = new Map<Node, string>()
const WRITTEN = new Map<Node, string>()
export function resetCounts(): void { ORIGINAL.clear(); WRITTEN.clear() }
/** The node's real text, as the UI last rendered it. */
export function realText(n: Node): string {
  const cur = n.textContent ?? ""
  if (!ORIGINAL.has(n) || WRITTEN.get(n) !== cur) { ORIGINAL.set(n, cur); WRITTEN.delete(n) }
  return ORIGINAL.get(n)!
}
export function writeText(n: Node, text: string): void {
  if (n.textContent !== text) n.textContent = text
  WRITTEN.set(n, text)
}
export function countUp(el: Element, p: number): void {
  const orig = realText(el)
  const k = ease(p)
  const out = k >= 1 ? orig : orig.replace(/(\d+)h(\d\d)m|(\d+)m\b|(\d+)/g, (_m, h, mm, mins, n) => {
    if (h !== undefined) return fmt(Math.round((Number(h) * 60 + Number(mm)) * k) * 60_000)
    if (mins !== undefined) return `${Math.round(Number(mins) * k)}m`
    return String(Math.round(Number(n) * k))
  })
  writeText(el, out)
}

/** Item i of n's own progress when n items enter one after another, each over `overlap` slots. */
export const itemT = (p: number, i: number, n: number, overlap = 3): number =>
  clamp((clamp(p) * (n - 1 + overlap) - i) / overlap)
export { ease, clamp }

export type Reveals = Partial<Record<RevealKind, (p: number) => void>>

export function applyReveals(view: UiView, kinds: Reveals): void {
  for (const [k, fn] of Object.entries(kinds)) {
    const p = view.reveal?.[k as RevealKind]
    fn!(p === undefined ? 1 : clamp(p))
  }
}

export function liveMsg(live: LivePayload): ExtensionMessage {
  return { type: "live", ...clone(live) }
}

function zoomOf(): number {
  return Number(document.documentElement.style.zoom) || 1
}

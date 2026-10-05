// Dashboard entry point: wiring only. Every panel renders from the store, and
// nothing here computes a number.
import type { ExtensionMessage, WebviewMessage } from "../shared/types"
import { carrotSvg } from "./carrot"
import { applyCrt, initCrt } from "./crt"
import { $ } from "./dom"
import { Change, Store, Tab } from "./state"
import { hideTip, initTooltip } from "./tooltip"

declare function acquireVsCodeApi(): {
  postMessage(m: WebviewMessage): void
  getState(): unknown
  setState(s: unknown): void
}

const vscode = acquireVsCodeApi()
const post = (m: WebviewMessage): void => vscode.postMessage(m)
const store = new Store(post)
const TABS: Tab[] = ["overview", "activity", "projects", "settings"]
let tab: Tab = "overview"

type Render = (change: Change | "tab") => void
// Each tab registers its renderer below; the top bar renders on every change.
const tabs: Partial<Record<Tab, Render>> = {}
const bar: Render[] = []
// Messages the store doesn't handle (the interim export's data) go to whoever asked.
const extra: ((msg: ExtensionMessage) => void)[] = []

function render(change: Change | "tab"): void {
  for (const r of bar) r(change)
  tabs[tab]?.(change)
}

function showTab(next: Tab): void {
  tab = next
  document.querySelectorAll<HTMLElement>("section.tab").forEach(s => { s.hidden = s.dataset.tab !== next })
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === next)))
  $("range").hidden = next !== "overview"
  hideTip()
  try { vscode.setState({ tab: next }) } catch { /* only a convenience */ }
  render("tab")
}

// ── panels ──

// ── start ──
initTooltip($("tip"))
initCrt()
$("brand").append(carrotSvg(2))
store.on(change => {
  if (change === "settings" && store.settings) applyCrt(store.settings.crt)
  render(change)
})
window.addEventListener("message", (e: MessageEvent<ExtensionMessage>) => {
  for (const fn of extra) fn(e.data)
  store.receive(e.data)
})
document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach(b =>
  b.addEventListener("click", () => showTab((b.dataset.tab as Tab) ?? "overview")))
const saved = vscode.getState() as { tab?: Tab } | null
showTab(saved?.tab && TABS.includes(saved.tab) ? saved.tab : "overview")
post({ type: "ready" })

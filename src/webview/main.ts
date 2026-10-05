// Dashboard entry point: wiring only. Every panel renders from the store, and
// nothing here computes a number.
import type { ExtensionMessage, WebviewMessage } from "../shared/types"
import { carrotSvg } from "./carrot"
import { applyCrt, initCrt } from "./crt"
import { $ } from "./dom"
import { Change, Store, Tab } from "./state"
import { hideTip, initTooltip } from "./tooltip"
import { initDatePicker, renderRangeButtons } from "./datePicker"
import { initProjectPicker, renderProjectButton } from "./projectPicker"
import type { RangeId } from "./calendar"
import { keepFocus, wireFocus } from "./focus"
import { addDaysKey } from "./format"
import { initFiles } from "./files"
import { initLines } from "./lines"
import { renderOverview } from "./overview"
import { initCols } from "./rangeColumns"
import { initTape } from "./tape"
import { initActivity, renderActivity } from "./activityTab"
import { initHeat } from "./heatmap"
import { initCards, renderCards } from "./projectCards"
import { initExport, onExportMessage, openExport } from "./exportDialog"
import { initSettings, renderSettings } from "./settingsTab"

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

// Panels rebuild their rows on every change, including the 10 s live tick;
// keepFocus puts keyboard focus back on the element that replaced the focused one.
function render(change: Change | "tab"): void {
  keepFocus(() => {
    for (const r of bar) r(change)
    tabs[tab]?.(change)
  })
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
initProjectPicker(store)
initDatePicker(store)
bar.push(() => {
  renderProjectButton(store)
  renderRangeButtons(store)
})

// a column opens its day; "back to range" returns to where it came from
function openDay(date: string): void {
  const v = store.view
  const today = store.year?.today ?? date
  const preset: RangeId | null = date === today ? "today" : date === addDaysKey(today, -1) ? "yday" : null
  store.setView(date, date, preset, { from: v.from, to: v.to, preset: v.preset })
}
function backToRange(): void {
  const b = store.view.back
  if (b) store.setView(b.from, b.to, b.preset)
}
initTape()
initLines()
initFiles()
initCols()
wireFocus($("ov"), {
  allowProject: () => store.view.sel === "all",
  current: () => store.view.focus,
  set: f => store.setFocus(f),
})
tabs.overview = () => renderOverview(store, openDay, backToRange)

initHeat()
initActivity(store)
tabs.activity = () => renderActivity(store)

function openInOverview(id: string): void {
  store.setSelection(id)
  showTab("overview")
  window.scrollTo(0, 0)
}
initCards(store, post, () => renderCards(store, openInOverview))
tabs.projects = () => renderCards(store, openInOverview)

initExport(store, post)
extra.push(onExportMessage)
initSettings(store, post, openExport)
tabs.settings = c => renderSettings(store, c)

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

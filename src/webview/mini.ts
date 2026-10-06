// The Activity Bar sidebar's entry point: wiring and drawing only. Every
// number comes from miniModel.ts.
import type { DailyLog, ExtensionMessage, MiniMessage, YearPayload } from "../shared/types"
import { carrotSvg } from "./carrot"
import { projectPaint } from "./colors"
import { applyCrt, initCrt } from "./crt"
import { $, el, keyBox } from "./dom"
import { keepFocus, wireFocus } from "./focus"
import { HOUR, clock, fmt, weekday } from "./format"
import { MiniView, miniView } from "./miniModel"
import { initTape, setTape } from "./tape"
import { bindTip, initTooltip, tipLine } from "./tooltip"

declare function acquireVsCodeApi(): { postMessage(m: MiniMessage): void }

const vscode = acquireVsCodeApi()
let year: YearPayload | null = null
let logs: Record<string, DailyLog> = {}
let focus: string | null = null

const colorOf = (id: string): string => projectPaint(year, id).color   // glyphs
const fillOf = (id: string): string => projectPaint(year, id).fill     // boxes
const nameOf = (id: string): string => year?.projects.find(p => p.id === id)?.name ?? "unknown project"
const dimmed = (id: string): string => (focus && focus !== id ? "dim" : "")

function streak(v: MiniView): void {
  $("st-n").textContent = String(v.streak)
  $("st-days").replaceChildren(...v.marks.map(m => (m === "today"
    ? el("span", "now", v.todayMet ? "◆" : "◇")
    : el("span", m === "met" ? "hit" : "miss", m === "met" ? "■" : "□"))))
}

function today(v: MiniView, now: number): void {
  $("td-who").textContent = v.who
  $("td-t").textContent = fmt(v.todayMs)
  $("td-k").textContent = `of ${fmt(v.targetMs)}`
  const bar = el("span")
  bar.append(el("span", "on", "█".repeat(v.meter[0])), el("span", "off", "░".repeat(v.meter[1])))
  // its own item, so a narrow sidebar wraps the time under the bar rather than cutting it off
  $("td-meter").replaceChildren(bar, el("span", null, v.metAt !== null ? `daily target met at ${clock(v.metAt)}` : `${fmt(v.remainingMs)} to daily target`))
  setTape({
    sessions: v.sessions,
    base: v.baseSessions,
    perDays: 1,
    now,
    // the sidebar asks where today went across projects, so cells take the project's colour
    color: c => (c.projectId ? colorOf(c.projectId) : null),
    label: c => (c.projectId ? nameOf(c.projectId) : null),
  })
}

function lines(v: MiniView): void {
  $("ln-who").textContent = `today · ${v.who}`
  $("ln-a").textContent = `+${v.added}`
  $("ln-d").textContent = `−${v.deleted}`
}

function week(v: MiniView): void {
  $("wk-who").textContent = v.who
  const axis = el("div", "axis")
  axis.append(el("span", null, `${v.weekMax / HOUR}h`), el("span"), el("span"), el("span", null, "0"))
  $("wk-cols").replaceChildren(axis, ...v.week.map((d, i) => {
    const col = el("div", d.today && !v.focus ? "col now" : "col")
    col.dataset.i = String(i)
    if (v.focus) col.style.color = colorOf(v.focus)
    col.append(...d.rows.map(g => el("span", null, g)))
    const when = d.today ? "today" : weekday(d.date)
    bindTip(col, () => [tipLine(d.ms ? fmt(d.ms) : "no activity", v.focus ? `${when} · ${nameOf(v.focus)}, of ${fmt(d.total)}` : when)])
    return col
  }))
  $("wk-labels").replaceChildren(el("span", "gap"), ...v.week.map(d => el("span", d.today ? "now" : null, d.label)))
  $("wk-keys").replaceChildren(...v.keys.map(k => {
    const s = el("span", dimmed(k.id))
    s.dataset.hl = `p:${k.id}`
    s.tabIndex = 0
    s.append(keyBox(fillOf(k.id)), el("span", "n", k.name))
    return s
  }))
}

function projects(v: MiniView): void {
  $("pj-split").replaceChildren(...v.projects.map(p => {
    const s = el("span", dimmed(p.id))
    s.dataset.hl = `p:${p.id}`
    s.style.flex = String(p.ms)
    s.style.background = fillOf(p.id)
    return s
  }))
  $("pj-list").replaceChildren(...(v.projects.length
    ? v.projects.map(p => {
      const row = el("div", `p ${dimmed(p.id)}`.trim())
      row.dataset.hl = `p:${p.id}`
      row.tabIndex = 0
      const t = el("span", "t", fmt(p.ms))
      t.append(el("span", "pct", ` ${Math.round(p.share * 100)}%`))
      row.append(keyBox(fillOf(p.id)), el("span", "n", p.name), t)
      return row
    })
    : [el("div", "hint", "no activity yet today")]))
}

function render(): void {
  if (!year) return
  const now = Date.now()
  const v = miniView(year, logs, focus, now)
  // a focused project that vanished must stop dimming the rest, not just the legends
  focus = v.focus
  keepFocus(() => {
    streak(v)
    today(v, now)
    lines(v)
    week(v)
    projects(v)
  })
}

window.addEventListener("message", (e: MessageEvent<ExtensionMessage>) => {
  const m = e.data
  if (m.type === "settings") applyCrt(m.crt)
  else if (m.type === "mini") {
    year = m.year
    logs = m.logs
    render()
  }
})

initTooltip($("tip"))
initCrt()
initTape()
$("brand").append(carrotSvg(3))
wireFocus($("mini"), {
  allowProject: () => true,
  current: () => (focus ? { kind: "project", id: focus } : null),
  set: f => {
    focus = f && f.kind === "project" ? f.id : null
    render()
  },
})
$("open").addEventListener("click", () => vscode.postMessage({ type: "openDashboard" }))
vscode.postMessage({ type: "ready" })

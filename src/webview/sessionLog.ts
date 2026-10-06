// Sessions for a single day; one line per day for a range (the "days" card,
// which scrolls on its own).
import type { ActivitySession } from "../shared/types"
import { Names, Paint, langPaint } from "./colors"
import { $, el, keyBox } from "./dom"
import { clock, dstr, fmt, plural, shortDate, weekday } from "./format"
import type { DayView, Focus } from "./model"
import { hlOf } from "./focus"
import { bindTip, tipLine, tipSub } from "./tooltip"

export interface LogOpts {
  multi: boolean
  focus: Focus
  focusName: string
  colors: Map<string, Paint>
  names: Names
  now: number
}
export interface DaysOpts extends LogOpts { byProject: (date: string) => [string, number][] }

function sessionBar(s: ActivitySession, o: LogOpts): HTMLElement {
  const bar = el("span", "langs")
  const langs = Object.entries(s.languages ?? {}).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1])
  if (!langs.length) {
    // recorded before per-session languages: the project's colour stands in
    const b = el("span")
    b.style.flex = "1"
    b.style.background = o.names.paint(s.projectId ?? "").fill
    bar.append(b)
    return bar
  }
  for (const [name, ms] of langs) {
    const b = el("span")
    b.dataset.hl = "l:" + name
    b.style.flex = String(ms)
    b.style.background = langPaint(o.colors, name).fill
    if (o.focus?.kind === "language" && o.focus.id !== name) b.style.opacity = ".15"
    bar.append(b)
  }
  return bar
}

export function renderSessions(sessions: ActivitySession[], o: LogOpts): void {
  const host = $("log")
  host.classList.remove("daylog")
  host.classList.toggle("multi", o.multi)
  const f = o.focus
  host.replaceChildren(...sessions.map(s => {
    const off = !!f && (f.kind === "project" ? s.projectId !== f.id : !s.languages?.[f.id])
    const li = el("li", off ? "dim" : null)
    const end = s.endTime ?? o.now
    li.append(el("span", "when", `${clock(s.startTime)}–${clock(end)}`), el("span", "dur", fmt(s.activeTime)), sessionBar(s, o))
    if (o.multi && s.projectId) {
      const pj = el("span", "pj")
      pj.dataset.hl = "p:" + s.projectId
      pj.append(keyBox(o.names.paint(s.projectId).fill), o.names.project(s.projectId))
      li.append(pj)
    }
    const langs = Object.entries(s.languages ?? {}).sort((a, b) => b[1] - a[1])
    bindTip(li, () => [
      tipLine(`${fmt(s.activeTime)} active`, `${clock(s.startTime)}–${clock(end)}` + (o.multi && s.projectId ? ` · ${o.names.project(s.projectId)}` : "")),
      ...langs.map(([name, ms]) => tipSub(`${name} ${fmt(ms)}`)),
    ])
    return li
  }))
  if (!sessions.length) host.append(el("li", "hint", "no sessions"))
}

export function renderDays(days: DayView[], o: DaysOpts): void {
  const host = $("log")
  host.classList.add("daylog")
  host.classList.remove("multi")
  const f = o.focus
  const maxDay = Math.max(1, ...days.map(d => d.whole.activeMs))
  host.replaceChildren(...days.slice().reverse().map(d => {
    const ms = d.shown.activeMs
    const li = el("li", f && !ms ? "dim" : null)
    // One bar per day, as long as the whole day; split by project (all projects)
    // or by language. A focus dims the other segments rather than redrawing the
    // bar: a segment that shrank or moved out from under the pointer cleared the
    // focus, which redrew it under the pointer again — a hover vibrated.
    const segs: [string, number, string][] = o.multi
      ? o.byProject(d.date).map(([id, v]) => ["p:" + id, v, o.names.paint(id).fill] as [string, number, string])
      : d.whole.languages.map(l => ["l:" + l.name, l.ms, langPaint(o.colors, l.name).fill] as [string, number, string])
    const track = el("span", "dtrack")
    const bar = el("span", "dbar")
    bar.style.width = `${segs.reduce((n, s) => n + s[1], 0) / maxDay * 100}%`
    for (const [hl, v, color] of segs) {
      const seg = el("span")
      seg.dataset.hl = hl
      seg.style.flex = String(v)
      seg.style.background = color
      if (f && hl.startsWith(f.kind === "project" ? "p:" : "l:") && hl !== hlOf(f)) seg.style.opacity = ".15"
      bar.append(seg)
    }
    track.append(bar)
    li.append(el("span", "when", `${weekday(d.date)} ${shortDate(d.date)}`), el("span", ms ? "dur" : "dur z", ms ? fmt(ms) : "·"), d.whole.activeMs ? track : el("span"))
    bindTip(li, () => {
      if (!ms) return [tipLine("no activity", dstr(d.date))]
      const ss = d.shown.sessions
      const out = [tipLine(`${fmt(ms)} active`, (f ? `${o.focusName} · ` : "") + dstr(d.date))]
      if (ss.length) out.push(tipSub(`${plural(ss.length, "session")}, ${clock(ss[0].startTime)}–${clock(ss[ss.length - 1].endTime ?? o.now)}`))
      if (o.multi) for (const [id, v] of o.byProject(d.date)) out.push(tipSub(`${o.names.project(id)} ${fmt(v)}`))
      else for (const l of d.shown.languages.slice(0, 3)) out.push(tipSub(`${l.name} ${fmt(l.ms)}`))
      return out
    })
    return li
  }))
}

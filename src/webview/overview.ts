// The overview tab: one day or a range, every panel narrowed by the hover focus.
// It reads the store and hands each panel numbers from model.ts.
import type { ActivitySession } from "../shared/types"
import { langPaint, languagePaints, namesFor } from "./colors"
import { $, el, keyBox, kv } from "./dom"
import { renderFiles } from "./files"
import { hlOf, lockHeights } from "./focus"
import { MIN, addDaysKey, clock, dstr, fmt, fromKey, hours, pct, shortDate, weekday } from "./format"
import { renderLangs } from "./languages"
import { meter } from "./layout"
import { renderLines, setLineTotals } from "./lines"
import { TapeCell, buildView, lineRows, seriesFor, targetMetAt } from "./model"
import { renderCols } from "./rangeColumns"
import { renderDays, renderSessions } from "./sessionLog"
import type { Store } from "./state"
import { renderStreak } from "./streak"
import { setTape } from "./tape"

function hlKey(hl: string, fill: string, label: string): HTMLElement {
  const s = el("span")
  s.dataset.hl = hl
  s.tabIndex = 0
  s.append(keyBox(fill), label)
  return s
}

export function renderOverview(store: Store, openDay: (date: string) => void, back: () => void): void {
  const year = store.year
  const range = store.days()
  const status = $("ov-status")
  if (!year || !range) {
    status.hidden = false
    status.textContent = store.refused ? "That range can't be shown: pick at most 92 days." : "loading…"
    return
  }
  status.hidden = true

  const { sel, focus, from, to } = store.view
  const now = Date.now()
  const names = namesFor(year)
  const view = buildView(range, sel, focus)
  const n = view.days.length
  const single = n === 1
  const multi = sel === "all"
  const isToday = single && from === year.today
  const series = seriesFor(year, sel)
  const targetOn = (date: string): number => {
    const i = series.days.indexOf(date)
    return i >= 0 ? series.targetMs[i] : series.targetMs[series.targetMs.length - 1] ?? year.globalTargetMs
  }
  const colors = languagePaints(view.wholeLanguages)
  const focusName = !focus ? "" : focus.kind === "project" ? names.project(focus.id) : focus.id
  const focusColor = !focus ? null : (focus.kind === "project" ? names.paint(focus.id) : langPaint(colors, focus.id)).color
  const yearIndex = new Map(year.days.map((d, i) => [d, i] as [string, number]))
  // per-project active ms on a date, from the year: what the columns and the streak count
  const byProject = (date: string): [string, number][] => {
    const i = yearIndex.get(date)
    if (i === undefined) return []
    return year.projects.filter(p => (multi || p.id === sel) && p.active[i] > 0).map(p => [p.id, p.active[i]] as [string, number])
  }
  const metDays = view.days.filter(d => d.whole.activeMs >= targetOn(d.date)).length

  if (!focus) lockHeights($("ov"), false)
  renderStreak(year, sel)

  $("hero-k").textContent = single ? "day" : "range"
  $("hero-when").textContent = (single ? dstr(from) : `${dstr(from)} – ${dstr(to)} · ${n} days`)
    + (multi ? " · all projects" : "") + (focus ? ` · ${focusName} only` : "")
  $("cols-wrap").hidden = single
  $("tod-k").hidden = single
  const head = $("hero-head")
  const target = $("target")
  const leg = $("tape-legend")
  leg.replaceChildren()
  let tapeSessions: ActivitySession[]
  let tapeBase: ActivitySession[]
  let perDays = 1

  if (single) {
    const day = view.days[0]
    const ss = day.whole.sessions
    head.replaceChildren(el("div", "big", fmt(day.shown.activeMs)))
    if (ss.length) {
      const lastSession = ss[ss.length - 1]
      head.append(kv("sessions", ss.length), kv("first keystroke", clock(ss[0].startTime)), kv("last", clock(lastSession.endTime ?? now)))
    } else {
      head.append(el("span", "kv", multi ? "no activity this day" : `no activity in ${names.project(sel)} this day`))
    }
    const active = byProject(day.date)
    if (multi && active.length) head.append(kv("projects", active.length))
    if (store.view.back) {
      const b = el("button", "btn", "back to range")
      b.addEventListener("click", back)
      head.append(b)
    }
    if (focus) {
      target.replaceChildren(`${focusName}: `, el("b", null, fmt(day.shown.activeMs)),
        ` of ${fmt(day.whole.activeMs)} that day (${pct(day.shown.activeMs, day.whole.activeMs)}%)`)
    } else {
      const T = targetOn(day.date)
      const [on, off] = meter(day.whole.activeMs, T)
      const bar = el("span", "meter", "█".repeat(on))
      bar.append(el("i", null, "░".repeat(off)))
      const metAt = targetMetAt(ss, T, now)
      target.replaceChildren(`target ${Math.round(T / MIN)}m `, bar, metAt !== null ? ` met at ${clock(metAt)}` : ` ${fmt(T - day.whole.activeMs)} short`)
    }
    tapeSessions = day.shown.sessions
    tapeBase = ss
  } else {
    const activeDays = view.days.filter(d => d.shown.activeMs > 0)
    const best = view.days.reduce((b, d) => (d.shown.activeMs > b.shown.activeMs ? d : b), view.days[0])
    head.replaceChildren(
      el("div", "big", hours(view.totalMs)),
      kv("active days", `${activeDays.length}/${n}`),
      kv("per active day", fmt(view.totalMs / Math.max(1, activeDays.length))),
      kv("best", best.shown.activeMs ? `${weekday(best.date)} ${shortDate(best.date)}, ${fmt(best.shown.activeMs)}` : "—"),
    )
    renderCols(view.days.map(d => ({
      date: d.date,
      shownMs: d.shown.activeMs,
      wholeMs: d.whole.activeMs,
      targetMs: targetOn(d.date),
      sessions: d.shown.sessions.length,
      added: d.shown.linesAdded,
      deleted: d.shown.linesDeleted,
      byProject: multi && !focus ? byProject(d.date) : [],
    })), { today: year.today, focusColor, focusName: focus ? focusName : null, projName: names.project, onOpen: openDay })
    if (focus) {
      target.replaceChildren(`${focusName}: `, el("b", null, hours(view.totalMs)),
        ` of ${hours(view.wholeMs)} in the range (${pct(view.totalMs, view.wholeMs)}%)`)
    } else {
      target.replaceChildren(`target ${Math.round(targetOn(to) / MIN)}m · met on `, el("b", null, String(metDays)), ` of ${n} days`)
    }
    // The column keys mean nothing under a focus, but they stay in the layout:
    // removing them slid every project and language key along, so the key under
    // a still pointer changed, which changed the focus back — a hover vibrated.
    for (const [cls, text] of [["met", "target met"], ["under", "under target"], ["now", "today"]]) {
      if (cls === "now" && to !== year.today) continue
      const s = el("span", focus ? "ghost" : null)
      s.append(el("i", cls), text)
      leg.append(s)
    }
    const wholeActive = view.days.filter(d => d.whole.activeMs > 0)
    tapeSessions = activeDays.flatMap(d => d.shown.sessions)
    tapeBase = wholeActive.flatMap(d => d.whole.sessions)
    perDays = Math.max(1, wholeActive.length)
  }

  // legend: projects (all projects only), the three biggest languages, the tape's key
  if (multi) {
    for (const p of year.projects) {
      if (view.days.some(d => byProject(d.date).some(([id]) => id === p.id))) leg.append(hlKey("p:" + p.id, names.paint(p.id).fill, p.name))
    }
  }
  for (const l of view.wholeLanguages.slice(0, 3)) leg.append(hlKey("l:" + l.name, langPaint(colors, l.name).fill, l.name))
  if (focus) {
    leg.querySelectorAll<HTMLElement>("[data-hl]").forEach(s => {
      const on = s.dataset.hl === hlOf(focus)
      s.classList.toggle("dim", !on)
      s.classList.toggle("focus", on)
    })
  }
  const keyNode = el("span")
  keyNode.id = "tape-key"
  leg.append(keyNode)
  const cellColor = (c: TapeCell): string | null => {
    if (focus?.kind === "project") return names.paint(focus.id).color
    if (c.language) return langPaint(colors, c.language).color
    return c.projectId ? names.paint(c.projectId).color : null   // sessions recorded before per-session languages
  }
  setTape({
    sessions: tapeSessions,
    base: tapeBase,
    perDays,
    now,
    color: cellColor,
    label: c => c.language ?? (c.projectId ? names.project(c.projectId) : null),
  })

  setLineTotals(view.linesAdded, view.linesDeleted)
  if (single) {
    const week = store.days(addDaysKey(to, -6), to)
    const days = week ? buildView(week, sel, focus).days : view.days
    $("lines-when").textContent = `net per file, ${isToday ? "today" : dstr(from)}`
    renderLines(days.map(d => ({ label: weekday(d.date), added: d.shown.linesAdded, deleted: d.shown.linesDeleted, now: d.date === to, sub: dstr(d.date) })), false)
  } else if (n <= 14) {
    $("lines-when").textContent = `net per file, ${n} days`
    renderLines(view.days.map(d => ({
      label: `${weekday(d.date)} ${fromKey(d.date).getDate()}`,
      added: d.shown.linesAdded,
      deleted: d.shown.linesDeleted,
      now: d.date === year.today,
      sub: dstr(d.date),
    })), true)
  } else {
    $("lines-when").textContent = `net per file, ${n} days · one row per week`
    renderLines(lineRows(view.days).map(r => ({
      label: shortDate(r.from), added: r.added, deleted: r.deleted, now: false, sub: `${shortDate(r.from)} – ${shortDate(r.to)}`,
    })), true)
  }

  $("lang-when").textContent = single ? "" : `${n} days`
  const langFocus = focus?.kind === "language" ? focus.id : null
  renderLangs(langFocus ? view.wholeLanguages : view.languages, view.wholeLanguages, langFocus ? view.wholeMs : view.totalMs,
    single ? (isToday ? "today" : "the day") : "the range", langFocus, colors)

  $("files-when").textContent = single ? "git diff --stat" : `git diff --stat ${shortDate(from).toLowerCase()}..${shortDate(to).toLowerCase()}`
  renderFiles(view.files, multi, names)

  const logOpts = { multi, focus, focusName, colors, names, now }
  if (single) {
    $("log-k").textContent = "sessions"
    $("log-when").textContent = ""
    renderSessions(view.days[0].whole.sessions, logOpts)
  } else {
    $("log-k").textContent = "days"
    $("log-when").textContent = "newest first"
    renderDays(view.days, { ...logOpts, byProject })
  }

  const sr = $("streak-range")
  sr.hidden = single
  if (!single) sr.textContent = `In this range the target was met on ${metDays} of ${n} days.`
}

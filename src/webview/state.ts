// View state and the message cache for the dashboard. No DOM: the webview's
// postMessage is injected, so the request rules are tested in node.
import type { CrtSettings, DailyLog, ExtensionMessage, RangePayload, WebviewMessage, YearPayload } from "../shared/types"
import { RangeId, presetRange } from "./calendar"
import { addDaysKey } from "./format"
import { Focus, Selection, mergeLive } from "./model"

export type Tab = "overview" | "activity" | "projects" | "settings"
export interface Settings {
  dailyTargetMs: number
  dailyTargetMinutes: number
  idleThresholdMinutes: number
  storagePath: string
  crt: CrtSettings
  lineNotes?: string[]
}
export interface Back { from: string; to: string; preset: RangeId | null }
export interface ViewState {
  sel: Selection
  from: string
  to: string
  preset: RangeId | null        // the pressed range button; null = a picked range
  back: Back | null             // set while a day opened from a range is shown
  focus: Focus
}
export interface ConsoleLine { cls: "cmd" | "ok" | "bad" | ""; text: string }
export type Change = "year" | "days" | "focus" | "settings" | "console"

const CONSOLE_LINES = 9

export function subRange(range: RangePayload, from: string, to: string): RangePayload | null {
  if (from < range.from || to > range.to) return null
  const logs: Record<string, DailyLog[]> = {}
  for (const [id, list] of Object.entries(range.logs)) logs[id] = list.filter(l => l.date >= from && l.date <= to)
  return { from, to, logs }
}

// A single day still needs the six before it: the lines panel shows its week.
export function fetchSpan(from: string, to: string): { from: string; to: string } {
  const weekStart = addDaysKey(to, -6)
  return { from: from < weekStart ? from : weekStart, to }
}

export class Store {
  year: YearPayload | null = null
  settings: Settings | null = null
  here: string | null = null    // the project this window is working in, from live updates
  refused = false
  console: ConsoleLine[] = []
  private notesShown = new Set<string>()
  view: ViewState = { sel: "all", from: "", to: "", preset: "today", back: null, focus: null }
  private range: RangePayload | null = null
  private askedFor: string | null = null   // the unknown live project a year was last requested for
  private readonly listeners: ((c: Change) => void)[] = []

  constructor(private readonly post: (m: WebviewMessage) => void) {}

  on(fn: (c: Change) => void): void { this.listeners.push(fn) }
  private emit(c: Change): void { for (const fn of this.listeners) fn(c) }

  // Logs for from..to (the view by default), or null while they are being fetched.
  days(from = this.view.from, to = this.view.to): RangePayload | null {
    return this.range && from ? subRange(this.range, from, to) : null
  }

  setView(from: string, to: string, preset: RangeId | null, back: Back | null = null): void {
    this.view = { ...this.view, from, to, preset, back, focus: null }
    this.refused = false
    const span = fetchSpan(from, to)
    if (!this.range || !subRange(this.range, span.from, span.to)) this.post({ type: "requestDays", ...span })
    this.emit("days")
  }

  setSelection(sel: Selection): void {
    if (sel === this.view.sel) return
    this.view = { ...this.view, sel, focus: null }
    this.emit("year")
  }

  setFocus(focus: Focus): void {
    this.view = { ...this.view, focus }
    this.emit("focus")
  }

  note(cls: ConsoleLine["cls"], text: string): void {
    this.console.push({ cls, text })
    while (this.console.length > CONSOLE_LINES) this.console.shift()
    this.emit("console")
  }

  receive(msg: ExtensionMessage): void {
    switch (msg.type) {
      case "year": {
        const { type: _type, ...year } = msg
        const prev = this.year
        this.year = year
        if (this.view.sel !== "all" && !year.projects.some(p => p.id === this.view.sel)) this.view = { ...this.view, sel: "all" }
        // A year arrives on open, and again whenever stored data changed (a
        // wipe, an import, a new target) or the date did. A preset view moves
        // with the date; a picked range stays put. Either way it is refetched.
        const moved = !prev || prev.today !== year.today
        const preset = prev ? this.view.preset : "today"
        const r = moved && preset ? presetRange(preset, year.today) : { from: this.view.from, to: this.view.to }
        this.view = { ...this.view, from: r.from, to: r.to, preset, back: moved ? null : this.view.back, focus: null }
        this.post({ type: "requestDays", ...fetchSpan(r.from, r.to) })
        this.emit("year")
        break
      }
      case "range": {
        if (msg.for) break   // the export dialog's own fetch
        // a reply to an older request is dropped unless it still covers the view
        const span = fetchSpan(this.view.from, this.view.to)
        if (msg.from > span.from || msg.to < span.to) break
        this.range = { from: msg.from, to: msg.to, logs: msg.logs }
        this.emit("days")
        break
      }
      case "rangeRefused": {
        if (msg.for) break
        const span = fetchSpan(this.view.from, this.view.to)
        if (msg.from === span.from && msg.to === span.to) {
          this.refused = true
          this.emit("days")
        }
        break
      }
      case "live": {
        const { type: _type, ...live } = msg
        this.here = live.projectId || null
        if (!this.year) break
        // Once per project: after a wipe the tracker's project stays unregistered
        // until a reload, and the fresh year still won't list it.
        if (!mergeLive(this.year, this.range, live) && this.askedFor !== live.projectId) {
          this.askedFor = live.projectId
          this.post({ type: "requestYear" })
        }
        this.emit("year")
        break
      }
      case "settings": {
        const { type: _type, ...settings } = msg
        this.settings = settings
        for (const n of settings.lineNotes ?? []) {
          if (this.notesShown.has(n)) continue
          this.notesShown.add(n)
          this.note("bad", n)
        }
        this.emit("settings")
        break
      }
      case "actionResult":
        for (const line of msg.lines) this.note(msg.ok ? "ok" : "bad", line)
        break
    }
  }
}

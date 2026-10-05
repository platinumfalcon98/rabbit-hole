// The export dialog: format, range, project, the file name it will suggest,
// and a live preview (the share card itself, or the report's outline). It
// fetches the last 90 days once when opened, tagged so the dashboard ignores
// the reply, and every option then renders from that without waiting.
import type { ExtensionMessage, RangePayload, WebviewMessage } from "../shared/types"
import { ExportExt, exportFileName } from "../shared/exportName"
import { $, el, press } from "./dom"
import { reportOutline } from "./exportLayout"
import { ExportData, Format, SPANS, SPAN_DAYS, Span, exportData, fitSpan, rangeText, spanDates } from "./exportModel"
import { dstr } from "./format"
import type { Selection } from "./model"
import { reportPdf } from "./reportPdf"
import { cardFontsReady, cardJpegBase64, drawCard } from "./shareCard"
import type { Store } from "./state"

const EXT: Record<Format, ExportExt> = { card: "jpg", report: "pdf", csv: "csv", json: "json" }
const NAME: Record<Format, string> = { card: "share card", report: "report", csv: "csv", json: "json" }
const WHAT: Record<Format, string> = {
  card: "a 420×620 image to post, drawn at 3×",
  report: "an A4 PDF to keep or print",
  csv: "one row per day: date, totalTime, activeTime, streak, linesAdded, linesDeleted (times in ms)",
  json: "the daily logs in full: sessions with their languages, files and languages",
}

let store: Store | null = null
let post: ((m: WebviewMessage) => void) | null = null
let format: Format = "card"
let span: Span = "today"
let sel: Selection = "all"
let data: RangePayload | null = null
let failed = false
let busy = false
let fetchedFor = ""   // the day the 90 days end on; a new day refetches

const isOpen = (): boolean => !$("xd").hidden

function window90(): { from: string; to: string } | null {
  return store?.year ? spanDates("90d", store.year.today) : null
}

function fetchData(): void {
  const w = window90()
  if (!w || !post) return
  data = null
  failed = false
  fetchedFor = w.to
  post({ type: "requestDays", ...w, for: "export" })
}

function title(): string {
  if (sel === "all") return "all projects"
  return store?.year?.projects.find(p => p.id === sel)?.name ?? "unknown project"
}

function current(): ExportData | null {
  const y = store?.year
  return y && data ? exportData(data, y, sel, span, Date.now()) : null
}

function status(text: string, bad = false): void {
  const s = $("xd-status")
  s.textContent = text
  s.classList.toggle("bad", bad)
}

function buildProjects(): void {
  const y = store?.year
  if (!y) return
  if (sel !== "all" && !y.projects.some(p => p.id === sel)) sel = "all"
  $("xd-project").replaceChildren(...[{ id: "all", name: "all projects" }, ...y.projects].map(p => {
    const b = el("button", null, p.name)
    b.dataset.v = p.id
    return b
  }))
}

function render(): void {
  const y = store?.year
  if (!y) return
  span = fitSpan(format, span)
  press($("xd-format"), b => b.dataset.v === format)
  press($("xd-range"), b => b.dataset.v === span)
  press($("xd-project"), b => b.dataset.v === sel)
  $("xd-format").querySelectorAll<HTMLButtonElement>("button").forEach(b => { b.disabled = busy })
  $("xd-project").querySelectorAll<HTMLButtonElement>("button").forEach(b => { b.disabled = busy })
  $("xd-range").querySelectorAll<HTMLButtonElement>("button").forEach(b => {
    b.disabled = busy || !SPANS[format].includes(b.dataset.v as Span)
  })
  $("xd-what").textContent = WHAT[format]
  const { from, to } = spanDates(span, y.today)
  $("xd-dest").textContent = `${exportFileName(title(), to, SPAN_DAYS[span], EXT[format])}, in a folder you pick`
  $("xd-head").replaceChildren(el("b", null, NAME[format]), el("span", null, span === "today" ? dstr(to) : `${dstr(from)} – ${dstr(to)}`), el("span", null, title()))

  const drawn = format === "card" || format === "report"
  $<HTMLButtonElement>("xd-go").disabled = busy || (drawn && !data)
  const pv = $("xd-preview")
  if (!drawn) {
    pv.replaceChildren(el("p", "hint", "written by the extension from your stored data; nothing to preview"))
    return
  }
  if (failed) {
    pv.replaceChildren(el("p", "hint bad", "couldn't load the data for this export"))
    return
  }
  const d = current()
  if (!d) {
    pv.replaceChildren(el("p", "hint", "loading…"))
    return
  }
  if (format === "card") {
    const canvas = pv.querySelector<HTMLCanvasElement>("canvas") ?? el("canvas")
    canvas.setAttribute("role", "img")
    canvas.setAttribute("aria-label", `share card preview: ${d.title}, ${rangeText(d)}`)
    drawCard(canvas, d)
    if (canvas.parentElement !== pv) pv.replaceChildren(canvas)
    return
  }
  const list = el("ul", "xd-outline")
  for (const p of reportOutline(d)) {
    list.append(el("li", "pg", `page ${p.page}`))
    for (const item of p.items) list.append(el("li", null, item))
  }
  pv.replaceChildren(list)
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function go(): Promise<void> {
  const s = store
  const p = post
  const y = s?.year
  if (!s || !p || !y || busy) return
  const { from, to } = spanDates(span, y.today)
  const name = exportFileName(title(), to, SPAN_DAYS[span], EXT[format])
  s.note("cmd", `rabbithole export --${format} --${span}${sel === "all" ? "" : ` --project ${title()}`}`)
  busy = true
  status(format === "card" || format === "report" ? "drawing…" : "saving…")
  render()
  try {
    if (format === "csv" || format === "json") {
      p({ type: "export", format, from, to, projectId: sel === "all" ? undefined : sel, name })
    } else {
      const d = current()
      if (!d) throw new Error("the data hasn't arrived yet")
      const base64 = format === "card" ? await cardJpegBase64(d) : toBase64(reportPdf(d))
      p({ type: "writeFile", kind: format === "card" ? "jpg" : "pdf", base64, name })
    }
    status("choose where to save it…")
  } catch (err) {
    busy = false
    status(`export failed: ${err instanceof Error ? err.message : String(err)}`, true)
    render()
  }
}

// Runs before the store sees each message (main.ts `extra`).
export function onExportMessage(msg: ExtensionMessage): void {
  if ((msg.type === "range" || msg.type === "rangeRefused") && msg.for === "export") {
    const w = window90()
    if (!w || msg.from !== w.from || msg.to !== w.to) return   // asked for before midnight
    if (msg.type === "range") data = { from: msg.from, to: msg.to, logs: msg.logs }
    else failed = true
    if (isOpen()) render()
    return
  }
  if (msg.type === "actionResult" && busy) {
    busy = false
    status(msg.lines.join(" "), !msg.ok)
    if (isOpen()) render()
  }
}

export function openExport(): void {
  const s = store
  if (!s?.year) return
  sel = s.view.sel
  busy = false
  status("")
  buildProjects()
  fetchData()
  $("xd").hidden = false
  render()
  void cardFontsReady().then(() => { if (isOpen()) render() })
  $("xd-format").querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
}

function closeExport(): void {
  $("xd").hidden = true
  data = null
}

export function initExport(s: Store, p: (m: WebviewMessage) => void): void {
  store = s
  post = p
  const pick = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLButtonElement>("button[data-v]") : null)
  const onPick = (id: string, set: (v: string) => void) => $(id).addEventListener("click", e => {
    const b = pick(e.target)
    if (!b || b.disabled || busy) return
    set(b.dataset.v ?? "")
    status("")
    render()
  })
  onPick("xd-format", v => { format = v as Format })
  onPick("xd-range", v => { span = v as Span })
  onPick("xd-project", v => { sel = v })
  $("xd-cancel").addEventListener("click", closeExport)
  $("xd-go").addEventListener("click", () => { void go() })
  $("xd").addEventListener("click", e => { if (e.target === $("xd")) closeExport() })
  window.addEventListener("keydown", e => { if (e.key === "Escape" && isOpen()) closeExport() })
  // a new day while the dialog is open: the 90 days end on the new today
  s.on(change => {
    if (change === "year" && isOpen() && s.year && s.year.today !== fetchedFor) {
      buildProjects()
      fetchData()
      render()
    }
  })
}

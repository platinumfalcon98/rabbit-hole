// Interim export dialog. Phase 3 replaces the share card and report renderers
// and adds the live card preview; until then the card is today only and the
// report today, 30 or 90 days, through the existing generators. CSV and JSON
// go through the host's ranged export.
import type { ExtensionMessage, WebviewMessage } from "../shared/types"
import { $, el, press } from "./dom"
import type { ExportOptions, ReportPreset } from "./exportShared"
import { addDaysKey } from "./format"
import { generateJpg } from "./jpgExport"
import { generateReportPdf } from "./pdfExport"
import type { Store } from "./state"

type Format = "card" | "report" | "csv" | "json"
type Span = "today" | "7d" | "30d" | "90d"

const SPANS: Record<Format, Span[]> = {
  card: ["today"],
  report: ["today", "30d", "90d"],
  csv: ["today", "7d", "30d", "90d"],
  json: ["today", "7d", "30d", "90d"],
}
const BACK: Record<Span, number> = { today: 0, "7d": 6, "30d": 29, "90d": 89 }
const WHAT: Record<Format, string> = {
  card: "A 420×620 JPG of today's numbers, for sharing.",
  report: "A multi-page PDF report.",
  csv: "The raw daily data as CSV.",
  json: "The raw daily logs, sessions included, as JSON.",
}

let format: Format = "card"
let span: Span = "today"
let waiting = false
let store: Store | null = null
let post: ((m: WebviewMessage) => void) | null = null

function render(): void {
  press($("xd-format"), b => b.dataset.v === format)
  if (!SPANS[format].includes(span)) span = SPANS[format][0]
  $("xd-range").replaceChildren(...SPANS[format].map(s => {
    const b = el("button", null, s)
    b.dataset.v = s
    b.setAttribute("aria-pressed", String(s === span))
    return b
  }))
  $("xd-what").textContent = WHAT[format]
}

function resetGo(): void {
  const go = $<HTMLButtonElement>("xd-go")
  go.disabled = false
  go.textContent = "export"
}

function closeExport(): void {
  $("xd").hidden = true
  waiting = false
  resetGo()
}

export function openExport(): void {
  const s = store
  if (!s?.year) return
  const sel = $<HTMLSelectElement>("xd-project")
  const all = el("option", null, "all projects")
  all.value = "all"
  sel.replaceChildren(all, ...s.year.projects.map(p => {
    const o = el("option", null, p.name)
    o.value = p.id
    return o
  }))
  sel.value = s.view.sel
  resetGo()
  render()
  $("xd").hidden = false
  $("xd-format").querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
}

function go(): void {
  const s = store
  const p = post
  if (!s?.year || !p) return
  const sel = $<HTMLSelectElement>("xd-project")
  const projectId = sel.value
  const who = projectId === "all" ? "" : ` --project ${sel.selectedOptions[0]?.textContent ?? projectId}`
  s.note("cmd", `rabbithole export --${format} --${span}${who}`)
  if (format === "csv" || format === "json") {
    const to = s.year.today
    p({ type: "export", format, from: addDaysKey(to, -BACK[span]), to, projectId: projectId === "all" ? undefined : projectId })
    closeExport()
    return
  }
  waiting = true
  const b = $<HTMLButtonElement>("xd-go")
  b.disabled = true
  b.textContent = "generating…"
  p({ type: "exportPdfRequest", preset: span, exportProjectId: projectId })
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// The host answers exportPdfRequest with pdfData; render it and hand the file back.
export function onExportData(msg: ExtensionMessage): void {
  if (msg.type !== "pdfData" || !waiting) return
  const s = store
  const p = post
  if (!s || !p) return
  waiting = false
  const preset: ReportPreset = span === "30d" || span === "90d" ? span : "today"
  const options: ExportOptions = {
    projectName: msg.projectName,
    dateRange: msg.dateRange,
    isToday: preset === "today",
    preset,
    projectNames: Object.fromEntries((s.year?.projects ?? []).map(q => [q.id, q.name])),
  }
  const fail = (err: unknown) => {
    resetGo()
    s.note("bad", `export failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (format === "report") {
    try {
      p({ type: "writePdf", base64: toBase64(generateReportPdf(msg.logs, options)), projectName: msg.projectName })
      closeExport()
    } catch (err) {
      fail(err)
    }
  } else {
    generateJpg(msg.logs, options).then(url => {
      p({ type: "writeJpg", base64: url.split(",")[1], projectName: msg.projectName })
      closeExport()
    }, fail)
  }
}

export function initExport(s: Store, p: (m: WebviewMessage) => void): void {
  store = s
  post = p
  const pick = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLButtonElement>("button[data-v]") : null)
  $("xd-format").addEventListener("click", e => {
    const b = pick(e.target)
    if (b && !waiting) {
      format = b.dataset.v as Format
      render()
    }
  })
  $("xd-range").addEventListener("click", e => {
    const b = pick(e.target)
    if (b && !waiting) {
      span = b.dataset.v as Span
      render()
    }
  })
  $("xd-cancel").addEventListener("click", closeExport)
  $("xd-go").addEventListener("click", go)
  $("xd").addEventListener("click", e => { if (e.target === $("xd")) closeExport() })
  window.addEventListener("keydown", e => { if (e.key === "Escape" && !$("xd").hidden) closeExport() })
}

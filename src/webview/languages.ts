// Languages: the unfocused view's rows, most lines changed first, always in the
// same order, so a hover never moves anything. Colours still rank by time (the
// model's order), so sorting here recolours nothing. Under a language focus the
// other rows dim; under a project focus each row shows that project's share.
import { Paint, langPaint } from "./colors"
import { $, el, keyBox } from "./dom"
import { HOUR, fmt, hours, pct } from "./format"
import type { LangRow } from "./model"
import { bindTip, tipLine, tipSub } from "./tooltip"

const LANG_ROWS = 10

const lines = (l: LangRow) => l.added + l.deleted
const byLinesDesc = (a: LangRow, b: LangRow) => lines(b) - lines(a) || b.ms - a.ms || a.name.localeCompare(b.name)

export function renderLangs(values: LangRow[], base: LangRow[], totalMs: number, scope: string, focusLang: string | null, colors: Map<string, Paint>): void {
  const host = $("lang")
  const shown = [...base].sort(byLinesDesc).slice(0, LANG_ROWS)
  const maxLines = Math.max(1, ...shown.map(lines))
  const many = totalMs >= 10 * HOUR
  const rows = shown.map(b => values.find(v => v.name === b.name) ?? { name: b.name, ms: 0, added: 0, deleted: 0 })
  host.classList.toggle("wide", rows.some(l => l.added >= 1000 || l.deleted >= 1000))
  const hdr = el("div", "row hdr")
  hdr.append(el("span", null, "language"), el("span"), el("span", "l", "lines"), el("span", "t", "time"))
  host.replaceChildren(hdr, ...rows.map(l => {
    const row = el("div", focusLang && focusLang !== l.name ? "row dim" : "row")
    row.dataset.hl = "l:" + l.name
    const paint = langPaint(colors, l.name)
    const name = el("span", "name")
    name.append(keyBox(paint.fill), l.name)
    const track = el("span", "track")
    const fill = el("span", "fill")
    fill.style.width = `${lines(l) / maxLines * 100}%`
    fill.style.background = paint.fill
    track.append(fill)
    row.append(name, track, el("span", "l", lines(l) ? `+${l.added} −${l.deleted}` : "·"), el("span", "t", l.ms ? (many ? hours(l.ms) : fmt(l.ms)) : "·"))
    bindTip(row, () => [tipLine(fmt(l.ms), l.name), tipSub(`${pct(l.ms, totalMs)}% of ${scope} · +${l.added} −${l.deleted} lines`)])
    return row
  }))
  if (!rows.length) host.append(el("div", "hint", "no activity"))
  if (base.length > LANG_ROWS) host.append(el("div", "hint", `${base.length - LANG_ROWS} more languages`))
}

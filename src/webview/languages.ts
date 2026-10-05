// Languages: the unfocused view's rows, always in the same order, so a hover
// never moves anything. Under a language focus the other rows dim; under a
// project focus each row shows that project's share.
import { langColor } from "./colors"
import { $, el, keyBox } from "./dom"
import { HOUR, fmt, hours, pct } from "./format"
import type { LangRow } from "./model"
import { bindTip, tipLine, tipSub } from "./tooltip"

const LANG_ROWS = 10

export function renderLangs(values: LangRow[], base: LangRow[], totalMs: number, scope: string, focusLang: string | null, colors: Map<string, string>): void {
  const host = $("lang")
  const shown = base.slice(0, LANG_ROWS)
  const maxMs = Math.max(1, ...shown.map(l => l.ms))
  const many = totalMs >= 10 * HOUR
  const rows = shown.map(b => values.find(v => v.name === b.name) ?? { name: b.name, ms: 0, added: 0, deleted: 0 })
  host.classList.toggle("wide", rows.some(l => l.added >= 1000 || l.deleted >= 1000))
  const hdr = el("div", "row hdr")
  hdr.append(el("span", null, "language"), el("span"), el("span", "t", "time"), el("span", "l", "lines"))
  host.replaceChildren(hdr, ...rows.map(l => {
    const row = el("div", focusLang && focusLang !== l.name ? "row dim" : "row")
    row.dataset.hl = "l:" + l.name
    const color = langColor(colors, l.name)
    const name = el("span", "name")
    name.append(keyBox(color), l.name)
    const track = el("span", "track")
    const fill = el("span", "fill")
    fill.style.width = `${l.ms / maxMs * 100}%`
    fill.style.background = color
    track.append(fill)
    row.append(name, track, el("span", "t", l.ms ? (many ? hours(l.ms) : fmt(l.ms)) : "·"), el("span", "l", l.ms ? `+${l.added} −${l.deleted}` : ""))
    bindTip(row, () => [tipLine(fmt(l.ms), l.name), tipSub(`${pct(l.ms, totalMs)}% of ${scope} · +${l.added} −${l.deleted} lines`)])
    return row
  }))
  if (!rows.length) host.append(el("div", "hint", "no activity"))
  if (base.length > LANG_ROWS) host.append(el("div", "hint", `${base.length - LANG_ROWS} more languages`))
}

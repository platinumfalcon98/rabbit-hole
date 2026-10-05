// Lines: the totals, and one +/- row per day (or per week), the runs scaled to
// the biggest row and to the width the row actually has.
import { $, charWidth, el, onWidth } from "./dom"
import { signed } from "./format"
import { runs } from "./layout"
import { bindTip, tipLine, tipSub } from "./tooltip"

export interface LineItem { label: string; added: number; deleted: number; now: boolean; sub: string }

let bars: { node: HTMLElement; added: number; deleted: number }[] = []
let max = 1

export function setLineTotals(added: number, deleted: number): void {
  $("ln-add").textContent = `+${added}`
  $("ln-del").textContent = `−${deleted}`
  $("ln-net").textContent = signed(added - deleted)
}

export function renderLines(items: LineItem[], wide: boolean): void {
  const host = $("week")
  max = Math.max(1, ...items.map(r => r.added + r.deleted))
  host.classList.toggle("wide", wide)
  bars = []
  host.replaceChildren(...items.map(r => {
    const row = el("div", r.now ? "row now" : "row")
    const node = el("span", "bars")
    row.append(el("span", "d", r.label), node, el("span", "n", `+${r.added} −${r.deleted}`))
    bindTip(row, () => [tipLine(`+${r.added}  −${r.deleted}`, r.sub), tipSub(`net ${signed(r.added - r.deleted)}`)])
    bars.push({ node, added: r.added, deleted: r.deleted })
    return row
  }))
  fillLines()
}

function fillLines(): void {
  if (!bars.length) return
  const w = bars[0].node.clientWidth
  if (!w) return
  const cols = Math.max(6, Math.floor(w / charWidth(bars[0].node)) - 1)
  for (const b of bars) {
    const [na, nr] = runs(b.added, b.deleted, max, cols)
    b.node.replaceChildren(el("span", "add", "+".repeat(na)), el("span", "del", "-".repeat(nr)))
  }
}

export function initLines(): void {
  onWidth($("week"), fillLines)
}

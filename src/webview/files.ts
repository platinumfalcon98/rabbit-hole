// Files as git diff --stat: path, |, count, and a +/- graph that gets whatever
// width the other columns leave.
import type { Names } from "./colors"
import { $, charWidth, el, onWidth } from "./dom"
import { plural, splitPath } from "./format"
import { runs } from "./layout"
import type { FileRow } from "./model"

const SHOW_FILES = 9

let graphs: { g: HTMLElement; added: number; deleted: number }[] = []
let max = 1

export function renderFiles(rows: FileRow[], multi: boolean, names: Names): void {
  const shown = rows.slice(0, SHOW_FILES)
  max = Math.max(1, ...shown.map(f => f.added + f.deleted))
  const body = el("tbody")
  graphs = shown.map(f => {
    const { dir, name } = splitPath(f.path, names.root(f.projectId))
    const tr = el("tr")
    const path = el("td", "path")
    // with all projects shown, the same path in two repos must read differently
    const prefix = (multi ? names.project(f.projectId) + "/" : "") + dir
    if (prefix) path.append(el("span", "dir", prefix))
    path.append(name)
    path.title = f.path
    const g = el("td", "g")
    tr.append(path, el("td", "sep", "|"), el("td", "num", f.added + f.deleted), g)
    body.append(tr)
    return { g, added: f.added, deleted: f.deleted }
  })
  const added = rows.reduce((s, f) => s + f.added, 0)
  const deleted = rows.reduce((s, f) => s + f.deleted, 0)
  const foot = el("tfoot")
  const footRow = el("tr")
  const cell = el("td", null, rows.length
    ? `${plural(rows.length, "file")} changed, ${added} insertions(+), ${deleted} deletions(-)` + (rows.length > SHOW_FILES ? ` · ${rows.length - SHOW_FILES} smaller not shown` : "")
    : "no changes")
  cell.colSpan = 4
  footRow.append(cell)
  foot.append(footRow)
  const cols = el("colgroup")
  for (const w of ["55%", "2ch", "6.5ch", ""]) {
    const c = el("col")
    if (w) c.style.width = w
    cols.append(c)
  }
  $("stat").replaceChildren(cols, body, foot)
  fillFiles()
}

function fillFiles(): void {
  if (!graphs.length) return
  for (const x of graphs) x.g.replaceChildren()
  const w = graphs[0].g.clientWidth
  if (!w) return
  const cols = Math.max(4, Math.floor(w / charWidth(graphs[0].g)) - 1)
  for (const x of graphs) {
    const [na, nr] = runs(x.added, x.deleted, max, cols)
    x.g.append(el("span", "add", "+".repeat(na)), el("span", "del", "-".repeat(nr)))
  }
}

export function initFiles(): void {
  onWidth($("stat"), fillFiles)
}

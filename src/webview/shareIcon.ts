// The share button's icon: the share card in miniature, on the carrot's pixel
// grid — the carrot in the corner, a strip of day tape, the big number.
// k is the button's own colour (currentColor), so the icon follows its hover.
import { CARROT_COLORS } from "./carrot"

export const SHARE_ICON = [
  "kkkkkkkkkkkkk",
  "k...........k",
  "k.OG........k",
  "k.OO........k",
  "k...........k",
  "k.kk.kkk.kk.k",
  "k...........k",
  "k.kkkkk.....k",
  "kkkkkkkkkkkkk",
]

const SVG_NS = "http://www.w3.org/2000/svg"

export function shareIconSvg(scale: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("width", String(SHARE_ICON[0].length * scale))
  svg.setAttribute("height", String(SHARE_ICON.length * scale))
  svg.setAttribute("viewBox", `0 0 ${SHARE_ICON[0].length} ${SHARE_ICON.length}`)
  svg.setAttribute("shape-rendering", "crispEdges")
  svg.setAttribute("aria-hidden", "true")
  SHARE_ICON.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === ".") return
    const r = document.createElementNS(SVG_NS, "rect")
    r.setAttribute("x", String(x))
    r.setAttribute("y", String(y))
    r.setAttribute("width", "1")
    r.setAttribute("height", "1")
    r.setAttribute("fill", ch === "k" ? "currentColor" : CARROT_COLORS[ch])
    svg.append(r)
  }))
  return svg
}

// The Rabbit Hole carrot, one character per pixel. Its shape is
// resources/icon.svg's (the carrot suite fails if they drift), including the
// brown pixel at row 8, column 0 that resources/rabbithole-icon.svg is still
// missing — phase 5 adds it there.
export const CARROT = [
  ".........G....",
  ".........G..G.",
  "......BBBG.G..",
  ".....BOOOBG...",
  "....BBOOOOBGGG",
  "...BOOBOOOB...",
  "..BOOOOOOOB...",
  ".BOOOOBOOB....",
  "BOOOOOOBB.....",
  "BBBBBBBB......",
]
export const CARROT_W = 14
export const CARROT_H = 10
export const CARROT_COLORS: Record<string, string> = { O: "#FF8B00", B: "#A5510C", G: "#01FF00" }

export function carrotPixels(): { x: number; y: number; c: string }[] {
  const out: { x: number; y: number; c: string }[] = []
  CARROT.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") out.push({ x, y, c: CARROT_COLORS[ch] }) }))
  return out
}

const SVG_NS = "http://www.w3.org/2000/svg"

// Crisp at any whole-number scale; the CSS glow goes on the <svg>.
export function carrotSvg(scale: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("width", String(CARROT_W * scale))
  svg.setAttribute("height", String(CARROT_H * scale))
  svg.setAttribute("viewBox", `0 0 ${CARROT_W} ${CARROT_H}`)
  svg.setAttribute("shape-rendering", "crispEdges")
  svg.setAttribute("role", "img")
  svg.setAttribute("aria-label", "Rabbit Hole")
  for (const p of carrotPixels()) {
    const r = document.createElementNS(SVG_NS, "rect")
    r.setAttribute("x", String(p.x))
    r.setAttribute("y", String(p.y))
    r.setAttribute("width", "1")
    r.setAttribute("height", "1")
    r.setAttribute("fill", p.c)
    svg.append(r)
  }
  return svg
}

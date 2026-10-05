// Fitting text into a fixed space, for the share card and the report. Pure:
// callers pass their own measure (canvas measureText, jsPDF getTextWidth).

// Cut from the end and mark the cut, so a long name never runs into the next column.
export function ellipsize(text: string, maxW: number, width: (s: string) => number): string {
  if (width(text) <= maxW) return text
  const chars = [...text]
  while (chars.length && width(chars.join("") + "…") > maxW) chars.pop()
  return chars.length ? chars.join("") + "…" : ""
}

// Which characters a TrueType font can draw, read from its cmap (formats 4 and
// 12), skipping any that map to the missing glyph. The report checks text
// against the font it embeds; the fonts suite checks the same in node.
export function ttfCoverage(bytes: Uint8Array): Set<number> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Set<number>()
  let cmap = -1
  for (let i = 0; i < v.getUint16(4); i++) {
    const rec = 12 + 16 * i
    if (String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]) === "cmap") cmap = v.getUint32(rec + 8)
  }
  if (cmap < 0) return out
  for (let i = 0; i < v.getUint16(cmap + 2); i++) {
    const at = cmap + v.getUint32(cmap + 8 + 8 * i)
    const format = v.getUint16(at)
    if (format === 4) {
      const segs = v.getUint16(at + 6) / 2
      const endAt = at + 14
      const startAt = at + 16 + 2 * segs
      const deltaAt = at + 16 + 4 * segs
      const rangeAt = at + 16 + 6 * segs
      for (let s = 0; s < segs; s++) {
        const end = v.getUint16(endAt + 2 * s)
        const start = v.getUint16(startAt + 2 * s)
        const delta = v.getInt16(deltaAt + 2 * s)
        const ro = v.getUint16(rangeAt + 2 * s)
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g = ro === 0 ? (c + delta) & 0xffff : v.getUint16(rangeAt + 2 * s + ro + 2 * (c - start))
          if (ro !== 0 && g !== 0) g = (g + delta) & 0xffff
          if (g !== 0) out.add(c)
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < v.getUint32(at + 12); g++) {
        const start = v.getUint32(at + 16 + 12 * g)
        const end = v.getUint32(at + 20 + 12 * g)
        if (v.getUint32(at + 24 + 12 * g) === 0) continue
        for (let c = start; c <= end; c++) out.add(c)
      }
    }
  }
  return out
}

// jsPDF has no font fallback: a character the embedded font lacks prints as
// nothing. A visible "?" at least shows that something was there.
export function pdfSafe(text: string, covered: Set<number>): string {
  return [...text].map(ch => (covered.has(ch.codePointAt(0)!) ? ch : "?")).join("")
}

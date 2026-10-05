import { describe, it } from "node:test"
import * as assert from "node:assert"
import { existsSync, readFileSync } from "node:fs"
// @ts-ignore — esbuild alias to src/webview/textFit.ts
import { ellipsize, pdfSafe, ttfCoverage } from "textFit"

const font = (name: string): Set<number> =>
  ttfCoverage(new Uint8Array(readFileSync(`src/webview/fonts/MartianMono-${name}.ttf`)))
const regular = font("NrRg")
const bold = font("NrBd")
const has = (ch: string) => regular.has(ch.codePointAt(0)!)

// Every string the report draws comes from these files. Comments are stripped:
// they never reach the PDF. Files that don't exist yet (later tasks) are skipped.
const SOURCES = ["reportPdf", "exportModel", "exportLayout", "format", "textFit"]
  .map(n => `src/webview/${n}.ts`)
  .filter(p => existsSync(p))
const code = (path: string) =>
  readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1")

describe("the report's fonts", () => {
  it("regular and bold draw the same characters, including ASCII and the report's symbols", () => {
    assert.deepStrictEqual([...regular].sort((a, b) => a - b), [...bold].sort((a, b) => a - b))
    for (let c = 0x20; c <= 0x7e; c++) assert.ok(regular.has(c), `missing U+${c.toString(16)}`)
    for (const ch of "·−–—…") assert.ok(has(ch), `missing ${ch}`)
  })

  it("has no block or shape glyphs, which is why the renderers draw marks as shapes", () => {
    for (const ch of "░▒▓█▁■□◆") assert.ok(!has(ch), `${ch} is in the font now; the renderers could use glyphs`)
  })

  it("every non-ASCII character in the report's code is in the font", () => {
    for (const path of SOURCES) {
      for (const ch of new Set(code(path).match(/[^\x00-\x7f]/gu) ?? [])) assert.ok(has(ch), `${path} uses ${ch}, which the font lacks`)
    }
  })
})

describe("fitting text", () => {
  it("pdfSafe keeps what the font has and replaces the rest with ?", () => {
    assert.strictEqual(pdfSafe("café · жук", regular), "café · жук")
    assert.strictEqual(pdfSafe("日本 🥕 x", regular), "?? ? x")
    assert.strictEqual(pdfSafe("Ĉ", regular), "?")   // a hole inside Latin Extended-A
  })

  it("ellipsize cuts from the end and marks the cut", () => {
    const w = (s: string) => [...s].length
    assert.strictEqual(ellipsize("abcdef", 6, w), "abcdef")
    assert.strictEqual(ellipsize("abcdef", 4, w), "abc…")
    assert.strictEqual(ellipsize("abcdef", 0, w), "")
  })
})

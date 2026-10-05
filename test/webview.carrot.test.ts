import { describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
// @ts-ignore — esbuild alias to src/webview/carrot.ts
import { CARROT, CARROT_H, CARROT_W, carrotPixels } from "carrot"

// The cells resources/icon.svg fills. It is 48×34 for 14×10 cells, drawn as
// single-cell <rect>s and a few merged "M x y H x2 V y2 H x V y Z" paths.
function iconCells(svg: string): Set<string> {
  const cw = 48 / 14
  const ch = 3.4
  const out = new Set<string>()
  const add = (x: number, y: number, w: number, h: number) => {
    for (let c = Math.round(x / cw); c < Math.round((x + w) / cw); c++) {
      for (let r = Math.round(y / ch); r < Math.round((y + h) / ch); r++) out.add(`${c},${r}`)
    }
  }
  const attr = (tag: string, k: string) => {
    const m = new RegExp(`\\s${k}="([\\d.]+)"`).exec(tag)
    return m ? Number(m[1]) : 0
  }
  for (const m of svg.matchAll(/<rect[^>]*>/g)) add(attr(m[0], "x"), attr(m[0], "y"), attr(m[0], "width"), attr(m[0], "height"))
  for (const m of svg.matchAll(/<path d="M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+V[\d.]+Z"/g)) {
    const [x1, y1, x2, y2] = m.slice(1, 5).map(Number)
    add(x1, y1, x2 - x1, y2 - y1)
  }
  return out
}

describe("carrot", () => {
  it("is 14 by 10 with only known colours", () => {
    assert.strictEqual(CARROT.length, CARROT_H)
    for (const row of CARROT) assert.match(row, new RegExp(`^[.OBG]{${CARROT_W}}$`))
  })

  it("has exactly the shape of resources/icon.svg, including row 8's first pixel", () => {
    const want = iconCells(fs.readFileSync("resources/icon.svg", "utf8"))
    const got = new Set(carrotPixels().map((p: any) => `${p.x},${p.y}`))
    assert.deepStrictEqual([...got].sort(), [...want].sort())
    assert.ok(got.has("0,8"))
  })
})

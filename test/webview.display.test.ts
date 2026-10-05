import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/crt.ts
import { crtParams, themeOf } from "crt"
// @ts-ignore — esbuild alias to src/webview/focus.ts
import { hlOf, parseHl, sameFocus } from "focus"

const C = (o: any = {}): any => ({ mask: "slot", pitch: "fine", strength: 30, effects: ["scanlines", "bloom"], ...o })

describe("crt parameters", () => {
  it("the default is a subtle slot mask with scanlines and bloom", () => {
    const p = crtParams(C(), "dark")
    assert.strictEqual(p.off, false)
    assert.strictEqual(p.s, 0.3)
    assert.strictEqual(p.boost, 1.255)
    assert.strictEqual(p.line, 3)
    assert.deepStrictEqual(p.fx, { scan: true, roll: false, flicker: false, conv: false, glow: true })
  })

  it("paper screens get half the mask", () => {
    assert.strictEqual(crtParams(C(), "light").s, 0.15)
  })

  it("high contrast gets nothing at all", () => {
    const p = crtParams(C({ effects: ["scanlines", "bloom", "convergence", "roll", "flicker"] }), "hc")
    assert.strictEqual(p.off, true)
    assert.strictEqual(p.boost, 1)
    assert.deepStrictEqual(p.fx, { scan: false, roll: false, flicker: false, conv: false, glow: false })
  })

  it("mask off or zero strength gives the light back", () => {
    assert.strictEqual(crtParams(C({ mask: "off" }), "dark").boost, 1)
    assert.strictEqual(crtParams(C({ strength: 0 }), "dark").off, true)
  })

  it("pitch scales the cells and the scanline period", () => {
    const p = crtParams(C({ pitch: "coarse" }), "dark")
    assert.strictEqual(p.unit, 3)
    assert.strictEqual(p.line, 9)
  })

  it("a shadow mask removes more light, so it gives more back", () => {
    assert.ok(crtParams(C({ mask: "shadow" }), "dark").boost > crtParams(C(), "dark").boost)
  })

  it("themes come from VS Code's body classes", () => {
    assert.strictEqual(themeOf("vscode-dark"), "dark")
    assert.strictEqual(themeOf("vscode-light"), "light")
    assert.strictEqual(themeOf("vscode-high-contrast"), "hc")
    assert.strictEqual(themeOf("vscode-high-contrast-light vscode-high-contrast"), "hc")
    assert.strictEqual(themeOf(""), "dark")
  })
})

describe("focus attributes", () => {
  it("project ids keep their colons", () => {
    assert.deepStrictEqual(parseHl("p:git@github.com:me/x.git"), { kind: "project", id: "git@github.com:me/x.git" })
    assert.strictEqual(hlOf({ kind: "project", id: "git@github.com:me/x.git" }), "p:git@github.com:me/x.git")
  })

  it("languages, and anything malformed", () => {
    assert.deepStrictEqual(parseHl("l:typescript"), { kind: "language", id: "typescript" })
    for (const bad of [undefined, "", "p:", "x:1", "nocolon"]) assert.strictEqual(parseHl(bad), null)
  })

  it("sameFocus", () => {
    assert.strictEqual(sameFocus(null, null), true)
    assert.strictEqual(sameFocus({ kind: "language", id: "go" }, { kind: "language", id: "go" }), true)
    assert.strictEqual(sameFocus({ kind: "language", id: "go" }, { kind: "project", id: "go" }), false)
    assert.strictEqual(sameFocus(null, { kind: "project", id: "a" }), false)
  })
})

import { beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/shared/config.ts
import { getCrtSettings, CRT_DEFAULTS } from "cfg"
// @ts-ignore — esbuild alias to src/shared/config.ts
import { crtSettingValue } from "cfg"

const v = vscode as any
beforeEach(() => v.__resetConfig())

describe("CRT settings", () => {
  it("defaults to a subtle slot mask with scanlines and bloom", () => {
    assert.deepStrictEqual(getCrtSettings(), { mask: "slot", pitch: "fine", strength: 23, vignette: 35, effects: ["scanlines", "bloom"] })
  })

  it("reads valid values", () => {
    v.__setConfig("crt.mask", "grille")
    v.__setConfig("crt.pitch", "coarse")
    v.__setConfig("crt.strength", 55)
    v.__setConfig("crt.vignette", 10)
    v.__setConfig("crt.effects", ["roll", "scanlines"])
    assert.deepStrictEqual(getCrtSettings(), { mask: "grille", pitch: "coarse", strength: 55, vignette: 10, effects: ["scanlines", "roll"] })
  })

  // settings.json is hand-editable: VS Code shows a squiggle and passes the value through anyway.
  it("falls back on unknown enum values", () => {
    v.__setConfig("crt.mask", "trinitron")
    v.__setConfig("crt.pitch", 2)
    const s = getCrtSettings()
    assert.strictEqual(s.mask, "slot")
    assert.strictEqual(s.pitch, "fine")
  })

  it("clamps and rounds strength, and ignores non-numbers", () => {
    v.__setConfig("crt.strength", 150)
    assert.strictEqual(getCrtSettings().strength, 100)
    v.__setConfig("crt.strength", -5)
    assert.strictEqual(getCrtSettings().strength, 0)
    v.__setConfig("crt.strength", 42.6)
    assert.strictEqual(getCrtSettings().strength, 43)
    v.__setConfig("crt.strength", "50")
    assert.strictEqual(getCrtSettings().strength, 23)
  })

  // The glass darkened the edges at a fixed 62% black, which no setting reached.
  it("clamps and rounds the edge darkening, and ignores non-numbers", () => {
    v.__setConfig("crt.vignette", 150)
    assert.strictEqual(getCrtSettings().vignette, 100)
    v.__setConfig("crt.vignette", -1)
    assert.strictEqual(getCrtSettings().vignette, 0)
    v.__setConfig("crt.vignette", "dark")
    assert.strictEqual(getCrtSettings().vignette, 35)
  })

  it("keeps known effects in a fixed order, drops unknown ones, allows none", () => {
    v.__setConfig("crt.effects", ["flicker", "sparkle", "bloom", "bloom"])
    assert.deepStrictEqual(getCrtSettings().effects, ["bloom", "flicker"])
    v.__setConfig("crt.effects", [])
    assert.deepStrictEqual(getCrtSettings().effects, [])
    v.__setConfig("crt.effects", "bloom")
    assert.deepStrictEqual(getCrtSettings().effects, ["scanlines", "bloom"])
  })

  it("package.json declares the same defaults", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"))
    const props = pkg.contributes.configuration.properties
    assert.strictEqual(props["rabbithole.crt.mask"].default, CRT_DEFAULTS.mask)
    assert.strictEqual(props["rabbithole.crt.pitch"].default, CRT_DEFAULTS.pitch)
    assert.strictEqual(props["rabbithole.crt.strength"].default, CRT_DEFAULTS.strength)
    assert.strictEqual(props["rabbithole.crt.vignette"].default, CRT_DEFAULTS.vignette)
    assert.deepStrictEqual(props["rabbithole.crt.effects"].default, CRT_DEFAULTS.effects)
  })
})

describe("CRT values written from the dashboard", () => {
  it("are normalised, or refused when the manifest would reject them", () => {
    assert.strictEqual(crtSettingValue("mask", "grille"), "grille")
    assert.strictEqual(crtSettingValue("mask", "glitter"), null)
    assert.strictEqual(crtSettingValue("pitch", "coarse"), "coarse")
    assert.strictEqual(crtSettingValue("strength", 42.6), 43)
    assert.strictEqual(crtSettingValue("strength", -5), 0)
    assert.strictEqual(crtSettingValue("strength", "50"), null)
    assert.strictEqual(crtSettingValue("vignette", 120), 100)
    assert.strictEqual(crtSettingValue("vignette", "x"), null)
    assert.deepStrictEqual(crtSettingValue("effects", ["flicker", "bloom", "bogus"]), ["bloom", "flicker"])
    assert.strictEqual(crtSettingValue("effects", "bloom"), null)
    assert.strictEqual(crtSettingValue("colour", "red"), null)
  })
})

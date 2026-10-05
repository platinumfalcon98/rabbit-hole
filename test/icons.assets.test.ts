import { it } from "node:test"
import * as assert from "node:assert"
import { readFileSync } from "node:fs"

const manifest = () => JSON.parse(readFileSync("package.json", "utf8"))

it("registers the existing status-bar id with a committed WOFF", () => {
  const p = manifest()
  assert.deepStrictEqual(p.contributes.icons?.["rabbithole-carrot"], {
    description: "Rabbit Hole carrot",
    default: { fontPath: "./resources/rabbithole-icons.woff", fontCharacter: "\\E001" },
  })
  const font = readFileSync("resources/rabbithole-icons.woff")
  assert.strictEqual(font.toString("ascii", 0, 4), "wOFF")
  assert.strictEqual(font.readUInt32BE(8), font.length)
  assert.ok(font.readUInt16BE(12) > 0)
})

it("keeps the Activity Bar carrot and ordinary builds independent of Python", () => {
  const p = manifest()
  assert.strictEqual(p.contributes.viewsContainers.activitybar
    .find((v: { id: string }) => v.id === "rabbithole").icon, "resources/icon.svg")
  for (const key of ["build", "build:ext", "build:webview", "test", "watch"]) {
    assert.doesNotMatch(p.scripts[key], /python|fonttools|build-icon-/i)
  }
  assert.strictEqual(p.publisher, "rabbit-hole")
})

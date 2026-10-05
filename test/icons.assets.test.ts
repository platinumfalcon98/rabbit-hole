import { it } from "node:test"
import * as assert from "node:assert"
import { readFileSync } from "node:fs"
import { inflateSync } from "node:zlib"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// @ts-ignore — esbuild alias to src/webview/carrot.ts
import { CARROT, CARROT_COLORS } from "carrot"

const manifest = () => JSON.parse(readFileSync("package.json", "utf8"))

it("ships the exact centred Marketplace tile with valid PNG chunks", () => {
  const p = manifest()
  assert.strictEqual(p.icon, "resources/icon.png")
  assert.deepStrictEqual(p.galleryBanner, { color: "#06090a", theme: "dark" })
  const png = readFileSync(p.icon)
  assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const idat: Buffer[] = []
  const types: string[] = []
  let offset = 8
  while (offset < png.length) {
    const n = png.readUInt32BE(offset)
    assert.ok(offset + n + 12 <= png.length)
    const type = png.toString("ascii", offset + 4, offset + 8)
    types.push(type)
    const data = png.subarray(offset + 8, offset + 8 + n)
    let crc = 0xffffffff
    for (const byte of png.subarray(offset + 4, offset + 8 + n)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    assert.strictEqual(png.readUInt32BE(offset + n + 8), (crc ^ 0xffffffff) >>> 0)
    if (type === "IHDR") {
      assert.strictEqual(data.readUInt32BE(0), 128)
      assert.strictEqual(data.readUInt32BE(4), 128)
      assert.deepStrictEqual([...data.subarray(8)], [8, 2, 0, 0, 0])
    }
    if (type === "IDAT") idat.push(data)
    if (type === "IEND") assert.strictEqual(n, 0)
    offset += n + 12
  }
  assert.deepStrictEqual(types, ["IHDR", "IDAT", "IEND"])
  assert.strictEqual(offset, png.length)
  const raw = inflateSync(Buffer.concat(idat))
  assert.strictEqual(raw.length, 128 * 385)
  for (let y = 0; y < 128; y++) {
    assert.strictEqual(raw[y * 385], 0)
    for (let x = 0; x < 128; x++) {
      const gx = Math.floor((x - 8) / 8), gy = Math.floor((y - 24) / 8)
      const cell = gx >= 0 && gx < 14 && gy >= 0 && gy < 10 ? CARROT[gy][gx] : "."
      const hex = cell === "." ? "#06090a" : CARROT_COLORS[cell]
      const expected = Buffer.from(hex.slice(1), "hex")
      const at = y * 385 + 1 + x * 3
      assert.deepStrictEqual(raw.subarray(at, at + 3), expected, `pixel ${x},${y}`)
    }
  }
})

it("regenerates the committed PNG byte for byte", () => {
  const dir = mkdtempSync(join(tmpdir(), "rabbithole-icon-"))
  try {
    const out = join(dir, "icon.png")
    execFileSync(process.execPath, ["scripts/build-icon-png.js", out])
    assert.deepStrictEqual(readFileSync(out), readFileSync("resources/icon.png"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

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

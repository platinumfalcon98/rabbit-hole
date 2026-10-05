# TTY Redesign — Phase 5 (Icons) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the carrot assets, make the existing status-bar carrot visible, prepare the Marketplace icon and banner, and bring the design documentation up to date.

**Architecture:** Keep the existing `src/webview/carrot.ts` as the single grid and palette source. Developer scripts consume it through the existing esbuild dependency, generate committed WOFF and PNG files, and never run during an ordinary build. Preserve the Activity Bar's existing monochrome SVG and the status bar's existing text/wiring.

**Tech Stack:** TypeScript, Node built-ins (including zlib), existing esbuild, Python fonttools for developer-only font regeneration, existing node:test runner.

**Spec:** `docs/superpowers/specs/2026-10-04-tty-redesign-design.md` §5 and §7; read §6 too. Follow phase 4's plan format and CLAUDE.md's phases 1–4. Branch: `tty-redesign`.

## Global Constraints

- No new runtime dependencies.
- Never import `vscode` or `src/shared/config.ts` from `src/webview/*`. Type-only imports from `src/shared/types.ts` are fine.
- **No webview module touches `document` or `window` at import time.** Only the entry points (`main.ts`, `mini.ts`) run code on load.
- Day keys are local time: use `dayKey()` (`model.ts`) and `addDaysKey()` / `fromKey()` (`format.ts`). Never use `toISOString().slice(0, 10)` or `new Date("YYYY-MM-DD")`.
- The sidebar's CSP is the dashboard's: `default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};`. No nonce and no inline scripts.
- One font: Martian Mono, bundled. No network at runtime.
- Palettes are the dashboard's fixed tokens: phosphor (dark), paper (light) and high contrast, keyed on VS Code's body classes in `style.css`. Projects take `--c1…--c6` by registry order (`projectColor`). There is no host-hue tinting.
- CRT: the same layers, the same `rabbithole.crt.*` settings and the same rules as the dashboard (light themes get half the strength, high contrast gets none).
- Narrow sidebars (below 230 px) show 7 streak days instead of 14, drop the graph axis, hide every other hour label and drop the percentages.
- Status bar: `$(rabbithole-carrot) <today> / <target>` for all projects against the global target, green (`#22c55e`) while actively tracking. Times are floored, never rounded up. The 🥕 emoji is removed.
- House style: TypeScript, 2-space indent, no semicolons, double quotes. Comments say why, not what.
- Tests run through `scripts/test.js`, and new suites are registered in its `SUITES` array. Every task ends with `npm test`, `npm run typecheck` and `npm run build` passing.
- Commit messages are plain sentence case, with no `feat:`-style prefix and **no `Co-Authored-By` lines**. This is the user's rule and overrides any harness default.
- A negative control is required wherever a task changes existing behaviour, per `CLAUDE.md`. That means running the new test against the pre-change source and seeing it fail. The temp copy lives inside `src/`, next to the original, and is deleted afterwards.

## Deviations and decisions made while planning

1. **Do not recreate phase 2 or phase 4.** CARROT, carrotPixels(), carrotSvg(), the carrot suite, and statusText() already exist. Extend the SVG tests; change only the stale comment in carrot.ts. The missing colour-SVG pixel is still missing at planning baseline `8b5673d`.
2. **Activity Bar: keep the carrot it already has.** `contributes.viewsContainers.activitybar[0].icon` already points to `resources/icon.svg`, whose shape matches the grid. Keep this theme-coloured SVG; do not substitute the full-colour Marketplace tile or migrate it to a font unnecessarily. The command's clock icon is outside this phase.
3. **Fonttools approval is unresolved.** The request includes both bracketed alternatives rather than a selected decision. No installation is authorized by this plan. At execution, obtain the user's go-ahead before the one-time install if needed. Plan review alone is not installation approval. Other tasks can proceed independently; don't mark the font task complete without generating and checking the font.
4. **Publisher remains `rabbit-hole`.** No actual publisher id was supplied. This is the explicit, permitted placeholder exception. Do not invent an id, log in, publish, bump the version, or claim release readiness.
5. **One typography family, plus a dedicated icon font.** Phase 4's “one font” means Martian Mono for text (variable webview font and static export faces). The one encoded carrot glyph is the §5 exception, not a new text face.
6. **Normal tests/builds need no Python.** Node checks committed assets. A separate Python verification test runs only when regenerating the WOFF. Two glyph records are necessary: mandatory empty .notdef and the single encoded carrot at U+E001.
7. **Defer all three phase 4 minors.** None is required to register or package icons. Record the exact follow-ups in Task 4; do not quietly mix sidebar behaviour fixes into an asset commit. The reported duplicate send is a hypothesis to reproduce: code has webview-ready and host-visibility triggers, but actual event ordering needs a host test.
8. **Use the actual TTY token names in DESIGN.md.** Current style.css uses --bg, --ink, --chrome, --add, --del and --c1…--c6, not the obsolete --rh-* system. Document the implemented redesign; don't rename tokens to reconcile old guidance.

## Review Focus

1. **The bottom-left pixel and overlapping SVG primitives:** final painted colour, not just occupied coordinates, must agree at every grid cell. Task 1 tests both SVGs and brown (0,8).
2. **A blank, inverted or clipped status glyph:** verify cmap, all cell contours and metrics, then inspect 16 px on Windows and macOS. Task 2 separates automated geometry checks from host rendering.
3. **Fresh installs without Python or source files:** committed WOFF/PNG must be in the VSIX; npm builds/tests must not invoke Python. Task 2 checks scripts and Task 4 checks package contents.
4. **PNG scale, background and checksum mistakes:** decode chunks, verify CRCs and compare every RGB pixel against the grid at offset (8,24), scale 8. Task 3 includes byte-stable regeneration.
5. **Theme and icon-theme differences:** Activity Bar stays a theme-coloured carrot; status bar inherits its existing active/inactive colour and still works with the default product icon theme. Task 2 has manifest assertions; Task 4 has explicit dark/light/high-contrast and product-icon-theme manual cases.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| resources/rabbithole-icon.svg | modify | restore brown cell (0,8) |
| resources/icon.svg | preserve | existing Activity Bar monochrome carrot |
| src/webview/carrot.ts | comment only | remove obsolete missing-pixel note |
| test/webview.carrot.test.ts | extend | full colour SVG equivalence |
| scripts/carrot-data.js | create | expose existing TypeScript grid to developer generators |
| scripts/build-icon-font.py | create | generate deterministic single-icon WOFF |
| resources/rabbithole-icons.woff | create, commit | status bar's bundled font |
| test/icon-font.test.py | create | developer-only font geometry verification |
| test/icons.assets.test.ts | create | Node manifest and committed asset checks |
| scripts/test.js | modify | register icons suite |
| scripts/build-icon-png.js | create | built-in PNG encoding, existing grid source |
| resources/icon.png | create, commit | opaque 128×128 Marketplace tile |
| package.json | modify | icons contribution, listing icon and galleryBanner |
| DESIGN.md | replace | current TTY design reference |
| CLAUDE.md | update locally, never force-add | phase 5 results, verified limits, follow-ups |

No tracker, storage, mirror schema, sidebar runtime, lockfile or font-copy pipeline changes.

## Execution preflight

- [x] Read AGENTS.md and CLAUDE.md; inspect `git status --short` and `git branch --show-current`. Work on tty-redesign and preserve any later user edits or negative controls.
- [x] Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build` separately. Expected: baseline green. Stop and report unrelated baseline failures rather than folding fixes into this phase.
- [x] For every task below, run the listed focused check and all three gates before committing. On PowerShell check each exit code; don't use an unconditional semicolon chain as evidence that all commands passed.
- [x] Keep the first red run before each fix. These are asset/manifest changes, so the actual pre-edit asset is the negative control (no alias can substitute a filesystem SVG or manifest). For a TypeScript behaviour change, use CLAUDE.md's adjacent src/ negative-control copy and runner alias. Never overwrite someone else's temporary copy.

---

### Task 1: Close the colour SVG drift gap

**Files:** Modify resources/rabbithole-icon.svg, src/webview/carrot.ts (comment), test/webview.carrot.test.ts.

**Interfaces:** Consume existing carrotPixels(): { x: number; y: number; c: string }[]. Preserve all exports. Produce strict colour-SVG equivalence alongside the existing mono-shape test.

- [x] **Step 1: Add the failing test to the existing carrot suite**

Keep iconCells() and the existing tests. Append this test inside describe("carrot"):

```ts
  it("the colour SVG paints exactly the canonical grid, including the brown tip", () => {
    const svg = fs.readFileSync("resources/rabbithole-icon.svg", "utf8")
    const cells = new Map<string, string>()
    for (const [tag] of svg.matchAll(/<(?:rect|path)\b[^>]*>/g)) {
      const attr = (key: string) => new RegExp(`\\b${key}="([^"]+)"`).exec(tag)?.[1]
      const fill = attr("fill")
      assert.ok(fill, tag)
      let x: number, y: number, w: number, h: number
      if (tag.startsWith("<rect")) {
        x = Number(attr("x") ?? 0)
        y = Number(attr("y") ?? 0)
        w = Number(attr("width"))
        h = Number(attr("height"))
      } else {
        const m = /^M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H([\d.]+)V([\d.]+)Z$/.exec(attr("d") ?? "")
        assert.ok(m, tag)
        x = Number(m[1])
        y = Number(m[2])
        w = Number(m[3]) - x
        h = Number(m[4]) - y
        assert.strictEqual(Number(m[5]), x)
        assert.strictEqual(Number(m[6]), y)
      }
      assert.ok([x, y, w, h].every(Number.isInteger))
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 14 && y + h <= 10)
      for (let row = y; row < y + h; row++) {
        for (let col = x; col < x + w; col++) cells.set(`${col},${row}`, fill!.toUpperCase())
      }
    }
    const want = carrotPixels().map((p: { x: number; y: number; c: string }) =>
      [`${p.x},${p.y}`, p.c])
    assert.strictEqual(cells.get("0,8"), "#A5510C")
    assert.deepStrictEqual([...cells].sort(), want.sort())
  })
```

The parser respects document order: the existing SVG intentionally paints brown over an earlier orange rectangle at (9,3). Do not compare every primitive to a cell independently.

Run: `node scripts/test.js --suite carrot`.
Expected: FAIL specifically because (0,8) is absent. Record this pre-fix negative control.

- [x] **Step 2: Add the missing rectangle**

Insert before the closing SVG tag:

```xml
<rect x="0" y="8" width="1" height="1" fill="#A5510C"/>
```

Replace the first comment in carrot.ts with:

```ts
// The Rabbit Hole carrot, one character per pixel. The carrot suite checks
// both resource SVGs against this shape and palette, including (0, 8).
```

Run: `node scripts/test.js --suite carrot`.
Expected: PASS including existing mono test; no runtime module changes.

- [x] **Step 3: Gate and commit**

Run all three gates, then:

```powershell
git add resources/rabbithole-icon.svg src/webview/carrot.ts test/webview.carrot.test.ts
git commit -m "Align the colour carrot SVG with the canonical grid"
```

---

### Task 2: Generate and register the status-bar icon font

**Files:** Create scripts/carrot-data.js, scripts/build-icon-font.py, test/icon-font.test.py, test/icons.assets.test.ts, resources/rabbithole-icons.woff. Modify package.json and scripts/test.js.

**Interfaces:**
- scripts/carrot-data.js exports loadCarrot() returning { rows: string[], width: number, height: number, colors: Record<string,string> }; when run directly it prints that JSON to stdout.
- scripts/build-icon-font.py accepts an optional output filename; default is resources/rabbithole-icons.woff.
- Manifest icon id rabbithole-carrot maps to U+E001 in that WOFF. Existing statusText() consumes the id unchanged.

- [x] **Step 1: Write the failing Node asset tests and register their suite**

Create test/icons.assets.test.ts:

```ts
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
```

Append to scripts/test.js SUITES:

```js
  { name: "icons", entry: "test/icons.assets.test.ts", alias: {} },
```

Run: `node scripts/test.js --suite icons`.
Expected: FAIL for missing contributes.icons (the second test already passes and guards preservation).

- [x] **Step 2: Add the developer grid bridge**

Create scripts/carrot-data.js:

```js
const path = require("node:path")
const vm = require("node:vm")
const { buildSync } = require("esbuild")

function loadCarrot() {
  const result = buildSync({
    entryPoints: [path.join(__dirname, "../src/webview/carrot.ts")],
    bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
  })
  const module = { exports: {} }
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports })
  const { CARROT, CARROT_W, CARROT_H, CARROT_COLORS } = module.exports
  return JSON.parse(JSON.stringify({
    rows: CARROT, width: CARROT_W, height: CARROT_H, colors: CARROT_COLORS,
  }))
}
module.exports = { loadCarrot }
if (require.main === module) process.stdout.write(JSON.stringify(loadCarrot()))
```

This loads the actual module, without regex-extracting TypeScript or duplicating the grid. No DOM is provided, so an accidental import-time DOM dependency fails.

Run: `node scripts/carrot-data.js`.
Expected: JSON with ten 14-character rows and exactly the existing palette.

- [x] **Step 3: Write the font verification before generating the font**

Only after explicit installation approval, if fonttools is absent:

```powershell
python -m pip install fonttools
python -m pip show fonttools
```

Record the installed version for regeneration notes. Do not add it to npm or a runtime path.

Create test/icon-font.test.py:

```python
import json
from pathlib import Path
import subprocess
import unittest
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]

class IconFontTest(unittest.TestCase):
    def test_encoded_glyph_matches_every_grid_cell(self):
        data = json.loads(subprocess.check_output(
            ["node", str(ROOT / "scripts/carrot-data.js")], cwd=ROOT))
        with TTFont(ROOT / "resources/rabbithole-icons.woff") as font:
            self.assertEqual(font.flavor, "woff")
            self.assertEqual(font.getBestCmap(), {0xE001: "carrot"})
            self.assertEqual(font.getGlyphOrder(), [".notdef", "carrot"])
            self.assertEqual(font["head"].unitsPerEm, 1024)
            self.assertEqual(font["hmtx"]["carrot"], (1024, 64))
            self.assertEqual((font["hhea"].ascent, font["hhea"].descent), (832, -192))
            glyph = font["glyf"]["carrot"]
            coords, ends, flags = glyph.getCoordinates(font["glyf"])
            actual = []
            start = 0
            for end in ends:
                pts = [tuple(p) for p in coords[start:end + 1]]
                self.assertEqual(len(pts), 4)
                self.assertTrue(all(int(f) & 1 for f in flags[start:end + 1]))
                actual.append(tuple(pts))
                start = end + 1
            expected = []
            for y, row in enumerate(data["rows"]):
                for x, ch in enumerate(row):
                    if ch != ".":
                        left, bottom = 64 + x * 64, (9 - y) * 64
                        expected.append(((left, bottom), (left, bottom + 64),
                                         (left + 64, bottom + 64), (left + 64, bottom)))
            self.assertCountEqual(actual, expected)
            self.assertEqual((glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax),
                             (64, 0, 960, 640))

if __name__ == "__main__":
    unittest.main()
```

Run: `python test/icon-font.test.py`.
Expected: FAIL on missing WOFF, not on missing fonttools. This test belongs to developer regeneration, not npm test.

- [x] **Step 4: Implement the generator**

Create scripts/build-icon-font.py:

```python
import json
from pathlib import Path
import subprocess
import sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parents[1]
data = json.loads(subprocess.check_output(
    ["node", str(ROOT / "scripts/carrot-data.js")], cwd=ROOT))
assert data["width"] == 14 and data["height"] == 10
pen = TTGlyphPen(None)
for y, row in enumerate(data["rows"]):
    for x, cell in enumerate(row):
        if cell == ".":
            continue
        left, bottom = 64 + x * 64, (9 - y) * 64
        pen.moveTo((left, bottom))
        pen.lineTo((left, bottom + 64))
        pen.lineTo((left + 64, bottom + 64))
        pen.lineTo((left + 64, bottom))
        pen.closePath()

fb = FontBuilder(1024, isTTF=True)
fb.setupGlyphOrder([".notdef", "carrot"])
fb.setupCharacterMap({0xE001: "carrot"})
fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "carrot": pen.glyph()})
fb.setupHorizontalMetrics({".notdef": (1024, 0), "carrot": (1024, 64)})
fb.setupHorizontalHeader(ascent=832, descent=-192, lineGap=0)
fb.setupNameTable({
    "familyName": "Rabbit Hole Icons", "styleName": "Regular",
    "uniqueFontIdentifier": "RabbitHoleIcons-Regular-1",
    "fullName": "Rabbit Hole Icons Regular", "psName": "RabbitHoleIcons-Regular",
    "version": "Version 1.000",
})
fb.setupOS2(sTypoAscender=832, sTypoDescender=-192, sTypoLineGap=0,
            usWinAscent=832, usWinDescent=192, fsType=0)
fb.setupPost()
# Fixed OpenType epoch timestamps prevent time-only changes on regeneration.
fb.font["head"].created = fb.font["head"].modified = 3800000000
fb.font.recalcTimestamp = False
fb.font.flavor = "woff"
output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "resources/rabbithole-icons.woff"
output.parent.mkdir(parents=True, exist_ok=True)
fb.save(str(output))
```

The rectangle contours are clockwise and y-flipped from screen coordinates. At 16 px this gives a 14×10 carrot inside a 16 px advance. Inspect actual baseline visually; do not mistake the geometry test for platform rendering proof.

- [x] **Step 5: Generate and register**

Run: `python scripts/build-icon-font.py`.

Add under contributes (preserve all other fields):

```json
"icons": {
  "rabbithole-carrot": {
    "description": "Rabbit Hole carrot",
    "default": {
      "fontPath": "./resources/rabbithole-icons.woff",
      "fontCharacter": "\\E001"
    }
  }
}
```

The JSON contains a literal escaped backslash, not the six-character string “U+E001”. This shape follows the [VS Code icons contribution documentation](https://code.visualstudio.com/api/references/contribution-points#contributes.icons). Generator API order follows [fonttools' own FontBuilder example](https://github.com/fonttools/fonttools/blob/main/Lib/fontTools/fontBuilder.py).

Run separately:

```powershell
python test/icon-font.test.py
node scripts/test.js --suite icons
node scripts/test.js --suite status
python scripts/build-icon-font.py test/.out/icons-repeat.woff
node -e "const f=require('node:fs');require('node:assert').deepStrictEqual(f.readFileSync('resources/rabbithole-icons.woff'),f.readFileSync('test/.out/icons-repeat.woff'))"
```

Expected: all PASS; repeat bytes equal using the same recorded fonttools version. Ordinary npm checks require only the committed font, never the Python test.

- [x] **Step 6: Gate and commit**

Run all three gates, then:

```powershell
git add scripts/carrot-data.js scripts/build-icon-font.py test/icon-font.test.py test/icons.assets.test.ts resources/rabbithole-icons.woff package.json scripts/test.js
git commit -m "Register the carrot icon font for the status bar"
```

---

### Task 3: Generate the Marketplace tile and banner

**Files:** Create scripts/build-icon-png.js and resources/icon.png. Extend test/icons.assets.test.ts. Modify package.json.

**Interfaces:** Consume loadCarrot() from Task 2. Generator accepts optional output path; defaults to resources/icon.png. PNG is RGB, 8 bits per channel, non-interlaced, filter 0, opaque, 128×128. Grid is 112×80 at (8,24).

- [x] **Step 1: Add the failing PNG and manifest test**

Add these imports to test/icons.assets.test.ts:

```ts
import { inflateSync } from "node:zlib"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// @ts-ignore — esbuild alias to src/webview/carrot.ts
import { CARROT, CARROT_COLORS } from "carrot"
```

Change the icons suite alias to `{ carrot: "src/webview/carrot.ts" }`. Append:

```ts
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
```

Run: `node scripts/test.js --suite icons`.
Expected: new tests FAIL for missing listing fields/generator. Existing WOFF tests pass. This pins pre-change behaviour.

- [x] **Step 2: Implement the built-in PNG generator**

Create scripts/build-icon-png.js:

```js
const fs = require("node:fs")
const path = require("node:path")
const { deflateSync } = require("node:zlib")
const { loadCarrot } = require("./carrot-data")

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type, "ascii")
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  name.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return out
}
const { rows, colors } = loadCarrot()
const raw = Buffer.alloc(128 * 385)
for (let y = 0; y < 128; y++) {
  for (let x = 0; x < 128; x++) {
    const gx = Math.floor((x - 8) / 8), gy = Math.floor((y - 24) / 8)
    const cell = gx >= 0 && gx < 14 && gy >= 0 && gy < 10 ? rows[gy][gx] : "."
    Buffer.from((cell === "." ? "#06090a" : colors[cell]).slice(1), "hex")
      .copy(raw, y * 385 + 1 + x * 3)
  }
}
const header = Buffer.alloc(13)
header.writeUInt32BE(128, 0)
header.writeUInt32BE(128, 4)
header[8] = 8
header[9] = 2
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
])
const out = process.argv[2] || path.join(__dirname, "../resources/icon.png")
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
```

No image-generation service, canvas, image library or resampling: this is deterministic pixel encoding from the approved grid.

- [x] **Step 3: Generate and add listing metadata**

Run: `node scripts/build-icon-png.js`.
Add at the top level of package.json:

```json
"icon": "resources/icon.png",
"galleryBanner": { "color": "#06090a", "theme": "dark" }
```

Run: `node scripts/test.js --suite icons`.
Expected: PASS, including all pixel, CRC and reproducibility assertions. Open the PNG at 100% and enlarged with nearest-neighbour display: expected clean edges, brown (0,8), no blur, 8 px horizontal and 24 px vertical padding.

- [x] **Step 4: Gate and commit**

Run all three gates, then:

```powershell
git add scripts/build-icon-png.js resources/icon.png package.json scripts/test.js test/icons.assets.test.ts
git commit -m "Add the pixel carrot Marketplace icon and banner"
```

---

### Task 4: Replace the stale design reference and verify the packaged result

**Files:** Replace DESIGN.md; update local CLAUDE.md. No sidebar fixes or CLI repository edits.

**Interfaces:** Document the implemented assets, generation commands, existing TTY UI and unverified host checks. No new runtime interfaces.

This is documentation and integration verification, so use content checks and manual acceptance cases rather than inventing a failing unit test for prose.

- [x] **Step 1: Replace DESIGN.md with the following current reference**

```markdown
# Rabbit Hole — TTY design system

The reference is docs/superpowers/specs/2026-10-04-tty-redesign-design.md and
the dashboard, sidebar and export mockups in docs/design/mockups/.
Implementation lives in src/webview/. Preserve the terminal layout and exact
product copy; don't introduce a separate visual language for new panels.

## Tokens and themes

src/webview/style.css owns the fixed palettes, keyed on VS Code body classes.
Use its existing variables rather than the retired --rh-* tokens.
--bg / --panel / --rule are surfaces and borders; --ink / --ink-dim /
--ink-mute are text; --chrome / --chrome-ink are interactive accents;
--add / --del are positive and negative values; --c1 through --c6 and
--c-other are series colours. There is no host-hue derivation.

Dark phosphor: background #050b08, panel #08110d, rule #22392d,
ink #cfeedd, amber #ffb703, additions #39d98a, deletions #ff6b6b.
Light paper: background #eef0e9, panel #f6f7f2, rule #b9c2b2,
ink #12261b, amber #8a5a00, additions #0f7a43, deletions #b4232f.
High-contrast dark and light use VS Code foreground/background/contrast
tokens and disable CRT and glow. Keep those theme branches together.

## Typography and structure

Martian Mono is bundled: variable woff2 for webviews, static Regular and Bold
TTF for PDF embedding. --mono includes local fallback monospace faces.
Block glyphs in the webview use fallback coverage; exports draw marks as
shapes. PDF textFit.ts checks cmap coverage and replaces unsupported
characters with ?, then fits text within its assigned space.

Use fieldset/legend terminal frames, compact tabular numerals, thin rules,
block columns and tapes, git diff --stat file rows, and amber interaction.
The streak stays plain. No old rounded-card theme or display typefaces.

## Interaction and sidebar

model.ts owns aggregation. state.ts owns dashboard state and requests.
Colours are stable: projects use registry order, languages use unfocused
rank. Hover or keyboard focus narrows a view without moving the target
under the pointer; restore keyboard focus across redraws.

miniPanel.ts is the host shell; mini.ts renders values from miniModel.ts.
The sidebar loads style.css then mini.css, so check selector collisions.
Below 230 px it shows 7 streak marks, drops the week axis and percentages,
and hides every other hour label. Its tape is coloured by project.
The dashboard tape is coloured by language.

## CRT

crt.ts shares the rendering and settings across dashboard and sidebar.
Defaults: slot mask, fine pitch, strength 23%, vignette 35%, scanlines and
bloom enabled. Convergence, roll and flicker are off. Light themes halve
strength; high contrast disables effects. Reduced motion suppresses roll
and flicker. Keep text legible and overlays non-interactive.

## Carrot and workbench icons

src/webview/carrot.ts is the sole 14×10 grid and palette:
O #FF8B00, B #A5510C, G #01FF00. Cell (0,8) is brown.
carrotPixels() supplies renderers; carrotSvg(scale) supplies webview SVGs.
The carrot suite checks both resource SVGs, including paint order.

Activity Bar: resources/icon.svg, monochrome and theme-coloured.
Status bar: $(rabbithole-carrot), registered at U+E001 from the committed
resources/rabbithole-icons.woff. It inherits the existing item colour:
#22c55e when tracking, default otherwise. Text remains floored
<today> / <target> across all projects.

Marketplace: resources/icon.png is an opaque 128×128 RGB tile, the carrot
at 8× (112×80), centred at (8,24) on #06090a. galleryBanner uses that
background with theme dark. The publisher remains a placeholder until
the user supplies their registered id.

## Regenerating assets

From the repository root, with existing npm development dependencies:
node scripts/build-icon-png.js
python scripts/build-icon-font.py

Font regeneration alone needs fonttools, installed only with user approval:
python -m pip install fonttools
Record the fonttools version used for a regeneration in the implementation
handoff. Generated PNG and WOFF are committed; ordinary builds, tests and
the installed extension never need Python.

Checks:
node scripts/test.js --suite carrot
node scripts/test.js --suite icons
python test/icon-font.test.py
The last command is a developer regeneration check, separate from npm test.
Run npm test, typecheck and build before committing asset changes.

## Exports and verification

The share card uses a 420×620 logical canvas at 3× with faint scanlines,
no mask. Reports are dark A4 with #06090a background, a hairline frame,
embedded fonts and no CRT. exportModel.ts and exportLayout.ts own values
and layout; shareCard.ts and reportPdf.ts draw them.

Use the existing dashboard, sidebar and export browser harnesses for
layout checks. Use the real Extension Development Host for workbench icons,
theme changes, visibility, storage and live-update checks. Check the status
glyph at 16 px on Windows and macOS and inspect packaged asset inclusion.
Record unavailable platforms as unverified. Marketplace screenshots follow
the host pass; login and publishing remain user-run.
```

Run: `rg -n 'derivePalette|Press Start|Unica One|Electrolize|Chart.js|CHART_FONT' DESIGN.md`.
Expected: no matches. Check paths against current files, token values against style.css and export dimensions against the spec. Do not rewrite live CSS to match documentation.

- [x] **Step 2: Update local CLAUDE.md and retain explicit follow-ups**

Append after phase 4:

```markdown
### TTY redesign — phase 5 icons (branch tty-redesign)

Plan: docs/superpowers/plans/2026-10-05-tty-redesign-phase5-icons.md.
The existing carrot module is the source for SVG checks and generated assets.
The colour SVG now includes brown (0,8). The Activity Bar retains icon.svg.
contributes.icons registers rabbithole-carrot at U+E001 using the committed
WOFF; statusText() and its active/inactive colour handling are unchanged.
The Marketplace tile is 128×128, an 8× carrot on #06090a, with a dark banner.
Normal builds need no Python. DESIGN.md now describes the implemented TTY
tokens, fonts, themes, CRT, focus behaviour, exports and asset regeneration.
The publisher is still rabbit-hole until the user supplies a registered id.
Publishing and Marketplace login remain user-run.

Follow-up in the separate rabbithole-cli repository: teach rabbithole doctor
that ActivitySession.languages and ActivitySession.intervals are known,
optional fields. Add fixtures with neither field, each field independently,
both fields, and a genuinely unknown field. Expected: known fields do not
warn, old sessions remain valid, unknown fields still warn. Keep mirror
schema and data ownership unchanged. Inspect that repository before choosing
file paths; this phase does not edit it.

Deferred phase 4 minors:
- Zero-day streak colour: sidebar mini.css currently colours the numeral with
  --add unconditionally, while the dashboard dims zero. A separate fix should
  cover zero -> positive -> zero in dark, light and high contrast, without
  decorating the streak.
- Duplicate initial sidebar data: reproduce webview ready plus host visibility
  notifications with a counting WebviewView stub and a real host trace.
  A lifecycle fix must send one initial settings/mini pair, still refresh on
  re-show and settings changes, and do no hidden-view polling.
- Deterministic buildMini midnight coverage: current payload tests use real
  dates. Add explicit local 23:59:59.999 and 00:00:00 fixtures with both dates'
  logs. Assert year.today and every log date agree; use a source negative
  control that reads an independent current date to prove the test catches
  day skew. Production buildMini already accepts now, so avoid changing its
  API merely to stabilize tests.
```

Only add the completed-implementation paragraph after Tasks 1–3 pass. Add actual gate results, fonttools version, host/platform outcomes and any remaining limitations as factual lines after running the checks; never copy intended results as observed facts. Update Relevant files and the tests table for the icons suite; use actual runner counts. Replace old branding backlog claims that icon/banner are absent, while preserving the unresolved publisher and publishing boundary. Do not force-add CLAUDE.md.

- [x] **Step 3: Check packaging and the no-Python build path**

Run all three gates with no generator invocation.

Run: `npx.cmd --no-install vsce ls`.
Expected: resources/icon.svg, resources/rabbithole-icon.svg, resources/icon.png and resources/rabbithole-icons.woff included; scripts/, test/, docs/ and CLAUDE.md excluded. .vscodeignore currently includes resources implicitly, so no speculative edit is needed. If vsce is not installed, report the packaging check as blocked or obtain execution-time approval to install the development packaging tool; do not claim an npm build verifies packaging.

With an available vsce, package locally only:

```powershell
npx.cmd --no-install vsce package --out test/.out/tty-phase5.vsix
```

Expected: local VSIX succeeds with all icon assets. No login, publish or version bump. Inspect the archive (ZIP reader or archive viewer), checking extension/package.json and its referenced asset paths. No user storage, test profile or local notes may be included.

- [ ] **Step 4: Perform and report the manual host acceptance cases**

Use the real Extension Development Host; browser harnesses cannot render contributed status-bar icons.

| Case | Expected |
|---|---|
| Reload after registration | Carrot replaces the blank before the unchanged time/target text |
| Windows at 16 px, 100% and 125% display scale | Recognisable carrot, right orientation, no clipped leaves/tip or baseline jump |
| macOS at 16 px | Same shape and acceptable alignment; if unavailable, explicitly unverified |
| Dark/light/high-contrast dark/high-contrast light | Activity Bar SVG remains visible; status glyph inherits item colour |
| Tracking then paused | Carrot and text turn existing green while active, return to default while paused |
| Default and a non-default product icon theme | Default contributed glyph is present unless the theme intentionally overrides this icon id |
| Activity Bar click | Existing carrot opens the Today view |
| Dashboard/sidebar/card/PDF | Existing colour carrots remain unchanged apart from the corrected resource SVG |
| Extension details from local VSIX | Marketplace tile is the carrot, with no generic/missing image |

After the wider §6 host checklist has actually passed (themes, narrow layouts, hover, CRT settings, exports, midnight), capture Marketplace screenshots from the TTY implementation. Do not claim those earlier-phase checks happened during this plan-writing turn.

- [x] **Step 5: Diff check and commit documentation**

Run: `git diff --check`.
Expected: no whitespace errors. Inspect `git diff -- DESIGN.md` and `git status --short`; preserve unrelated files.

```powershell
git add DESIGN.md
git commit -m "Document the TTY design and icon asset workflow"
```

CLAUDE.md remains local. Report automated checks, package checks, manual checks, installation/publisher decisions and deferred items separately.

## Plan self-review and stopping point

- §5: existing grid reused, colour SVG fixed, both SVGs checked, committed WOFF and registration, committed PNG and banner, publisher retained.
- §7: DESIGN.md replacement, local CLAUDE.md update and CLI follow-up included.
- Phase 4 constraints preserved with the explicit text-font/icon-font clarification.
- Every code task contains a red run, concrete implementation, expected results, gates and scoped commit.
- Five Review Focus items have automated or explicit host acceptance coverage.
- No implementation, installation, generated assets, commits, publishing or CLI edits are part of writing this plan.
- Stop here for the user's review. Execution method can be chosen after review; native execution fits these mostly sequential asset tasks, with independent review at the end.

## Execution record — 2026-10-05

The user subsequently requested implementation and explicitly approved installing
fonttools if needed. Tasks 1–3 are implemented; fonttools 4.66.1 generated the
committed WOFF. DESIGN.md and local CLAUDE.md were updated, including the CLI
follow-up and all three deferred phase 4 minors.

- Automated: 441 tests across 30 suites, typecheck and build passed. The separate
  Python geometry check passed. PNG and WOFF repeat generation matched their
  committed bytes. The new SVG, contribution and PNG assertions failed before
  their corresponding changes.
- Packaging: local `test/.out/tty-phase5.vsix` built successfully (17 archive
  entries). All four icon assets are present; source, tests, scripts, local
  guidance, test profiles and planning files are excluded.
- Windows host: the actual contributed WOFF loaded at 16 CSS px in dark, light,
  high-contrast dark and high-contrast light. Screenshots confirmed the status
  carrot; Activity Bar click opened Today and both existing carrots stayed
  visible. Evidence is local under `test/.out/phase5-host/`.
- Not verified: macOS; explicit 100%/125% OS scaling (the current host reported
  devicePixelRatio 1.10417); active-to-paused colour transition; a non-default
  product icon theme; installed-VSIX extension details; and the broader
  previous-phase export/midnight host checklist. Marketplace screenshots wait
  for that wider pass. The isolated test window was closed after inspection.
- Publisher remains `rabbit-hole`. Nothing was published or pushed.

### Independent review

The fresh reviewer found no phase 5 blockers or additional phase 5 minors.
Independent carrot/status/icons tests (9 assertions), Python font geometry,
VSIX contents and all four Windows host screenshots checked out.

One **pre-existing Important issue** remains outside this icon phase:
`src/webview/model.ts:276` treats elapsed minutes since midnight as local clock
minutes. In `America/New_York`, a session at 23:00–23:30 on 2026-03-08 paints
at 22:00; on 2026-11-01 the same 30 minutes disappear from the tape because
the 1440-minute clamp collapses the interval. Stored activity totals remain
intact. This affects consumers of the shared tape model, including exports.
Follow up separately with offset-transition/repeated-hour handling and
spring-forward/fall-back regressions; no model code was changed in phase 5.
The review approves phase 5, not unconditional whole-branch release readiness.

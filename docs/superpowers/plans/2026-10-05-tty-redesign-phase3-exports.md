# TTY Redesign — Phase 3 (Exports) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interim export dialog and the old share-card and report generators with the TTY designs from the exports mockup: a dialog with format / range / project / file name and a live preview, a 420×620 share card for today, 7 or 30 days, and a two-page dark A4 report for today, 7, 30 or 90 days, set in Martian Mono.

**Architecture:** Everything an export shows is computed by one pure module (`exportModel.ts`) from the same `year` and `range` payloads and `model.ts` functions the dashboard uses, and everything's position by another (`exportLayout.ts`), so the numbers and the "it fits" rules are tested in node. Two renderers only draw: `shareCard.ts` on a canvas, `reportPdf.ts` with jsPDF (which also runs in node, so the report gets real tests). The dialog fetches the last 90 days once with a `requestDays` tagged `for: "export"`, which the dashboard's `Store` ignores. Files reach disk through one host message, `writeFile`, whose name the host sanitises with the same `exportName.ts` the dialog uses to show it.

**Tech Stack:** TypeScript, VS Code webview API, canvas 2D, jsPDF 4 (already a dependency), esbuild (`--loader:.ttf=base64`), `node:test` + `node:assert` through `scripts/test.js`, Martian Mono v1.1.0 (variable woff2 already bundled; static TTFs added here).

**Spec:** `docs/superpowers/specs/2026-10-04-tty-redesign-design.md` — phase 3 is §4.3 (dialog), §4.4 (share card), §4.5 (report), and the export lines of §6. The visual reference for every detail this plan does not spell out is `docs/design/mockups/exports.html` (v2). Read both before starting. Phase 2's plan (`docs/superpowers/plans/2026-10-05-tty-redesign-phase2-dashboard.md`) built the modules this one consumes (`model.ts`, `format.ts`, `layout.ts`, `carrot.ts`, `state.ts`, `dom.ts`).

## Global Constraints

- No new runtime dependencies. `jspdf` stays; nothing is added to `package.json` `dependencies`.
- Never import `vscode` or `src/shared/config.ts` from `src/webview/*`. Type-only imports from `src/shared/types.ts`, and the pure `src/shared/exportName.ts`, are fine.
- **No webview module touches `document` or `window` at import time.** DOM work happens inside functions. That is what lets `exportModel.ts`, `exportLayout.ts`, `textFit.ts` and `reportPdf.ts` run under `node --test`.
- Day keys are local time: `dayKey()` (model.ts), `fromKey()` / `addDaysKey()` (format.ts). Never `toISOString().slice(0, 10)`, never `new Date("YYYY-MM-DD")`.
- CSP stays exactly `default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};`. The preview is a `<canvas>`, so no `img-src` is needed.
- Share card: 420×620 logical, drawn at 3×, always the phosphor palette, faint scanlines, no mask. Carrot 5× in the header, 2× in the footer. Card ranges: today, 7d, 30d.
- Report: A4, dark pages `#06090a`, hairline rounded frame inset 20 pt radius 6, flat (no glow, no scanlines). Carrot 4× in the header, 2× in the footer. Report ranges: today, 7d, 30d, 90d. Days table: newest first, 18 rows, 14 at 30 days and above, with an "and N earlier" line. Heatmap centred at 30 days (5 weeks) and 90 days (13 weeks).
- CSV and JSON keep their existing columns and shape (`exportCSV` / `exportJSON` are not changed). Ranges: today, 7d, 30d, 90d. The host still refuses a range that isn't real or is longer than 92 days.
- Fonts: the report embeds static Martian Mono **v1.1.0** TTFs (OFL; `src/webview/fonts/MartianMono-OFL.txt` is already committed) via `addFileToVFS` / `addFont`. jsPDF cannot embed the variable font.
- House style: TypeScript, 2-space indent, no semicolons, double quotes. Comments say why, not what.
- Tests run through `scripts/test.js`; new suites are registered in its `SUITES` array. Every task ends with `npm test`, `npm run typecheck` and `npm run build` passing.
- Commit messages: plain sentence case, no `feat:`-style prefix, and **no `Co-Authored-By` lines** (user rule, overrides any harness default).
- A negative control (the new test run against the pre-change source and seen to fail) is required wherever a task changes existing behaviour, per `CLAUDE.md`. The temp copy lives inside `src/` next to the original (relative imports must resolve) and is deleted afterwards.

## Deviations from the spec, decided while planning

1. **Marks are drawn as shapes, not block glyphs.** Checked 2026-10-05 against the release's `cmap`: Martian Mono v1.1.0 has **no** `░▒▓█`, `▁…▇`, `■□◆` in any instance (the dashboard shows them only because the browser falls back to Cascadia Mono / Consolas). jsPDF has no fallback at all, and a posted image must not depend on the machine's fallback fonts. So tape cells, heatmap cells, columns and streak marks are rectangles (and one diamond) in solid colours mixed toward the background by activity level (`SHADE`). The fonts suite pins this fact.
2. **New renderer files.** `shareCard.ts` and `reportPdf.ts` are new; `jpgExport.ts`, `pdfExport.ts` and `exportShared.ts` are deleted in Task 7 once the dialog has switched. Rewriting them in place would break the interim dialog's build between tasks.
3. **The static fonts are the Narrow width** (`MartianMono-NrRg.ttf`, `MartianMono-NrBd.ttf`, wdth 87.5): the width the dashboard's body text uses. The spec says "Regular and Bold", which these are.
4. **Text the font can't draw prints as `?`.** Martian Mono covers Latin and Cyrillic but not CJK or emoji, and has holes even in Latin Extended-A (no `Ĉ`). `reportPdf.ts` reads the embedded font's own `cmap` at runtime (`ttfCoverage`) and `pdfSafe` replaces anything else, so a project or file name never silently vanishes.
5. **One `writeFile` message** replaces `exportPdfRequest` / `pdfData` / `writePdf` / `writeJpg`. The webview renders from data it already has and sends the bytes plus the file name it showed; the host sanitises the name (`safeFileName`) and opens the save dialog on it. `export` (CSV/JSON) gains the same `name`.
6. **The dialog fetches 90 days once** (`requestDays` with `for: "export"`; the host echoes `for` on `range` / `rangeRefused`). Every span and project then renders from that one reply with no waiting, and the tag keeps the dashboard's `Store` from adopting it.
7. **The report's languages table matches the dashboard's languages card** (commit `03181ae`, 2026-10-05): most lines changed first, lines before time, the bar measuring lines. Colours still rank by time. The card's languages bar stays a share of *time* with percentages, as in the mockup.
8. **Row caps the spec doesn't give**, so page 2 can never overflow: languages 8, projects 6, sessions 20, files 10, each with an "… and N more" line (files say the total in their `git diff --stat` summary instead).
9. **The single-project, single-day report's eighth tile** is "daily target" (`met`, or `Nm short`) instead of the mockup's "1/1 days on target".
10. **No CSV/JSON text preview.** The spec asks for the card preview and the report's section list only; CSV and JSON show a one-line description of what they contain.
11. **A browser harness is committed** under `test/harness/` (excluded from the `.vsix` by `.vscodeignore`'s `test/`): one page draws every card variant and downloads every report variant from fixture data; another serves the real dashboard markup with a stubbed VS Code API. Phase 2 checked DOM modules this way ad hoc; this makes it repeatable.

## Review Focus

1. **A file name from the webview reaching the file system.** The host must never let a name carry folders (`..\..\x`), a different extension, or a Windows reserved name (`CON`). Tests in Task 2 (`exportName` and handler suites).
2. **Characters the PDF font lacks** — a CJK or emoji project name or file path — must print as `?`, never vanish and never throw. Tests in Task 1 (`pdfSafe`) and Task 6 (a report with such names renders).
3. **The busiest possible day or range** — 40 projects, 30 languages, 300 files, 50 sessions — must still be exactly two pages with every section inside the content area, and the card's blocks must stay inside 620 px. Tests in Task 4 (layout) and Task 6 (render).
4. **A brand-new install, an empty range, or a project cleared while the dialog is open** must give zeros and "none", never `NaN`, `Infinity` or a throw. Tests in Task 3 (empty world, unknown project) and Task 6 (empty report).
5. **Replies meant for someone else.** The export's 90-day fetch must never become the dashboard's view data, and a reply fetched before midnight must not feed a dialog that now wants today's window. Tests in Task 2 (`Store` ignores tagged replies); the dialog's own check is in Task 7 and exercised in the dashboard harness.

---

## File map

| File | Status | Job |
|---|---|---|
| `src/webview/fonts/MartianMono-NrRg.ttf`, `MartianMono-NrBd.ttf` | add | the report's static fonts (bundled as base64) |
| `src/webview/textFit.ts` | create | `ellipsize`, `ttfCoverage`, `pdfSafe` (pure) |
| `src/shared/exportName.ts` | create | suggested and sanitised file names (pure, shared by host and webview) |
| `src/shared/types.ts` | modify | `for` tag on `requestDays` / `range` / `rangeRefused`; `writeFile`; `name` on `export`; old export messages removed (Task 7) |
| `src/dashboard/messageHandler.ts` | modify | tagged replies, `writeFile`, one `saveFile`; old export handlers removed (Task 7) |
| `src/webview/state.ts` | modify | ignore tagged replies |
| `src/webview/exportModel.ts` | create | spans, palettes, `exportData()` (pure) |
| `src/webview/exportLayout.ts` | create | card blocks, report pages, caps, outline (pure) |
| `src/webview/shareCard.ts` | create | the card on a canvas |
| `src/webview/reportPdf.ts` | create | the report with jsPDF |
| `src/webview/exportDialog.ts` | replace | the dialog |
| `src/dashboard/dashboardPanel.ts` | modify | dialog markup |
| `src/webview/main.ts` | modify | wire `onExportMessage` |
| `src/webview/style.css` | modify | dialog styles |
| `src/webview/jpgExport.ts`, `pdfExport.ts`, `exportShared.ts` | delete (Task 7) | replaced |
| `scripts/test.js` | modify | `.ttf` loader, five new suites |
| `scripts/copy-assets.js` | modify | don't ship the bundled TTFs twice |
| `tsconfig.test.json` | modify | include `src/webview/fonts.d.ts` |
| `test/helpers/exportFixtures.ts` | create | `world()`, `sampleWorld()` |
| `test/shared.exportName.test.ts`, `webview.fonts.test.ts`, `webview.exportData.test.ts`, `webview.exportLayout.test.ts`, `webview.report.test.ts` | create | suites |
| `test/harness/exports.html`, `exports.ts`, `dashboard.js`, `dashboardStub.ts` | create | browser harnesses |

---

### Task 1: Static fonts and text fitting

**Files:**
- Add: `src/webview/fonts/MartianMono-NrRg.ttf`, `src/webview/fonts/MartianMono-NrBd.ttf`
- Create: `src/webview/textFit.ts`
- Modify: `scripts/test.js` (loader + suite), `scripts/copy-assets.js`
- Test: `test/webview.fonts.test.ts`

**Interfaces:**
- Produces: `ellipsize(text: string, maxW: number, width: (s: string) => number): string`, `ttfCoverage(bytes: Uint8Array): Set<number>`, `pdfSafe(text: string, covered: Set<number>): string`. The two TTF files, importable as base64 strings (`import MM from "./fonts/MartianMono-NrRg.ttf"`, typed by the existing `src/webview/fonts.d.ts`).

- [ ] **Step 1: Download the static fonts**

The fonts come from the same Martian Mono release as the dashboard's woff2, v1.1.0, asset `martian-mono-1.1.0-ttf.zip`. The zip holds one file per width × weight: `Cn` (75), `Nr` (87.5), `Std` (100), `sWd`; `Rg` / `Bd` are regular and bold.

```bash
mkdir -p "$TMPDIR/mm" && gh release download v1.1.0 --repo evilmartians/mono --pattern 'martian-mono-1.1.0-ttf.zip' --dir "$TMPDIR/mm" --clobber
cd "$TMPDIR/mm" && unzip -oq martian-mono-1.1.0-ttf.zip -d ttf && cd -
cp "$TMPDIR/mm/ttf/MartianMono-NrRg.ttf" "$TMPDIR/mm/ttf/MartianMono-NrBd.ttf" src/webview/fonts/
node -e "for (const f of ['NrRg','NrBd']) { const b = require('fs').readFileSync('src/webview/fonts/MartianMono-'+f+'.ttf'); console.log(f, b.readUInt32BE(0).toString(16), b.length) }"
```

Expected: both lines print `10000` (the TrueType signature) and a size around 119 000 / 125 000 bytes. The licence is the same OFL already committed as `src/webview/fonts/MartianMono-OFL.txt`.

- [ ] **Step 2: Teach the test runner `.ttf` files and register the suite**

In `scripts/test.js`, add a loader to the `esbuild.buildSync({ ... })` call inside `main()` (next to `alias`):

```js
      alias,
      loader: { ".ttf": "base64" },
      logLevel: "warning",
```

and append to `SUITES`:

```js
  {
    name: "fonts",
    entry: "test/webview.fonts.test.ts",
    alias: { textFit: "src/webview/textFit.ts" },
  },
```

In `scripts/copy-assets.js`, skip the static TTFs (they are bundled into `main.js` as base64; copying them too only adds weight to the `.vsix`):

```js
for (const file of fs.readdirSync(fontsSrc)) {
  // the report's static fonts are bundled into main.js as base64 (--loader:.ttf=base64)
  if (/^MartianMono-.*\.ttf$/.test(file)) continue
  fs.copyFileSync(path.join(fontsSrc, file), path.join(fontsDest, file))
  console.log(`Copied fonts/${file} →`, path.join(fontsDest, file))
}
```

- [ ] **Step 3: Write the failing test**

Create `test/webview.fonts.test.ts`:

```ts
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
```

- [ ] **Step 4: Run it to see it fail**

Run: `node scripts/test.js --suite fonts`
Expected: FAIL — esbuild cannot resolve `src/webview/textFit.ts`.

- [ ] **Step 5: Write `src/webview/textFit.ts`**

```ts
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
```

- [ ] **Step 6: Run the suite and the whole gate**

Run: `node scripts/test.js --suite fonts`
Expected: PASS, 5 tests.

Run: `npm test && npm run typecheck && npm run build`
Expected: all suites pass, typecheck clean, build succeeds, and the build log no longer lists `fonts/MartianMono-NrRg.ttf` among copied files.

- [ ] **Step 7: Commit**

```bash
git add src/webview/fonts/MartianMono-NrRg.ttf src/webview/fonts/MartianMono-NrBd.ttf src/webview/textFit.ts scripts/test.js scripts/copy-assets.js test/webview.fonts.test.ts
git commit -m "Add the report's static Martian Mono fonts and the text fitting helpers, with a check of what the font can draw"
```

---

### Task 2: File names and the export protocol on the host

**Files:**
- Create: `src/shared/exportName.ts`
- Modify: `src/shared/types.ts:116-135`, `src/dashboard/messageHandler.ts` (imports, `requestDays`, `export`, new `writeFile`, `writeExport` → `saveFile`), `src/webview/state.ts` (`receive`), `test/stubs/vscodeHost.ts`, `scripts/test.js`
- Test: `test/shared.exportName.test.ts`, `test/dashboard.handler.test.ts`, `test/webview.state.test.ts`

**Interfaces:**
- Produces: `type ExportExt = "jpg" | "pdf" | "csv" | "json"`; `exportFileName(project: string, to: string, days: number, ext: ExportExt): string`; `safeFileName(name: unknown, ext: ExportExt): string`.
- Produces (protocol): `WebviewMessage` `{ type: "requestDays"; from; to; for?: "export" }`, `{ type: "export"; format; from?; to?; projectId?; name?: string }`, `{ type: "writeFile"; kind: "jpg" | "pdf"; base64: string; name: string }`. `ExtensionMessage` `({ type: "range"; for?: "export" } & RangePayload)`, `{ type: "rangeRefused"; from; to; for?: "export" }`. Every save ends with an `actionResult` (ok "Saved <path>", ok "export cancelled, nothing written", or a failure).
- `Store.receive` ignores `range` / `rangeRefused` that carry `for`.
- The old `exportPdfRequest` / `pdfData` / `writePdf` / `writeJpg` stay until Task 7.

- [ ] **Step 1: Write the failing name tests**

Create `test/shared.exportName.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/shared/exportName.ts
import { exportFileName, safeFileName } from "exportName"

describe("suggested file names", () => {
  it("one day is named by its date, a range by its length and last day", () => {
    assert.strictEqual(exportFileName("rabbit-hole", "2026-10-05", 1, "jpg"), "rabbithole-rabbit-hole-2026-10-05.jpg")
    assert.strictEqual(exportFileName("all projects", "2026-10-05", 30, "pdf"), "rabbithole-all-projects-30d-to-2026-10-05.pdf")
  })

  it("project names become safe slugs, and a name with nothing usable still gives a name", () => {
    assert.strictEqual(exportFileName("git@github.com:me/X.git", "2026-10-05", 1, "csv"), "rabbithole-git-github-com-me-x-git-2026-10-05.csv")
    assert.strictEqual(exportFileName("日本", "2026-10-05", 7, "json"), "rabbithole-export-7d-to-2026-10-05.json")
  })
})

// The host never trusts a name from the webview.
describe("sanitised file names", () => {
  it("keeps a good name as it is", () => {
    assert.strictEqual(safeFileName("rabbithole-alpha-30d-to-2026-10-05.pdf", "pdf"), "rabbithole-alpha-30d-to-2026-10-05.pdf")
  })

  it("drops folders, so a name can't point outside the folder the user picks", () => {
    assert.strictEqual(safeFileName("..\\..\\Windows\\evil.jpg", "jpg"), "evil.jpg")
    assert.strictEqual(safeFileName("../../etc/evil.jpg", "jpg"), "evil.jpg")
  })

  it("forces the extension of the format being written", () => {
    assert.strictEqual(safeFileName("card.exe", "jpg"), "card.jpg")
    assert.strictEqual(safeFileName("rabbit-hole-export", "csv"), "rabbit-hole-export.csv")
  })

  it("never yields a reserved, hidden, empty or huge name", () => {
    assert.strictEqual(safeFileName("CON.jpg", "jpg"), "rabbithole-CON.jpg")
    assert.strictEqual(safeFileName(".hidden", "jpg"), "rabbithole-export.jpg")
    assert.strictEqual(safeFileName(undefined, "pdf"), "rabbithole-export.pdf")
    assert.strictEqual(safeFileName(42, "pdf"), "rabbithole-export.pdf")
    assert.ok(safeFileName("a".repeat(500) + ".pdf", "pdf").length <= 124)
  })
})
```

Register it in `scripts/test.js`:

```js
  {
    name: "exportname",
    entry: "test/shared.exportName.test.ts",
    alias: { exportName: "src/shared/exportName.ts" },
  },
```

Run: `node scripts/test.js --suite exportname`
Expected: FAIL — `src/shared/exportName.ts` does not exist.

- [ ] **Step 2: Write `src/shared/exportName.ts`**

```ts
// File names for exports, shared by the webview (shown in the dialog) and the
// host (the save dialog's default) so the two can't disagree. Pure: no vscode.
export type ExportExt = "jpg" | "pdf" | "csv" | "json"

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "export"

// rabbithole-<project>-<day>.<ext> for one day, rabbithole-<project>-<n>d-to-<day>.<ext> for a range.
export function exportFileName(project: string, to: string, days: number, ext: ExportExt): string {
  return `rabbithole-${slug(project)}-${days <= 1 ? to : `${days}d-to-${to}`}.${ext}`
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

// One path segment of safe characters with the right extension, whatever the
// webview sent: the save dialog opens on it inside a folder the host chose.
export function safeFileName(name: unknown, ext: ExportExt): string {
  const base = typeof name === "string" ? name.split(/[\\/]/).pop() ?? "" : ""
  let stem = base.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 120)
  if (!stem) stem = "rabbithole-export"
  if (RESERVED.test(stem)) stem = "rabbithole-" + stem
  return `${stem}.${ext}`
}
```

Run: `node scripts/test.js --suite exportname`
Expected: PASS, 6 tests.

- [ ] **Step 3: Let the host stub record saves**

Replace `test/stubs/vscodeHost.ts` with (additions: `saveOptions`, `writes`, `__saveTo`):

```ts
// `vscode` stub for the message-handler suite: records what the handler shows
// the user, what it offers to save and what it writes; keeps configuration
// writes in memory, and nothing else.

export const calls = {
  info: [] as string[],
  error: [] as string[],
  saveDialogs: 0,
  saveOptions: [] as any[],
  writes: [] as { path: string; bytes: Uint8Array }[],
}
const config: Record<string, unknown> = {}
let saveTo: string | undefined

export const window = {
  showInformationMessage: async (text: string) => { calls.info.push(text); return undefined },
  showErrorMessage: async (text: string) => { calls.error.push(text); return undefined },
  showWarningMessage: async () => undefined,
  showSaveDialog: async (options: unknown) => {
    calls.saveDialogs++
    calls.saveOptions.push(options)
    return saveTo === undefined ? undefined : { fsPath: saveTo }
  },
  showQuickPick: async () => undefined,
  showOpenDialog: async () => undefined,
}

export const workspace = {
  workspaceFolders: undefined as unknown,
  getConfiguration: () => ({
    get: (key: string) => config[key],
    update: async (key: string, value: unknown) => { config[key] = value },
  }),
  fs: { writeFile: async (uri: { fsPath: string }, bytes: Uint8Array) => { calls.writes.push({ path: uri.fsPath, bytes }) } },
}

export const ConfigurationTarget = { Global: 1 }
export const commands = { executeCommand: async () => undefined }
export const Uri = {
  file: (p: string) => ({ fsPath: p }),
  joinPath: (...parts: unknown[]) => ({ fsPath: parts.slice(1).join("/") }),
}
export const ViewColumn = { One: 1 }

// Where the next save dialog "saves"; undefined is the user pressing cancel.
export function __saveTo(path: string | undefined): void {
  saveTo = path
}

export function __reset(): void {
  calls.info.length = 0
  calls.error.length = 0
  calls.saveDialogs = 0
  calls.saveOptions.length = 0
  calls.writes.length = 0
  saveTo = undefined
}
```

- [ ] **Step 4: Write the failing handler and store tests**

Append to `test/dashboard.handler.test.ts`:

```ts
// Files are written by the host from bytes the webview sends, under a name the
// webview suggests and the host sanitises.
describe("export files", () => {
  const b64 = Buffer.from("fake jpeg bytes").toString("base64")
  const result = () => posted.find(m => m.type === "actionResult")

  it("a share card is offered under the suggested name and written, and the console hears where", async () => {
    v.__saveTo("/picked/card.jpg")
    handleMessage({ type: "writeFile", kind: "jpg", base64: b64, name: "rabbithole-alpha-2026-10-05.jpg" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveOptions[0].defaultUri.fsPath, "rabbithole-alpha-2026-10-05.jpg")
    assert.deepStrictEqual(Object.values(v.calls.saveOptions[0].filters), [["jpg", "jpeg"]])
    assert.strictEqual(Buffer.from(v.calls.writes[0].bytes).toString(), "fake jpeg bytes")
    assert.ok(result().ok && /Saved \/picked\/card\.jpg/.test(result().lines[0]))
  })

  it("a name from the webview can't point outside the folder or change the type", async () => {
    handleMessage({ type: "writeFile", kind: "pdf", base64: b64, name: "..\\..\\Windows\\evil.exe" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveOptions[0].defaultUri.fsPath, "evil.pdf")
  })

  it("cancelling the save dialog writes nothing and says so", async () => {
    handleMessage({ type: "writeFile", kind: "pdf", base64: b64, name: "r.pdf" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.writes.length, 0)
    assert.match(result().lines[0], /cancelled/)
  })

  it("an empty file or an unknown kind is refused before any dialog opens", async () => {
    handleMessage({ type: "writeFile", kind: "jpg", base64: "", name: "x.jpg" } as any, store(), panel)
    handleMessage({ type: "writeFile", kind: "exe", base64: b64, name: "x.exe" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveDialogs, 0)
    assert.strictEqual(result().ok, false)
  })

  it("csv and json are offered under the dialog's name too", async () => {
    handleMessage({ type: "export", format: "csv", from: today, to: today, name: "rabbithole-all-projects-x.csv" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveOptions[0].defaultUri.fsPath, "rabbithole-all-projects-x.csv")
  })

  it("an export's own fetch is tagged in the reply; the dashboard's is not", () => {
    handleMessage({ type: "requestDays", from: today, to: today, for: "export" } as any, store(), panel)
    handleMessage({ type: "requestDays", from: today, to: today } as any, store(), panel)
    handleMessage({ type: "requestDays", from: "1990-01-01", to: today, for: "export" } as any, store(), panel)
    assert.deepStrictEqual(posted.map(m => [m.type, m.for]), [["range", "export"], ["range", undefined], ["rangeRefused", "export"]])
  })
})
```

Append to `test/webview.state.test.ts` (inside the file, after the existing describes):

```ts
// The export dialog fetches its own 90 days; that reply must never become the
// dashboard's view data, even when its dates would cover the view.
describe("store: replies tagged for the export dialog", () => {
  it("ignores a tagged range and a tagged refusal", () => {
    s.receive(year("2026-10-03", OCT3))
    const span = fetchSpan("2026-10-03", "2026-10-03")
    s.receive({ ...rangeMsg(span.from, span.to), for: "export" })
    assert.strictEqual(s.days(), null)
    s.receive({ type: "rangeRefused", ...span, for: "export" })
    assert.strictEqual(s.refused, false)
    s.receive(rangeMsg(span.from, span.to))
    assert.notStrictEqual(s.days(), null)
  })
})
```

Run: `node scripts/test.js --suite handler` and `node scripts/test.js --suite state`
Expected: FAIL — handler: `writeFile` posts nothing, the CSV name is ignored, replies carry no `for`; state: the tagged range is adopted.

- [ ] **Step 5: Extend the protocol types**

In `src/shared/types.ts`, change these union members (leave the old export messages in place until Task 7):

```ts
export type ExtensionMessage =
  | { type: "settings"; dailyTargetMs: number; dailyTargetMinutes: number; idleThresholdMinutes: number; storagePath: string; crt: CrtSettings }
  | { type: "pdfData"; logs: DailyLog[]; projectName: string; dateRange: { from: string; to: string } }
  | ({ type: "year" } & YearPayload)
  | ({ type: "range"; for?: "export" } & RangePayload)   // for: the export dialog's own fetch, which the dashboard ignores
  | { type: "rangeRefused"; from: string; to: string; for?: "export" }
  | ({ type: "live" } & LivePayload)
  | { type: "actionResult"; ok: boolean; lines: string[] }
```

and in `WebviewMessage`:

```ts
  | { type: "requestDays"; from: string; to: string; for?: "export" }
  | { type: "export"; format: "csv" | "json"; from?: string; to?: string; projectId?: string; name?: string }
  | { type: "writeFile"; kind: "jpg" | "pdf"; base64: string; name: string }
```

- [ ] **Step 6: Handle them on the host**

In `src/dashboard/messageHandler.ts`, add imports:

```ts
import * as os from "os"
import { ExportExt, safeFileName } from "../shared/exportName"
```

Replace the `requestDays` and `export` cases, and add `writeFile` after them:

```ts
    case "requestDays": {
      const range = buildRange(storage, msg.from, msg.to)
      // the export dialog's fetch is tagged so the dashboard's view never adopts it
      const tag = msg.for === "export" ? { for: "export" as const } : {}
      panel.postMessage(range
        ? { type: "range", ...range, ...tag }
        : { type: "rangeRefused", from: msg.from, to: msg.to, ...tag })
      break
    }

    case "export": {
      // No range is the long-standing 90-day export; a given range must be a real one.
      if ((msg.from !== undefined || msg.to !== undefined) && !(msg.from && msg.to && isValidRange(msg.from, msg.to))) {
        tell(panel, false, `Rabbit Hole: Export needs a date range of at most ${MAX_RANGE_DAYS} days.`)
        break
      }
      const content = msg.format === "csv"
        ? storage.exportCSV(msg.from, msg.to, msg.projectId)
        : storage.exportJSON(msg.from, msg.to, msg.projectId)
      void saveFile(panel, new TextEncoder().encode(content), safeFileName(msg.name ?? "rabbit-hole-export", msg.format), msg.format)
      break
    }

    case "writeFile": {
      // The webview is trusted with drawing, not with the file system.
      if (msg.kind !== "jpg" && msg.kind !== "pdf") {
        tell(panel, false, "Rabbit Hole: Export failed: unknown file type.")
        break
      }
      const bytes = typeof msg.base64 === "string" && msg.base64.length <= MAX_FILE_BASE64 ? Buffer.from(msg.base64, "base64") : null
      if (!bytes || bytes.length === 0) {
        tell(panel, false, "Rabbit Hole: Export failed: the file was empty or too large.")
        break
      }
      void saveFile(panel, bytes, safeFileName(msg.name, msg.kind), msg.kind)
      break
    }
```

Near the other module constants (top of file, below the imports):

```ts
// A 3× share card is about 1 MB and a report a few hundred KB; anything near
// this is not something the dialog drew.
const MAX_FILE_BASE64 = 40 * 1024 * 1024
```

Replace `writeExport` (at the bottom of the file) with `saveFile`:

```ts
const FILTERS: Record<ExportExt, Record<string, string[]>> = {
  jpg: { "JPEG Images": ["jpg", "jpeg"] },
  pdf: { "PDF Files": ["pdf"] },
  csv: { "CSV Files": ["csv"] },
  json: { "JSON Files": ["json"] },
}

// Every export ends in an actionResult, so the dialog and the settings console
// always hear how it went.
async function saveFile(panel: DashboardPanel, bytes: Uint8Array, name: string, ext: ExportExt): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir())
  const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(folder, name), filters: FILTERS[ext] })
  if (!uri) {
    panel.postMessage({ type: "actionResult", ok: true, lines: ["export cancelled, nothing written"] })
    return
  }
  try {
    await vscode.workspace.fs.writeFile(uri, bytes)
    tell(panel, true, `Rabbit Hole: Saved ${uri.fsPath}`)
  } catch (err) {
    tell(panel, false, `Rabbit Hole: Couldn't save ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

`writePdfExport`, `writeJpgExport` and `exportFilename` stay for now (the interim dialog still sends `writePdf` / `writeJpg`).

- [ ] **Step 7: Make the store ignore tagged replies**

In `src/webview/state.ts`, at the top of the `"range"` and `"rangeRefused"` cases in `receive`:

```ts
      case "range": {
        if (msg.for) break   // the export dialog's own fetch
        // a reply to an older request is dropped unless it still covers the view
```

```ts
      case "rangeRefused": {
        if (msg.for) break
        const span = fetchSpan(this.view.from, this.view.to)
```

- [ ] **Step 8: Run the suites**

Run: `node scripts/test.js --suite handler` and `node scripts/test.js --suite state`
Expected: PASS.

- [ ] **Step 9: Negative controls**

```bash
git show HEAD:src/dashboard/messageHandler.ts > src/dashboard/_negcontrol.ts
node scripts/test.js --suite handler --alias handler=src/dashboard/_negcontrol.ts
git show HEAD:src/webview/state.ts > src/webview/_negcontrol.ts
node scripts/test.js --suite state --alias state=src/webview/_negcontrol.ts
rm src/dashboard/_negcontrol.ts src/webview/_negcontrol.ts
```

Expected: both runs FAIL — every test in "export files" and the "replies tagged for the export dialog" test. (If `git show` of the pre-change file is the wrong revision because you committed already, use `HEAD~1`.)

- [ ] **Step 10: Full gate and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add src/shared/exportName.ts src/shared/types.ts src/dashboard/messageHandler.ts src/webview/state.ts test/stubs/vscodeHost.ts test/shared.exportName.test.ts test/dashboard.handler.test.ts test/webview.state.test.ts scripts/test.js
git commit -m "Save exports through one host path with a sanitised suggested name, and tag the export dialog's own fetch so the dashboard ignores it"
```

---

### Task 3: The export model

**Files:**
- Create: `src/webview/exportModel.ts`, `test/helpers/exportFixtures.ts`
- Modify: `scripts/test.js`
- Test: `test/webview.exportData.test.ts`

**Interfaces:**
- Consumes: `buildView`, `seriesFor`, `storedStreak`, `tapeWindow`, `tapeCells`, `dayKey`, `Selection`, `TapeWindow`, `TapeCell` (model.ts); `addDaysKey`, `clock`, `dstr`, `shortDate`, `splitPath` (format.ts); `heatCells`, `heatLevel`, `tapeCellCount` (layout.ts).
- Produces (exact):

```ts
export type Format = "card" | "report" | "csv" | "json"
export type Span = "today" | "7d" | "30d" | "90d"
export const SPAN_DAYS: Record<Span, number>
export const ALL_SPANS: Span[]
export const SPANS: Record<Format, Span[]>
export function fitSpan(format: Format, span: Span): Span
export function spanDates(span: Span, today: string): { from: string; to: string }
export const CARD: { bg; panel; rule; ink; dim; mute; amber; add; del }   // hex strings
export const PAGE: { bg; rule; frame; ink; dim; mute; amber; add; del }
export const LANG_COLORS: string[]; export const OTHER_COLOR: string; export const SHADE: number[]
export function mix(color: string, bg: string, t: number): string
export interface ExportDay { date: string; ms: number; met: boolean; today: boolean; added: number; deleted: number }
export interface ExportLang { name: string; ms: number; added: number; deleted: number; color: string }
export interface ExportSession { start: number; end: number; activeMs: number; languages: string[]; project: string }
export interface ExportFile { dir: string; name: string; added: number; deleted: number }
export type Mark = "met" | "miss" | "today"
export interface Tape { win: TapeWindow; cells: TapeCell[] }
export interface HeatCell { date: string; level: 0 | 1 | 2 | 3 | 4; today: boolean }
export interface ExportData { ...see Step 3... }
export function dayTape(sessions: ActivitySession[], maxCells: number, now: number): Tape
export function exportData(range: RangePayload, year: YearPayload, sel: Selection, span: Span, now: number): ExportData
export function generatedText(now: number): string
export function rangeText(d: ExportData): string
```

- Produces (test helper, `test/helpers/exportFixtures.ts`): `MIN`, `TODAY` (`"2026-10-05"`, a Monday), `addDays(key, n)`, `at(day, h, m?)`, `DaySpec`, `dayLog(date, spec)`, `world(spec, opts?) → { year, range }`, `sampleWorld()`.

- [ ] **Step 1: Write the fixtures**

Create `test/helpers/exportFixtures.ts`. It is pure data (no imports), so the node suites and the browser harnesses share it.

```ts
// Payloads for the export suites and the browser harnesses: a 365-day year
// ending on Monday 2026-10-05 (so it starts on a Monday, as the host's does)
// and range logs for the last 90 days, built from a compact description.
export const MIN = 60_000
export const TODAY = "2026-10-05"

const key = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number)
  return key(new Date(y, m - 1, d + n))
}
export function at(day: string, h: number, m = 0): number {
  const [y, mo, d] = day.split("-").map(Number)
  return new Date(y, mo - 1, d, h, m).getTime()
}

export interface DaySpec {
  ms: number
  langs?: Record<string, [number, number, number]>                     // name -> [time ms, added, deleted]
  files?: [string, number, number][]                                  // [absolute path, added, deleted]
  sessions?: [number, number, number, Record<string, number>?][]      // [start minute of day, span min, active min, languages]
}

export function dayLog(date: string, spec: DaySpec): any {
  return {
    date,
    totalTime: spec.ms,
    activeTime: spec.ms,
    streak: 0,
    languages: Object.fromEntries(Object.entries(spec.langs ?? {}).map(([l, [t, a, d]]) => [l, { time: t, linesAdded: a, linesDeleted: d }])),
    agents: {},
    files: (spec.files ?? []).map(([path, a, d]) => ({ path, language: "typescript", linesAdded: a, linesDeleted: d, lastModified: 0 })),
    sessions: (spec.sessions ?? []).map(([startMin, span, active, languages], i) => {
      const start = at(date, 0, startMin)
      return {
        id: `${date}-${i}`, startTime: start, endTime: start + span * MIN, duration: span * MIN,
        activeTime: active * MIN, languages, intervals: [[start, start + span * MIN]],
      }
    }),
  }
}

export interface WorldOpts {
  targetMin?: number
  stamped?: Record<string, number>   // date -> global target minutes stamped on that day
  globalStreak?: number
  streaks?: Record<string, number>
  names?: Record<string, string>
  ids?: string[]                     // registered projects; defaults to the spec's keys
}

// Every registered project gets a log for every one of the last 90 days, as
// the host's range reply does.
export function world(spec: Record<string, Record<string, DaySpec>>, opts: WorldOpts = {}): { year: any; range: any } {
  const ids = opts.ids ?? Object.keys(spec)
  const days = Array.from({ length: 365 }, (_, i) => addDays(TODAY, i - 364))
  const active = (id: string, d: string) => spec[id]?.[d]?.ms ?? 0
  const year = {
    today: TODAY,
    days,
    globalTargetMs: (opts.targetMin ?? 20) * MIN,
    global: {
      streak: opts.globalStreak ?? 0,
      active: days.map(d => ids.reduce((n, id) => n + active(id, d), 0)),
      targetMs: days.map(d => (opts.stamped?.[d] !== undefined ? opts.stamped[d] * MIN : null)),
    },
    projects: ids.map(id => ({
      id, name: opts.names?.[id] ?? id, path: `/work/${id}`, streak: opts.streaks?.[id] ?? 0,
      active: days.map(d => active(id, d)), targetMs: days.map(() => null),
    })),
  }
  const from = addDays(TODAY, -89)
  const range = {
    from,
    to: TODAY,
    logs: Object.fromEntries(ids.map(id => [id, days.filter(d => d >= from).map(d => dayLog(d, spec[id]?.[d] ?? { ms: 0 }))])),
  }
  return { year, range }
}

// A plausible quarter for the harnesses: today matches the mockup's sessions.
export function sampleWorld(): { year: any; range: any } {
  let seed = 4242
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const rh: Record<string, DaySpec> = {}
  const cli: Record<string, DaySpec> = {}
  for (let i = 1; i < 90; i++) {
    const d = addDays(TODAY, -i)
    if (rnd() < 0.25) continue
    const ms = Math.round(10 + rnd() * 220) * MIN
    rh[d] = {
      ms,
      langs: { typescript: [ms * 0.7, Math.round(rnd() * 300), Math.round(rnd() * 120)], markdown: [ms * 0.3, Math.round(rnd() * 60), Math.round(rnd() * 20)] },
      files: [["/work/rabbit-hole/src/tracker/lineLedger.ts", 40, 12], ["/work/rabbit-hole/CLAUDE.md", 12, 3]],
    }
    if (rnd() < 0.5) {
      cli[d] = { ms: Math.round(ms * 0.3), langs: { go: [Math.round(ms * 0.3), 30, 8] }, files: [["/work/rabbithole-cli/cmd/rabbithole/main.go", 30, 8]] }
    }
  }
  rh[TODAY] = {
    ms: 192 * MIN,
    langs: { typescript: [122 * MIN, 280, 110], markdown: [35 * MIN, 52, 9], css: [12 * MIN, 21, 12], json: [6 * MIN, 8, 2], go: [17 * MIN, 31, 8] },
    files: [
      ["/work/rabbit-hole/src/tracker/lineLedger.ts", 142, 61], ["/work/rabbit-hole/src/tracker/activityTracker.ts", 96, 58],
      ["/work/rabbit-hole/test/tracker.ledger.test.ts", 64, 14], ["/work/rabbit-hole/CLAUDE.md", 38, 6], ["/work/rabbit-hole/src/webview/style.css", 21, 12],
    ],
    sessions: [
      [8 * 60 + 41, 77, 64, { typescript: 45 * MIN, markdown: 13 * MIN, json: 6 * MIN }],
      [10 * 60 + 20, 105, 78, { typescript: 66 * MIN, css: 12 * MIN }],
      [14 * 60 + 2, 29, 22, { markdown: 22 * MIN }],
      [16 * 60 + 10, 48, 28, { go: 17 * MIN, typescript: 11 * MIN }],
    ],
  }
  cli[TODAY] = { ms: 28 * MIN, langs: { go: [21 * MIN, 31, 8], markdown: [7 * MIN, 4, 0] }, files: [["/work/rabbithole-cli/cmd/rabbithole/main.go", 31, 8]], sessions: [[17 * 60 + 18, 33, 28, { go: 21 * MIN, markdown: 7 * MIN }]] }
  return world({ "rabbit-hole": rh, "rabbithole-cli": cli }, { globalStreak: 12, streaks: { "rabbit-hole": 9, "rabbithole-cli": 2 } })
}
```

- [ ] **Step 2: Write the failing tests**

Register in `scripts/test.js`:

```js
  {
    name: "exportdata",
    entry: "test/webview.exportData.test.ts",
    alias: { exportModel: "src/webview/exportModel.ts" },
  },
```

Create `test/webview.exportData.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/exportModel.ts
import { LANG_COLORS, SPANS, exportData, fitSpan, generatedText, mix, rangeText, spanDates } from "exportModel"
import { MIN, TODAY, addDays, at, world } from "./helpers/exportFixtures"

const D1 = addDays(TODAY, -1)
const D2 = addDays(TODAY, -2)
const NOW = at(TODAY, 18)

// alpha: today 50m (two sessions), yesterday 25m, the day before 10m; beta: today 30m.
function busy(opts: any = {}) {
  return world({
    alpha: {
      [TODAY]: {
        ms: 50 * MIN,
        langs: { typescript: [40 * MIN, 100, 20], markdown: [10 * MIN, 5, 0] },
        files: [["/work/alpha/src/a.ts", 100, 20], ["/work/alpha/README.md", 5, 0]],
        sessions: [[9 * 60, 60, 40, { typescript: 40 * MIN }], [14 * 60, 15, 10, { markdown: 10 * MIN }]],
      },
      [D1]: { ms: 25 * MIN },
      [D2]: { ms: 10 * MIN },
    },
    beta: {
      [TODAY]: { ms: 30 * MIN, langs: { go: [30 * MIN, 10, 2] }, files: [["/work/beta/main.go", 10, 2]], sessions: [[11 * 60, 40, 30, { go: 30 * MIN }]] },
    },
  }, { globalStreak: 3, streaks: { alpha: 2 }, ...opts })
}
const data = (w: any, sel: string, span: string) => exportData(w.range, w.year, sel, span, NOW)

describe("export spans", () => {
  it("the card has no 90 days; switching to it keeps the longest span it has", () => {
    assert.ok(!SPANS.card.includes("90d"))
    assert.strictEqual(fitSpan("card", "90d"), "30d")
    assert.strictEqual(fitSpan("report", "30d"), "30d")
  })

  it("a span ends today and counts today", () => {
    assert.deepStrictEqual(spanDates("7d", TODAY), { from: addDays(TODAY, -6), to: TODAY })
    assert.deepStrictEqual(spanDates("today", TODAY), { from: TODAY, to: TODAY })
  })
})

describe("one day, all projects", () => {
  const d = data(busy(), "all", "today")

  it("totals the day across projects, from the fetched 90 days narrowed to today", () => {
    assert.strictEqual(d.title, "all projects")
    assert.strictEqual(d.daysList.length, 1)
    assert.strictEqual(d.totalMs, 80 * MIN)
    assert.deepStrictEqual([d.added, d.deleted], [115, 22])
  })

  it("lists every session in time order with its project and languages", () => {
    assert.deepStrictEqual(d.sessions.map((s: any) => [s.start, s.project, s.languages]), [
      [at(TODAY, 9), "alpha", ["typescript"]],
      [at(TODAY, 11), "beta", ["go"]],
      [at(TODAY, 14), "alpha", ["markdown"]],
    ])
    assert.strictEqual(d.firstStart, at(TODAY, 9))
    assert.strictEqual(d.lastEnd, at(TODAY, 14, 15))
  })

  it("ranks languages by time and colours them by that rank", () => {
    assert.deepStrictEqual(d.langs.map((l: any) => [l.name, l.color]), [["typescript", LANG_COLORS[0]], ["go", LANG_COLORS[1]], ["markdown", LANG_COLORS[2]]])
  })

  it("takes the streak from storage and marks the last 14 days against each day's target", () => {
    assert.strictEqual(d.streak, 3)
    assert.strictEqual(d.marks.length, 14)
    assert.deepStrictEqual(d.marks.slice(-3), ["miss", "met", "today"])   // 10m, 25m, today
  })

  it("draws the day on a 24-cell tape for the card and a 48-cell one for the report", () => {
    assert.strictEqual(d.tapes.card.cells.length, 24)
    assert.strictEqual(d.tapes.report.cells.length, 48)
    assert.strictEqual(d.tapes.report.win.cellMin, 15)
    assert.strictEqual(d.heat, null)
  })

  it("lists projects by time, and files as git would with the project in front", () => {
    assert.deepStrictEqual(d.projects, [{ name: "alpha", ms: 50 * MIN }, { name: "beta", ms: 30 * MIN }])
    assert.deepStrictEqual(d.files.map((f: any) => [f.dir, f.name, f.added, f.deleted]), [
      ["alpha/src/", "a.ts", 100, 20], ["beta/", "main.go", 10, 2], ["alpha/", "README.md", 5, 0],
    ])
  })
})

describe("a range for one project", () => {
  const d = data(busy(), "alpha", "7d")

  it("has one entry per day, and counts active days, the best day and the average", () => {
    assert.strictEqual(d.title, "alpha")
    assert.strictEqual(d.daysList.length, 7)
    assert.ok(d.daysList[6].today)
    assert.strictEqual(d.activeDays, 3)
    assert.strictEqual(d.totalMs, 85 * MIN)
    assert.strictEqual(d.best.date, TODAY)
    assert.strictEqual(d.perActiveMs, 85 * MIN / 3)
  })

  it("counts days on target, has no sessions or tape, and uses the project's own streak", () => {
    assert.strictEqual(d.metDays, 2)
    assert.deepStrictEqual(d.sessions, [])
    assert.strictEqual(d.tapes, null)
    assert.deepStrictEqual(d.projects, [])
    assert.strictEqual(d.streak, 2)
    assert.strictEqual(d.files[0].dir, "src/")
  })

  it("judges a past day against the target stamped on it, today against the live one", () => {
    const s = data(busy({ stamped: { [D1]: 30 } }), "all", "7d")
    assert.strictEqual(s.daysList.find((x: any) => x.date === D1).met, false)
    assert.strictEqual(s.metDays, 1)
  })
})

describe("heatmaps", () => {
  it("30 days get five Monday-first weeks ending this week; days after today are empty", () => {
    const h = data(busy(), "all", "30d").heat
    assert.strictEqual(h.weeks, 5)
    assert.strictEqual(h.cells.length, 35)
    assert.deepStrictEqual(h.cells[28], { date: TODAY, level: 2, today: true })
    assert.deepStrictEqual(h.cells[27], { date: D1, level: 1, today: false })
    assert.ok(h.cells.slice(29).every((c: any) => c === null))
  })

  it("90 days get thirteen weeks and every day of the span", () => {
    const d = data(busy(), "all", "90d")
    assert.strictEqual(d.heat.weeks, 13)
    assert.strictEqual(d.heat.cells.length, 91)
    assert.strictEqual(d.daysList.length, 90)
  })
})

describe("nothing to show", () => {
  it("a brand-new install gives zeros, never NaN", () => {
    const w = world({}, { ids: ["alpha"] })
    for (const span of ["today", "7d", "90d"]) {
      const d = data(w, "all", span)
      for (const k of ["totalMs", "activeDays", "perActiveMs", "added", "deleted", "metDays", "streak"]) {
        assert.ok(Number.isFinite(d[k]), `${span} ${k} = ${d[k]}`)
      }
      assert.strictEqual(d.best, null)
      assert.deepStrictEqual([d.langs, d.files, d.sessions], [[], [], []])
    }
    const day = data(w, "all", "today")
    assert.strictEqual(day.firstStart, null)
    assert.ok(day.tapes.card.cells.every((c: any) => c.level === 0))
  })

  it("a project cleared while the dialog was open is an empty, named export", () => {
    const d = data(busy(), "gone", "7d")
    assert.strictEqual(d.title, "unknown project")
    assert.strictEqual(d.totalMs, 0)
    assert.strictEqual(d.streak, 0)
  })
})

describe("export text and colour helpers", () => {
  it("mixes a colour toward the background by a clamped amount", () => {
    assert.strictEqual(mix("#39d98a", "#06090a", 1), "#39d98a")
    assert.strictEqual(mix("#39d98a", "#06090a", 0), "#06090a")
    assert.strictEqual(mix("#39d98a", "#06090a", 2), "#39d98a")
  })

  it("says when it was generated and which days it covers", () => {
    assert.strictEqual(generatedText(at(TODAY, 17, 58)), "generated 5 Oct 2026 17:58")
    assert.strictEqual(rangeText(data(busy(), "all", "today")), "Mon 5 Oct")
    assert.strictEqual(rangeText(data(busy(), "all", "7d")), "Tue 29 Sep – Mon 5 Oct")
  })
})
```

Run: `node scripts/test.js --suite exportdata`
Expected: FAIL — `src/webview/exportModel.ts` does not exist.

- [ ] **Step 3: Write `src/webview/exportModel.ts`**

```ts
// What an export shows, computed from the same payloads and model as the
// dashboard, so a share card or report never disagrees with the screen. Pure:
// the renderers and the dialog only draw what this returns.
import type { ActivitySession, RangePayload, YearPayload } from "../shared/types"
import { addDaysKey, clock, dstr, shortDate, splitPath } from "./format"
import { heatCells, heatLevel, tapeCellCount } from "./layout"
import { Selection, TapeCell, TapeWindow, buildView, dayKey, seriesFor, storedStreak, tapeCells, tapeWindow } from "./model"

export type Format = "card" | "report" | "csv" | "json"
export type Span = "today" | "7d" | "30d" | "90d"

export const SPAN_DAYS: Record<Span, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 }
export const ALL_SPANS: Span[] = ["today", "7d", "30d", "90d"]
// The card has no 90-day layout: 90 columns don't fit 420 px.
export const SPANS: Record<Format, Span[]> = {
  card: ["today", "7d", "30d"],
  report: ALL_SPANS,
  csv: ALL_SPANS,
  json: ALL_SPANS,
}

// Switching to a format that lacks the chosen span keeps the longest one it has that isn't longer.
export function fitSpan(format: Format, span: Span): Span {
  const ok = SPANS[format]
  if (ok.includes(span)) return span
  return [...ok].reverse().find(s => SPAN_DAYS[s] <= SPAN_DAYS[span]) ?? ok[0]
}

export function spanDates(span: Span, today: string): { from: string; to: string } {
  return { from: addDaysKey(today, -(SPAN_DAYS[span] - 1)), to: today }
}

// Exports are files people post and print: literal colours, always the dark
// phosphor look whatever the editor theme. Values from the exports mockup.
export const CARD = { bg: "#050b08", panel: "#08110d", rule: "#22392d", ink: "#cfeedd", dim: "#86a596", mute: "#56705f", amber: "#ffb703", add: "#39d98a", del: "#ff6b6b" }
export const PAGE = { bg: "#06090a", rule: "#22392d", frame: "#2c4436", ink: "#dcfbe6", dim: "#86a596", mute: "#5b7468", amber: "#ffb703", add: "#39d98a", del: "#ff6b6b" }
export const LANG_COLORS = ["#1fa866", "#2a8fd0", "#b87e00", "#d0508f", "#8a6fe0", "#9a9420"]
export const OTHER_COLOR = "#4f6459"
// How much of a mark's colour shows at each activity level. Solid colours mixed
// toward the background, never transparency, which JPEG and PDF both keep exactly.
export const SHADE = [0, 0.3, 0.55, 0.8, 1]

export function mix(color: string, bg: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  const k = Math.max(0, Math.min(1, t))
  return "#" + [0, 1, 2].map(i => Math.round(ch(bg, i) + (ch(color, i) - ch(bg, i)) * k).toString(16).padStart(2, "0")).join("")
}

export interface ExportDay { date: string; ms: number; met: boolean; today: boolean; added: number; deleted: number }
export interface ExportLang { name: string; ms: number; added: number; deleted: number; color: string }
export interface ExportSession { start: number; end: number; activeMs: number; languages: string[]; project: string }
export interface ExportFile { dir: string; name: string; added: number; deleted: number }
export type Mark = "met" | "miss" | "today"
export interface Tape { win: TapeWindow; cells: TapeCell[] }
export interface HeatCell { date: string; level: 0 | 1 | 2 | 3 | 4; today: boolean }

export interface ExportData {
  title: string                 // the project's name, or "all projects"
  sel: Selection
  from: string
  to: string
  today: string
  days: number                  // the span's length
  single: boolean               // one day (today)
  generatedAt: number
  totalMs: number
  activeDays: number
  perActiveMs: number
  best: ExportDay | null
  added: number
  deleted: number
  targetMs: number              // today's target for the selection
  metDays: number
  streak: number                // storage's
  marks: Mark[]                 // the last 14 days, today last
  firstStart: number | null     // single day: first session start
  lastEnd: number | null        // single day: last session end (an open one: now)
  langs: ExportLang[]           // most time first; colours by that rank, like the dashboard
  daysList: ExportDay[]         // from..to, oldest first
  sessions: ExportSession[]     // single day only, by start
  tapes: { card: Tape; report: Tape } | null   // single day only
  files: ExportFile[]           // biggest change first
  projects: { name: string; ms: number }[]     // all projects only, active ones, most time first
  heat: { weeks: number; cells: (HeatCell | null)[] } | null   // 30d: 5 weeks, 90d: 13
}

// The dashboard's own tape rules: the finest whole-minute cell that fits.
export function dayTape(sessions: ActivitySession[], maxCells: number, now: number): Tape {
  const first = tapeWindow(sessions, 1, now)
  const win = tapeWindow(sessions, tapeCellCount(first.endMin - first.startMin, maxCells), now)
  return { win, cells: tapeCells(sessions, win, now) }
}

export function exportData(range: RangePayload, year: YearPayload, sel: Selection, span: Span, now: number): ExportData {
  const { from, to } = spanDates(span, year.today)
  // the dialog fetches 90 days once; every span is a slice of that reply
  const logs = Object.fromEntries(Object.entries(range.logs).map(([id, list]) => [id, list.filter(l => l.date >= from && l.date <= to)]))
  const view = buildView({ from, to, logs }, sel, null)
  const series = seriesFor(year, sel)
  const n = series.days.length
  const at = new Map(series.days.map((d, i) => [d, i] as [string, number]))
  const liveTarget = n ? series.targetMs[n - 1] : year.globalTargetMs
  const targetOn = (date: string) => {
    const i = at.get(date)
    return i === undefined ? liveTarget : series.targetMs[i]
  }
  const daysList: ExportDay[] = view.days.map(d => ({
    date: d.date,
    ms: d.whole.activeMs,
    met: d.whole.activeMs >= targetOn(d.date),
    today: d.date === year.today,
    added: d.whole.linesAdded,
    deleted: d.whole.linesDeleted,
  }))
  const active = daysList.filter(d => d.ms > 0)
  const best = active.reduce<ExportDay | null>((b, d) => (b && b.ms >= d.ms ? b : d), null)
  const project = (id: string | undefined) => year.projects.find(p => p.id === id)
  const name = (id: string | undefined) => project(id)?.name ?? "unknown project"

  const single = span === "today"
  const last = view.days[view.days.length - 1]
  const raw = single && last ? last.whole.sessions : []
  const sessions: ExportSession[] = raw.map(s => ({
    start: s.startTime,
    end: s.endTime ?? Math.max(s.startTime, now),
    activeMs: s.activeTime,
    languages: Object.entries(s.languages ?? {}).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]).map(([l]) => l),
    project: name(s.projectId),
  }))

  const marks: Mark[] = []
  for (let i = Math.max(0, n - 14); i < n; i++) {
    marks.push(i === n - 1 ? "today" : series.active[i] >= series.targetMs[i] ? "met" : "miss")
  }
  const heatWeeks = span === "90d" ? 13 : span === "30d" ? 5 : 0

  return {
    title: sel === "all" ? "all projects" : name(sel),
    sel, from, to,
    today: year.today,
    days: SPAN_DAYS[span],
    single,
    generatedAt: now,
    totalMs: view.totalMs,
    activeDays: active.length,
    perActiveMs: active.length ? view.totalMs / active.length : 0,
    best,
    added: view.linesAdded,
    deleted: view.linesDeleted,
    targetMs: liveTarget,
    metDays: daysList.filter(d => d.met).length,
    streak: storedStreak(year, sel),
    marks,
    firstStart: sessions.length ? Math.min(...sessions.map(s => s.start)) : null,
    lastEnd: sessions.length ? Math.max(...sessions.map(s => s.end)) : null,
    langs: view.languages.map((l, i) => ({ ...l, color: LANG_COLORS[i] ?? OTHER_COLOR })),
    daysList,
    sessions,
    tapes: single ? { card: dayTape(raw, 24, now), report: dayTape(raw, 48, now) } : null,
    files: view.files.map(f => {
      const p = splitPath(f.path, project(f.projectId)?.path)
      return { dir: (sel === "all" ? name(f.projectId) + "/" : "") + p.dir, name: p.name, added: f.added, deleted: f.deleted }
    }),
    projects: sel === "all"
      ? Object.entries(logs)
        .map(([id, list]) => ({ name: name(id), ms: list.reduce((t, l) => t + l.activeTime, 0) }))
        .filter(p => p.ms > 0)
        .sort((a, b) => b.ms - a.ms)
      : [],
    heat: heatWeeks
      ? {
        weeks: heatWeeks,
        cells: heatCells(n, heatWeeks).map(i => (i === null ? null : { date: series.days[i], level: heatLevel(series.active[i]), today: series.days[i] === year.today })),
      }
      : null,
  }
}

export function generatedText(now: number): string {
  const k = dayKey(new Date(now))
  return `generated ${shortDate(k)} ${k.slice(0, 4)} ${clock(now)}`
}

export const rangeText = (d: ExportData): string => (d.single ? dstr(d.to) : `${dstr(d.from)} – ${dstr(d.to)}`)
```

- [ ] **Step 4: Run the suites**

Run: `node scripts/test.js --suite exportdata`
Expected: PASS, 17 tests.

Run: `node scripts/test.js --suite fonts`
Expected: PASS — `exportModel.ts` is now scanned; its only non-ASCII character is `–` in `rangeText`, which the font has.

- [ ] **Step 5: Full gate and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add src/webview/exportModel.ts test/helpers/exportFixtures.ts test/webview.exportData.test.ts scripts/test.js
git commit -m "Compute what a share card or report shows from the dashboard's own payloads and model"
```

---

### Task 4: Export layout — card blocks, report pages, caps and outline

**Files:**
- Create: `src/webview/exportLayout.ts`
- Modify: `scripts/test.js`
- Test: `test/webview.exportLayout.test.ts`

**Interfaces:**
- Consumes: `ExportData` (type only) from `exportModel.ts`; `plural` from `format.ts`.
- Produces (exact):

```ts
export const CARD_W = 420, CARD_H = 620, CARD_SCALE = 3, CARD_X = 24, CARD_TOP = 22, CARD_BOTTOM = 18, CARD_GAP = 12
export type CardKind = "header" | "hero" | "tiles" | "tape" | "columns" | "languages" | "footer"
export interface CardBlock { kind: CardKind; y: number; h: number }
export function cardLayout(d: ExportData): CardBlock[]
export const PAGE_W = 595.28, PAGE_H = 841.89, FRAME_INSET = 20, FRAME_RADIUS = 6, PAGE_X = 38, PAGE_TOP = 34, PAGE_BOTTOM = 28
export const HEADER_H = 46, FOOTER_H = 26, GAP = 12, ROW = 13, TITLE_H = 16
export const CONTENT_TOP: number, CONTENT_H: number
export const CAPS = { langs: 8, projects: 6, sessions: 20, files: 10 }
export function dayRowCap(days: number): number
export type SectionKind = "tiles" | "tape" | "columns" | "langs" | "projects" | "sessions" | "days" | "files" | "heat"
export interface Section { kind: SectionKind; rows: number; more: number; h: number }
export function reportPages(d: ExportData): Section[][]
export function stackHeight(s: Section[]): number
export function reportOutline(d: ExportData): { page: number; items: string[] }[]
```

- [ ] **Step 1: Write the failing tests**

Register in `scripts/test.js`:

```js
  {
    name: "exportlayout",
    entry: "test/webview.exportLayout.test.ts",
    alias: { exportModel: "src/webview/exportModel.ts", exportLayout: "src/webview/exportLayout.ts" },
  },
```

Create `test/webview.exportLayout.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/exportLayout.ts
import { CARD_BOTTOM, CARD_H, CARD_TOP, CONTENT_H, cardLayout, dayRowCap, reportOutline, reportPages, stackHeight } from "exportLayout"
// @ts-ignore — esbuild alias to src/webview/exportModel.ts
import { exportData } from "exportModel"
import { MIN, TODAY, at, world } from "./helpers/exportFixtures"

const w = world({
  alpha: {
    [TODAY]: {
      ms: 50 * MIN,
      langs: { typescript: [40 * MIN, 100, 20], markdown: [10 * MIN, 5, 0] },
      files: [["/work/alpha/src/a.ts", 100, 20], ["/work/alpha/README.md", 5, 0]],
      sessions: [[9 * 60, 60, 40, { typescript: 40 * MIN }], [14 * 60, 15, 10, { markdown: 10 * MIN }]],
    },
  },
  beta: { [TODAY]: { ms: 30 * MIN, langs: { go: [30 * MIN, 10, 2] }, files: [["/work/beta/main.go", 10, 2]], sessions: [[11 * 60, 40, 30, { go: 30 * MIN }]] } },
})
const real = (sel: string, span: string) => exportData(w.range, w.year, sel, span, at(TODAY, 18))

// reportPages reads only counts, so the worst cases are described directly.
const n = (k: number) => Array.from({ length: k }, (_, i) => ({ i }))
const fake = (o: any): any => ({
  single: false, sel: "all", days: 7, activeDays: 0, metDays: 0,
  langs: [], projects: [], sessions: [], files: [], daysList: [], heat: null, tapes: null, ...o,
})
const tapes = { card: { cells: n(24), win: { cellMin: 30 } }, report: { cells: n(48), win: { cellMin: 15 } } }
const crowded = (o: any) => fake({ langs: n(30), projects: n(40), sessions: n(50), files: n(300), ...o })
const WORST = [
  crowded({ single: true, days: 1, activeDays: 1, daysList: n(1), tapes }),
  crowded({ days: 7, activeDays: 7, daysList: n(7) }),
  crowded({ days: 30, activeDays: 30, daysList: n(30), heat: { weeks: 5 } }),
  crowded({ days: 90, activeDays: 90, daysList: n(90), heat: { weeks: 13 } }),
]

describe("share card layout", () => {
  for (const span of ["today", "7d", "30d"]) {
    it(`${span}: every block sits inside the 620 px card without overlapping`, () => {
      const blocks = cardLayout(real("all", span))
      assert.ok(blocks[0].y >= CARD_TOP)
      for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i - 1].y + blocks[i - 1].h <= blocks[i].y, `${blocks[i - 1].kind} runs into ${blocks[i].kind}`)
      const last = blocks[blocks.length - 1]
      assert.strictEqual(last.kind, "footer")
      assert.ok(last.y + last.h <= CARD_H - CARD_BOTTOM)
    })
  }

  it("one day gets the tape, a range the columns", () => {
    assert.ok(cardLayout(real("all", "today")).some((b: any) => b.kind === "tape"))
    assert.ok(cardLayout(real("all", "7d")).some((b: any) => b.kind === "columns"))
  })
})

describe("report pages", () => {
  it("one day: summary, tape, languages, projects; then sessions and files", () => {
    const pages = reportPages(real("all", "today"))
    assert.deepStrictEqual(pages.map((p: any[]) => p.map(s => s.kind)), [["tiles", "tape", "langs", "projects"], ["sessions", "files"]])
  })

  it("a range for one project: columns and no projects table; days instead of sessions; a heatmap from 30 days", () => {
    assert.deepStrictEqual(reportPages(real("alpha", "7d")).map((p: any[]) => p.map(s => s.kind)), [["tiles", "columns", "langs"], ["days", "files"]])
    assert.deepStrictEqual(reportPages(real("alpha", "30d"))[1].map((s: any) => s.kind), ["days", "files", "heat"])
  })

  it("the days table holds 18 rows below 30 days and 14 from 30, the rest counted", () => {
    assert.deepStrictEqual([dayRowCap(7), dayRowCap(29), dayRowCap(30), dayRowCap(90)], [18, 18, 14, 14])
    const days = (o: any) => reportPages(fake(o))[1][0]
    assert.deepStrictEqual([days({ days: 7, activeDays: 7 }).rows, days({ days: 7, activeDays: 7 }).more], [7, 0])
    assert.deepStrictEqual([days({ days: 30, activeDays: 25 }).rows, days({ days: 30, activeDays: 25 }).more], [14, 11])
  })

  it("long lists are capped with the rest counted", () => {
    const [p1, p2] = reportPages(WORST[0])
    const at = (secs: any[], kind: string) => secs.find(s => s.kind === kind)
    assert.deepStrictEqual([at(p1, "langs").rows, at(p1, "langs").more], [8, 22])
    assert.deepStrictEqual([at(p1, "projects").rows, at(p1, "projects").more], [6, 34])
    assert.deepStrictEqual([at(p2, "sessions").rows, at(p2, "sessions").more], [20, 30])
    assert.deepStrictEqual([at(p2, "files").rows, at(p2, "files").more], [10, 290])
  })

  it("the busiest day or range, for all projects or one, is two pages that fit", () => {
    for (const c of WORST) {
      for (const sel of ["all", "alpha"]) {
        const pages = reportPages({ ...c, sel })
        assert.strictEqual(pages.length, 2)
        pages.forEach((p: any[], i: number) => assert.ok(stackHeight(p) <= CONTENT_H, `days ${c.days} ${sel} page ${i + 1}: ${stackHeight(p)} > ${CONTENT_H}`))
      }
    }
  })

  it("an empty export still has a row for 'none' in every table", () => {
    const pages = reportPages(fake({ single: true, days: 1, tapes }))
    for (const s of pages.flat()) assert.ok(s.h > 0)
    pages.forEach((p: any[]) => assert.ok(stackHeight(p) <= CONTENT_H))
  })
})

describe("report outline", () => {
  it("lists each page's sections with their sizes", () => {
    assert.deepStrictEqual(reportOutline(real("all", "today")), [
      { page: 1, items: ["summary · 8 tiles", "day tape · 15-minute cells", "languages · 3", "projects · 2"] },
      { page: 2, items: ["sessions · 3", "files · 3, git diff --stat"] },
    ])
  })

  it("says how much was left out", () => {
    const out = reportOutline(WORST[2])
    assert.strictEqual(out[0].items[2], "languages · 8 of 30")
    assert.strictEqual(out[1].items[0], "days · 14 of 30 active, newest first")
    assert.strictEqual(out[1].items[2], "activity · 5 weeks")
  })
})
```

Run: `node scripts/test.js --suite exportlayout`
Expected: FAIL — `src/webview/exportLayout.ts` does not exist.

- [ ] **Step 2: Write `src/webview/exportLayout.ts`**

```ts
// Where everything goes on the share card and the report, as plain numbers, so
// the "it fits" rules are tested without a canvas or a PDF. The renderers place
// every block at the position given here and nowhere else.
import type { ExportData } from "./exportModel"

// ── share card (logical px; drawn at CARD_SCALE) ────────────────────────────

export const CARD_W = 420
export const CARD_H = 620
export const CARD_SCALE = 3
export const CARD_X = 24
export const CARD_TOP = 22
export const CARD_BOTTOM = 18
export const CARD_GAP = 12

export type CardKind = "header" | "hero" | "tiles" | "tape" | "columns" | "languages" | "footer"
export interface CardBlock { kind: CardKind; y: number; h: number }

const CARD_HEIGHTS: Record<Exclude<CardKind, "hero">, number> = { header: 52, tiles: 132, tape: 72, columns: 106, languages: 56, footer: 16 }

export function cardLayout(d: ExportData): CardBlock[] {
  const kinds: CardKind[] = ["header", "hero", "tiles", d.single ? "tape" : "columns", "languages"]
  const out: CardBlock[] = []
  let y = CARD_TOP
  for (const kind of kinds) {
    const h = kind === "hero" ? (d.single ? 112 : 86) : CARD_HEIGHTS[kind as Exclude<CardKind, "hero">]
    out.push({ kind, y, h })
    y += h + CARD_GAP
  }
  // the footer sits on the bottom edge, whatever is above it
  out.push({ kind: "footer", y: CARD_H - CARD_BOTTOM - CARD_HEIGHTS.footer, h: CARD_HEIGHTS.footer })
  return out
}

// ── report (pt, A4) ──────────────────────────────────────────────────────────

export const PAGE_W = 595.28
export const PAGE_H = 841.89
export const FRAME_INSET = 20
export const FRAME_RADIUS = 6
export const PAGE_X = 38
export const PAGE_TOP = 34
export const PAGE_BOTTOM = 28
export const HEADER_H = 46
export const FOOTER_H = 26
export const GAP = 12
export const ROW = 13
export const TITLE_H = 16
export const CONTENT_TOP = PAGE_TOP + HEADER_H + GAP
export const CONTENT_H = PAGE_H - PAGE_BOTTOM - FOOTER_H - GAP - CONTENT_TOP

// Caps the spec leaves open, chosen so the busiest export still fits two pages.
export const CAPS = { langs: 8, projects: 6, sessions: 20, files: 10 }
export const dayRowCap = (days: number): number => (days >= 30 ? 14 : 18)

export type SectionKind = "tiles" | "tape" | "columns" | "langs" | "projects" | "sessions" | "days" | "files" | "heat"
export interface Section { kind: SectionKind; rows: number; more: number; h: number }

const FIXED = {
  tiles: TITLE_H + 2 * 36 + 6 + 8,
  tape: TITLE_H + 26 + 12 + 8,
  columns: TITLE_H + 70 + 12 + 8,
  heat: TITLE_H + 7 * 13 + 8,
}
// title, a header row, the rows (at least one, for "none"), "… and N more", footer rows
const tableH = (rows: number, more: number, footer = 0): number =>
  TITLE_H + ROW * (1 + Math.max(1, rows) + (more ? 1 : 0) + footer) + 8
const cap = (total: number, max: number): [number, number] => [Math.min(total, max), Math.max(0, total - max)]

export function reportPages(d: ExportData): Section[][] {
  const p1: Section[] = [{ kind: "tiles", rows: 8, more: 0, h: FIXED.tiles }]
  p1.push(d.single
    ? { kind: "tape", rows: d.tapes?.report.cells.length ?? 0, more: 0, h: FIXED.tape }
    : { kind: "columns", rows: d.daysList.length, more: 0, h: FIXED.columns })
  const [lr, lm] = cap(d.langs.length, CAPS.langs)
  p1.push({ kind: "langs", rows: lr, more: lm, h: tableH(lr, lm) })
  if (d.sel === "all") {
    const [pr, pm] = cap(d.projects.length, CAPS.projects)
    p1.push({ kind: "projects", rows: pr, more: pm, h: tableH(pr, pm) })
  }

  const p2: Section[] = []
  if (d.single) {
    const [sr, sm] = cap(d.sessions.length, CAPS.sessions)
    p2.push({ kind: "sessions", rows: sr, more: sm, h: tableH(sr, sm, 1) })
  } else {
    const [dr, dm] = cap(d.activeDays, dayRowCap(d.days))
    p2.push({ kind: "days", rows: dr, more: dm, h: tableH(dr, dm) })
  }
  // files have no header row; their git-style summary line takes its place
  const [fr, fm] = cap(d.files.length, CAPS.files)
  p2.push({ kind: "files", rows: fr, more: fm, h: tableH(fr, 0) })
  if (d.heat) p2.push({ kind: "heat", rows: d.heat.weeks, more: 0, h: FIXED.heat })
  return [p1, p2]
}

export const stackHeight = (s: Section[]): number => s.reduce((t, x) => t + x.h, 0) + GAP * Math.max(0, s.length - 1)

// The dialog lists the report's sections instead of previewing its pages.
const LABEL: Record<SectionKind, string> = {
  tiles: "summary", tape: "day tape", columns: "each day", langs: "languages", projects: "projects",
  sessions: "sessions", days: "days", files: "files", heat: "activity",
}

function detail(d: ExportData, s: Section): string {
  const count = s.more ? `${s.rows} of ${s.rows + s.more}` : String(s.rows)
  switch (s.kind) {
    case "tiles": return "8 tiles"
    case "tape": return `${d.tapes?.report.win.cellMin ?? 15}-minute cells`
    case "columns": return `target met on ${d.metDays} of ${d.days} days`
    case "days": return `${count} active, newest first`
    case "files": return `${count}, git diff --stat`
    case "heat": return `${s.rows} weeks`
    default: return count
  }
}

export function reportOutline(d: ExportData): { page: number; items: string[] }[] {
  return reportPages(d).map((secs, i) => ({ page: i + 1, items: secs.map(s => `${LABEL[s.kind]} · ${detail(d, s)}`) }))
}
```

- [ ] **Step 3: Run the suites**

Run: `node scripts/test.js --suite exportlayout`
Expected: PASS, 12 tests.

Run: `node scripts/test.js --suite fonts`
Expected: PASS (`exportLayout.ts` is now scanned; it uses only `·`).

- [ ] **Step 4: Full gate and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add src/webview/exportLayout.ts test/webview.exportLayout.test.ts scripts/test.js
git commit -m "Lay out the share card and the report's two pages as numbers, with caps that keep the busiest export inside them"
```

---

### Task 5: The share card renderer and the exports harness

**Files:**
- Create: `src/webview/shareCard.ts`, `test/harness/exports.html`, `test/harness/exports.ts`
- Test: visual, in the harness (canvas drawing has no node test; its numbers and positions are tested in Tasks 3–4)

**Interfaces:**
- Consumes: `ExportData`, `CARD`, `OTHER_COLOR`, `SHADE`, `mix`, `generatedText`, `rangeText` (exportModel); `CARD_*`, `CardBlock`, `cardLayout` (exportLayout); `CARROT_W`, `carrotPixels` (carrot.ts); `clock`, `dstr`, `fmt`, `hhmm`, `hours`, `pct`, `shortDate` (format.ts); `tapeTicks` (layout.ts); `ellipsize` (textFit).
- Produces: `drawCard(canvas: HTMLCanvasElement, d: ExportData): void`, `cardFontsReady(): Promise<void>`, `cardJpegBase64(d: ExportData): Promise<string>` (base64 without the `data:` prefix).

- [ ] **Step 1: Write `src/webview/shareCard.ts`**

```ts
// The share card: 420×620, drawn at 3× on a canvas, always the phosphor
// screen with faint scanlines and no mask (a mask moirés once a social site
// rescales the image). Tape cells, columns and streak marks are shapes, not
// block glyphs: Martian Mono has none, and an image must look the same on
// every machine whatever its fallback fonts.
import { CARROT_W, carrotPixels } from "./carrot"
import { CARD, ExportData, OTHER_COLOR, SHADE, generatedText, mix, rangeText } from "./exportModel"
import { CARD_H, CARD_SCALE, CARD_W, CARD_X, CardBlock, cardLayout } from "./exportLayout"
import { clock, dstr, fmt, hhmm, hours, pct, shortDate } from "./format"
import { tapeTicks } from "./layout"
import { ellipsize } from "./textFit"

type Ctx = CanvasRenderingContext2D
const FAMILY = '"Martian Mono", "Cascadia Mono", Consolas, monospace'
const INNER = CARD_W - 2 * CARD_X

function font(ctx: Ctx, size: number, weight = 400, narrow = false): void {
  ctx.font = `${weight} ${size}px ${FAMILY}`
  // wdth 75 for the big numerals, 87.5 for text: the dashboard's two widths
  ctx.fontStretch = narrow ? "condensed" : "semi-condensed"
}

function text(ctx: Ctx, s: string, x: number, y: number, color: string, align: CanvasTextAlign = "left"): void {
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(s, x, y)
}

const fit = (ctx: Ctx, s: string, w: number) => ellipsize(s, w, t => ctx.measureText(t).width)

// The phosphor bloom, kept to the big numbers so small text stays crisp.
function glow(ctx: Ctx, color: string, blur: number, draw: () => void): void {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  draw()
  ctx.restore()
}

function carrot(ctx: Ctx, x: number, y: number, px: number): void {
  for (const p of carrotPixels()) {
    ctx.fillStyle = p.c
    ctx.fillRect(x + p.x * px, y + p.y * px, px, px)
  }
}

// A boxed panel with its title set into the top rule, like the dashboard's fieldsets.
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, title: string, sub = ""): void {
  ctx.fillStyle = CARD.panel
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = CARD.rule
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  font(ctx, 11)
  const titleW = ctx.measureText(title + (sub ? " " : "")).width
  const subW = sub ? ctx.measureText(sub).width : 0
  ctx.fillStyle = CARD.panel
  ctx.fillRect(x + 8, y - 1, titleW + subW + 12, 3)
  ctx.textBaseline = "middle"
  text(ctx, title, x + 14, y, CARD.amber)
  if (sub) text(ctx, sub, x + 14 + titleW, y, CARD.dim)
  ctx.textBaseline = "alphabetic"
}

const langColor = (d: ExportData) => {
  const m = new Map(d.langs.map(l => [l.name, l.color]))
  // a session recorded before per-session languages has no language: plain green
  return (name: string | null) => (name ? m.get(name) ?? OTHER_COLOR : CARD.add)
}

function header(ctx: Ctx, d: ExportData, b: CardBlock): void {
  glow(ctx, "rgba(255,139,0,.55)", 3, () => carrot(ctx, CARD_X, b.y + 1, 5))
  const tx = CARD_X + CARROT_W * 5 + 14
  const right = d.single ? "today" : `${d.days} days`
  font(ctx, 11)
  const rw = ctx.measureText(right).width
  text(ctx, right, CARD_X + INNER, b.y + 22, CARD.dim, "right")
  text(ctx, fit(ctx, rangeText(d), CARD_X + INNER - tx), tx, b.y + 40, CARD.dim)
  font(ctx, 16, 700)
  text(ctx, fit(ctx, d.title, CARD_X + INNER - rw - 14 - tx), tx, b.y + 22, CARD.ink)
}

function marks(ctx: Ctx, d: ExportData, x: number, y: number, w: number): void {
  const step = w / 14
  d.marks.forEach((m, i) => {
    const cx = x + step * (i + 14 - d.marks.length) + step / 2
    if (m === "today") {
      ctx.fillStyle = CARD.amber
      ctx.beginPath()
      ctx.moveTo(cx, y)
      ctx.lineTo(cx + 5.5, y + 5.5)
      ctx.lineTo(cx, y + 11)
      ctx.lineTo(cx - 5.5, y + 5.5)
      ctx.closePath()
      ctx.fill()
    } else if (m === "met") {
      ctx.fillStyle = CARD.add
      ctx.fillRect(cx - 4.5, y + 1, 9, 9)
    } else {
      ctx.strokeStyle = CARD.mute
      ctx.lineWidth = 1
      ctx.strokeRect(cx - 4, y + 1.5, 8, 8)
    }
  })
}

function hero(ctx: Ctx, d: ExportData, b: CardBlock): void {
  panel(ctx, CARD_X, b.y, INNER, b.h, d.single ? "streak" : `${d.days} days`)
  const big = d.single ? String(d.streak) : hours(d.totalMs)
  const color = d.single ? CARD.add : CARD.ink
  font(ctx, 64, 700, true)
  const w = ctx.measureText(big).width
  glow(ctx, color, 7, () => text(ctx, big, CARD_X + 12, b.y + 68, color))
  font(ctx, 12.5)
  const key = d.single ? "days in a row" : `active · ${d.activeDays}/${d.days} days`
  text(ctx, fit(ctx, key, INNER - 34 - w), CARD_X + 22 + w, b.y + 68, CARD.dim)
  if (d.single) marks(ctx, d, CARD_X + 12, b.y + 84, INNER - 24)
}

function tiles(ctx: Ctx, d: ExportData, b: CardBlock): void {
  const top = d.langs[0]
  const list: [string, string, string, string][] = d.single
    ? [
      ["active", fmt(d.totalMs), CARD.ink, `of ${fmt(d.targetMs)} target`],
      ["sessions", String(d.sessions.length), CARD.ink, d.firstStart !== null && d.lastEnd !== null ? `${clock(d.firstStart)} – ${clock(d.lastEnd)}` : "none yet"],
    ]
    : [
      ["per active day", fmt(d.perActiveMs), CARD.ink, `${d.activeDays} active days`],
      ["best day", d.best ? fmt(d.best.ms) : "—", CARD.ink, d.best ? dstr(d.best.date) : "no activity"],
    ]
  list.push(
    ["lines", `+${d.added}`, CARD.add, `−${d.deleted} removed`],
    ["top language", top ? top.name : "—", CARD.ink, top ? hours(top.ms) : "no activity"],
  )
  const w = (INNER - 10) / 2
  const h = (b.h - 10) / 2
  list.forEach(([title, value, color, key], i) => {
    const x = CARD_X + (i % 2) * (w + 10)
    const y = b.y + Math.floor(i / 2) * (h + 10)
    panel(ctx, x, y, w, h, title)
    font(ctx, 26, 600, true)
    const v = fit(ctx, value, w - 24)
    glow(ctx, color, 5, () => text(ctx, v, x + 12, y + 34, color))
    font(ctx, 11)
    text(ctx, fit(ctx, key, w - 24), x + 12, y + 51, CARD.dim)
  })
}

function tape(ctx: Ctx, d: ExportData, b: CardBlock): void {
  const t = d.tapes!.card
  panel(ctx, CARD_X, b.y, INNER, b.h, "day", `${hhmm(t.win.startMin)}–${hhmm(t.win.endMin)}`)
  const x0 = CARD_X + 12
  const w = INNER - 24
  const cw = w / t.cells.length
  const top = b.y + 18
  const h = 30
  const color = langColor(d)
  t.cells.forEach((c, i) => {
    const x = x0 + i * cw
    if (!c.level) {
      ctx.fillStyle = CARD.mute
      ctx.fillRect(x + cw / 2 - 1, top + h - 2, 2, 2)
      return
    }
    ctx.fillStyle = mix(color(c.language), CARD.panel, SHADE[c.level])
    ctx.fillRect(x + 1, top, cw - 2, h)
  })
  font(ctx, 9.5)
  const ticks = tapeTicks(t.win, t.cells.length)
  ticks.forEach((label, i) => { if (label) text(ctx, label, x0 + i * (w / ticks.length), top + h + 14, CARD.mute) })
}

function columns(ctx: Ctx, d: ExportData, b: CardBlock): void {
  panel(ctx, CARD_X, b.y, INNER, b.h, "each day", `target met on ${d.metDays}`)
  const list = d.daysList
  const gap = list.length > 20 ? 2 : 4
  const x0 = CARD_X + 12
  const w = INNER - 24
  const cw = (w - gap * (list.length - 1)) / list.length
  const base = b.y + 18 + 74
  const max = Math.max(1, ...list.map(x => x.ms))
  list.forEach((day, i) => {
    if (!day.ms) return
    const h = Math.max(2, day.ms / max * 74)
    ctx.fillStyle = day.today ? CARD.amber : day.met ? CARD.add : CARD.mute
    ctx.fillRect(x0 + i * (cw + gap), base - h, cw, h)
  })
  font(ctx, 9.5)
  text(ctx, shortDate(list[0].date), x0, base + 12, CARD.mute)
  text(ctx, shortDate(list[list.length - 1].date), x0 + w, base + 12, CARD.mute, "right")
}

function languages(ctx: Ctx, d: ExportData, b: CardBlock): void {
  panel(ctx, CARD_X, b.y, INNER, b.h, "languages")
  const x0 = CARD_X + 12
  const w = INNER - 24
  const y = b.y + 16
  const shown = d.langs.filter(l => l.ms > 0)
  const total = shown.reduce((t, l) => t + l.ms, 0)
  font(ctx, 10.5)
  if (!total) {
    text(ctx, "no activity", x0, y + 10, CARD.mute)
    return
  }
  let x = x0
  for (const l of shown) {
    const lw = l.ms / total * w
    ctx.fillStyle = l.color
    ctx.fillRect(x, y, Math.max(0, lw - 2), 10)
    x += lw
  }
  const kw = w / 3
  shown.slice(0, 3).forEach((l, i) => {
    const kx = x0 + i * kw
    ctx.fillStyle = l.color
    ctx.fillRect(kx, y + 19, 7, 7)
    const share = ` ${pct(l.ms, total)}%`
    const name = fit(ctx, l.name, kw - 16 - ctx.measureText(share).width)
    text(ctx, name + share, kx + 12, y + 26, CARD.dim)
  })
}

function footer(ctx: Ctx, d: ExportData, b: CardBlock): void {
  const left = `${generatedText(d.generatedAt)} ·`
  font(ctx, 10)
  const lw = ctx.measureText(left).width
  font(ctx, 10, 600)
  const bw = ctx.measureText("rabbit hole").width
  const cw = CARROT_W * 2
  let x = (CARD_W - (lw + 6 + cw + 6 + bw)) / 2
  const base = b.y + 12
  font(ctx, 10)
  text(ctx, left, x, base, CARD.mute)
  x += lw + 6
  carrot(ctx, x, base - 15, 2)
  x += cw + 6
  font(ctx, 10, 600)
  text(ctx, "rabbit hole", x, base, CARD.ink)
}

function scanlines(ctx: Ctx): void {
  ctx.fillStyle = "rgba(0,0,0,0.28)"
  for (let y = 2; y < CARD_H; y += 3) ctx.fillRect(0, y, CARD_W, 1)
}

const DRAW: Record<CardBlock["kind"], (ctx: Ctx, d: ExportData, b: CardBlock) => void> = { header, hero, tiles, tape, columns, languages, footer }

export function drawCard(canvas: HTMLCanvasElement, d: ExportData): void {
  canvas.width = CARD_W * CARD_SCALE
  canvas.height = CARD_H * CARD_SCALE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("this webview has no 2D canvas")
  ctx.setTransform(CARD_SCALE, 0, 0, CARD_SCALE, 0, 0)
  ctx.fillStyle = CARD.bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  for (const b of cardLayout(d)) DRAW[b.kind](ctx, d, b)
  scanlines(ctx)
}

// The dashboard's @font-face loads Martian Mono lazily; a canvas drawn before
// it arrives silently uses the fallback font.
export async function cardFontsReady(): Promise<void> {
  await Promise.all([document.fonts.load(`400 12px ${FAMILY}`), document.fonts.load(`700 12px ${FAMILY}`)])
}

export async function cardJpegBase64(d: ExportData): Promise<string> {
  await cardFontsReady()
  const canvas = document.createElement("canvas")
  drawCard(canvas, d)
  return canvas.toDataURL("image/jpeg", 0.92).split(",")[1]
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build && node scripts/test.js --suite fonts`
Expected: green. (The card is not bundled into `main.js` yet; nothing imports it until Task 7. The fonts suite does not scan `shareCard.ts`: a canvas falls back per glyph.)

- [ ] **Step 3: Write the exports harness**

Create `test/harness/exports.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>Export harness</title>
<!-- Serve the repo root (python -m http.server 8123) and open /test/harness/exports.html.
     Build first: npx esbuild test/harness/exports.ts --bundle --platform=browser --loader:.ttf=base64 --outfile=test/.out/harness/exports.js -->
<style>
  @font-face { font-family: "Martian Mono"; src: url("/src/webview/fonts/MartianMono-VF.woff2") format("woff2"); font-weight: 100 800; font-stretch: 75% 112.5%; }
  body { background: #1b1b1b; color: #ddd; font: 13px system-ui, sans-serif; padding: 16px; }
  #cards { display: flex; flex-wrap: wrap; gap: 16px; }
  figure { margin: 0; }
  canvas { width: 420px; display: block; }
  button { margin: 4px 6px 4px 0; }
</style>
<div id="reports"></div>
<div id="cards"></div>
<script src="/test/.out/harness/exports.js"></script>
```

Create `test/harness/exports.ts`:

```ts
// Draws every share card variant (and, from Task 6, offers every report) from
// fixture data, for a visual check against docs/design/mockups/exports.html.
import { Span, exportData } from "../../src/webview/exportModel"
import { cardFontsReady, drawCard } from "../../src/webview/shareCard"
import { sampleWorld, world } from "../helpers/exportFixtures"

const sample = sampleWorld()
const empty = world({}, { ids: ["alpha"] })
export const CASES: [string, { year: any; range: any }, string, Span][] = [
  ["today, all projects", sample, "all", "today"],
  ["today, rabbit-hole", sample, "rabbit-hole", "today"],
  ["7d, all projects", sample, "all", "7d"],
  ["30d, rabbithole-cli", sample, "rabbithole-cli", "30d"],
  ["today, empty install", empty, "all", "today"],
  ["30d, empty install", empty, "all", "30d"],
]

async function main(): Promise<void> {
  await cardFontsReady()
  const host = document.getElementById("cards")!
  for (const [label, w, sel, span] of CASES) {
    if (span === "90d") continue
    const fig = document.createElement("figure")
    const canvas = document.createElement("canvas")
    drawCard(canvas, exportData(w.range, w.year, sel, span, Date.now()))
    const cap = document.createElement("figcaption")
    cap.textContent = label
    fig.append(canvas, cap)
    host.append(fig)
  }
}
void main()
```

- [ ] **Step 4: Look at it**

```bash
npx esbuild test/harness/exports.ts --bundle --platform=browser --loader:.ttf=base64 --outfile=test/.out/harness/exports.js
python -m http.server 8123
```

(run the server in the background), then open `http://localhost:8123/test/harness/exports.html` in Chrome (or take a screenshot with the chrome-devtools tools) next to `docs/design/mockups/exports.html` (format "share card").

Expected, for every card: the 5× carrot top left with an orange glow; project name bold, date line dim, "today" / "N days" right; boxed panels with amber titles set into the top rule; the streak hero in green with 14 marks (filled green squares, hollow grey squares, an amber diamond last) for a day; big hours for a range; four tiles; the 24-cell tape coloured by language for a day, green/grey/amber columns for a range; the languages bar with three keys; the centred footer with a 2× carrot; faint horizontal scanlines; the font is Martian Mono (narrow and squarish — compare with the mockup). Nothing overlaps or leaves the card. The empty-install cards read "0", "—", "none yet", "no activity" and have no `NaN`.

Stop the server when done.

- [ ] **Step 5: Full gate and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add src/webview/shareCard.ts test/harness/exports.html test/harness/exports.ts
git commit -m "Draw the TTY share card on a canvas, with a browser harness that shows every variant"
```

---

### Task 6: The report renderer

**Files:**
- Create: `src/webview/reportPdf.ts`
- Modify: `scripts/test.js`, `tsconfig.test.json`, `test/harness/exports.ts`, `test/harness/exports.html`
- Test: `test/webview.report.test.ts`

**Interfaces:**
- Consumes: everything from `exportModel.ts` and `exportLayout.ts` named in Steps 3; `carrotPixels`; `clock`, `dstr`, `fmt`, `hhmm`, `hours`, `pct`, `shortDate`; `colGap`, `runs`, `tapeTicks`; `ellipsize`, `pdfSafe`, `ttfCoverage`; the two TTFs.
- Produces: `reportPdf(d: ExportData): ArrayBuffer` — always two A4 pages.

- [ ] **Step 1: Let the test config see the font module declaration**

`reportPdf.ts` imports `.ttf` files, which `src/webview/fonts.d.ts` declares. The harness imports `reportPdf.ts` directly, so `tsconfig.test.json` must include that declaration:

```json
  "include": ["test/**/*.ts", "src/webview/fonts.d.ts"],
```

- [ ] **Step 2: Write the failing test**

Register in `scripts/test.js`:

```js
  {
    name: "report",
    entry: "test/webview.report.test.ts",
    alias: { exportModel: "src/webview/exportModel.ts", report: "src/webview/reportPdf.ts" },
  },
```

Create `test/webview.report.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/exportModel.ts
import { exportData } from "exportModel"
// @ts-ignore — esbuild alias to src/webview/reportPdf.ts
import { reportPdf } from "report"
import { DaySpec, MIN, TODAY, addDays, at, sampleWorld, world } from "./helpers/exportFixtures"

// jsPDF runs in node, so the real renderer is exercised end to end.
const NOW = at(TODAY, 18)
const pdf = (w: any, sel: string, span: string): string =>
  Buffer.from(reportPdf(exportData(w.range, w.year, sel, span, NOW))).toString("latin1")
const pages = (s: string) => (s.match(/\/Type \/Page[^s]/g) ?? []).length

// 40 projects, 30 languages, 300 files and 50 sessions every day for 90 days,
// and names the embedded font can't draw.
function crowded() {
  const langs: Record<string, [number, number, number]> = {}
  for (let i = 0; i < 30; i++) langs[`lang-${i}`] = [(i + 1) * MIN, i * 3, i]
  const files = Array.from({ length: 300 }, (_, i): [string, number, number] =>
    [`/work/p0/src/very/deeply/nested/folder/file-${i}-🥕-日本.ts`, i + 1, i % 7])
  const sessions = Array.from({ length: 50 }, (_, i): [number, number, number, Record<string, number>] =>
    [i * 20, 15, 10, { "lang-0": 10 * MIN }])
  const spec: Record<string, Record<string, DaySpec>> = { p0: {} }
  for (let k = 0; k < 90; k++) spec.p0[addDays(TODAY, -k)] = { ms: 200 * MIN, langs, files, sessions }
  for (let p = 1; p < 40; p++) spec[`p${p}`] = { [TODAY]: { ms: 5 * MIN } }
  return world(spec, { names: { p0: "日本語プロジェクト 🥕" } })
}

describe("the report", () => {
  it("is a two-page PDF for every span, all projects or one", () => {
    const w = sampleWorld()
    for (const span of ["today", "7d", "30d", "90d"]) {
      for (const sel of ["all", "rabbit-hole"]) {
        const out = pdf(w, sel, span)
        assert.ok(out.startsWith("%PDF-"), `${span} ${sel}`)
        assert.strictEqual(pages(out), 2, `${span} ${sel}`)
      }
    }
  })

  it("renders an empty install without throwing", () => {
    const w = world({}, { ids: ["alpha"] })
    for (const span of ["today", "7d", "30d", "90d"]) assert.strictEqual(pages(pdf(w, "all", span)), 2)
  })

  it("renders the busiest day and quarter, with names the font lacks, in two pages", () => {
    const w = crowded()
    for (const span of ["today", "90d"]) {
      assert.strictEqual(pages(pdf(w, "all", span)), 2)
      assert.strictEqual(pages(pdf(w, "p0", span)), 2)
    }
  })
})
```

Run: `node scripts/test.js --suite report`
Expected: FAIL — `src/webview/reportPdf.ts` does not exist.

- [ ] **Step 3: Write `src/webview/reportPdf.ts`**

```ts
// The report: A4, dark pages with the hairline terminal frame, flat (no glow,
// no scanlines, which neither PDF viewers nor printers keep). Marks are shapes;
// text is Martian Mono, embedded, and goes through pdfSafe because jsPDF has no
// fallback for a character the font lacks.
import { jsPDF } from "jspdf"
import MM_BOLD from "./fonts/MartianMono-NrBd.ttf"
import MM_REGULAR from "./fonts/MartianMono-NrRg.ttf"
import { carrotPixels } from "./carrot"
import { ExportData, OTHER_COLOR, PAGE, SHADE, generatedText, mix, rangeText } from "./exportModel"
import {
  CONTENT_TOP, FOOTER_H, FRAME_INSET, FRAME_RADIUS, GAP, HEADER_H, PAGE_BOTTOM, PAGE_H, PAGE_TOP, PAGE_W, PAGE_X,
  ROW, Section, TITLE_H, reportPages,
} from "./exportLayout"
import { clock, dstr, fmt, hhmm, hours, pct, shortDate } from "./format"
import { colGap, runs, tapeTicks } from "./layout"
import { ellipsize, pdfSafe, ttfCoverage } from "./textFit"

type Doc = jsPDF
const FONT = "MartianMono"
const W = PAGE_W - 2 * PAGE_X
const DIVIDER = mix(PAGE.rule, PAGE.bg, 0.6)

let covered: Set<number> | null = null
const coverage = (): Set<number> =>
  covered ?? (covered = ttfCoverage(Uint8Array.from(atob(MM_REGULAR), c => c.charCodeAt(0))))

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const fill = (doc: Doc, hex: string) => doc.setFillColor(...rgb(hex))
const stroke = (doc: Doc, hex: string) => doc.setDrawColor(...rgb(hex))

function type(doc: Doc, size: number, bold = false): void {
  doc.setFont(FONT, bold ? "bold" : "normal")
  doc.setFontSize(size)
}

function say(doc: Doc, s: string, x: number, y: number, color: string, align: "left" | "right" | "center" = "left"): void {
  doc.setTextColor(...rgb(color))
  doc.text(pdfSafe(s, coverage()), x, y, { align })
}

const fit = (doc: Doc, s: string, w: number): string => ellipsize(pdfSafe(s, coverage()), w, t => doc.getTextWidth(t))

function carrot(doc: Doc, x: number, y: number, px: number): void {
  for (const p of carrotPixels()) {
    fill(doc, p.c)
    doc.rect(x + p.x * px, y + p.y * px, px, px, "F")
  }
}

function frame(doc: Doc, d: ExportData, page: number, pages: number): void {
  fill(doc, PAGE.bg)
  doc.rect(0, 0, PAGE_W, PAGE_H, "F")
  stroke(doc, PAGE.frame)
  doc.setLineWidth(0.75)
  doc.roundedRect(FRAME_INSET, FRAME_INSET, PAGE_W - 2 * FRAME_INSET, PAGE_H - 2 * FRAME_INSET, FRAME_RADIUS, FRAME_RADIUS, "S")

  carrot(doc, PAGE_X, PAGE_TOP, 4)
  const tx = PAGE_X + 14 * 4 + 12
  type(doc, 9.5)
  const right = `page ${page} of ${pages}`
  const rw = doc.getTextWidth(right)
  say(doc, right, PAGE_X + W, PAGE_TOP + 14, PAGE.dim, "right")
  say(doc, fit(doc, `${d.title} · ${rangeText(d)}`, PAGE_X + W - rw - 12 - tx), tx, PAGE_TOP + 31, PAGE.dim)
  type(doc, 15, true)
  say(doc, "rabbit hole · report", tx, PAGE_TOP + 14, PAGE.ink)
  doc.line(PAGE_X, PAGE_TOP + HEADER_H - 2, PAGE_X + W, PAGE_TOP + HEADER_H - 2)

  const fy = PAGE_H - PAGE_BOTTOM - FOOTER_H
  doc.line(PAGE_X, fy, PAGE_X + W, fy)
  carrot(doc, PAGE_X, fy + 4, 2)
  type(doc, 8.5)
  say(doc, `${generatedText(d.generatedAt)} by rabbit hole`, PAGE_X + 28 + 8, fy + 17, PAGE.mute)
  say(doc, "local data only", PAGE_X + W, fy + 17, PAGE.mute, "right")
}

// A boxed section with its title set into the top rule.
function box(doc: Doc, y: number, s: Section, title: string, sub = ""): void {
  stroke(doc, PAGE.rule)
  doc.setLineWidth(0.75)
  doc.rect(PAGE_X, y + 5, W, s.h - 5, "S")
  type(doc, 9.5, true)
  const tw = doc.getTextWidth(title + " ")
  type(doc, 9.5)
  const sw = sub ? doc.getTextWidth(pdfSafe(sub, coverage())) : 0
  fill(doc, PAGE.bg)
  doc.rect(PAGE_X + 8, y, tw + sw + 8, 10, "F")
  type(doc, 9.5, true)
  say(doc, title, PAGE_X + 12, y + 8.5, PAGE.amber)
  if (sub) {
    type(doc, 9.5)
    say(doc, sub, PAGE_X + 12 + tw, y + 8.5, PAGE.dim)
  }
}

type Cell = string | { t: string; c: string }
interface Col { w: number; right?: boolean }   // w 0: whatever width is left
interface Placed { x: number; w: number; right: boolean }

function place(cols: Col[]): Placed[] {
  const fixed = cols.reduce((t, c) => t + c.w, 0) + 8 * (cols.length - 1)
  let x = PAGE_X + 12
  return cols.map(c => {
    const w = c.w || Math.max(20, W - 24 - fixed)
    const out = { x, w, right: !!c.right }
    x += w + 8
    return out
  })
}

function line(doc: Doc, at: Placed[], y: number, row: Cell[], color: string): void {
  row.forEach((cell, i) => {
    const col = at[i]
    if (!col) return
    const t = typeof cell === "string" ? cell : cell.t
    const c = typeof cell === "string" ? color : cell.c
    say(doc, fit(doc, t, col.w), col.right ? col.x + col.w : col.x, y, c, col.right ? "right" : "left")
  })
}

// Header, rows ("none" when empty), "… and N more", footer rows, ROW apart, as
// reportPages measured them. Returns the first body row's baseline.
function table(doc: Doc, y: number, cols: Col[], head: string[], body: Cell[][], more: string, foot: Cell[][] = []): number {
  const at = place(cols)
  let base = y + TITLE_H + ROW - 3
  type(doc, 8.5, true)
  line(doc, at, base, head, PAGE.dim)
  stroke(doc, PAGE.frame)
  doc.setLineWidth(0.5)
  doc.line(PAGE_X + 12, base + 3, PAGE_X + W - 12, base + 3)
  const first = base + ROW
  type(doc, 9)
  if (!body.length) {
    base += ROW
    say(doc, "none", at[0].x, base, PAGE.mute)
  }
  for (const r of body) {
    base += ROW
    line(doc, at, base, r, PAGE.ink)
    stroke(doc, DIVIDER)
    doc.line(PAGE_X + 12, base + 3, PAGE_X + W - 12, base + 3)
  }
  if (more) {
    base += ROW
    say(doc, more, at[0].x, base, PAGE.mute)
  }
  type(doc, 9, true)
  for (const r of foot) {
    base += ROW
    line(doc, at, base, r, PAGE.ink)
  }
  return first
}

const langColor = (d: ExportData) => {
  const m = new Map(d.langs.map(l => [l.name, l.color]))
  return (name: string | null) => (name ? m.get(name) ?? OTHER_COLOR : PAGE.add)
}

function tiles(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "summary")
  const top = d.langs[0]
  const last: [string, string, string] = d.sel === "all"
    ? [d.projects[0]?.name ?? "—", "top project", PAGE.ink]
    : d.single
      ? [d.metDays ? "met" : `${fmt(Math.max(0, d.targetMs - d.totalMs))} short`, `daily target ${fmt(d.targetMs)}`, d.metDays ? PAGE.add : PAGE.ink]
      : [`${d.metDays}/${d.days}`, "days on target", PAGE.ink]
  const list: [string, string, string][] = d.single
    ? [
      [fmt(d.totalMs), "active time", PAGE.ink],
      [`${d.streak}d`, "day streak", PAGE.ink],
      [String(d.sessions.length), "sessions", PAGE.ink],
      [top ? top.name : "—", "top language", PAGE.ink],
      [`+${d.added.toLocaleString("en-US")}`, "lines added", PAGE.add],
      [`−${d.deleted.toLocaleString("en-US")}`, "lines removed", PAGE.del],
      [d.firstStart !== null ? clock(d.firstStart) : "—", "first session", PAGE.ink],
      last,
    ]
    : [
      [hours(d.totalMs), "active time", PAGE.ink],
      [`${d.activeDays}/${d.days}`, "active days", PAGE.ink],
      [fmt(d.perActiveMs), "per active day", PAGE.ink],
      [top ? top.name : "—", "top language", PAGE.ink],
      [`+${d.added.toLocaleString("en-US")}`, "lines added", PAGE.add],
      [`−${d.deleted.toLocaleString("en-US")}`, "lines removed", PAGE.del],
      [d.best ? fmt(d.best.ms) : "—", d.best ? `best day, ${shortDate(d.best.date)}` : "best day", PAGE.ink],
      last,
    ]
  const tw = (W - 24 - 3 * 8) / 4
  list.forEach(([value, key, color], i) => {
    const x = PAGE_X + 12 + (i % 4) * (tw + 8)
    const ty = y + TITLE_H + Math.floor(i / 4) * (36 + 6)
    stroke(doc, PAGE.rule)
    doc.setLineWidth(0.75)
    doc.rect(x, ty, tw, 36, "S")
    type(doc, 17, true)
    say(doc, fit(doc, value, tw - 12), x + 6, ty + 18, color)
    type(doc, 8.5)
    say(doc, fit(doc, key, tw - 12), x + 6, ty + 30, PAGE.dim)
  })
}

function tape(doc: Doc, d: ExportData, y: number, s: Section): void {
  const t = d.tapes!.report
  box(doc, y, s, "day", `${hhmm(t.win.startMin)}–${hhmm(t.win.endMin)}, ${t.win.cellMin}-minute cells`)
  const x0 = PAGE_X + 12
  const w = W - 24
  const cw = w / t.cells.length
  const top = y + TITLE_H + 2
  const h = 22
  const color = langColor(d)
  t.cells.forEach((c, i) => {
    const x = x0 + i * cw
    if (!c.level) {
      fill(doc, PAGE.mute)
      doc.rect(x + cw / 2 - 0.75, top + h - 1.5, 1.5, 1.5, "F")
      return
    }
    fill(doc, mix(color(c.language), PAGE.bg, SHADE[c.level]))
    doc.rect(x + 0.5, top, cw - 1, h, "F")
  })
  type(doc, 8)
  const ticks = tapeTicks(t.win, t.cells.length)
  ticks.forEach((label, i) => { if (label) say(doc, label, x0 + i * (w / ticks.length), top + h + 10, PAGE.mute) })
}

function columns(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "each day", `target ${fmt(d.targetMs)} met on ${d.metDays} of ${d.days} days`)
  const list = d.daysList
  const gap = colGap(list.length)
  const x0 = PAGE_X + 12
  const w = W - 24
  const cw = (w - gap * (list.length - 1)) / list.length
  const base = y + TITLE_H + 2 + 70
  const max = Math.max(1, ...list.map(x => x.ms))
  list.forEach((day, i) => {
    if (!day.ms) return
    const h = Math.max(1.5, day.ms / max * 70)
    fill(doc, day.met ? PAGE.add : PAGE.mute)
    doc.rect(x0 + i * (cw + gap), base - h, cw, h, "F")
  })
  type(doc, 8)
  say(doc, dstr(list[0].date), x0, base + 10, PAGE.mute)
  say(doc, dstr(list[list.length - 1].date), x0 + w, base + 10, PAGE.mute, "right")
}

// Most lines first, lines before time: the dashboard's languages card does the same.
function langs(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "languages", "most lines first")
  const lines = (l: { added: number; deleted: number }) => l.added + l.deleted
  const rows = [...d.langs].sort((a, b) => lines(b) - lines(a) || b.ms - a.ms || a.name.localeCompare(b.name)).slice(0, s.rows)
  const max = Math.max(1, ...rows.map(lines))
  const cols: Col[] = [{ w: 110 }, { w: 0 }, { w: 56, right: true }, { w: 56, right: true }, { w: 50, right: true }]
  const first = table(doc, y, cols, ["language", "", "added", "removed", "time"],
    rows.map(l => [l.name, "", { t: `+${l.added}`, c: PAGE.add }, { t: `−${l.deleted}`, c: PAGE.del }, hours(l.ms)]),
    s.more ? `… and ${s.more} more` : "")
  const bar = place(cols)[1]
  rows.forEach((l, i) => {
    if (!lines(l)) return
    fill(doc, l.color)
    doc.rect(bar.x, first + i * ROW - 6, Math.max(1, lines(l) / max * bar.w), 6, "F")
  })
}

function projects(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "projects")
  table(doc, y, [{ w: 0 }, { w: 60, right: true }, { w: 50, right: true }], ["project", "time", "share"],
    d.projects.slice(0, s.rows).map(p => [p.name, hours(p.ms), `${pct(p.ms, d.totalMs)}%`]),
    s.more ? `… and ${s.more} more` : "")
}

function sessions(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "sessions")
  const all = d.sel === "all"
  const cols: Col[] = [{ w: 40 }, { w: 40 }, { w: 50, right: true }, { w: 0 }, ...(all ? [{ w: 110 }] : [])]
  table(doc, y, cols, ["start", "end", "active", "languages", ...(all ? ["project"] : [])],
    d.sessions.slice(0, s.rows).map(x => [clock(x.start), clock(x.end), fmt(x.activeMs), x.languages.join(", ") || "—", ...(all ? [x.project] : [])]),
    s.more ? `… and ${s.more} more sessions` : "",
    [["total", "", fmt(d.totalMs), ""]])
}

function days(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "days", "newest first, active days only")
  const rows = d.daysList.filter(x => x.ms > 0).reverse().slice(0, s.rows)
  table(doc, y, [{ w: 0 }, { w: 56, right: true }, { w: 56, right: true }, { w: 56, right: true }, { w: 50 }],
    ["day", "active", "added", "removed", "target"],
    rows.map(x => [dstr(x.date), fmt(x.ms), { t: `+${x.added}`, c: PAGE.add }, { t: `−${x.deleted}`, c: PAGE.del }, x.met ? "met" : "under"]),
    s.more ? `… and ${s.more} earlier active days` : "")
}

function files(doc: Doc, d: ExportData, y: number, s: Section): void {
  box(doc, y, s, "files", "git diff --stat")
  const rows = d.files.slice(0, s.rows)
  const max = Math.max(1, ...rows.map(f => f.added + f.deleted))
  const pathW = 230
  const numX = PAGE_X + 12 + pathW + 8 + 36
  const graphX = numX + 8
  let base = y + TITLE_H + 2
  type(doc, 9)
  const cw = doc.getTextWidth("+")
  if (!rows.length) {
    base += ROW
    say(doc, "no files changed", PAGE_X + 12, base, PAGE.mute)
  }
  for (const f of rows) {
    base += ROW
    const name = fit(doc, f.name, pathW)
    const dir = fit(doc, f.dir, Math.max(0, pathW - doc.getTextWidth(name)))
    say(doc, dir, PAGE_X + 12, base, PAGE.mute)
    say(doc, name, PAGE_X + 12 + doc.getTextWidth(dir), base, PAGE.ink)
    say(doc, String(f.added + f.deleted), numX, base, PAGE.ink, "right")
    const [na, nr] = runs(f.added, f.deleted, max, 28)
    say(doc, "+".repeat(na), graphX, base, PAGE.add)
    say(doc, "-".repeat(nr), graphX + na * cw, base, PAGE.del)
  }
  base += ROW
  say(doc, `${d.files.length} files changed, ${d.added} insertions(+), ${d.deleted} deletions(-)`, PAGE_X + 12, base, PAGE.mute)
}

function heat(doc: Doc, d: ExportData, y: number, s: Section): void {
  const h = d.heat!
  box(doc, y, s, "activity", `${h.weeks} weeks`)
  const cell = 11
  const gap = 2
  const x0 = PAGE_X + (W - (h.weeks * (cell + gap) - gap)) / 2
  const y0 = y + TITLE_H + 1
  h.cells.forEach((c, i) => {
    if (!c) return
    const x = x0 + Math.floor(i / 7) * (cell + gap)
    const cy = y0 + (i % 7) * (cell + gap)
    if (!c.level && !c.today) {
      fill(doc, PAGE.mute)
      doc.rect(x + cell / 2 - 0.75, cy + cell / 2 - 0.75, 1.5, 1.5, "F")
      return
    }
    fill(doc, c.today ? PAGE.amber : mix(PAGE.add, PAGE.bg, SHADE[c.level]))
    doc.rect(x, cy, cell, cell, "F")
  })
}

const DRAW: Record<Section["kind"], (doc: Doc, d: ExportData, y: number, s: Section) => void> = {
  tiles, tape, columns, langs, projects, sessions, days, files, heat,
}

export function reportPdf(d: ExportData): ArrayBuffer {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true })
  doc.addFileToVFS("MartianMono-NrRg.ttf", MM_REGULAR)
  doc.addFont("MartianMono-NrRg.ttf", FONT, "normal")
  doc.addFileToVFS("MartianMono-NrBd.ttf", MM_BOLD)
  doc.addFont("MartianMono-NrBd.ttf", FONT, "bold")
  const pages = reportPages(d)
  pages.forEach((sections, i) => {
    if (i) doc.addPage()
    frame(doc, d, i + 1, pages.length)
    let y = CONTENT_TOP
    for (const s of sections) {
      DRAW[s.kind](doc, d, y, s)
      y += s.h + GAP
    }
  })
  return doc.output("arraybuffer")
}
```

- [ ] **Step 4: Run the suites**

Run: `node scripts/test.js --suite report`
Expected: PASS, 3 tests.

Run: `node scripts/test.js --suite fonts`
Expected: PASS — `reportPdf.ts` is now scanned; its non-ASCII characters (`·`, `−`, `–`, `—`, `…`) are all in the font. If it fails naming a character, replace that character in the code (do not widen the check).

- [ ] **Step 5: Add the reports to the harness**

In `test/harness/exports.ts`, add the import and, at the end of `main()`, a download button per case including 90 days:

```ts
import { reportPdf } from "../../src/webview/reportPdf"
```

```ts
  const reports = document.getElementById("reports")!
  for (const [label, w, sel] of CASES) {
    for (const span of ["today", "7d", "30d", "90d"] as Span[]) {
      const b = document.createElement("button")
      b.textContent = `report: ${label.split(",")[1].trim()}, ${span}`
      b.onclick = () => {
        const blob = new Blob([reportPdf(exportData(w.range, w.year, sel, span, Date.now()))], { type: "application/pdf" })
        window.open(URL.createObjectURL(blob))
      }
      reports.append(b)
    }
  }
```

Rebuild the harness bundle (same `npx esbuild …` command as Task 5) and serve the repo root again. Open several reports (today all projects, 7d one project, 30d, 90d, empty install) next to the mockup (format "report"). Expected: dark pages with the rounded hairline frame; carrot 4× header with "rabbit hole · report", the project and dates, "page n of 2"; eight tiles; the 48-cell tape or per-day columns; the languages table (lines first, coloured bars) and the projects table for all projects; page 2 with sessions or days (capped, with the "and N earlier" line on long ranges), files as `git diff --stat` with green `+` and red `-` runs, a centred heatmap at 30 and 90 days; the footer with the 2× carrot. Text is Martian Mono, nothing crosses the frame or a section box, and selecting text in the viewer gives real text.

- [ ] **Step 6: Full gate and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add src/webview/reportPdf.ts test/webview.report.test.ts test/harness/exports.ts scripts/test.js tsconfig.test.json
git commit -m "Render the TTY report with jsPDF and embedded Martian Mono, tested end to end in node"
```

---

### Task 7: The export dialog, and the old export path removed

**Files:**
- Replace: `src/webview/exportDialog.ts`
- Modify: `src/dashboard/dashboardPanel.ts` (dialog markup, ~line 314), `src/webview/main.ts:22,105-106`, `src/webview/style.css` (`.xd` rules ~line 396), `src/shared/types.ts`, `src/dashboard/messageHandler.ts`
- Delete: `src/webview/jpgExport.ts`, `src/webview/pdfExport.ts`, `src/webview/exportShared.ts`
- Create: `test/harness/dashboard.js`, `test/harness/dashboardStub.ts`
- Test: `test/dashboard.handler.test.ts`; visual in the dashboard harness

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: `initExport(store: Store, post: (m: WebviewMessage) => void): void`, `openExport(): void`, `onExportMessage(msg: ExtensionMessage): void`. `settingsTab.ts` keeps calling `openExport` unchanged.

- [ ] **Step 1: Write the failing handler test for the removal**

Append to `test/dashboard.handler.test.ts`:

```ts
// The webview now renders cards and reports from data it already has; the old
// round trip through the host is gone.
describe("the old export protocol", () => {
  it("exportPdfRequest, writePdf and writeJpg do nothing", async () => {
    handleMessage({ type: "exportPdfRequest", preset: "today" } as any, store(), panel)
    handleMessage({ type: "writePdf", base64: "eA==", projectName: "x" } as any, store(), panel)
    handleMessage({ type: "writeJpg", base64: "eA==", projectName: "x" } as any, store(), panel)
    await settle()
    assert.deepStrictEqual(posted, [])
    assert.strictEqual(v.calls.saveDialogs, 0)
  })
})
```

Run: `node scripts/test.js --suite handler`
Expected: FAIL — `exportPdfRequest` posts `pdfData` and the writes open save dialogs.

- [ ] **Step 2: Remove the old protocol from the host**

In `src/shared/types.ts` delete these members:

```ts
  | { type: "pdfData"; logs: DailyLog[]; projectName: string; dateRange: { from: string; to: string } }
```
```ts
  | { type: "exportPdfRequest"; preset: "today" | "7d" | "30d" | "90d" | "custom"; customStart?: string; customEnd?: string; exportProjectId?: string }
  | { type: "writePdf"; base64: string; projectName: string }
  | { type: "writeJpg"; base64: string; projectName: string }
```

In `src/dashboard/messageHandler.ts` delete the `exportPdfRequest`, `writePdf` and `writeJpg` cases and the functions `presetToDates`, `offsetDateStr`, `exportFilename`, `writePdfExport`, `writeJpgExport`. Then:

Run: `grep -n "todayStr" src/dashboard/messageHandler.ts`
If the only hit is its own definition, delete `todayStr` too.

- [ ] **Step 3: Replace the dialog markup**

In `src/dashboard/dashboardPanel.ts`, replace the whole `<div class="xd-back" id="xd" hidden> … </div>` block with:

```html
<div class="xd-back" id="xd" hidden>
  <div class="xd" role="dialog" aria-modal="true" aria-labelledby="xd-title">
    <fieldset class="xd-form">
      <legend><b id="xd-title">export</b></legend>
      <div class="xd-row">
        <span class="k">format</span>
        <div class="opts" id="xd-format" role="group" aria-label="Format"><button data-v="card">share card</button><button data-v="report">report</button><button data-v="csv">csv</button><button data-v="json">json</button></div>
        <span class="desc" id="xd-what"></span>
      </div>
      <div class="xd-row">
        <span class="k">range</span>
        <div class="opts" id="xd-range" role="group" aria-label="Range"><button data-v="today">today</button><button data-v="7d">7d</button><button data-v="30d">30d</button><button data-v="90d">90d</button></div>
      </div>
      <div class="xd-row">
        <span class="k">project</span>
        <div class="opts" id="xd-project" role="group" aria-label="Project"></div>
      </div>
      <div class="xd-row">
        <span class="k">saves as</span>
        <span class="dest" id="xd-dest"></span>
      </div>
      <div class="xd-foot"><button class="btn" id="xd-cancel">cancel</button><button class="btn primary" id="xd-go">export</button></div>
      <div class="xd-status" id="xd-status" aria-live="polite"></div>
    </fieldset>
    <section class="xd-stage" aria-label="Preview">
      <div class="xd-head" id="xd-head"></div>
      <div class="xd-canvas" id="xd-preview"></div>
    </section>
  </div>
</div>
```

- [ ] **Step 4: Style it**

In `src/webview/style.css`, replace the line `.xd { width: min(560px, 100%); }` with:

```css
.xd { width: min(1100px, 100%); max-height: calc(100vh - 32px); overflow: auto; display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 860px) { .xd { grid-template-columns: minmax(0, 1fr); } }
.xd-form { border-color: var(--chrome); }
.xd-row { display: grid; gap: 6px; padding-block: 8px; }
.xd-row + .xd-row { border-top: 1px dashed var(--rule); }
.xd-row .k { color: var(--ink-dim); }
.xd-row .desc, .xd-row .dest { color: var(--ink-mute); overflow-wrap: anywhere; }
.opts button:disabled { color: var(--ink-mute); opacity: .5; cursor: default; }
.btn.primary { background: var(--chrome); color: var(--chrome-ink); padding: 3px 10px; text-shadow: none; }
.btn.primary::before, .btn.primary::after { content: none; }
.btn.primary:disabled { background: var(--rule); color: var(--ink-mute); }
.xd-status { min-height: 1.5em; margin-top: 6px; color: var(--add); }
.xd-status.bad { color: var(--del); }
.xd-stage { display: grid; gap: 10px; min-width: 0; background: var(--panel); border: 1px solid var(--rule); padding: 12px; }
.xd-head { display: flex; flex-wrap: wrap; gap: 4px 18px; color: var(--ink-dim); }
.xd-head b { color: var(--ink); font-weight: 600; }
.xd-canvas { display: flex; justify-content: center; border: 1px dashed var(--rule); padding: 14px; min-height: 120px; }
.xd-canvas canvas { width: min(420px, 100%); height: auto; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
.xd-outline { margin: 0; padding: 0; list-style: none; width: 100%; }
.xd-outline li { color: var(--ink-dim); padding-left: 2ch; }
.xd-outline li.pg { color: var(--chrome); padding-left: 0; margin-top: 6px; }
.hint.bad { color: var(--del); }
```

- [ ] **Step 5: Write the dialog**

Replace `src/webview/exportDialog.ts` with:

```ts
// The export dialog: format, range, project, the file name it will suggest,
// and a live preview (the share card itself, or the report's outline). It
// fetches the last 90 days once when opened, tagged so the dashboard ignores
// the reply, and every option then renders from that without waiting.
import type { ExtensionMessage, RangePayload, WebviewMessage } from "../shared/types"
import { ExportExt, exportFileName } from "../shared/exportName"
import { $, el, press } from "./dom"
import { reportOutline } from "./exportLayout"
import { ExportData, Format, SPANS, SPAN_DAYS, Span, exportData, fitSpan, rangeText, spanDates } from "./exportModel"
import { dstr } from "./format"
import type { Selection } from "./model"
import { reportPdf } from "./reportPdf"
import { cardFontsReady, cardJpegBase64, drawCard } from "./shareCard"
import type { Store } from "./state"

const EXT: Record<Format, ExportExt> = { card: "jpg", report: "pdf", csv: "csv", json: "json" }
const NAME: Record<Format, string> = { card: "share card", report: "report", csv: "csv", json: "json" }
const WHAT: Record<Format, string> = {
  card: "a 420×620 image to post, drawn at 3×",
  report: "an A4 PDF to keep or print",
  csv: "one row per day: date, totalTime, activeTime, streak, linesAdded, linesDeleted (times in ms)",
  json: "the daily logs in full: sessions with their languages, files and languages",
}

let store: Store | null = null
let post: ((m: WebviewMessage) => void) | null = null
let format: Format = "card"
let span: Span = "today"
let sel: Selection = "all"
let data: RangePayload | null = null
let failed = false
let busy = false
let fetchedFor = ""   // the day the 90 days end on; a new day refetches

const isOpen = (): boolean => !$("xd").hidden

function window90(): { from: string; to: string } | null {
  return store?.year ? spanDates("90d", store.year.today) : null
}

function fetchData(): void {
  const w = window90()
  if (!w || !post) return
  data = null
  failed = false
  fetchedFor = w.to
  post({ type: "requestDays", ...w, for: "export" })
}

function title(): string {
  if (sel === "all") return "all projects"
  return store?.year?.projects.find(p => p.id === sel)?.name ?? "unknown project"
}

function current(): ExportData | null {
  const y = store?.year
  return y && data ? exportData(data, y, sel, span, Date.now()) : null
}

function status(text: string, bad = false): void {
  const s = $("xd-status")
  s.textContent = text
  s.classList.toggle("bad", bad)
}

function buildProjects(): void {
  const y = store?.year
  if (!y) return
  if (sel !== "all" && !y.projects.some(p => p.id === sel)) sel = "all"
  $("xd-project").replaceChildren(...[{ id: "all", name: "all projects" }, ...y.projects].map(p => {
    const b = el("button", null, p.name)
    b.dataset.v = p.id
    return b
  }))
}

function render(): void {
  const y = store?.year
  if (!y) return
  span = fitSpan(format, span)
  press($("xd-format"), b => b.dataset.v === format)
  press($("xd-range"), b => b.dataset.v === span)
  press($("xd-project"), b => b.dataset.v === sel)
  $("xd-format").querySelectorAll<HTMLButtonElement>("button").forEach(b => { b.disabled = busy })
  $("xd-project").querySelectorAll<HTMLButtonElement>("button").forEach(b => { b.disabled = busy })
  $("xd-range").querySelectorAll<HTMLButtonElement>("button").forEach(b => {
    b.disabled = busy || !SPANS[format].includes(b.dataset.v as Span)
  })
  $("xd-what").textContent = WHAT[format]
  const { from, to } = spanDates(span, y.today)
  $("xd-dest").textContent = `${exportFileName(title(), to, SPAN_DAYS[span], EXT[format])}, in a folder you pick`
  $("xd-head").replaceChildren(el("b", null, NAME[format]), el("span", null, span === "today" ? dstr(to) : `${dstr(from)} – ${dstr(to)}`), el("span", null, title()))

  const drawn = format === "card" || format === "report"
  $<HTMLButtonElement>("xd-go").disabled = busy || (drawn && !data)
  const pv = $("xd-preview")
  if (!drawn) {
    pv.replaceChildren(el("p", "hint", "written by the extension from your stored data; nothing to preview"))
    return
  }
  if (failed) {
    pv.replaceChildren(el("p", "hint bad", "couldn't load the data for this export"))
    return
  }
  const d = current()
  if (!d) {
    pv.replaceChildren(el("p", "hint", "loading…"))
    return
  }
  if (format === "card") {
    const canvas = pv.querySelector<HTMLCanvasElement>("canvas") ?? el("canvas")
    canvas.setAttribute("role", "img")
    canvas.setAttribute("aria-label", `share card preview: ${d.title}, ${rangeText(d)}`)
    drawCard(canvas, d)
    if (canvas.parentElement !== pv) pv.replaceChildren(canvas)
    return
  }
  const list = el("ul", "xd-outline")
  for (const p of reportOutline(d)) {
    list.append(el("li", "pg", `page ${p.page}`))
    for (const item of p.items) list.append(el("li", null, item))
  }
  pv.replaceChildren(list)
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function go(): Promise<void> {
  const s = store
  const p = post
  const y = s?.year
  if (!s || !p || !y || busy) return
  const { from, to } = spanDates(span, y.today)
  const name = exportFileName(title(), to, SPAN_DAYS[span], EXT[format])
  s.note("cmd", `rabbithole export --${format} --${span}${sel === "all" ? "" : ` --project ${title()}`}`)
  busy = true
  status(format === "card" || format === "report" ? "drawing…" : "saving…")
  render()
  try {
    if (format === "csv" || format === "json") {
      p({ type: "export", format, from, to, projectId: sel === "all" ? undefined : sel, name })
    } else {
      const d = current()
      if (!d) throw new Error("the data hasn't arrived yet")
      const base64 = format === "card" ? await cardJpegBase64(d) : toBase64(reportPdf(d))
      p({ type: "writeFile", kind: format === "card" ? "jpg" : "pdf", base64, name })
    }
    status("choose where to save it…")
  } catch (err) {
    busy = false
    status(`export failed: ${err instanceof Error ? err.message : String(err)}`, true)
    render()
  }
}

// Runs before the store sees each message (main.ts `extra`).
export function onExportMessage(msg: ExtensionMessage): void {
  if ((msg.type === "range" || msg.type === "rangeRefused") && msg.for === "export") {
    const w = window90()
    if (!w || msg.from !== w.from || msg.to !== w.to) return   // asked for before midnight
    if (msg.type === "range") data = { from: msg.from, to: msg.to, logs: msg.logs }
    else failed = true
    if (isOpen()) render()
    return
  }
  if (msg.type === "actionResult" && busy) {
    busy = false
    status(msg.lines.join(" "), !msg.ok)
    if (isOpen()) render()
  }
}

export function openExport(): void {
  const s = store
  if (!s?.year) return
  sel = s.view.sel
  busy = false
  status("")
  buildProjects()
  fetchData()
  $("xd").hidden = false
  render()
  void cardFontsReady().then(() => { if (isOpen()) render() })
  $("xd-format").querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
}

function closeExport(): void {
  $("xd").hidden = true
  data = null
}

export function initExport(s: Store, p: (m: WebviewMessage) => void): void {
  store = s
  post = p
  const pick = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLButtonElement>("button[data-v]") : null)
  const onPick = (id: string, set: (v: string) => void) => $(id).addEventListener("click", e => {
    const b = pick(e.target)
    if (!b || b.disabled || busy) return
    set(b.dataset.v ?? "")
    status("")
    render()
  })
  onPick("xd-format", v => { format = v as Format })
  onPick("xd-range", v => { span = v as Span })
  onPick("xd-project", v => { sel = v })
  $("xd-cancel").addEventListener("click", closeExport)
  $("xd-go").addEventListener("click", () => { void go() })
  $("xd").addEventListener("click", e => { if (e.target === $("xd")) closeExport() })
  window.addEventListener("keydown", e => { if (e.key === "Escape" && isOpen()) closeExport() })
  // a new day while the dialog is open: the 90 days end on the new today
  s.on(change => {
    if (change === "year" && isOpen() && s.year && s.year.today !== fetchedFor) {
      buildProjects()
      fetchData()
      render()
    }
  })
}
```

- [ ] **Step 6: Wire it in `main.ts` and delete the old files**

In `src/webview/main.ts`, change the import and the `extra` line:

```ts
import { initExport, onExportMessage, openExport } from "./exportDialog"
```

```ts
initExport(store, post)
extra.push(onExportMessage)
```

```bash
git rm src/webview/jpgExport.ts src/webview/pdfExport.ts src/webview/exportShared.ts
```

`src/webview/fonts/Electrolize-Regular.ttf` and `OFL.txt` stay: the sidebar (`miniPanel.ts`) still loads Electrolize until phase 4.

Run: `grep -rn "exportShared\|jpgExport\|pdfExport\|pdfData\|exportPdfRequest\|writePdf\|writeJpg\|onExportData" src test`
Expected: no hits.

- [ ] **Step 7: Run the gate**

Run: `node scripts/test.js --suite handler`
Expected: PASS, including "the old export protocol".

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 8: Negative control for the removal**

```bash
git show HEAD:src/dashboard/messageHandler.ts > src/dashboard/_negcontrol.ts
node scripts/test.js --suite handler --alias handler=src/dashboard/_negcontrol.ts
rm src/dashboard/_negcontrol.ts
```

Expected: FAIL on "exportPdfRequest, writePdf and writeJpg do nothing" (the pre-change handler posts `pdfData`). The `_negcontrol.ts` copy imports types that no longer exist; esbuild strips types, so it still bundles.

- [ ] **Step 9: Write the dashboard harness**

Create `test/harness/dashboardStub.ts`:

```ts
// A stand-in for VS Code's webview API that answers the dashboard from fixture
// data, and downloads any file the export dialog asks the host to save.
import { MIN, sampleWorld } from "../helpers/exportFixtures"

const { year, range } = sampleWorld()
const settings = {
  type: "settings", dailyTargetMs: 20 * MIN, dailyTargetMinutes: 20, idleThresholdMinutes: 5, storagePath: "/harness",
  crt: { mask: "slot", pitch: "fine", strength: 23, vignette: 35, effects: ["scanlines", "bloom"] },
}
const send = (m: unknown) => setTimeout(() => window.postMessage(m, "*"), 30)

;(window as any).acquireVsCodeApi = () => ({
  getState: () => null,
  setState: () => undefined,
  postMessage: (m: any) => {
    console.log("[harness] webview →", m.type, m)
    if (m.type === "ready") { send(settings); send({ type: "year", ...year }) }
    if (m.type === "requestYear") send({ type: "year", ...year })
    if (m.type === "requestDays") {
      const logs = Object.fromEntries(Object.entries(range.logs).map(([id, l]: [string, any]) => [id, l.filter((x: any) => x.date >= m.from && x.date <= m.to)]))
      send({ type: "range", from: m.from, to: m.to, logs, ...(m.for ? { for: m.for } : {}) })
    }
    if (m.type === "writeFile") {
      const a = document.createElement("a")
      a.href = `data:${m.kind === "pdf" ? "application/pdf" : "image/jpeg"};base64,${m.base64}`
      a.download = m.name
      a.click()
    }
    if (m.type === "writeFile" || m.type === "export") send({ type: "actionResult", ok: true, lines: [`harness: would save ${m.name}`] })
  },
})
```

Create `test/harness/dashboard.js`:

```js
// Writes test/.out/harness/dashboard.html: the real dashboard markup without
// its CSP, loading the built webview and a stub VS Code API serving fixture
// data. Run `npm run build` first, then `node test/harness/dashboard.js`, serve
// the repo root (python -m http.server 8123) and open
// http://localhost:8123/test/.out/harness/dashboard.html
const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const out = path.join(root, "test", ".out", "harness")
fs.mkdirSync(out, { recursive: true })

const vscodeStub = path.join(out, "vscode-panel-stub.js")
fs.writeFileSync(vscodeStub, `
let html = ""
module.exports = {
  html: () => html,
  ViewColumn: { One: 1 },
  Uri: { joinPath: (_base, ...parts) => ({ rel: parts.join("/") }) },
  window: {
    activeTextEditor: undefined,
    createWebviewPanel: () => ({
      webview: { cspSource: "", asWebviewUri: u => "/" + u.rel, set html(v) { html = v }, postMessage() {}, onDidReceiveMessage() {} },
      onDidDispose() {}, reveal() {}, dispose() {},
    }),
  },
}`)

esbuild.buildSync({
  stdin: {
    contents: `const v = require("vscode"); const { DashboardPanel } = require("./src/dashboard/dashboardPanel"); DashboardPanel.createOrShow({ extensionUri: {} }); module.exports = v.html()`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", outfile: path.join(out, "panel.js"), alias: { vscode: vscodeStub }, logLevel: "warning",
})
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "dashboardStub.ts")],
  bundle: true, platform: "browser", outfile: path.join(out, "stub.js"), logLevel: "warning",
})

const html = require(path.join(out, "panel.js"))
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
  .replace("<script src=", `<script src="stub.js"></script>\n<script src=`)
fs.writeFileSync(path.join(out, "dashboard.html"), html)
console.log("wrote", path.join(out, "dashboard.html"))
```

- [ ] **Step 10: Check the dialog in the harness**

```bash
npm run build && node test/harness/dashboard.js
python -m http.server 8123
```

(server in the background) Open `http://localhost:8123/test/.out/harness/dashboard.html`, go to Settings → export. Expected:
- The dialog opens beside its preview (stacked below 860 px). The format, range and project buttons look like the mockup's; "90d" is greyed out for the share card; choosing "report" + "90d" and then "share card" lands on "30d".
- The share card preview appears ("loading…" first) and redraws on every option change. The report shows its outline (page 1 / page 2 sections with counts). CSV and JSON show their one-line descriptions.
- "saves as" shows names like `rabbithole-rabbit-hole-2026-10-05.jpg` and `rabbithole-all-projects-30d-to-2026-10-05.pdf`.
- Export downloads the JPEG or PDF, the status line reads "harness: would save …", and the settings console shows the `rabbithole export …` command and the result. Escape and the backdrop close the dialog.
- The dashboard's overview still shows its own range after the dialog has fetched 90 days (the tagged reply is ignored): select "today" in the top bar, open and close the export dialog, and confirm the overview still shows only today.

Stop the server.

- [ ] **Step 11: Commit**

```bash
git add -A src/webview/exportDialog.ts src/webview/main.ts src/webview/style.css src/dashboard/dashboardPanel.ts src/dashboard/messageHandler.ts src/shared/types.ts test/dashboard.handler.test.ts test/harness/dashboard.js test/harness/dashboardStub.ts
git commit -m "Replace the interim export dialog with the TTY one and its live preview, and remove the old export round trip"
```

(`git rm` in Step 6 already staged the three deletions.)

---

### Task 8: Phase wrap-up

**Files:**
- Modify: `CLAUDE.md` (gitignored: edit, don't commit)

- [ ] **Step 1: Update `CLAUDE.md`**

- Add a section after "TTY redesign — phase 2 dashboard":

```markdown
### TTY redesign — phase 3 exports (branch `tty-redesign`)
Plan `docs/superpowers/plans/2026-10-05-tty-redesign-phase3-exports.md`.
- `exportModel.ts` computes everything an export shows from `year` + `range` via `model.ts`; `exportLayout.ts` positions it (card blocks, report sections, caps: languages 8, projects 6, sessions 20, files 10, days 18 / 14 from 30 days). Both pure and tested; the renderers (`shareCard.ts` canvas, `reportPdf.ts` jsPDF) only draw.
- **Martian Mono has no block or shape glyphs** (`░▒▓█ ▁…▇ ■□◆`): the dashboard shows them via fallback fonts; the exports draw marks as shapes in colours mixed toward the background (`SHADE`). The fonts suite pins this.
- The report embeds `MartianMono-NrRg/NrBd.ttf` (v1.1.0, bundled as base64, not copied to `out/`), reads the font's own cmap at runtime (`ttfCoverage`) and prints anything the font lacks as `?` (`pdfSafe`): jsPDF has no fallback.
- The dialog fetches 90 days once with `requestDays { for: "export" }`; the host echoes `for` and `Store` ignores tagged replies. Files go to disk through `writeFile` (JPEG/PDF) or `export` (CSV/JSON), both with a `name` the host passes through `safeFileName` (`src/shared/exportName.ts`, shared with the dialog). Every save ends in an `actionResult`.
- `jpgExport.ts`, `pdfExport.ts`, `exportShared.ts` and the `exportPdfRequest` / `pdfData` / `writePdf` / `writeJpg` messages are gone. Electrolize stays until phase 4 (sidebar).
- Browser harnesses: `test/harness/exports.html` (every card variant, every report) and `test/harness/dashboard.js` (the real dashboard markup with a stub API); see the files' headers for how to run them.
```

- In "Relevant files": replace the `exportDialog.ts` row's description with "Export dialog: format/range/project/name, live card preview, report outline"; replace the `jpgExport.ts / pdfExport.ts / exportShared.ts` row with rows for `exportModel.ts` / `exportLayout.ts` ("what an export shows / where it goes — pure, tested"), `shareCard.ts` / `reportPdf.ts` ("the renderers"), `textFit.ts` ("ellipsize, font coverage, pdfSafe — pure"), and `src/shared/exportName.ts` ("suggested and sanitised export file names, shared by host and webview"). In the fonts row, add the two static TTFs and remove "PDF" from what Electrolize is still used for.
- In "Tests": update the suite count and total (`npm test` prints both), and add rows for `exportname`, `fonts`, `exportdata`, `exportlayout`, `report`.
- In the dashboard-panels table, Settings row: replace "export dialog" with "export dialog (live share-card preview, report outline)". Remove "The export dialog is **interim** …" from the phase 2 section.

- [ ] **Step 2: Final gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green; report the suite and test counts.

- [ ] **Step 3: Hand the Extension Development Host pass to the user**

This needs a person at VS Code. List for them:
- Settings → export in a dark, a light and a high-contrast theme: the dialog follows the theme; the card preview is always the dark phosphor card.
- Each format × range × project writes a file; open each: the JPEG in an image viewer at 100% (crisp at 3×, scanlines faint), the PDF in a viewer and printed to PDF/paper once (frame, text selectable), the CSV and JSON unchanged in shape.
- The save dialog opens in the workspace folder (or home with no folder open) on the suggested name; cancelling prints "export cancelled, nothing written" in the dialog and the console.
- A project with a non-Latin name (rename a folder, or edit its name in a backup and restore it) prints with `?` in the report and correctly on the card.
- The dashboard's own block glyphs (tape, heatmap, sparklines, streak marks) come from fallback fonts: check they look right on this machine, and on macOS if one is available (Menlo fallback), since Martian Mono has none.
- Leave the dialog open across midnight (or change the system date): the next option change shows the new day.

- [ ] **Step 4: Commit**

Nothing to commit if only `CLAUDE.md` changed (it is gitignored). Otherwise:

```bash
git status --short
```

Expected: clean.

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

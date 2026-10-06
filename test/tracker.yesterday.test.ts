import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
// @ts-ignore — esbuild alias to src/tracker/ledgerStore.ts
import { dropYesterday, keepYesterday, ledgerFile, loadYesterday, pruneLedgers, saveLedger, yesterdayFile } from "ledgerStore"

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-yday-"))
after(() => fs.rmSync(DIR, { recursive: true, force: true }))
let n = 0
const fresh = () => ledgerFile(DIR, [`file:///y${n++}`])
const snap = (day: string, files: Record<string, unknown>) => ({ version: 1, day, files })
const entry = (last: number[]) => ({ base: null, last, credited: { added: 0, deleted: 0 }, edited: false })

describe("keepYesterday", () => {
  it("renames a snapshot written yesterday", () => {
    const f = fresh()
    saveLedger(f, snap("2026-10-05", { "C:\\w\\a.ts": entry([1, 2]) }))
    keepYesterday(f, "2026-10-05")
    assert.ok(!fs.existsSync(f))
    assert.ok(fs.existsSync(yesterdayFile(f)))
  })
  it("leaves an older snapshot for pruning", () => {
    const f = fresh()
    saveLedger(f, snap("2026-10-01", {}))
    keepYesterday(f, "2026-10-05")
    assert.ok(fs.existsSync(f))
    assert.ok(!fs.existsSync(yesterdayFile(f)))
  })
})

describe("loadYesterday", () => {
  it("returns each file's last content and the save time", () => {
    const f = fresh()
    saveLedger(f, snap("2026-10-05", { "C:\\w\\a.ts": entry([1, 2]), "C:\\w\\gone.ts": entry([]), "bad": { last: "x" } }))
    keepYesterday(f, "2026-10-05")
    const y = loadYesterday(yesterdayFile(f), "2026-10-05")!
    assert.deepStrictEqual([...y.files.entries()].sort(), [["C:\\w\\a.ts", [1, 2]], ["C:\\w\\gone.ts", []]])
    assert.ok(Math.abs(y.savedAt - fs.statSync(yesterdayFile(f)).mtimeMs) < 1)
  })
  it("a wrong day or missing file is null", () => {
    const f = fresh()
    saveLedger(f, snap("2026-10-05", {}))
    keepYesterday(f, "2026-10-05")
    assert.strictEqual(loadYesterday(yesterdayFile(f), "2026-10-04"), null)
    assert.strictEqual(loadYesterday(yesterdayFile(fresh()), "2026-10-05"), null)
  })
  it("dropYesterday deletes it", () => {
    const f = fresh()
    saveLedger(f, snap("2026-10-05", {}))
    keepYesterday(f, "2026-10-05")
    dropYesterday(yesterdayFile(f))
    assert.ok(!fs.existsSync(yesterdayFile(f)))
  })
})

describe("pruning yesterday files", () => {
  it("a yesterday file older than a day before midnight is removed; a fresh one stays", () => {
    const oldF = fresh(); const newF = fresh()
    for (const f of [oldF, newF]) { saveLedger(f, snap("2026-10-05", {})); keepYesterday(f, "2026-10-05") }
    const midnight = Date.now()
    const ancient = (midnight - 3 * 86_400_000) / 1000
    fs.utimesSync(yesterdayFile(oldF), ancient, ancient)
    pruneLedgers(newF, midnight)
    assert.ok(!fs.existsSync(yesterdayFile(oldF)))
    assert.ok(fs.existsSync(yesterdayFile(newF)))
  })
})

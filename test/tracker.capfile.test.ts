import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
// @ts-ignore — esbuild alias to src/tracker/captureStore.ts
import { CaptureWriter, captureFile, loadCapture, pruneCaptures, readCaptured, saveCapture } from "captureStore"
// @ts-ignore — esbuild alias to src/tracker/lineLedger.ts
import { hashLines } from "ledger"

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-capfile-"))
after(() => fs.rmSync(DIR, { recursive: true, force: true }))
const DAY = "2026-10-06"
const h = (t: string) => hashLines(t)
let n = 0
const freshJson = () => captureFile(DIR, [`file:///w${n++}`])

function write(json: string, day = DAY) {
  const w = new CaptureWriter(json, day)
  const a = w.add(h("a\nb\n"))
  const b = w.add(h("c\n"))
  w.close()
  saveCapture(json, { version: 1, day, bin: w.name, folders: [{ root: "C:\\w", partial: false }], index: { "C:\\w\\a.ts": a, "C:\\w\\b.ts": b, "C:\\w\\n.ts": "empty", "C:\\w\\t.ts": "useB" } })
  return { w, a, b }
}

describe("capture file round trip", () => {
  it("saves and loads the index and reads each file's hashes back", () => {
    const json = freshJson()
    const { a, b } = write(json)
    const loaded = loadCapture(json, DAY)
    assert.strictEqual(loaded.kind, "today")
    const c = (loaded as any).capture
    assert.deepStrictEqual(readCaptured(path.dirname(json), c.bin, c.index["C:\\w\\a.ts"]), h("a\nb\n"))
    assert.deepStrictEqual(readCaptured(path.dirname(json), c.bin, b), h("c\n"))
    assert.deepStrictEqual(a, [0, 2])
    assert.strictEqual(c.index["C:\\w\\n.ts"], "empty")
    assert.strictEqual(c.index["C:\\w\\t.ts"], "useB")
  })
  it("an empty file is [offset, 0] and reads back as []", () => {
    const json = freshJson()
    const w = new CaptureWriter(json, DAY)
    const e = w.add([]); w.close()
    assert.deepStrictEqual(readCaptured(path.dirname(json), w.name, e), [])
  })
  it("a range past the end of the bin reads as null", () => {
    const json = freshJson()
    const { w } = write(json)
    assert.strictEqual(readCaptured(path.dirname(json), w.name, [1, 99]), null)
    assert.strictEqual(readCaptured(path.dirname(json), "missing.bin", [0, 1]), null)
  })
})

describe("rejected captures are deleted", () => {
  it("another day's capture is stale; its keys are returned and its index removed", () => {
    const json = freshJson()
    const { w } = write(json, "2026-10-05")
    const loaded = loadCapture(json, DAY) as any
    assert.strictEqual(loaded.kind, "stale")
    assert.deepStrictEqual(loaded.paths.sort(), ["C:\\w\\a.ts", "C:\\w\\b.ts", "C:\\w\\n.ts", "C:\\w\\t.ts"])
    assert.ok(!fs.existsSync(json))
    assert.ok(fs.existsSync(path.join(path.dirname(json), w.name))) // another window may still read it
  })
  it("an unknown version or corrupt JSON is stale with no keys", () => {
    const json = freshJson()
    fs.mkdirSync(path.dirname(json), { recursive: true })
    fs.writeFileSync(json, JSON.stringify({ version: 2, day: DAY }))
    assert.deepStrictEqual(loadCapture(json, DAY), { kind: "stale", paths: [] })
    fs.writeFileSync(json, "{not json")
    assert.deepStrictEqual(loadCapture(json, DAY), { kind: "stale", paths: [] })
  })
  it("today's capture whose bin is missing is stale (retaken)", () => {
    const json = freshJson()
    const { w } = write(json)
    fs.rmSync(path.join(path.dirname(json), w.name))
    assert.strictEqual(loadCapture(json, DAY).kind, "stale")
  })
  it("no capture file is none", () => assert.deepStrictEqual(loadCapture(freshJson(), DAY), { kind: "none" }))
  it("a json containing null is stale without throwing", () => {
    const json = freshJson()
    fs.mkdirSync(path.dirname(json), { recursive: true })
    fs.writeFileSync(json, "null")
    assert.deepStrictEqual(loadCapture(json, DAY), { kind: "stale", paths: [] })
    assert.ok(!fs.existsSync(json))
  })
  it("a json whose index is an array is stale without throwing", () => {
    const json = freshJson()
    fs.mkdirSync(path.dirname(json), { recursive: true })
    fs.writeFileSync(json, JSON.stringify({ version: 1, day: DAY, bin: "x.bin", folders: [], index: [] }))
    assert.deepStrictEqual(loadCapture(json, DAY), { kind: "stale", paths: [] })
    assert.ok(!fs.existsSync(json))
  })
  it("a json with a malformed index entry (negative offset) is stale", () => {
    const json = freshJson()
    const w = new CaptureWriter(json, DAY)
    w.add([1])
    w.close()
    saveCapture(json, { version: 1, day: DAY, bin: w.name, folders: [{ root: "C:\\w", partial: false }], index: { "C:\\w\\bad.ts": [-1, 2] as any } })
    const loaded = loadCapture(json, DAY)
    assert.strictEqual(loaded.kind, "stale")
  })
  it("a json with a bogus index entry is stale", () => {
    const json = freshJson()
    const w = new CaptureWriter(json, DAY)
    w.add([1])
    w.close()
    saveCapture(json, { version: 1, day: DAY, bin: w.name, folders: [{ root: "C:\\w", partial: false }], index: { "C:\\w\\bad.ts": "bogus" as any } })
    const loaded = loadCapture(json, DAY)
    assert.strictEqual(loaded.kind, "stale")
  })
})

describe("the json and bin stay consistent", () => {
  it("a newer save preserves older readers; an unsaved writer leaves the saved pair intact", () => {
    const json = freshJson()
    const first = write(json).w
    const second = write(json).w
    assert.ok(fs.existsSync(path.join(path.dirname(json), first.name)))
    // a capture interrupted after writing its bin but before saving the json
    const orphan = new CaptureWriter(json, DAY); orphan.add(h("z\n")); orphan.close()
    const c = (loadCapture(json, DAY) as any).capture
    assert.strictEqual(c.bin, second.name)
    assert.deepStrictEqual(readCaptured(path.dirname(json), c.bin, c.index["C:\\w\\a.ts"]), h("a\nb\n"))
  })
})

describe("pruneCaptures", () => {
  it("removes other workspaces' captures older than the threshold", () => {
    const json = freshJson()
    write(json)
    const old = Date.now() / 1000 - 40 * 86_400
    for (const f of fs.readdirSync(path.dirname(json))) if (f.startsWith(path.basename(json, ".json"))) fs.utimesSync(path.join(path.dirname(json), f), old, old)
    pruneCaptures(path.dirname(json), Date.now() - 30 * 86_400_000)
    assert.ok(!fs.existsSync(json))
  })
})

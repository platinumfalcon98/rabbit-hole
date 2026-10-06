import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
// @ts-ignore — esbuild alias to src/tracker/morningStore.ts
import { MorningStore, classify } from "morningStore"
// @ts-ignore — esbuild alias to src/tracker/captureStore.ts
import { CaptureWriter, captureFile } from "captureStore"
// @ts-ignore — esbuild alias to src/tracker/lineLedger.ts
import { hashLines } from "ledger"
// @ts-ignore — esbuild alias to src/tracker/pathRules.ts
import { normalizePath } from "paths"

const MID = 1_000_000
const h = (t: string) => hashLines(t)
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-store-"))
after(() => fs.rmSync(DIR, { recursive: true, force: true }))

describe("classify", () => {
  const st = (mtimeMs: number, birthtimeMs = 0) => ({ mtimeMs, birthtimeMs })
  it("modified before midnight: exact, whatever else is true", () =>
    assert.strictEqual(classify(st(MID - 1, MID + 5), MID, true, true, false), "exact"))
  it("in a usable snapshot: the snapshot", () => assert.strictEqual(classify(st(MID + 1), MID, true, true, true), "snapshot"))
  it("modified after midnight and tracked: B", () => assert.strictEqual(classify(st(MID + 1), MID, true, false, false), "useB"))
  it("a tracked file with a new creation time is B, never empty (temp-and-rename saves)", () =>
    assert.strictEqual(classify(st(MID + 2, MID + 1), MID, true, false, false), "useB"))
  it("untracked, created after midnight, not seen before: empty", () =>
    assert.strictEqual(classify(st(MID + 2, MID + 1), MID, false, false, false), "empty"))
  it("untracked, created after midnight, but it existed before: unknown", () =>
    assert.strictEqual(classify(st(MID + 2, MID + 1), MID, false, false, true), "unknown"))
  it("untracked, modified after midnight, no creation time: unknown", () =>
    assert.strictEqual(classify(st(MID + 2, 0), MID, false, false, false), "unknown"))
  it("untracked, born before midnight, modified after: unknown", () =>
    assert.strictEqual(classify(st(MID + 2, MID - 1), MID, false, false, false), "unknown"))
})

const ROOT = path.join(DIR, "w")
const P = (rel: string) => path.join(ROOT, rel)
function setup(opts: { kind?: "git" | "plain"; listed?: string[]; listedDirs?: string[]; worktree?: boolean; blobs?: Record<string, string | "missing" | "unknown"> } = {}) {
  const json = captureFile(DIR, [Math.random().toString()])
  const writer = new CaptureWriter(json, "d")
  const reads: string[] = []
  const repo: any = {
    top: normalizePath(ROOT), topRaw: ROOT, baseline: "B", worktree: !!opts.worktree,
    listed: new Set((opts.listed ?? []).map(r => normalizePath(P(r)))),
    listedDirs: (opts.listedDirs ?? []).map(r => normalizePath(P(r)) + "/"),
    reflog: [],
  }
  const store = new MorningStore("d", {
    bin: { dir: path.dirname(json), name: writer.name },
    findRepo: async () => repo,
    readBlob: async (_r: any, rel: string) => {
      reads.push(rel)
      const b = (opts.blobs ?? {})[rel]
      return b === undefined || b === "missing" ? "missing" : b === "unknown" ? "unknown" : Buffer.from(b)
    },
  })
  store.addFolder(ROOT)
  return { store, writer, reads, ready: () => store.folderReady(ROOT, opts.kind ?? "git") }
}

describe("MorningStore.lookup", () => {
  it("a captured file returns its captured hashes", async () => {
    const { store, writer, ready } = setup()
    store.put(P("a.ts"), writer.add(h("x\ny\n"))); ready()
    assert.deepStrictEqual(await store.lookup(P("a.ts")), h("x\ny\n"))
  })
  it("empty → [], unknown → unknown, useB → B's content", async () => {
    const { store, ready } = setup({ blobs: { "t.ts": "b\n" } })
    store.put(P("n.ts"), "empty"); store.put(P("u.ts"), "unknown"); store.put(P("t.ts"), "useB"); ready()
    assert.deepStrictEqual(await store.lookup(P("n.ts")), [])
    assert.strictEqual(await store.lookup(P("u.ts")), "unknown")
    assert.deepStrictEqual(await store.lookup(P("t.ts")), h("b\n"))
  })
  it("a lookup waits for the folder's git status", async () => {
    const { store, ready } = setup({ blobs: { "c.ts": "c\n" } })
    let settled = false
    const p = store.lookup(P("c.ts")).then((r: unknown) => { settled = true; return r })
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(settled, false)
    ready()
    assert.deepStrictEqual(await p, h("c\n"))
  })
  it("a clean tracked file resolves through git; absent from B is []", async () => {
    const { store, ready } = setup({ blobs: { "src/c.ts": "c\n" } })
    ready()
    assert.deepStrictEqual(await store.lookup(P("src/c.ts")), h("c\n"))
    assert.deepStrictEqual(await store.lookup(P("new.ts")), [])
  })
  it("a dirty file the capture has not reached is unknown, never B", async () => {
    const { store, reads, ready } = setup({ listed: ["d.ts"], blobs: { "d.ts": "yesterday's committed\n" } })
    ready()
    assert.strictEqual(await store.lookup(P("d.ts")), "unknown")
    assert.deepStrictEqual(reads, [])
  })
  it("a file under a collapsed ignored directory is unknown until captured", async () => {
    const { store, ready } = setup({ listedDirs: ["docs"] })
    ready()
    assert.strictEqual(await store.lookup(P("docs/x.md")), "unknown")
  })
  it("a plain folder: uncaptured is unknown, captured is exact", async () => {
    const { store, writer, ready } = setup({ kind: "plain" })
    store.put(P("a.ts"), writer.add(h("q\n"))); ready()
    assert.strictEqual(await store.lookup(P("b.ts")), "unknown")
    assert.deepStrictEqual(await store.lookup(P("a.ts")), h("q\n"))
  })
  it("a worktree file resolves through its own B even when listed", async () => {
    const { store, ready } = setup({ worktree: true, listed: ["w.ts"], blobs: { "w.ts": "w\n" } })
    ready()
    assert.deepStrictEqual(await store.lookup(P("w.ts")), h("w\n"))
  })
  it("a git read that cannot answer is unknown", async () => {
    const { store, ready } = setup({ blobs: { "lfs.json": "unknown" } })
    ready()
    assert.strictEqual(await store.lookup(P("lfs.json")), "unknown")
  })
  it("a repo whose top is not a prefix of the path is unknown, never read", async () => {
    const { store, reads } = setup({ blobs: { "a.ts": "a\n" } })
    const other: any = { top: normalizePath(path.join(DIR, "other")), topRaw: path.join(DIR, "other"), baseline: "B", worktree: false, listed: new Set(), listedDirs: [], reflog: [] }
    ;(store as any).deps.findRepo = async () => other
    store.folderReady(ROOT, "git")
    assert.strictEqual(await store.lookup(P("a.ts")), "unknown")
    assert.deepStrictEqual(reads, [])
  })
  it("a path outside every workspace folder is unknown", async () => {
    const { store, ready } = setup(); ready()
    assert.strictEqual(await store.lookup(path.join(DIR, "elsewhere", "a.ts")), "unknown")
  })
  it("index() reports raw keys", () => {
    const { store } = setup()
    store.put(P("Mixed.ts"), "empty")
    assert.deepStrictEqual(store.index(), { [P("Mixed.ts")]: "empty" })
  })
})

import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawnSync } from "node:child_process"
// @ts-ignore — esbuild alias to src/tracker/gitBaseline.ts
import { BlobQueue, Git } from "gitBaseline"
import { TempRepo, startOfToday, yesterdayNoon } from "./helpers/gitRepo"

const repos: TempRepo[] = []
const repo = (init = true) => { const r = new TempRepo(init); repos.push(r); return r }
after(() => repos.forEach(r => r.cleanup()))
const git = new Git()
const MID = startOfToday()
const now = () => Date.now()
const B = async (r: TempRepo) => git.baselineFor(r.dir, await git.reflog(r.dir), MID)

describe("topLevel", () => {
  it("finds the repo top from a subdirectory", async () => {
    const r = repo(); r.write("a/b/c.ts", "x\n")
    const top = await git.topLevel(r.path("a/b"))
    assert.strictEqual(path.resolve(top!).toLowerCase(), path.resolve(r.dir).toLowerCase())
  })
  it("returns null outside a repo", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-plain-"))
    assert.strictEqual(await git.topLevel(d), null)
    fs.rmSync(d, { recursive: true, force: true })
  })
  it("throws when git cannot run (bad executable)", async () => {
    await assert.rejects(new Git(path.join(os.tmpdir(), "no-such-git.exe")).topLevel(os.tmpdir()))
  })
  it("times out a hung command", async () => {
    await assert.rejects(new Git(process.execPath, 200).run(os.tmpdir(), ["-e", "setTimeout(() => {}, 5000)"]), /timed out/)
  })
})

describe("baselineFor against real reflogs", () => {
  it("today's commits keep yesterday's HEAD", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon()); const y = r.head()
    r.write("a.ts", "2\n"); r.commitAll("t", now())
    assert.strictEqual(await B(r), y)
  })
  it("a checkout today moves it", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    r.git(["checkout", "-q", "-b", "feat"], yesterdayNoon()); r.write("b.ts", "f\n"); r.commitAll("f", yesterdayNoon()); const f = r.head()
    r.git(["checkout", "-q", "main"], yesterdayNoon())
    r.git(["checkout", "-q", "feat"], now())
    assert.strictEqual(await B(r), f)
  })
  it("a hard reset today moves it", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("x", yesterdayNoon() - 3_600_000); const x = r.head()
    r.write("a.ts", "2\n"); r.commitAll("y", yesterdayNoon())
    r.git(["reset", "-q", "--hard", x], now())
    assert.strictEqual(await B(r), x)
  })
  it("a repo cloned today: the clone's HEAD", async () => {
    const src = repo(); src.write("a.ts", "1\n"); src.commitAll("y", yesterdayNoon())
    const dst = repo(false)
    dst.git(["clone", "-q", src.dir, "."], now())
    assert.strictEqual(await B(dst), src.head())
  })
  it("no reflog: the last commit before midnight", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon()); const y = r.head()
    r.write("a.ts", "2\n"); r.commitAll("t", now())
    fs.rmSync(path.join(r.dir, ".git", "logs"), { recursive: true, force: true })
    assert.strictEqual(await B(r), y)
  })
  it("no reflog and nothing before midnight: HEAD", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("t", now())
    fs.rmSync(path.join(r.dir, ".git", "logs"), { recursive: true, force: true })
    assert.strictEqual(await B(r), r.head())
  })
  it("empty repo has no baseline", async () => assert.strictEqual(await B(repo()), null))
})

describe("status, submodules and diffNames", () => {
  it("lists dirty tracked, untracked files individually, and collapsed ignored dirs", async () => {
    const r = repo()
    r.write(".gitignore", "dist/\n*.env\n"); r.write("a.ts", "1\n"); r.write("gone.ts", "g\n"); r.commitAll("y", yesterdayNoon())
    r.write("a.ts", "2\n"); fs.rmSync(r.path("gone.ts")); r.write("notes/x.md", "n\n"); r.write("dist/out.js", "o\n"); r.write("k.env", "s\n")
    const st = await git.status(r.dir)
    assert.deepStrictEqual(st.tracked.sort(), ["a.ts", "gone.ts"])
    assert.deepStrictEqual(st.untracked, ["notes/x.md"])
    assert.deepStrictEqual(st.ignored.sort(), ["dist/", "k.env"])
  })
  it("a nested repo shows as an untracked directory", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    const inner = path.join(r.dir, "sub"); fs.mkdirSync(inner)
    spawnSync("git", ["init", "-q", inner])
    fs.writeFileSync(path.join(inner, "s.ts"), "s\n")
    assert.deepStrictEqual((await git.status(r.dir)).untracked, ["sub/"])
  })
  it("submodules() is empty without .gitmodules", async () => assert.deepStrictEqual(await git.submodules(repo().dir), []))
  it("diffNames lists working-tree edits, today's commits and deletions against B", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.write("b.ts", "1\n"); r.write("c.ts", "1\n"); r.write("d.ts", "1\n"); r.commitAll("y", yesterdayNoon()); const y = r.head()
    r.write("b.ts", "2\n"); r.commitAll("t", now())
    r.write("a.ts", "2\n"); fs.rmSync(r.path("c.ts"))
    assert.deepStrictEqual((await git.diffNames(r.dir, y)).sort(), ["a.ts", "b.ts", "c.ts"])
  })
})

describe("diffNames renames", () => {
  it("a rename lists both the old and the new path", async () => {
    const r = repo(); r.write("old.ts", "1\nsome content\n"); r.commitAll("y", yesterdayNoon()); const y = r.head()
    r.git(["mv", "old.ts", "new.ts"])
    assert.deepStrictEqual((await git.diffNames(r.dir, y)).sort(), ["new.ts", "old.ts"])
  })
})

describe("readBlobs", () => {
  it("reads content in request order; absent paths are missing", async () => {
    const r = repo(); r.write("a.ts", "x\ny\n"); r.write("b.ts", "z\n"); r.commitAll("y", yesterdayNoon())
    const out = await git.readBlobs(r.dir, r.head(), ["b.ts", "nope.ts", "a.ts"])
    assert.strictEqual((out[0] as Buffer).toString(), "z\n")
    assert.strictEqual(out[1], "missing")
    assert.strictEqual((out[2] as Buffer).toString(), "x\ny\n")
  })
  it("readBlobs: odd paths (spaces, #, non-ASCII) come back intact", async () => {
    const r = repo(); r.write("a b/ü #1.ts", "q\n"); r.commitAll("y", yesterdayNoon())
    const [b] = await git.readBlobs(r.dir, r.head(), ["a b/ü #1.ts"])
    assert.strictEqual((b as Buffer).toString(), "q\n")
  })
  it("readBlobs: a blob over 5 MB is unknown", async () => {
    const r = repo(); r.write("big.json", Buffer.alloc(5 * 1024 * 1024 + 1, 0x61)); r.commitAll("y", yesterdayNoon())
    assert.deepStrictEqual(await git.readBlobs(r.dir, r.head(), ["big.json"]), ["unknown"])
  })
  it("an LFS pointer blob is unknown, never compared as text", async () => {
    const r = repo(); r.write("data.json", "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 3\n"); r.commitAll("y", yesterdayNoon())
    assert.deepStrictEqual(await git.readBlobs(r.dir, r.head(), ["data.json"]), ["unknown"])
  })
  it("a path containing a newline is unknown without asking git", async () => {
    const r = repo(); r.write("a.ts", "1\n"); r.commitAll("y", yesterdayNoon())
    assert.deepStrictEqual(await git.readBlobs(r.dir, r.head(), ["a\nb.ts"]), ["unknown"])
  })
  it("more than 200 paths are split across processes and all answered", async () => {
    const r = repo(); for (let i = 0; i < 205; i++) r.write(`f${i}.ts`, `${i}\n`); r.commitAll("y", yesterdayNoon())
    const out = await git.readBlobs(r.dir, r.head(), Array.from({ length: 205 }, (_, i) => `f${i}.ts`))
    assert.strictEqual((out[204] as Buffer).toString(), "204\n")
  })
})

describe("BlobQueue", () => {
  it("coalesces concurrent first sightings into one cat-file process", async () => {
    const r = repo(); r.write("a.ts", "a\n"); r.write("b.ts", "b\n"); r.write("c.ts", "c\n"); r.commitAll("y", yesterdayNoon())
    let processes = 0
    const counting = new Git()
    const run = counting.run.bind(counting)
    counting.run = (cwd: string, args: string[], input?: string) => { if (args[0] === "cat-file") processes++; return run(cwd, args, input) }
    const q = new BlobQueue(counting)
    const out = await Promise.all(["a.ts", "b.ts", "c.ts"].map(rel => q.read(r.dir, r.head(), rel)))
    assert.deepStrictEqual(out.map((b: unknown) => (b as Buffer).toString()), ["a\n", "b\n", "c\n"])
    assert.strictEqual(processes, 1)
  })
  it("a failing git resolves unknown and reports once", async () => {
    const errors: string[] = []
    const q = new BlobQueue(new Git(path.join(os.tmpdir(), "no-such-git.exe")), (top: string) => errors.push(top))
    assert.strictEqual(await q.read(os.tmpdir(), "HEAD", "a.ts"), "unknown")
    assert.deepStrictEqual(errors, [os.tmpdir()])
  })
  it("a throwing onError still resolves every waiter unknown", async () => {
    const q = new BlobQueue(new Git(path.join(os.tmpdir(), "no-such-git.exe")), () => { throw new Error("boom") })
    const guard = new Promise<string>(res => setTimeout(() => res("HUNG"), 2000))
    const out = await Promise.race([Promise.all([q.read(os.tmpdir(), "HEAD", "a.ts"), q.read(os.tmpdir(), "HEAD", "b.ts")]), guard])
    assert.deepStrictEqual(out, ["unknown", "unknown"])
  })
})

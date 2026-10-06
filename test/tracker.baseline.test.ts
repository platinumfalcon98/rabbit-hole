import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/tracker/gitBaseline.ts
import { chooseBaseline, isAuthorship, isLfsPointer, parseBatch, parseReflog, parseStatus } from "gitBaseline"

const MID = Date.UTC(2026, 9, 6) // any fixed instant stands in for local midnight
const H = 3_600_000
const e = (sha: string, t: number, action: string) => ({ sha, time: t, action })

describe("parseReflog", () => {
  it("reads sha, unix time and subject, newest first", () => {
    const out = "bbcb993bb584c2e7418dba2e18e3d2f8d795259f\tHEAD@{1791285494}\tcheckout: moving from feat to main\n" +
      "6ac1a663e5abbd6cf00499edfa57919782cb2cd0\tHEAD@{1791198000}\tcommit (initial): one\n"
    assert.deepStrictEqual(parseReflog(out), [
      e("bbcb993bb584c2e7418dba2e18e3d2f8d795259f", 1791285494000, "checkout: moving from feat to main"),
      e("6ac1a663e5abbd6cf00499edfa57919782cb2cd0", 1791198000000, "commit (initial): one"),
    ])
  })
  it("tolerates CRLF and junk lines, and SHA-256 ids", () => {
    const sha = "a".repeat(64)
    assert.deepStrictEqual(parseReflog(`junk\r\n${sha}\tHEAD@{10}\tcommit: x\r\n`), [e(sha, 10_000, "commit: x")])
  })
})

describe("isAuthorship", () => {
  it("plain, amended and initial commits are authorship", () => {
    for (const a of ["commit: x", "commit (amend): x", "commit (initial): x"]) assert.ok(isAuthorship(a), a)
  })
  it("everything else moved the working tree", () => {
    for (const a of ["commit (merge): x", "checkout: moving", "merge feat: Fast-forward", "pull: Fast-forward",
      "reset: moving to HEAD~1", "rebase (finish): returning", "rebase -i (pick): x", "cherry-pick: x", "revert: x", "clone: from u", "am: x"])
      assert.ok(!isAuthorship(a), a)
  })
})

describe("chooseBaseline", () => {
  it("starts from HEAD at midnight; today's commits keep it", () =>
    assert.strictEqual(chooseBaseline([e("C2", MID + 2 * H, "commit: b"), e("C1", MID + H, "commit: a"), e("Y", MID - H, "commit: y")], MID), "Y"))
  for (const action of ["checkout: moving from a to b", "merge feat: Fast-forward", "commit (merge): Merge", "pull: Fast-forward",
    "reset: moving to X", "rebase (finish): returning to refs/heads/x", "cherry-pick: x", "revert: x"]) {
    it(`a later "${action.split(":")[0]}" moves it`, () =>
      assert.strictEqual(chooseBaseline([e("M", MID + H, action), e("Y", MID - H, "commit: y")], MID), "M"))
  }
  it("a commit after a move keeps the moved baseline", () =>
    assert.strictEqual(chooseBaseline([e("C", MID + 2 * H, "commit: c"), e("M", MID + H, "checkout: x"), e("Y", MID - H, "commit: y")], MID), "M"))
  it("cloned or initialised today: the first entry's value, so a clone counts 0", () =>
    assert.strictEqual(chooseBaseline([e("C", MID + 2 * H, "commit: c"), e("K", MID + H, "clone: from u")], MID), "K"))
  it("entries either side of midnight: the last one before it wins", () =>
    assert.strictEqual(chooseBaseline([e("T", MID + 1, "commit: t"), e("B", MID - 1, "checkout: b"), e("A", MID - H, "commit: a")], MID), "B"))
  it("no reflog: null (the caller falls back)", () => assert.strictEqual(chooseBaseline([], MID), null))
})

describe("parseStatus", () => {
  it("splits tracked, untracked and ignored; a rename lists both paths", () => {
    const out = " M src/a.ts\0D  gone.ts\0R  new.ts\0old.ts\0?? notes/x.md\0!! dist/\0!! secret.env\0?? sub/\0"
    assert.deepStrictEqual(parseStatus(out), {
      tracked: ["src/a.ts", "gone.ts", "new.ts", "old.ts"],
      untracked: ["notes/x.md", "sub/"],
      ignored: ["dist/", "secret.env"],
    })
  })
  it("keeps spaces and unicode in paths", () =>
    assert.deepStrictEqual(parseStatus(" M a b/ü #1.ts\0").tracked, ["a b/ü #1.ts"]))
})

describe("parseBatch", () => {
  const blob = (sha: string, body: string) => `${sha} blob ${Buffer.byteLength(body)}\n${body}\n`
  it("reads blobs and missing paths in order", () => {
    const out = Buffer.from(blob("aa", "x\ny\n") + "HEAD:nope missing\n" + blob("bb", ""))
    const r = parseBatch(out, 3)
    assert.strictEqual((r[0] as Buffer).toString(), "x\ny\n")
    assert.strictEqual(r[1], "missing")
    assert.strictEqual((r[2] as Buffer).length, 0)
  })
  it("a blob over the limit, a tree, or an LFS pointer is unknown", () => {
    const lfs = "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 9\n"
    const out = Buffer.from(blob("aa", "0123456789") + "cc tree 3\nabc\n" + blob("dd", lfs))
    assert.deepStrictEqual(parseBatch(out, 3, 5), ["unknown", "unknown", "unknown"])
  })
  it("a truncated reply pads with unknown", () =>
    assert.deepStrictEqual(parseBatch(Buffer.from("aa blob 10\nabc"), 2), ["unknown", "unknown"]))
  it("isLfsPointer only matches the pointer header", () => {
    assert.ok(isLfsPointer(Buffer.from("version https://git-lfs.github.com/spec/v1\n")))
    assert.ok(!isLfsPointer(Buffer.from("version 2\n")))
  })
})

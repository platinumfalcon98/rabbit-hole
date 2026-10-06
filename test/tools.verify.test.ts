import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to scripts/verify-lines/core.ts
import { compare, netDiff } from "verifyCore"

describe("netDiff", () => {
  it("is a multiset diff ignoring CR and the trailing newline", () => {
    assert.deepStrictEqual(netDiff("a\r\nb\n", "a\nc\nd"), { added: 2, deleted: 1 })
    assert.deepStrictEqual(netDiff("", "x\n"), { added: 1, deleted: 0 })
  })
})
describe("compare", () => {
  it("reports every mismatch, including files only one side has", () => {
    const e = new Map([["c:/r/a.ts", { added: 2, deleted: 1 }], ["c:/r/b.ts", { added: 1, deleted: 0 }]])
    const r = new Map([["c:/r/a.ts", { added: 2, deleted: 1 }], ["c:/r/c.ts", { added: 3, deleted: 0 }]])
    assert.deepStrictEqual(compare(e, r).map((m: { path: string }) => m.path).sort(), ["c:/r/b.ts", "c:/r/c.ts"])
  })
})

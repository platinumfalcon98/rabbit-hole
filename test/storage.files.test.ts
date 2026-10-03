import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import { PROJECTS_KEY, cleanupStorageRoot, makeStore, proj, today } from "./helpers/store"

after(() => cleanupStorageRoot())

const row = (path: string, added: number, deleted: number) =>
  ({ path, language: "typescript", linesAdded: added, linesDeleted: deleted, lastModified: 1 })

function fresh() {
  return makeStore({ [PROJECTS_KEY]: [proj("alpha")] }, "alpha")
}
const logOf = (store: Map<string, unknown>) => store.get(`rabbithole:log:alpha:${today}`) as any

describe("appendFileActivity — signed deltas", () => {
  it("positive deltas accumulate", () => {
    const { s, store } = fresh()
    s.appendFileActivity(row("/a.ts", 3, 1))
    s.appendFileActivity(row("/a.ts", 2, 0))
    assert.deepStrictEqual([logOf(store).files[0].linesAdded, logOf(store).files[0].linesDeleted], [5, 1])
    assert.strictEqual(logOf(store).languages.typescript.linesAdded, 5)
  })
  it("a negative delta shrinks the row and the language total", () => {
    const { s, store } = fresh()
    s.appendFileActivity(row("/a.ts", 5, 2))
    s.appendFileActivity(row("/a.ts", -3, -1))
    assert.deepStrictEqual([logOf(store).files[0].linesAdded, logOf(store).files[0].linesDeleted], [2, 1])
    assert.deepStrictEqual(
      [logOf(store).languages.typescript.linesAdded, logOf(store).languages.typescript.linesDeleted], [2, 1])
  })
  it("a row that nets to 0/0 is removed", () => {
    const { s, store } = fresh()
    s.appendFileActivity(row("/tmp.ts", 3, 0))
    s.appendFileActivity(row("/tmp.ts", -3, 0))
    assert.strictEqual(logOf(store).files.length, 0)
  })
  it("values never go below zero", () => {
    const { s, store } = fresh()
    s.appendFileActivity(row("/a.ts", 1, 1))
    s.appendFileActivity(row("/a.ts", -5, 0))
    assert.strictEqual(logOf(store).files[0].linesAdded, 0)
    assert.strictEqual(logOf(store).languages.typescript.linesAdded, 0)
  })
  it("a negative-only delta for an unknown row creates nothing", () => {
    const { s, store } = fresh()
    s.appendFileActivity(row("/ghost.ts", -2, 0))
    assert.strictEqual((logOf(store)?.files ?? []).length, 0)
  })
})

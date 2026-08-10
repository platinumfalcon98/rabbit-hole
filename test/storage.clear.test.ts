import { after, before, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"
import {
  MIN, PROJECTS_KEY, cleanupStorageRoot, log, makeStore, populated, today,
} from "./helpers/store"

const v = vscode as any

before(() => v.__setConfig("dailyTargetMinutes", 20))
after(() => cleanupStorageRoot())

describe("clearProject — a project other than the one being tracked", () => {
  let store: Map<string, unknown>

  before(async () => {
    const t = makeStore(populated(), "alpha")
    store = t.store
    await t.s.clearProject("beta")
  })

  it("beta's log is deleted", () =>
    assert.strictEqual(store.get(`rabbithole:log:beta:${today}`), undefined))
  it("alpha's log survives", () =>
    assert.ok(store.get(`rabbithole:log:alpha:${today}`)))
  it("beta is unregistered", () =>
    assert.deepStrictEqual((store.get(PROJECTS_KEY) as any[]).map(p => p.id), ["alpha"]))
  it("global day recomputed 50m -> 30m (not left inflated)", () =>
    assert.strictEqual((store.get(`rabbithole:global:${today}`) as any).activeTime, 30 * MIN))
})

describe("clearProject — the CURRENTLY TRACKED project (the drift fix)", () => {
  let store: Map<string, unknown>

  before(async () => {
    const t = makeStore(populated(), "alpha")
    store = t.store
    await t.s.clearProject("alpha")
  })

  it("alpha's log is deleted", () =>
    assert.strictEqual(store.get(`rabbithole:log:alpha:${today}`), undefined))

  // The tracker keeps writing under currentProjectId regardless of the
  // registry, so unregistering it would send later sessions into logs no
  // aggregate reads while their deltas still inflated the global day totals.
  it("alpha stays REGISTERED (tracker keeps writing under it)", () => {
    const ids = (store.get(PROJECTS_KEY) as any[]).map(p => p.id)
    assert.ok(ids.includes("alpha"), `expected alpha registered, got ${JSON.stringify(ids)}`)
  })

  it("alpha's streak is reset to 0", () =>
    assert.strictEqual((store.get(PROJECTS_KEY) as any[]).find(p => p.id === "alpha").streak, 0))
  it("alpha's daily target survives (a setting, not data)", () =>
    assert.strictEqual((store.get(PROJECTS_KEY) as any[]).find(p => p.id === "alpha").dailyTargetMinutes, 45))
  it("global recomputed to beta's 20m only", () =>
    assert.strictEqual((store.get(`rabbithole:global:${today}`) as any).activeTime, 20 * MIN))

  it("global still equals the sum of registered projects", () => {
    let sum = 0
    for (const p of store.get(PROJECTS_KEY) as any[]) {
      sum += ((store.get(`rabbithole:log:${p.id}:${today}`) as any)?.activeTime ?? 0)
    }
    assert.strictEqual((store.get(`rabbithole:global:${today}`) as any).activeTime, sum)
  })
})

describe("clearAll", () => {
  let store: Map<string, unknown>

  before(async () => {
    const t = makeStore(populated(), "alpha")
    store = t.store
    await t.s.clearAll()
  })

  it("all log keys gone", () =>
    assert.strictEqual([...store.keys()].filter(k => k.startsWith("rabbithole:log:")).length, 0))
  it("all global day keys gone", () =>
    assert.strictEqual([...store.keys()].filter(k => k.startsWith("rabbithole:global:")).length, 0))
  it("projects registry gone", () =>
    assert.strictEqual(store.get(PROJECTS_KEY), undefined))

  // Re-firing the first-run target prompt after a wipe would be surprising.
  it("one-shot UI flags PRESERVED (no re-prompt after a wipe)", () => {
    assert.strictEqual(store.get("rabbithole:targetPrompted"), true)
    assert.strictEqual(store.get("rabbithole:targetDefaultMigrated"), true)
  })
})

describe("backupToDisk", () => {
  it("writes a file on disk", async () => {
    const { s } = makeStore(populated(), "alpha")
    const file = await s.backupToDisk()
    assert.ok(fs.existsSync(file))
  })

  it("filename has no ':' (illegal on Windows)", async () => {
    const { s } = makeStore(populated(), "alpha")
    const file = await s.backupToDisk()
    assert.ok(!path.basename(file).includes(":"), path.basename(file))
  })

  it("snapshot contains pre-delete project logs", async () => {
    const { s } = makeStore(populated(), "alpha")
    const parsed = JSON.parse(fs.readFileSync(await s.backupToDisk(), "utf8"))
    assert.strictEqual(parsed[`rabbithole:log:alpha:${today}`].activeTime, 30 * MIN)
  })

  // globalState has no undo, so the snapshot must precede the deletion.
  it("a backup taken BEFORE a wipe still holds the data", async () => {
    const { s } = makeStore(populated(), "alpha")
    await s.clearAll()
    const parsed = JSON.parse(fs.readFileSync(s.getLastBackupPath(), "utf8"))
    assert.strictEqual(parsed[`rabbithole:log:beta:${today}`].activeTime, 20 * MIN)
  })
})

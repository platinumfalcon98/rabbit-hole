import { after, beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
import * as vscode from "vscode"
import { MIN, PROJECTS_KEY, cleanupStorageRoot, log, makeStore, proj, today } from "./helpers/store"
// @ts-ignore — esbuild alias to src/dashboard/miniHandler.ts
import { handleMiniMessage, onMiniConfigChanged } from "miniHandler"

const v = vscode as any
after(cleanupStorageRoot)

let posted: any[]
const view = { postMessage: (m: any) => posted.push(m) }
const types = () => posted.map(m => m.type)
const store = () => makeStore({
  [PROJECTS_KEY]: [proj("alpha"), proj("beta")],
  [`rabbithole:log:alpha:${today}`]: log(30 * MIN),
  [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 1 },
}).s

beforeEach(() => { posted = []; v.__reset() })

describe("sidebar messages", () => {
  it("ready sends the settings (for the CRT), then everything the sidebar draws", () => {
    handleMiniMessage({ type: "ready" }, store(), view, () => assert.fail("not asked to open"))
    assert.deepStrictEqual(types(), ["settings", "mini"])
    assert.strictEqual(posted[1].logs.alpha.activeTime, 30 * MIN)
  })

  it("open dashboard opens it and sends nothing", () => {
    let opened = 0
    handleMiniMessage({ type: "openDashboard" }, store(), view, () => { opened++ })
    assert.strictEqual(opened, 1)
    assert.deepStrictEqual(types(), [])
  })

  it("a message it doesn't know does nothing", () => {
    handleMiniMessage({ type: "export" } as any, store(), view, () => assert.fail("not asked to open"))
    assert.deepStrictEqual(types(), [])
  })
})

describe("settings changed while the sidebar is open", () => {
  it("a Rabbit Hole setting sends the settings and fresh data", () => {
    onMiniConfigChanged((s: string) => s === "rabbithole" || s === "rabbithole.crt.mask", store(), view)
    assert.deepStrictEqual(types(), ["settings", "mini"])
  })

  it("another extension's setting sends nothing", () => {
    onMiniConfigChanged(() => false, store(), view)
    assert.deepStrictEqual(types(), [])
  })
})

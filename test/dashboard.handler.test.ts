import { after, beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
import * as vscode from "vscode"
import { MIN, PROJECTS_KEY, cleanupStorageRoot, daysAgo, log, makeStore, proj, today } from "./helpers/store"
// @ts-ignore — esbuild alias to src/dashboard/messageHandler.ts
import { handleMessage, onConfigChanged } from "handler"

const v = vscode as any
after(cleanupStorageRoot)

let posted: any[]
const panel: any = { postMessage: (m: any) => posted.push(m) }
const types = () => posted.map(m => m.type)
const settle = () => new Promise(r => setTimeout(r, 20))

function store() {
  return makeStore({
    [PROJECTS_KEY]: [proj("alpha"), proj("beta")],
    [`rabbithole:log:alpha:${today}`]: log(30 * MIN),
    [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 1 },
  }).s
}

beforeEach(() => { posted = []; v.__reset() })

// Settings edited outside the dashboard (settings.json, the Settings UI) must
// still reach it; a target change re-judges every day, so the year comes too.
describe("settings changed outside the dashboard", () => {
  it("a daily target change sends settings and a fresh year", () => {
    onConfigChanged((s: string) => s === "rabbithole" || s === "rabbithole.dailyTargetMinutes", store(), panel)
    assert.deepStrictEqual(types(), ["settings", "year"])
  })

  it("a CRT change sends settings only", () => {
    onConfigChanged((s: string) => s === "rabbithole" || s === "rabbithole.crt.mask", store(), panel)
    assert.deepStrictEqual(types(), ["settings"])
  })

  it("another extension's settings change sends nothing", () => {
    onConfigChanged(() => false, store(), panel)
    assert.deepStrictEqual(types(), [])
  })
})

// The host does not trust the webview's dates: an unchecked range could iterate
// hundreds of thousands of days on the extension host.
describe("export ranges", () => {
  it("refuses a range longer than 92 days and says why", async () => {
    handleMessage({ type: "export", format: "csv", from: "1990-01-01", to: today } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveDialogs, 0)
    const result = posted.find(m => m.type === "actionResult")
    assert.ok(result && result.ok === false, "expected a failed actionResult")
  })

  it("refuses malformed dates", async () => {
    handleMessage({ type: "export", format: "json", from: "garbage", to: today } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveDialogs, 0)
  })

  it("accepts a valid range and the no-range default", async () => {
    handleMessage({ type: "export", format: "csv", from: daysAgo(6), to: today } as any, store(), panel)
    handleMessage({ type: "export", format: "csv" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveDialogs, 2)
  })
})

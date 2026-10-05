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

// The redesigned webview builds every panel from the year and the range; the
// old init/update messages are gone.
describe("phase 2 protocol", () => {
  it("ready sends settings then the year, and no init", () => {
    handleMessage({ type: "ready" } as any, store(), panel)
    assert.deepStrictEqual(types(), ["settings", "year"])
  })

  it("requestYear sends a year", () => {
    handleMessage({ type: "requestYear" } as any, store(), panel)
    assert.deepStrictEqual(types(), ["year"])
  })

  it("a project target change sends the year, and no init", () => {
    handleMessage({ type: "updateProjectSetting", projectId: "alpha", key: "dailyTargetMinutes", value: 30 } as any, store(), panel)
    assert.deepStrictEqual(types(), ["year"])
  })
})

// The webview is not trusted with settings.json: VS Code would store whatever it sent.
describe("CRT writes", () => {
  const cfg = () => v.workspace.getConfiguration("rabbithole")

  it("a value the manifest would reject is never written", async () => {
    handleMessage({ type: "updateCrtSetting", key: "mask", value: "glitter" } as any, store(), panel)
    await settle()
    assert.strictEqual(cfg().get("crt.mask"), undefined)
    assert.deepStrictEqual(types(), [])
  })

  it("strength is clamped and effects filtered before writing", async () => {
    handleMessage({ type: "updateCrtSetting", key: "strength", value: 250 } as any, store(), panel)
    handleMessage({ type: "updateCrtSetting", key: "effects", value: ["roll", "sparkle", "scanlines"] } as any, store(), panel)
    await settle()
    assert.strictEqual(cfg().get("crt.strength"), 100)
    assert.deepStrictEqual(cfg().get("crt.effects"), ["scanlines", "roll"])
    assert.ok(types().includes("settings"))
  })
})

// Files are written by the host from bytes the webview sends, under a name the
// webview suggests and the host sanitises.
describe("export files", () => {
  const b64 = Buffer.from("fake jpeg bytes").toString("base64")
  const result = () => posted.find(m => m.type === "actionResult")

  it("a share card is offered under the suggested name and written, and the console hears where", async () => {
    v.__saveTo("/picked/card.jpg")
    handleMessage({ type: "writeFile", kind: "jpg", base64: b64, name: "rabbithole-alpha-2026-10-05.jpg" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveOptions[0].defaultUri.fsPath, "rabbithole-alpha-2026-10-05.jpg")
    assert.deepStrictEqual(Object.values(v.calls.saveOptions[0].filters), [["jpg", "jpeg"]])
    assert.strictEqual(Buffer.from(v.calls.writes[0].bytes).toString(), "fake jpeg bytes")
    assert.ok(result().ok && /Saved \/picked\/card\.jpg/.test(result().lines[0]))
  })

  it("a name from the webview can't point outside the folder or change the type", async () => {
    handleMessage({ type: "writeFile", kind: "pdf", base64: b64, name: "..\\..\\Windows\\evil.exe" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveOptions[0].defaultUri.fsPath, "evil.pdf")
  })

  it("cancelling the save dialog writes nothing and says so", async () => {
    handleMessage({ type: "writeFile", kind: "pdf", base64: b64, name: "r.pdf" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.writes.length, 0)
    assert.match(result().lines[0], /cancelled/)
  })

  it("an empty file or an unknown kind is refused before any dialog opens", async () => {
    handleMessage({ type: "writeFile", kind: "jpg", base64: "", name: "x.jpg" } as any, store(), panel)
    handleMessage({ type: "writeFile", kind: "exe", base64: b64, name: "x.exe" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveDialogs, 0)
    assert.strictEqual(result().ok, false)
  })

  it("csv and json are offered under the dialog's name too", async () => {
    handleMessage({ type: "export", format: "csv", from: today, to: today, name: "rabbithole-all-projects-x.csv" } as any, store(), panel)
    await settle()
    assert.strictEqual(v.calls.saveOptions[0].defaultUri.fsPath, "rabbithole-all-projects-x.csv")
  })

  it("an export's own fetch is tagged in the reply; the dashboard's is not", () => {
    handleMessage({ type: "requestDays", from: today, to: today, for: "export" } as any, store(), panel)
    handleMessage({ type: "requestDays", from: today, to: today } as any, store(), panel)
    handleMessage({ type: "requestDays", from: "1990-01-01", to: today, for: "export" } as any, store(), panel)
    assert.deepStrictEqual(posted.map(m => [m.type, m.for]), [["range", "export"], ["range", undefined], ["rangeRefused", "export"]])
  })
})

// The webview now renders cards and reports from data it already has; the old
// round trip through the host is gone.
describe("the old export protocol", () => {
  it("exportPdfRequest, writePdf and writeJpg do nothing", async () => {
    handleMessage({ type: "exportPdfRequest", preset: "today" } as any, store(), panel)
    handleMessage({ type: "writePdf", base64: "eA==", projectName: "x" } as any, store(), panel)
    handleMessage({ type: "writeJpg", base64: "eA==", projectName: "x" } as any, store(), panel)
    await settle()
    assert.deepStrictEqual(posted, [])
    assert.strictEqual(v.calls.saveDialogs, 0)
  })
})

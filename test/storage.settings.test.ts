import { before, describe, it } from "node:test"
import * as assert from "node:assert"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/tracker/storageService.ts
import { StorageService, dateKey, PROJECTS_KEY } from "storage"
// @ts-ignore — esbuild alias to src/shared/config.ts
import { getDailyTargetMinutes, resolveProjectTargetMinutes, DAILY_TARGET_DEFAULT } from "cfg"

const v = vscode as any

const MIN = 60_000
const today = dateKey(new Date())
const yd = new Date()
yd.setDate(yd.getDate() - 1)
const yesterday = dateKey(yd)

// Fresh Map-backed globalState per scenario. No globalStorageUri: nothing here
// reaches a destructive path, so no backup is ever written.
function makeContext() {
  const store = new Map<string, unknown>()
  return {
    ctx: {
      globalState: {
        get: (k: string) => store.get(k),
        update: (k: string, val: unknown) => { store.set(k, val); return Promise.resolve() },
        keys: () => [...store.keys()],
      },
    } as any,
    store,
  }
}

const globalDay = (date: string, activeTime: number, streak: number) =>
  [`rabbithole:global:${date}`, { date, activeTime, streak }] as const
const projLog = (pid: string, date: string, activeTime: number, streak: number) =>
  [`rabbithole:log:${pid}:${date}`, {
    date, activeTime, streak, totalTime: 0, languages: {}, agents: {}, files: [], sessions: [],
  }] as const

const streakOf = (store: Map<string, unknown>, date: string) =>
  (store.get(`rabbithole:global:${date}`) as any).streak

describe("daily target clamping — the justification for the defensive read", () => {
  // VS Code does not enforce minimum/maximum on a hand-edited settings.json:
  // it draws a squiggle and hands the value over anyway, including a string.
  const cases: [unknown, number][] = [
    [undefined, 20], [0, 1], [-5, 1], ["abc", 20],
    [99999, 1440], [45, 45], [NaN, 20], [20.6, 21],
  ]
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input) ?? "undefined"} -> ${expected}`, () => {
      v.__setConfig("dailyTargetMinutes", input)
      assert.strictEqual(getDailyTargetMinutes(), expected)
    })
  }

  it("DAILY_TARGET_DEFAULT is 20", () => {
    assert.strictEqual(DAILY_TARGET_DEFAULT, 20)
  })
})

describe("updateStreak boundary (>= not >)", () => {
  before(() => {
    v.__resetConfig()
    v.__setConfig("dailyTargetMinutes", 20)
  })

  it("activeTime exactly == target counts as met", () => {
    const { ctx, store } = makeContext()
    store.set(...globalDay(today, 20 * MIN, 0))
    new StorageService(ctx).updateStreak()
    assert.strictEqual(streakOf(store, today), 1)
  })

  it("one ms below target does NOT count", () => {
    const { ctx, store } = makeContext()
    store.set(...globalDay(today, 20 * MIN - 1, 0))
    new StorageService(ctx).updateStreak()
    assert.strictEqual(streakOf(store, today), 0)
  })
})

describe("streak chain", () => {
  before(() => v.__setConfig("dailyTargetMinutes", 20))

  it("yesterday met (4) + today met -> 5", () => {
    const { ctx, store } = makeContext()
    store.set(...globalDay(yesterday, 30 * MIN, 4))
    store.set(...globalDay(today, 25 * MIN, 0))
    new StorageService(ctx).updateStreak()
    assert.strictEqual(streakOf(store, today), 5)
  })

  it("yesterday met (4), today NOT met -> 4 (at risk, not zeroed)", () => {
    const { ctx, store } = makeContext()
    store.set(...globalDay(yesterday, 30 * MIN, 4))
    store.set(...globalDay(today, 2 * MIN, 0))
    new StorageService(ctx).updateStreak()
    assert.strictEqual(streakOf(store, today), 4)
  })

  it("yesterday NOT met -> chain restarts at 1 regardless of its streak field", () => {
    const { ctx, store } = makeContext()
    store.set(...globalDay(yesterday, 2 * MIN, 9))
    store.set(...globalDay(today, 30 * MIN, 0))
    new StorageService(ctx).updateStreak()
    assert.strictEqual(streakOf(store, today), 1)
  })

  it("three consecutive updateStreak calls do not double-increment", () => {
    const { ctx, store } = makeContext()
    store.set(...globalDay(yesterday, 30 * MIN, 4))
    store.set(...globalDay(today, 25 * MIN, 0))
    const s = new StorageService(ctx)
    s.updateStreak(); s.updateStreak(); s.updateStreak()
    assert.strictEqual(streakOf(store, today), 5)
  })
})

describe("updateProjectStreak target resolution (backend half of Bug A)", () => {
  before(() => v.__setConfig("dailyTargetMinutes", 20))

  const run = (override: number | undefined, todayActiveMin: number) => {
    const { ctx, store } = makeContext()
    store.set(PROJECTS_KEY, [{
      id: "p1", name: "p", path: "/p", detectionMethod: "folder-hash", streak: 0,
      ...(override !== undefined ? { dailyTargetMinutes: override } : {}),
    }])
    store.set(...projLog("p1", today, todayActiveMin * MIN, 0))
    new StorageService(ctx).updateProjectStreak("p1")
    return (store.get(`rabbithole:log:p1:${today}`) as any).streak
  }

  it("no own target + 25m -> inherits global 20, met", () => assert.strictEqual(run(undefined, 25), 1))
  it("no own target + 10m -> inherits global 20, not met", () => assert.strictEqual(run(undefined, 10), 0))
  it("own target 90 + 25m -> uses 90, not met", () => assert.strictEqual(run(90, 25), 0))
  it("own target 90 + 95m -> uses 90, met", () => assert.strictEqual(run(90, 95), 1))
  it("stale own target 0 + 0.5m -> clamps to 1, NOT 'any activity'", () => assert.strictEqual(run(0, 0.5), 0))
  it("resolveProjectTargetMinutes(undefined) falls back to global", () =>
    assert.strictEqual(resolveProjectTargetMinutes(undefined), 20))
})

describe("updateProjectTarget write clamp", () => {
  const run = (input: any) => {
    const { ctx, store } = makeContext()
    store.set(PROJECTS_KEY, [{
      id: "p1", name: "p", path: "/p", detectionMethod: "folder-hash",
      streak: 0, dailyTargetMinutes: 45,
    }])
    new StorageService(ctx).updateProjectTarget("p1", input)
    return (store.get(PROJECTS_KEY) as any[])[0].dailyTargetMinutes
  }

  it("null deletes the override (inherit global)", () => assert.strictEqual(run(null), undefined))
  it("0 clamps to 1", () => assert.strictEqual(run(0), 1))
  it("5000 clamps to 1440", () => assert.strictEqual(run(5000), 1440))
  it("NaN is rejected, leaves existing value intact", () => assert.strictEqual(run(NaN), 45))
  it("90 stored as-is", () => assert.strictEqual(run(90), 90))
})

import { after, before, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/tracker/storageService.ts
import { validateSnapshot, scopeSnapshotToProjects } from "storage"
import {
  MIN, PROJECTS_KEY, cleanupStorageRoot, daysAgo, log, makeStore, populated, proj, today,
} from "./helpers/store"

const v = vscode as any
const T = (minutes: number) => minutes * MIN

before(() => v.__setConfig("dailyTargetMinutes", 20))
after(() => cleanupStorageRoot())

describe("getLog does not write into the memento's cache", () => {
  // getLog back-fills the missing AgentName keys. It must do that on a copy:
  // the memento hands back its live cached object, so filling them in place
  // makes a *read* mutate the cache. Must run against a never-read log — the
  // back-fill is idempotent, so a second read cannot detect it.
  let s: any, store: Map<string, unknown>, beforeRead = ""
  const key = `rabbithole:log:alpha:${today}`

  before(() => {
    const t = makeStore(populated())
    s = t.s; store = t.store
    beforeRead = JSON.stringify(store.get(key))
    s.getRangeByDates(today, today)
  })

  it("first read leaves the stored object untouched", () =>
    assert.strictEqual(JSON.stringify(store.get(key)), beforeRead))

  it("...and the read still returns a normalized log", () => {
    const [returned] = s.getRangeByDates(today, today)
    assert.deepStrictEqual(Object.keys(returned.agents).sort(),
      ["claude-code", "continue", "copilot", "cursor", "manual", "unknown-ai"])
  })
})

describe("round trip — snapshot, wipe, restore", () => {
  let store: Map<string, unknown>, ok = false

  before(async () => {
    const t = makeStore(populated())
    store = t.store
    const snapshot = JSON.parse(fs.readFileSync(await t.s.backupToDisk(), "utf8"))
    await t.s.clearAll()
    ok = await t.s.importSnapshot(snapshot)
  })

  it("import reports success", () => assert.strictEqual(ok, true))
  it("alpha's log is back, byte-identical", () =>
    assert.deepStrictEqual(store.get(`rabbithole:log:alpha:${today}`), log(30 * MIN)))
  it("beta's log is back, byte-identical", () =>
    assert.deepStrictEqual(store.get(`rabbithole:log:beta:${today}`), log(20 * MIN)))
  it("registry is back with both projects", () =>
    assert.deepStrictEqual((store.get(PROJECTS_KEY) as any[]).map(p => p.id).sort(), ["alpha", "beta"]))
  it("global day rebuilt to 50m", () =>
    assert.strictEqual((store.get(`rabbithole:global:${today}`) as any).activeTime, 50 * MIN))
})

describe("cross-machine import — global is never copied from the snapshot", () => {
  // This machine knows only beta (20m today). The snapshot comes from a machine
  // that knows only alpha (30m today) and carries its own global record.
  let store: Map<string, unknown>

  before(async () => {
    const t = makeStore({
      [PROJECTS_KEY]: [proj("beta")],
      [`rabbithole:log:beta:${today}`]: log(20 * MIN),
      [`rabbithole:global:${today}`]: { date: today, activeTime: 20 * MIN, streak: 1 },
      "rabbithole:targetPrompted": true,
      "rabbithole:targetDefaultMigrated": true,
    }, "beta")
    store = t.store
    await t.s.importSnapshot({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:log:alpha:${today}`]: log(30 * MIN),
      [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 9 },
      "rabbithole:targetPrompted": false,
      "rabbithole:targetDefaultMigrated": false,
    })
  })

  it("global is 50m (both machines), NOT the imported 30m", () =>
    assert.strictEqual((store.get(`rabbithole:global:${today}`) as any).activeTime, 50 * MIN))
  it("beta's own log untouched by the import", () =>
    assert.strictEqual((store.get(`rabbithole:log:beta:${today}`) as any).activeTime, 20 * MIN))
  it("registry union-merged — beta survives, alpha added", () =>
    assert.deepStrictEqual((store.get(PROJECTS_KEY) as any[]).map(p => p.id).sort(), ["alpha", "beta"]))

  it("one-shot UI flags belong to this install, not the snapshot", () => {
    assert.strictEqual(store.get("rabbithole:targetPrompted"), true)
    assert.strictEqual(store.get("rabbithole:targetDefaultMigrated"), true)
  })

  it("global still equals the sum of registered projects", () => {
    let sum = 0
    for (const p of store.get(PROJECTS_KEY) as any[]) {
      sum += ((store.get(`rabbithole:log:${p.id}:${today}`) as any)?.activeTime ?? 0)
    }
    assert.strictEqual((store.get(`rabbithole:global:${today}`) as any).activeTime, sum)
  })
})

describe("conflict rule — replace wholesale", () => {
  let store: Map<string, unknown>

  before(async () => {
    const t = makeStore(populated())
    store = t.store
    await t.s.importSnapshot({ [`rabbithole:log:alpha:${today}`]: log(99 * MIN) })
  })

  it("shared log key takes the imported value", () =>
    assert.strictEqual((store.get(`rabbithole:log:alpha:${today}`) as any).activeTime, 99 * MIN))
  it("global moves by the delta: 99m + beta's 20m", () =>
    assert.strictEqual((store.get(`rabbithole:global:${today}`) as any).activeTime, 119 * MIN))
})

describe("backup precedes every write", () => {
  it("the pre-import backup holds the OLD value", async () => {
    const { s } = makeStore(populated())
    await s.importSnapshot({ [`rabbithole:log:alpha:${today}`]: log(99 * MIN) })
    const parsed = JSON.parse(fs.readFileSync(s.getLastBackupPath(), "utf8"))
    assert.strictEqual(parsed[`rabbithole:log:alpha:${today}`].activeTime, 30 * MIN)
  })
})

describe("rejection — nothing written", () => {
  // A snapshot is JSON off disk that anyone could have hand-edited. Garbage
  // written into globalState only surfaces later as a render crash, far from
  // the import that caused it.
  const bad: [string, unknown][] = [
    ["an empty object", {}],
    ["an array", []],
    ["null", null],
    ["no rabbithole keys", { foo: 1 }],
    ["a log value missing activeTime", { [`rabbithole:log:alpha:${today}`]: { date: today } }],
    ["a log value that is not an object", { [`rabbithole:log:alpha:${today}`]: 42 }],
    ["a log key with a malformed date", { "rabbithole:log:alpha:2026-8-9": log(1) }],
  ]

  // Kept as two assertions per case: refusing and writing nothing are separate
  // guarantees, and a single merged test cannot say which one broke.
  const attempt = async (snapshot: unknown) => {
    const { s, store } = makeStore(populated())
    const snapBefore = JSON.stringify([...store.entries()])
    const ok = await s.importSnapshot(snapshot as any)
    return { ok, unchanged: JSON.stringify([...store.entries()]) === snapBefore }
  }

  for (const [name, snapshot] of bad) {
    it(`refuses ${name}`, async () =>
      assert.strictEqual((await attempt(snapshot)).ok, false))
    it(`...and writes nothing given ${name}`, async () =>
      assert.ok((await attempt(snapshot)).unchanged, "globalState changed"))
  }

  it("validateSnapshot accepts a real snapshot and summarises it", () => {
    const summary = validateSnapshot(populated())
    assert.deepStrictEqual(summary.projects.map((p: any) => p.id).sort(), ["alpha", "beta"])
    assert.deepStrictEqual(summary.dates, [today])
  })

  it("project ids containing colons parse correctly", () => {
    const summary = validateSnapshot({
      [`rabbithole:log:git@github.com:me/repo.git:${today}`]: log(1),
    })
    assert.deepStrictEqual(summary.projects.map((p: any) => p.id), ["git@github.com:me/repo.git"])
  })
})

describe("legacy project-less log keys (`rabbithole:log:<date>`)", () => {
  // Pre-multi-project installs wrote these. One in a 225-key real backup was
  // enough to make the whole file unimportable.
  const legacy = { "rabbithole:log:2026-03-21": log(10 * MIN, "2026-03-21") }
  let store: Map<string, unknown>

  before(async () => {
    // The legacy log is already present and already counted in that day's
    // global, exactly as a real install has it.
    const t = makeStore({
      ...populated(),
      "rabbithole:log:2026-03-21": log(10 * MIN, "2026-03-21"),
      "rabbithole:global:2026-03-21": { date: "2026-03-21", activeTime: 10 * MIN, streak: 1 },
    })
    store = t.store
    await t.s.importSnapshot(legacy)
  })

  it("a legacy key does not reject the snapshot", () =>
    assert.ok(validateSnapshot({ ...populated(), ...legacy })))
  it("legacy keys are not counted as a project", () =>
    assert.deepStrictEqual(validateSnapshot(legacy).projects.map((p: any) => p.id), []))
  it("...but their date is still reported", () =>
    assert.deepStrictEqual(validateSnapshot(legacy).dates, ["2026-03-21"]))
  it("the legacy key is written through verbatim", () =>
    assert.strictEqual((store.get("rabbithole:log:2026-03-21") as any).activeTime, 10 * MIN))
  it("its historical global is left exactly as it was", () =>
    assert.strictEqual((store.get("rabbithole:global:2026-03-21") as any).activeTime, 10 * MIN))
})

describe("a backup shaped like a real one is accepted", () => {
  // Stands in for the machine-specific file that first exposed the legacy-key
  // rejection: a project-less key, a git-remote id containing colons, a
  // folder-hash id containing a colon, and an unknown rabbithole:* key.
  // Point RABBITHOLE_TEST_BACKUP at a real backup to check that one instead.
  const fixture = process.env.RABBITHOLE_TEST_BACKUP
    ?? path.join(process.cwd(), "test", "fixtures", "real-shaped-backup.json")

  it("validates, with both projects and both days found", () => {
    const parsed = JSON.parse(fs.readFileSync(fixture, "utf8"))
    const summary = validateSnapshot(parsed)
    assert.ok(summary, `expected ${path.basename(fixture)} to validate`)
    if (process.env.RABBITHOLE_TEST_BACKUP) return   // real file: shape only
    assert.deepStrictEqual(summary.projects.map((p: any) => p.id).sort(),
      ["beta-folder:7f57b2c5", "https://github.com/example/alpha.git"])
    assert.deepStrictEqual(summary.dates.sort(), ["2026-03-21", "2026-03-22"])
  })
})

describe("scoping a whole-store backup to one project (restore after a clear)", () => {
  // The reported bug: clear one project, import the backup, and every OTHER
  // project silently reverts to its state when the backup was taken.
  const snapshot = {
    [PROJECTS_KEY]: [proj("alpha"), proj("beta")],
    [`rabbithole:log:alpha:${today}`]: log(30 * MIN),
    [`rabbithole:log:beta:${today}`]: log(20 * MIN),
    "rabbithole:log:2026-03-21": log(10 * MIN, "2026-03-21"),
  }
  const scoped = scopeSnapshotToProjects(snapshot, ["alpha"])
  let store: Map<string, unknown>, unscopedStore: Map<string, unknown>

  before(async () => {
    // beta has moved on since the backup: 45m today, not the 20m in the file.
    const t = makeStore({
      [PROJECTS_KEY]: [proj("beta")],
      [`rabbithole:log:beta:${today}`]: log(45 * MIN),
      [`rabbithole:global:${today}`]: { date: today, activeTime: 45 * MIN, streak: 1 },
    }, "beta")
    store = t.store
    await t.s.importSnapshot(scoped)

    const u = makeStore({
      [PROJECTS_KEY]: [proj("beta")],
      [`rabbithole:log:beta:${today}`]: log(45 * MIN),
    }, "beta")
    unscopedStore = u.store
    await u.s.importSnapshot(snapshot)
  })

  it("scoped snapshot keeps alpha's logs", () =>
    assert.ok(scoped[`rabbithole:log:alpha:${today}`]))
  it("scoped snapshot drops beta's logs", () =>
    assert.strictEqual(scoped[`rabbithole:log:beta:${today}`], undefined))
  it("scoped registry contains only alpha", () =>
    assert.deepStrictEqual((scoped[PROJECTS_KEY] as any[]).map(p => p.id), ["alpha"]))
  it("legacy project-less keys still pass through the filter", () =>
    assert.ok(scoped["rabbithole:log:2026-03-21"]))
  it("the scoped snapshot is still valid", () => assert.ok(validateSnapshot(scoped)))

  it("beta's NEWER data is not reverted by the backup", () =>
    assert.strictEqual((store.get(`rabbithole:log:beta:${today}`) as any).activeTime, 45 * MIN))
  it("alpha is restored", () =>
    assert.strictEqual((store.get(`rabbithole:log:alpha:${today}`) as any).activeTime, 30 * MIN))
  it("global reflects both (45 + 30)", () =>
    assert.strictEqual((store.get(`rabbithole:global:${today}`) as any).activeTime, 75 * MIN))

  // Guards the reason scoping exists: without it, this is what the user saw.
  it("(unscoped import DOES revert beta — why scoping exists)", () =>
    assert.strictEqual((unscopedStore.get(`rabbithole:log:beta:${today}`) as any).activeTime, 20 * MIN))
})

describe("global days move by the imported DELTA, not a registry recompute", () => {
  const yesterday = daysAgo(1)

  // An orphan log — a project no longer in the registry — also contributed to
  // yesterday. A recompute over the registry would drop it.
  const base = () => ({
    [PROJECTS_KEY]: [proj("alpha"), proj("beta")],
    [`rabbithole:log:alpha:${yesterday}`]: log(30 * MIN, yesterday),
    [`rabbithole:log:beta:${yesterday}`]: log(25 * MIN, yesterday),
    [`rabbithole:log:orphan-project:${yesterday}`]: log(15 * MIN, yesterday),
    [`rabbithole:global:${yesterday}`]: { date: yesterday, activeTime: 70 * MIN, streak: 1 },
    [`rabbithole:log:beta:${today}`]: log(25 * MIN),
    [`rabbithole:global:${today}`]: { date: today, activeTime: 25 * MIN, streak: 2 },
  })

  let noop: Map<string, unknown>
  let roundTrip: Map<string, unknown>, afterClear = 0
  let symptom: Map<string, unknown>
  let orphan: Map<string, unknown>

  before(async () => {
    // Restore just alpha's yesterday, unchanged from what is already there.
    const a = makeStore(base(), "beta")
    noop = a.store
    await a.s.importSnapshot({ [`rabbithole:log:alpha:${yesterday}`]: log(30 * MIN, yesterday) })

    // The real clear-then-restore round trip.
    const b = makeStore(base(), "beta")
    roundTrip = b.store
    await b.s.clearProject("alpha")
    afterClear = (roundTrip.get(`rabbithole:global:${yesterday}`) as any).activeTime
    await b.s.importSnapshot({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:log:alpha:${yesterday}`]: log(30 * MIN, yesterday),
    })

    // The exact reported symptom: yesterday clears the 20m target only thanks
    // to a contributor the registry does not know about, so a recompute pushes
    // it under and snaps the chain — a 2-day streak comes back as 1.
    const c = makeStore({
      [PROJECTS_KEY]: [proj("beta")],
      [`rabbithole:log:beta:${yesterday}`]: log(6 * MIN, yesterday),
      [`rabbithole:log:orphan-project:${yesterday}`]: log(15 * MIN, yesterday),
      [`rabbithole:global:${yesterday}`]: { date: yesterday, activeTime: 21 * MIN, streak: 1 },
      [`rabbithole:log:beta:${today}`]: log(25 * MIN),
      [`rabbithole:global:${today}`]: { date: today, activeTime: 25 * MIN, streak: 2 },
    }, "beta")
    symptom = c.store
    await c.s.importSnapshot({ [`rabbithole:log:beta:${yesterday}`]: log(6 * MIN, yesterday) })

    const d = makeStore(base(), "beta")
    orphan = d.store
    await d.s.importSnapshot({ [`rabbithole:log:beta:${yesterday}`]: log(25 * MIN, yesterday) })
  })

  it("re-importing identical data is a no-op on the global day", () =>
    assert.strictEqual((noop.get(`rabbithole:global:${yesterday}`) as any).activeTime, 70 * MIN))
  it("yesterday's streak value survives", () =>
    assert.strictEqual((noop.get(`rabbithole:global:${yesterday}`) as any).streak, 1))
  it("today's streak is still 2, not snapped back to 1", () =>
    assert.strictEqual((noop.get(`rabbithole:global:${today}`) as any).streak, 2))

  it("clearing alpha drops yesterday's global", () =>
    assert.ok(afterClear < 70 * MIN, `expected < 70m, got ${afterClear / MIN}m`))
  it("restoring alpha adds exactly its time back", () =>
    assert.strictEqual(
      (roundTrip.get(`rabbithole:global:${yesterday}`) as any).activeTime,
      afterClear + 30 * MIN))

  it("a 2-day global streak survives a restore (the reported bug)", () =>
    assert.strictEqual((symptom.get(`rabbithole:global:${today}`) as any).streak, 2))

  it("an orphan project's contribution is not dropped from history", () =>
    assert.strictEqual((orphan.get(`rabbithole:global:${yesterday}`) as any).activeTime, 70 * MIN))
})

describe("self-healing a provably-wrong stored streak of 0", () => {
  let repaired: Map<string, unknown>
  let gap: Map<string, unknown>
  let trusted: Map<string, unknown>
  let broken: Map<string, unknown>

  before(() => {
    // Exactly the state found on disk: yesterday met the 20m target (58m) but
    // its record carries streak 0, because an import recreated the record and
    // getGlobalDay's default was left in place.
    const a = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:log:alpha:${daysAgo(1)}`]: log(58 * MIN, daysAgo(1)),
      [`rabbithole:global:${daysAgo(1)}`]: { date: daysAgo(1), activeTime: 58 * MIN, streak: 0 },
      [`rabbithole:log:alpha:${today}`]: log(25 * MIN),
      [`rabbithole:global:${today}`]: { date: today, activeTime: 25 * MIN, streak: 0 },
    })
    repaired = a.store
    a.s.updateStreak()

    const b = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:global:${daysAgo(3)}`]: { date: daysAgo(3), activeTime: 30 * MIN, streak: 0 },
      [`rabbithole:global:${daysAgo(2)}`]: { date: daysAgo(2), activeTime: 30 * MIN, streak: 0 },
      [`rabbithole:global:${daysAgo(1)}`]: { date: daysAgo(1), activeTime: 30 * MIN, streak: 0 },
      [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 0 },
    })
    gap = b.store
    b.s.updateStreak()

    // A stored non-zero value is trusted and stops the walk — history awarded
    // under an older target must not be silently recomputed.
    const c = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:global:${daysAgo(2)}`]: { date: daysAgo(2), activeTime: 30 * MIN, streak: 9 },
      [`rabbithole:global:${daysAgo(1)}`]: { date: daysAgo(1), activeTime: 30 * MIN, streak: 0 },
      [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 0 },
    })
    trusted = c.store
    c.s.updateStreak()

    const d = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:global:${daysAgo(2)}`]: { date: daysAgo(2), activeTime: 30 * MIN, streak: 5 },
      [`rabbithole:global:${daysAgo(1)}`]: { date: daysAgo(1), activeTime: 2 * MIN, streak: 0 },
      [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 0 },
    })
    broken = d.store
    d.s.updateStreak()
  })

  it("yesterday's wrong 0 is repaired to 1", () =>
    assert.strictEqual((repaired.get(`rabbithole:global:${daysAgo(1)}`) as any).streak, 1))
  it("today becomes 2 again", () =>
    assert.strictEqual((repaired.get(`rabbithole:global:${today}`) as any).streak, 2))

  it("a 3-day gap rebuilds as 1, 2, 3", () => {
    assert.strictEqual((gap.get(`rabbithole:global:${daysAgo(3)}`) as any).streak, 1)
    assert.strictEqual((gap.get(`rabbithole:global:${daysAgo(2)}`) as any).streak, 2)
    assert.strictEqual((gap.get(`rabbithole:global:${daysAgo(1)}`) as any).streak, 3)
  })
  it("...and today continues it at 4", () =>
    assert.strictEqual((gap.get(`rabbithole:global:${today}`) as any).streak, 4))

  it("an existing streak of 9 is trusted, not recomputed", () =>
    assert.strictEqual((trusted.get(`rabbithole:global:${daysAgo(2)}`) as any).streak, 9))
  it("the gap after it continues from 9", () =>
    assert.strictEqual((trusted.get(`rabbithole:global:${daysAgo(1)}`) as any).streak, 10))

  it("a day under target still resets the chain", () =>
    assert.strictEqual((broken.get(`rabbithole:global:${today}`) as any).streak, 1))
  it("the missed day is not given a streak", () =>
    assert.strictEqual((broken.get(`rabbithole:global:${daysAgo(1)}`) as any).streak, 0))
})

describe("changing the daily target does not re-judge earned days", () => {
  // Three days of 30m, each earned and stamped under a 20m target.
  const earned = () => ({
    [PROJECTS_KEY]: [proj("alpha")],
    [`rabbithole:global:${daysAgo(2)}`]: { date: daysAgo(2), activeTime: 30 * MIN, streak: 1, targetMs: T(20) },
    [`rabbithole:global:${daysAgo(1)}`]: { date: daysAgo(1), activeTime: 30 * MIN, streak: 2, targetMs: T(20) },
    [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 3, targetMs: T(20) },
  })

  let raised: Map<string, unknown>
  let met: Map<string, unknown>
  let lowered: Map<string, unknown>
  let unstamped: Map<string, unknown>

  before(() => {
    // Raise the bar to 60m. 30m days no longer clear it — but they were earned.
    v.__setConfig("dailyTargetMinutes", 60)

    const a = makeStore(earned())
    raised = a.store
    a.s.updateStreak()

    const b = makeStore({
      ...earned(),
      [`rabbithole:global:${today}`]: { date: today, activeTime: 90 * MIN, streak: 3, targetMs: T(20) },
    })
    met = b.store
    b.s.updateStreak()

    // A day stamped at 60m that only did 30m stays failed even once the target
    // is lowered to 20m — it genuinely missed the bar it was set.
    v.__setConfig("dailyTargetMinutes", 20)

    const c = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:global:${daysAgo(1)}`]: { date: daysAgo(1), activeTime: 30 * MIN, streak: 0, targetMs: T(60) },
      [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 0, targetMs: T(20) },
    })
    lowered = c.store
    c.s.updateStreak()

    const d = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:global:${daysAgo(1)}`]: { date: daysAgo(1), activeTime: 30 * MIN, streak: 7 },
      [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 0 },
    })
    unstamped = d.store
    d.s.updateStreak()
  })

  after(() => v.__setConfig("dailyTargetMinutes", 20))

  // Guard, not proof — the walk breaks before reaching this day either way.
  it("(guard) raising the target rewrites no stored history", () =>
    assert.strictEqual((raised.get(`rabbithole:global:${daysAgo(1)}`) as any).streak, 2))
  // The observable one: yesterday's 30m was earned under a 20m bar, so it still
  // counts and today shows that chain rather than 0.
  it("yesterday stays earned, so today shows its count not 0", () =>
    assert.strictEqual((raised.get(`rabbithole:global:${today}`) as any).streak, 2))
  it("today is restamped with the new target", () =>
    assert.strictEqual((raised.get(`rabbithole:global:${today}`) as any).targetMs, T(60)))

  it("a day meeting the raised target continues the chain to 3", () =>
    assert.strictEqual((met.get(`rabbithole:global:${today}`) as any).streak, 3))

  it("lowering the target does not retroactively award a missed day", () =>
    assert.strictEqual((lowered.get(`rabbithole:global:${daysAgo(1)}`) as any).streak, 0))
  it("today starts a fresh chain at 1", () =>
    assert.strictEqual((lowered.get(`rabbithole:global:${today}`) as any).streak, 1))

  it("unstamped legacy days use the current target", () =>
    assert.strictEqual((unstamped.get(`rabbithole:global:${today}`) as any).streak, 8))
})

describe("per-project streaks heal and respect their own target too", () => {
  // proj() sets dailyTargetMinutes: 45, so these use the project's own bar.
  const plog = (minutes: number, date: string, streak = 0, targetMs?: number) =>
    ({ ...log(minutes * MIN, date), streak, ...(targetMs === undefined ? {} : { targetMs }) })

  let repaired: Map<string, unknown>
  let gap: Map<string, unknown>
  let broken: Map<string, unknown>
  let earned: Map<string, unknown>

  before(() => {
    // A clear/restore left yesterday at streak 0 despite clearing the 45m bar.
    const a = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:log:alpha:${daysAgo(1)}`]: plog(50, daysAgo(1)),
      [`rabbithole:log:alpha:${today}`]: plog(50, today),
    })
    repaired = a.store
    a.s.updateProjectStreak("alpha")

    const b = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:log:alpha:${daysAgo(3)}`]: plog(50, daysAgo(3)),
      [`rabbithole:log:alpha:${daysAgo(2)}`]: plog(50, daysAgo(2)),
      [`rabbithole:log:alpha:${daysAgo(1)}`]: plog(50, daysAgo(1)),
      [`rabbithole:log:alpha:${today}`]: plog(50, today),
    })
    gap = b.store
    b.s.updateProjectStreak("alpha")

    const c = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:log:alpha:${daysAgo(1)}`]: plog(10, daysAgo(1)),
      [`rabbithole:log:alpha:${today}`]: plog(50, today),
    })
    broken = c.store
    c.s.updateProjectStreak("alpha")

    // A day earned under an older, lower project target stays earned.
    const d = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:log:alpha:${daysAgo(1)}`]: plog(30, daysAgo(1), 6, T(20)),
      [`rabbithole:log:alpha:${today}`]: plog(50, today),
    })
    earned = d.store
    d.s.updateProjectStreak("alpha")
  })

  it("yesterday's wrong 0 is repaired to 1", () =>
    assert.strictEqual((repaired.get(`rabbithole:log:alpha:${daysAgo(1)}`) as any).streak, 1))
  it("today's project streak becomes 2", () =>
    assert.strictEqual((repaired.get(`rabbithole:log:alpha:${today}`) as any).streak, 2))

  it("a 3-day project gap rebuilds as 1, 2, 3", () => {
    assert.strictEqual((gap.get(`rabbithole:log:alpha:${daysAgo(3)}`) as any).streak, 1)
    assert.strictEqual((gap.get(`rabbithole:log:alpha:${daysAgo(2)}`) as any).streak, 2)
    assert.strictEqual((gap.get(`rabbithole:log:alpha:${daysAgo(1)}`) as any).streak, 3)
  })
  it("...and today continues it at 4", () =>
    assert.strictEqual((gap.get(`rabbithole:log:alpha:${today}`) as any).streak, 4))

  it("a day under the project target resets the chain", () =>
    assert.strictEqual((broken.get(`rabbithole:log:alpha:${today}`) as any).streak, 1))

  it("30m earned at a 20m bar survives the raise to 45m", () =>
    assert.strictEqual((earned.get(`rabbithole:log:alpha:${today}`) as any).streak, 7))
  it("today is stamped with the project's current target", () =>
    assert.strictEqual((earned.get(`rabbithole:log:alpha:${today}`) as any).targetMs, T(45)))
})

describe("import adopts a streak only when creating a missing record", () => {
  const yesterday = daysAgo(1)
  let created: Map<string, unknown>
  let existing: Map<string, unknown>

  before(async () => {
    // No record for that day on this machine — adopt the snapshot's.
    const a = makeStore({ [PROJECTS_KEY]: [proj("alpha")] })
    created = a.store
    await a.s.importSnapshot({
      [`rabbithole:log:alpha:${yesterday}`]: log(30 * MIN, yesterday),
      [`rabbithole:global:${yesterday}`]: { date: yesterday, activeTime: 30 * MIN, streak: 4 },
    })

    // Record already exists — this machine's chain wins.
    const b = makeStore({
      [PROJECTS_KEY]: [proj("alpha")],
      [`rabbithole:global:${yesterday}`]: { date: yesterday, activeTime: 10 * MIN, streak: 2 },
    })
    existing = b.store
    await b.s.importSnapshot({
      [`rabbithole:log:alpha:${yesterday}`]: log(30 * MIN, yesterday),
      [`rabbithole:global:${yesterday}`]: { date: yesterday, activeTime: 30 * MIN, streak: 99 },
    })
  })

  it("streak adopted when the day had no record", () =>
    assert.strictEqual((created.get(`rabbithole:global:${yesterday}`) as any).streak, 4))
  it("activeTime still comes from the delta, not the snapshot", () =>
    assert.strictEqual((created.get(`rabbithole:global:${yesterday}`) as any).activeTime, 30 * MIN))
  it("an existing record's streak is never overwritten", () =>
    assert.strictEqual((existing.get(`rabbithole:global:${yesterday}`) as any).streak, 2))
  it("its activeTime still moves by the delta (10 + 30)", () =>
    assert.strictEqual((existing.get(`rabbithole:global:${yesterday}`) as any).activeTime, 40 * MIN))
})

describe("the live session is discarded before a destructive write", () => {
  // saveCheckpoint writes the in-memory session back every 10s, so without this
  // a cleared day returns on the next tick.
  const countDiscards = async (act: (s: any) => Promise<void>, currentProject = "alpha") => {
    const { s } = makeStore(populated(), currentProject)
    let discarded = 0
    s.setSessionDiscardHook(() => discarded++)
    await act(s)
    return discarded
  }

  it("clearProject on the CURRENT project discards the session", async () =>
    assert.strictEqual(await countDiscards(s => s.clearProject("alpha")), 1))

  it("clearProject on another project leaves the session alone", async () =>
    assert.strictEqual(await countDiscards(s => s.clearProject("beta")), 0))

  it("clearAll discards the session", async () =>
    assert.strictEqual(await countDiscards(s => s.clearAll()), 1))

  it("importSnapshot discards the session", async () =>
    assert.strictEqual(
      await countDiscards(s => s.importSnapshot({ [`rabbithole:log:alpha:${today}`]: log(99 * MIN) })), 1))

  it("...but a rejected import does not", async () =>
    assert.strictEqual(await countDiscards(s => s.importSnapshot({ nope: 1 })), 0))
})

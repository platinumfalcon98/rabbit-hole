# TTY Redesign — Phase 1 (Data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the redesigned webviews the data they need — per-session language time, per-project `year` / `range` / `live` payloads, CRT settings, filtered CSV/JSON export, action results — and a pure, tested `model.ts` that turns those payloads into every number the panels show.

**Architecture:** The tracker gains one optional session field. A new host module `src/dashboard/payloads.ts` builds three message payloads from `StorageService`; `messageHandler.ts` and `extension.ts` send them alongside the current messages, so the existing dashboard keeps working untouched until phase 2 replaces it. All aggregation for the new UI lives in `src/webview/model.ts`, which has no DOM or `vscode` imports and is unit-tested.

**Tech Stack:** TypeScript, VS Code extension API, esbuild, `node:test` + `node:assert` through `scripts/test.js`.

**Spec:** `docs/superpowers/specs/2026-10-04-tty-redesign-design.md` (phase 1 = §1, §3, and the CSV/JSON part of §4.3).

This is the first of five phase plans. Phases 2–5 (dashboard, exports, sidebar, icons) get their own plans, written once this one has landed, because they build on the interfaces defined here.

## Global Constraints

- No new runtime dependencies. Phase 1 adds no packages at all.
- Never import `vscode` or `src/shared/config.ts` from `src/webview/*` (config.ts imports vscode). Type-only imports from `src/shared/types.ts` are fine.
- Day keys are local time. Host code uses `dateKey()` from `storageService.ts`; webview code uses local `Date` arithmetic. Never `toISOString().slice(0, 10)`.
- House style: TypeScript, 2-space indent, no semicolons, double quotes. Comments say why, not what.
- Tests run through `scripts/test.js` (each suite bundled by esbuild with aliases to the real sources). New suites are registered in its `SUITES` array.
- Every task ends with `npm test` and `npm run typecheck` passing. The phase ends with `npm run build` passing too.
- Commit messages: plain sentence case, no `feat:`-style prefix, and **no `Co-Authored-By` lines** (user rule).
- The mirror schema number does not change. The existing dashboard and sidebar must behave exactly as before at every commit in this phase: every new message is additive and the old webview ignores types it doesn't know.
- A negative control (the new test run against the pre-change source, and seen to fail) is required wherever a task changes existing behaviour, per `CLAUDE.md`. The temp copy must live inside `src/` and is deleted afterwards.

## Deviations from the spec, decided while planning

1. The new range request is named `requestDays` (`{ type: "requestDays"; from; to }`), not `requestRange`, because the current webview still sends `requestRange` with a different shape. Phase 2 removes the old one.
2. `YearPayload` also carries each project's stored `streak` and a `global` series (active ms, stamped targets, stored streak). The displayed streak comes from storage, which already self-heals and is not limited to 371 days; `model.ts` computes only "met today", "at risk" and the longest run.
3. The default CSV/JSON export is the **last 90 days, all projects** — that is what the code does today. The spec's "all history (the current behaviour)" was wrong; Task 8 corrects the spec.
4. The day tape's window is 07:00–19:00 widened to whole hours covering every session shown, so night work is never cut off (the spec was silent; see Review Focus).
5. A refused range (reversed, malformed, or longer than 92 days) gets a `rangeRefused` reply rather than silence, so the webview can say why.

## Review Focus

1. **Night or early-morning sessions** (e.g. 22:30–23:40, or 05:10) must still appear on the day tape — the window widens to cover them. Test in Task 7.
2. **Sessions recorded before this change** (no `languages`) under a language focus must not crash or be credited to a guessed language; they drop out of the session list while the day's language totals still count. Test in Task 6.
3. **The open, in-progress session** (`endTime: null`) must be spread up to "now" on the tape and in target-met time, not dropped or treated as zero-length. Test in Task 7.
4. **Malformed or hostile range requests** (`"2026-02-30"`, `"garbage"`, reversed dates, 93 days) must be refused without throwing. Test in Task 3.
5. **Repeated live updates** must replace today's values, never add to them, so leaving the dashboard open for hours can't inflate today. Test in Task 7.

---

### Task 1: Record each session's language time

**Files:**
- Modify: `src/shared/types.ts` (`ActivitySession`)
- Modify: `src/tracker/activityTracker.ts:368-427` (`splitAtMidnight`, `flushLanguageTime`)
- Create: `test/tracker.languages.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Produces: `ActivitySession.languages?: Record<string, number>` — active ms per VS Code language id within the session. Absent on sessions recorded before this change.

- [ ] **Step 1: Register the suite and write the failing test**

Add to `SUITES` in `scripts/test.js`, after the `capture` entry:

```js
  {
    name: "languages",
    entry: "test/tracker.languages.test.ts",
    alias: { vscode: "test/stubs/vscodeWindow.ts", tracker: "src/tracker/activityTracker.ts" },
  },
```

Create `test/tracker.languages.test.ts`:

```ts
import { afterEach, beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/tracker/activityTracker.ts
import { ActivityTracker } from "tracker"

const MIN = 60_000
const realNow = Date.now
let now = 0

interface Calls {
  day: [string, number][]
  dayFor: [string, number, string][]
  appended: any[]
  appendedTo: [any, string][]
}
let calls: Calls

// Only what the session/language path touches. Clones, because the tracker
// keeps mutating its live session object after handing it over.
const storage: any = {
  updateLanguageTime: (l: string, ms: number) => calls.day.push([l, ms]),
  updateLanguageTimeForDate: (l: string, ms: number, d: string) => calls.dayFor.push([l, ms, d]),
  appendSession: (s: any) => calls.appended.push(structuredClone(s)),
  appendSessionToDate: (s: any, d: string) => calls.appendedTo.push([structuredClone(s), d]),
}

// A tracker mid-session, built without start(): no timers, watchers or editors.
function trackerAt(startedAt: number, language: string): any {
  const t: any = new ActivityTracker({ subscriptions: [] } as any, storage)
  t.currentProjectId = "alpha"
  t.currentSession = { id: "s1", startTime: startedAt, endTime: null, duration: 0, activeTime: 0 }
  t.isPaused = false
  t.activeIntervalStart = startedAt
  t.activeTimeAccumulated = 0
  t.languageCurrent = language
  t.languageIntervalStart = startedAt
  return t
}
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).getTime()

beforeEach(() => {
  calls = { day: [], dayFor: [], appended: [], appendedTo: [] }
  Date.now = () => now
})
afterEach(() => { Date.now = realNow })

describe("session languages", () => {
  it("a flush credits the open session with the same ms as the day", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "typescript")
    now += 7 * MIN
    t.flushLanguageTime(now)
    assert.deepStrictEqual(calls.day, [["typescript", 7 * MIN]])
    assert.deepStrictEqual(t.currentSession.languages, { typescript: 7 * MIN })
  })

  it("a checkpoint writes every language the session has seen, summing to the day's credit", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "typescript")
    now += 5 * MIN
    t.flushLanguageTime(now)
    t.languageCurrent = "markdown"
    now += 3 * MIN
    t.saveCheckpoint()
    const last = calls.appended[calls.appended.length - 1]
    assert.deepStrictEqual(last.languages, { typescript: 5 * MIN, markdown: 3 * MIN })
    const dayTotal = calls.day.reduce((s, [, ms]) => s + ms, 0)
    const sessionTotal = Object.values(last.languages as Record<string, number>).reduce((s, ms) => s + ms, 0)
    assert.strictEqual(sessionTotal, dayTotal)
  })

  it("an excluded document credits nothing to the session", () => {
    now = at(2026, 9, 3, 10, 0)
    const t = trackerAt(now, "")
    now += 4 * MIN
    t.flushLanguageTime(now)
    assert.strictEqual(t.currentSession.languages, undefined)
    assert.deepStrictEqual(calls.day, [])
  })

  it("midnight gives yesterday's session its share and starts today's from zero", () => {
    const start = at(2026, 9, 2, 23, 50)
    now = start
    const t = trackerAt(start, "typescript")
    now = at(2026, 9, 3, 0, 6)
    t.saveCheckpoint()
    const [closed, date] = calls.appendedTo[0]
    assert.strictEqual(date, "2026-10-02")
    assert.deepStrictEqual(closed.languages, { typescript: 10 * MIN })
    assert.deepStrictEqual(calls.appended[calls.appended.length - 1].languages, { typescript: 6 * MIN })
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node scripts/test.js --suite languages`
Expected: FAIL — `t.currentSession.languages` is `undefined` in tests 1, 2 and 4 (the excluded-document test passes already).

- [ ] **Step 3: Add the field and credit it**

In `src/shared/types.ts`, add to `ActivitySession` after `projectId?`:

```ts
  languages?: Record<string, number> // active ms per language within this session; absent on sessions recorded before per-session tracking
```

In `src/tracker/activityTracker.ts`, replace `flushLanguageTime` (line ~422) with:

```ts
  // Credit elapsed time to the current language — on the day log and on the
  // open session — and advance the interval start. Both get the same ms from
  // the same call, so a session's languages always sum to what it added to the
  // day's language totals.
  private flushLanguageTime(now: number): void {
    if (!this.languageCurrent || this.languageIntervalStart === 0) return
    const elapsed = now - this.languageIntervalStart
    if (elapsed > 0) {
      this.storage.updateLanguageTime(this.languageCurrent, elapsed)
      this.creditSessionLanguage(this.languageCurrent, elapsed)
    }
    this.languageIntervalStart = now
  }

  private creditSessionLanguage(language: string, ms: number): void {
    if (!this.currentSession) return
    const langs = this.currentSession.languages ?? (this.currentSession.languages = {})
    langs[language] = (langs[language] ?? 0) + ms
  }
```

In `splitAtMidnight`, inside the `if (langMs > 0)` block, after `updateLanguageTimeForDate(...)`, add:

```ts
        this.creditSessionLanguage(this.languageCurrent, langMs)
```

so the block reads:

```ts
    if (!this.isPaused && this.languageCurrent && this.languageIntervalStart < midnight) {
      const langMs = midnight - this.languageIntervalStart
      if (langMs > 0) {
        this.storage.updateLanguageTimeForDate(this.languageCurrent, langMs, sessionDateStr)
        this.creditSessionLanguage(this.languageCurrent, langMs)
      }
      this.languageIntervalStart = midnight
    }
```

The pre-midnight copy written by `appendSessionToDate({ ...this.currentSession, ... })` now carries those languages, and the new session object created after it has none, which is what the midnight test asserts.

- [ ] **Step 4: Run it and see it pass**

Run: `node scripts/test.js --suite languages`
Expected: PASS, 4 tests.

- [ ] **Step 5: Negative control**

```bash
git show HEAD:src/tracker/activityTracker.ts > src/tracker/_negcontrol.ts
node scripts/test.js --suite languages --alias tracker=src/tracker/_negcontrol.ts
rm src/tracker/_negcontrol.ts
```

Expected: the three language tests FAIL against the old tracker. If any of them passes, the test is not testing the change — fix the test before continuing.

- [ ] **Step 6: Full check and commit**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

```bash
git add src/shared/types.ts src/tracker/activityTracker.ts test/tracker.languages.test.ts scripts/test.js
git commit -m "Record each session's time per language"
```

---

### Task 2: CRT settings

**Files:**
- Modify: `src/shared/types.ts` (new CRT types; `settings` message)
- Modify: `src/shared/config.ts` (`getCrtSettings`, `CRT_DEFAULTS`)
- Modify: `package.json` (`contributes.configuration.properties`)
- Create: `test/config.crt.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Produces (types.ts): `CrtMask`, `CrtPitch`, `CrtEffect`, `CrtSettings = { mask: CrtMask; pitch: CrtPitch; strength: number; effects: CrtEffect[] }`
- Produces (config.ts): `CRT_DEFAULTS: CrtSettings`, `getCrtSettings(): CrtSettings`

- [ ] **Step 1: Register the suite and write the failing test**

Add to `SUITES`:

```js
  {
    name: "crt",
    entry: "test/config.crt.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", cfg: "src/shared/config.ts" },
  },
```

Create `test/config.crt.test.ts`:

```ts
import { beforeEach, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/shared/config.ts
import { getCrtSettings, CRT_DEFAULTS } from "cfg"

const v = vscode as any
beforeEach(() => v.__resetConfig())

describe("CRT settings", () => {
  it("defaults to a subtle slot mask with scanlines and bloom", () => {
    assert.deepStrictEqual(getCrtSettings(), { mask: "slot", pitch: "fine", strength: 30, effects: ["scanlines", "bloom"] })
  })

  it("reads valid values", () => {
    v.__setConfig("crt.mask", "grille")
    v.__setConfig("crt.pitch", "coarse")
    v.__setConfig("crt.strength", 55)
    v.__setConfig("crt.effects", ["roll", "scanlines"])
    assert.deepStrictEqual(getCrtSettings(), { mask: "grille", pitch: "coarse", strength: 55, effects: ["scanlines", "roll"] })
  })

  // settings.json is hand-editable: VS Code shows a squiggle and passes the value through anyway.
  it("falls back on unknown enum values", () => {
    v.__setConfig("crt.mask", "trinitron")
    v.__setConfig("crt.pitch", 2)
    const s = getCrtSettings()
    assert.strictEqual(s.mask, "slot")
    assert.strictEqual(s.pitch, "fine")
  })

  it("clamps and rounds strength, and ignores non-numbers", () => {
    v.__setConfig("crt.strength", 150)
    assert.strictEqual(getCrtSettings().strength, 100)
    v.__setConfig("crt.strength", -5)
    assert.strictEqual(getCrtSettings().strength, 0)
    v.__setConfig("crt.strength", 42.6)
    assert.strictEqual(getCrtSettings().strength, 43)
    v.__setConfig("crt.strength", "50")
    assert.strictEqual(getCrtSettings().strength, 30)
  })

  it("keeps known effects in a fixed order, drops unknown ones, allows none", () => {
    v.__setConfig("crt.effects", ["flicker", "sparkle", "bloom", "bloom"])
    assert.deepStrictEqual(getCrtSettings().effects, ["bloom", "flicker"])
    v.__setConfig("crt.effects", [])
    assert.deepStrictEqual(getCrtSettings().effects, [])
    v.__setConfig("crt.effects", "bloom")
    assert.deepStrictEqual(getCrtSettings().effects, ["scanlines", "bloom"])
  })

  it("package.json declares the same defaults", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"))
    const props = pkg.contributes.configuration.properties
    assert.strictEqual(props["rabbithole.crt.mask"].default, CRT_DEFAULTS.mask)
    assert.strictEqual(props["rabbithole.crt.pitch"].default, CRT_DEFAULTS.pitch)
    assert.strictEqual(props["rabbithole.crt.strength"].default, CRT_DEFAULTS.strength)
    assert.deepStrictEqual(props["rabbithole.crt.effects"].default, CRT_DEFAULTS.effects)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node scripts/test.js --suite crt`
Expected: FAIL — esbuild reports no export `getCrtSettings` / `CRT_DEFAULTS` (or the calls throw).

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, add before the message protocol section:

```ts
// ── CRT display (dashboard + sidebar) ─────────────────────────────────────
export type CrtMask = "slot" | "grille" | "shadow" | "off"
export type CrtPitch = "fine" | "medium" | "coarse"
export type CrtEffect = "scanlines" | "bloom" | "convergence" | "roll" | "flicker"
export interface CrtSettings {
  mask: CrtMask
  pitch: CrtPitch
  strength: number      // 0–100
  effects: CrtEffect[]  // canonical order, no duplicates
}
```

In `src/shared/config.ts`, add the import at the top (after the vscode import) and the reader at the end:

```ts
import type { CrtEffect, CrtMask, CrtPitch, CrtSettings } from "./types"
```

```ts
const CRT_MASKS: readonly CrtMask[] = ["slot", "grille", "shadow", "off"]
const CRT_PITCHES: readonly CrtPitch[] = ["fine", "medium", "coarse"]
const CRT_EFFECTS: readonly CrtEffect[] = ["scanlines", "bloom", "convergence", "roll", "flicker"]

// Subtle by default: enough to read as a tube, never enough to cost legibility.
export const CRT_DEFAULTS: CrtSettings = { mask: "slot", pitch: "fine", strength: 30, effects: ["scanlines", "bloom"] }

export function getCrtSettings(): CrtSettings {
  const cfg = vscode.workspace.getConfiguration("rabbithole")
  const mask = cfg.get("crt.mask")
  const pitch = cfg.get("crt.pitch")
  const effects = cfg.get("crt.effects")
  return {
    mask: CRT_MASKS.includes(mask as CrtMask) ? (mask as CrtMask) : CRT_DEFAULTS.mask,
    pitch: CRT_PITCHES.includes(pitch as CrtPitch) ? (pitch as CrtPitch) : CRT_DEFAULTS.pitch,
    // clampMinutes is a generic integer clamp despite its name
    strength: clampMinutes(cfg.get("crt.strength"), CRT_DEFAULTS.strength, 0, 100),
    effects: Array.isArray(effects)
      ? CRT_EFFECTS.filter(e => effects.includes(e))
      : [...CRT_DEFAULTS.effects],
  }
}
```

In `package.json`, add inside `contributes.configuration.properties` after `rabbithole.idleThresholdMinutes`:

```json
        "rabbithole.crt.mask": {
          "type": "string",
          "enum": ["slot", "grille", "shadow", "off"],
          "enumDescriptions": [
            "Staggered RGB slots, as on most consumer TVs and terminals.",
            "Unbroken vertical stripes (Trinitron).",
            "Round dot triads.",
            "No CRT effect."
          ],
          "default": "slot",
          "description": "Phosphor mask drawn over the dashboard and sidebar."
        },
        "rabbithole.crt.pitch": {
          "type": "string",
          "enum": ["fine", "medium", "coarse"],
          "default": "fine",
          "description": "Size of the mask's phosphor cells."
        },
        "rabbithole.crt.strength": {
          "type": "number",
          "default": 30,
          "minimum": 0,
          "maximum": 100,
          "description": "How strongly the mask darkens the screen, from 0 to 100."
        },
        "rabbithole.crt.effects": {
          "type": "array",
          "items": { "type": "string", "enum": ["scanlines", "bloom", "convergence", "roll", "flicker"] },
          "uniqueItems": true,
          "default": ["scanlines", "bloom"],
          "description": "Extra CRT effects. Refresh roll and flicker are skipped when the OS asks for reduced motion."
        }
```

In `src/shared/types.ts`, extend the `settings` variant of `ExtensionMessage`:

```ts
  | { type: "settings"; dailyTargetMs: number; dailyTargetMinutes: number; idleThresholdMinutes: number; storagePath: string; crt: CrtSettings }
```

and add to `WebviewMessage`:

```ts
  | { type: "updateCrtSetting"; key: "mask" | "pitch" | "strength" | "effects"; value: string | number | string[] }
```

In `src/dashboard/messageHandler.ts`, import `getCrtSettings` alongside the other config imports, add `crt: getCrtSettings(),` to the object posted by `sendSettings`, and add this case after `updateSetting`:

```ts
    case "updateCrtSetting": {
      vscode.workspace.getConfiguration("rabbithole")
        .update(`crt.${msg.key}`, msg.value, vscode.ConfigurationTarget.Global)
        .then(() => sendSettings(storage, panel))
      break
    }
```

- [ ] **Step 4: Run it and see it pass**

Run: `node scripts/test.js --suite crt`
Expected: PASS, 6 tests.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

```bash
git add src/shared/types.ts src/shared/config.ts src/dashboard/messageHandler.ts package.json test/config.crt.test.ts scripts/test.js
git commit -m "Add the CRT display settings"
```

---

### Task 3: Year, range and live payloads

**Files:**
- Modify: `src/shared/types.ts` (payload types, messages)
- Modify: `src/tracker/storageService.ts` (add `getGlobalDays`)
- Create: `src/dashboard/payloads.ts`
- Create: `test/dashboard.payloads.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Consumes: `StorageService.getProjects()`, `getRangeByDates(start, end, projectId)`, `getGlobalToday()`, `getToday()`, `getCurrentProjectId()`, `dateKey(d)`.
- Produces (types.ts):
  - `ProjectYear = { id; name; path; dailyTargetMinutes?: number; streak: number; lastActive?: number; active: number[]; targetMs: (number | null)[] }`
  - `YearPayload = { today: string; days: string[]; globalTargetMs: number; global: { streak: number; active: number[]; targetMs: (number | null)[] }; projects: ProjectYear[] }`
  - `RangePayload = { from: string; to: string; logs: Record<string, DailyLog[]> }`
  - `LivePayload = { today: string; projectId: string; log: DailyLog; todayActive: Record<string, number>; globalToday: number }`
- Produces (storageService.ts): `getGlobalDays(startDate: string, endDate: string): { date: string; activeTime: number; targetMs?: number }[]`
- Produces (payloads.ts): `MAX_RANGE_DAYS = 92`, `yearStart(today: Date): Date`, `buildYear(storage, now: Date, globalTargetMs: number): YearPayload`, `buildRange(storage, from: string, to: string): RangePayload | null`, `buildLive(storage, now: Date): LivePayload`

- [ ] **Step 1: Register the suite and write the failing test**

Add to `SUITES`:

```js
  {
    name: "payloads",
    entry: "test/dashboard.payloads.test.ts",
    alias: {
      vscode: "test/stubs/vscode.ts",
      storage: "src/tracker/storageService.ts",
      payloads: "src/dashboard/payloads.ts",
    },
  },
```

Create `test/dashboard.payloads.test.ts`:

```ts
import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import { MIN, PROJECTS_KEY, cleanupStorageRoot, daysAgo, log, makeStore, proj, today } from "./helpers/store"
// @ts-ignore — esbuild alias to src/dashboard/payloads.ts
import { MAX_RANGE_DAYS, buildLive, buildRange, buildYear, yearStart } from "payloads"

after(cleanupStorageRoot)

const TARGET = 20 * MIN

function store() {
  const sessionEnd = Date.now() - 5 * MIN
  return makeStore({
    [PROJECTS_KEY]: [proj("alpha", 4), proj("beta", 0)],
    [`rabbithole:log:alpha:${today}`]: {
      ...log(30 * MIN),
      targetMs: TARGET,
      sessions: [{ id: "a1", startTime: sessionEnd - 30 * MIN, endTime: sessionEnd, duration: 30 * MIN, activeTime: 30 * MIN }],
    },
    [`rabbithole:log:beta:${daysAgo(2)}`]: log(12 * MIN, daysAgo(2)),
    [`rabbithole:global:${today}`]: { date: today, activeTime: 30 * MIN, streak: 6, targetMs: TARGET },
    [`rabbithole:global:${daysAgo(2)}`]: { date: daysAgo(2), activeTime: 12 * MIN, streak: 5 },
    // Pre-multi-project installs wrote keys with no project segment; nothing reads them.
    [`rabbithole:log:${today}`]: log(99 * MIN),
  }).s
}

describe("year payload", () => {
  it("starts on a Monday, 364–370 days back, and ends today", () => {
    const now = new Date()
    const start = yearStart(now)
    assert.strictEqual(start.getDay(), 1)
    const back = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - start.getTime()) / 86_400_000)
    assert.ok(back >= 364 && back <= 370, `went back ${back} days`)
    const y = buildYear(store(), now, TARGET)
    assert.strictEqual(y.days[y.days.length - 1], today)
    assert.strictEqual(y.days.length, back + 1)
    assert.strictEqual(y.today, today)
  })

  it("carries each project's daily active time and stamped targets in registry order", () => {
    const y = buildYear(store(), new Date(), TARGET)
    assert.deepStrictEqual(y.projects.map((p: any) => p.id), ["alpha", "beta"])
    const [alpha, beta] = y.projects
    assert.strictEqual(alpha.active[alpha.active.length - 1], 30 * MIN)
    assert.strictEqual(alpha.targetMs[alpha.targetMs.length - 1], TARGET)
    assert.strictEqual(beta.active[beta.active.length - 3], 12 * MIN)
    assert.strictEqual(beta.targetMs[beta.targetMs.length - 3], null)
    assert.strictEqual(alpha.streak, 4)
    assert.strictEqual(alpha.dailyTargetMinutes, 45)
  })

  it("carries the global series and stored streak", () => {
    const y = buildYear(store(), new Date(), TARGET)
    assert.strictEqual(y.global.streak, 6)
    assert.strictEqual(y.global.active[y.global.active.length - 1], 30 * MIN)
    assert.strictEqual(y.global.targetMs[y.global.targetMs.length - 3], null)
    assert.strictEqual(y.globalTargetMs, TARGET)
  })

  it("reports the latest session end as lastActive, and none for a project without sessions", () => {
    const y = buildYear(store(), new Date(), TARGET)
    assert.ok(typeof y.projects[0].lastActive === "number")
    assert.strictEqual(y.projects[1].lastActive, undefined)
  })
})

describe("range payload", () => {
  it("returns one log per day per registered project", () => {
    const r = buildRange(store(), daysAgo(6), today)
    assert.ok(r)
    assert.deepStrictEqual(Object.keys(r.logs), ["alpha", "beta"])
    assert.strictEqual(r.logs.alpha.length, 7)
    assert.strictEqual(r.logs.alpha[6].activeTime, 30 * MIN)
    assert.strictEqual(r.logs.beta[4].activeTime, 12 * MIN)
  })

  it(`accepts exactly ${MAX_RANGE_DAYS} days and refuses one more`, () => {
    assert.ok(buildRange(store(), daysAgo(MAX_RANGE_DAYS - 1), today))
    assert.strictEqual(buildRange(store(), daysAgo(MAX_RANGE_DAYS), today), null)
  })

  it("refuses reversed, impossible and malformed dates without throwing", () => {
    const s = store()
    assert.strictEqual(buildRange(s, today, daysAgo(3)), null)
    assert.strictEqual(buildRange(s, "2026-02-30", "2026-03-02"), null)
    assert.strictEqual(buildRange(s, "garbage", today), null)
    assert.strictEqual(buildRange(s, "", ""), null)
  })
})

describe("live payload", () => {
  it("has today's active time for every project and the current project's log", () => {
    const l = buildLive(store(), new Date())
    assert.strictEqual(l.today, today)
    assert.strictEqual(l.projectId, "alpha")
    assert.deepStrictEqual(l.todayActive, { alpha: 30 * MIN, beta: 0 })
    assert.strictEqual(l.globalToday, 30 * MIN)
    assert.strictEqual(l.log.activeTime, 30 * MIN)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node scripts/test.js --suite payloads`
Expected: FAIL — esbuild cannot resolve `src/dashboard/payloads.ts`.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, add after the `DailyLog` interface:

```ts
// ── Payloads for the TTY webviews ─────────────────────────────────────────
// Everything is per project; the webview builds "all projects" and focus slices
// itself, which is what lets hover focus re-render without a round trip.
export interface ProjectYear {
  id: string
  name: string
  path: string
  dailyTargetMinutes?: number
  streak: number                 // stored per-project streak (self-healed by storage)
  lastActive?: number            // unix ms of the latest session end in the year
  active: number[]               // active ms per day, aligned with YearPayload.days
  targetMs: (number | null)[]    // stamped target per day; null = recorded before stamping
}
export interface YearPayload {
  today: string
  days: string[]                 // Monday-aligned, ending today (365–371 days)
  globalTargetMs: number
  global: { streak: number; active: number[]; targetMs: (number | null)[] }
  projects: ProjectYear[]        // registry order
}
export interface RangePayload {
  from: string
  to: string
  logs: Record<string, DailyLog[]>  // projectId -> one log per day, from..to
}
export interface LivePayload {
  today: string
  projectId: string
  log: DailyLog                  // today's log for the project being worked in
  todayActive: Record<string, number>
  globalToday: number
}
```

Add to `ExtensionMessage`:

```ts
  | ({ type: "year" } & YearPayload)
  | ({ type: "range" } & RangePayload)
  | { type: "rangeRefused"; from: string; to: string }
  | ({ type: "live" } & LivePayload)
  | { type: "actionResult"; ok: boolean; lines: string[] }
```

Add to `WebviewMessage`:

```ts
  | { type: "requestDays"; from: string; to: string }
```

In `src/tracker/storageService.ts`, add after `getMultiProjectRangeByDates`:

```ts
  // Cross-project day records for a date range, with the target each day was
  // judged against. Read-only; a missing day comes back as zero.
  getGlobalDays(startDate: string, endDate: string): { date: string; activeTime: number; targetMs?: number }[] {
    return this.iterDateRange(startDate, endDate).map(date => {
      const g = this.getGlobalDay(date)
      return g.targetMs === undefined
        ? { date, activeTime: g.activeTime }
        : { date, activeTime: g.activeTime, targetMs: g.targetMs }
    })
  }
```

Create `src/dashboard/payloads.ts`:

```ts
// Message payloads for the TTY webviews. Pure reads over StorageService — no
// vscode APIs — so they are unit-tested directly.
import type { DailyLog, LivePayload, ProjectYear, RangePayload, YearPayload } from "../shared/types"
import { StorageService, dateKey } from "../tracker/storageService"

// The calendar picker's limit. A range request is a full per-project read, so
// the host enforces it rather than trusting the webview.
export const MAX_RANGE_DAYS = 92
const YEAR_DAYS_BACK = 364
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function parseDay(s: string): Date | null {
  if (!DAY_RE.test(s)) return null
  const [y, m, d] = s.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  // new Date rolls 2026-02-30 over to March; refuse it rather than reading the wrong days
  return dateKey(date) === s ? date : null
}

// First day of the year grid: the Monday on or before today − 364, so the
// heatmap's columns are whole weeks.
export function yearStart(today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - YEAR_DAYS_BACK)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

export function buildYear(storage: StorageService, now: Date, globalTargetMs: number): YearPayload {
  const today = dateKey(now)
  const start = dateKey(yearStart(now))
  const global = storage.getGlobalDays(start, today)
  const projects: ProjectYear[] = storage.getProjects().map(p => {
    const logs = storage.getRangeByDates(start, today, p.id)
    let lastActive: number | undefined
    for (const l of logs) {
      for (const s of l.sessions) {
        const t = s.endTime ?? s.startTime
        if (lastActive === undefined || t > lastActive) lastActive = t
      }
    }
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      dailyTargetMinutes: p.dailyTargetMinutes,
      streak: p.streak ?? 0,
      lastActive,
      active: logs.map(l => l.activeTime),
      targetMs: logs.map(l => l.targetMs ?? null),
    }
  })
  return {
    today,
    days: global.map(g => g.date),
    globalTargetMs,
    global: {
      streak: storage.getGlobalToday().streak,
      active: global.map(g => g.activeTime),
      targetMs: global.map(g => g.targetMs ?? null),
    },
    projects,
  }
}

export function buildRange(storage: StorageService, from: string, to: string): RangePayload | null {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b || b < a) return null
  const span = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
  if (span > MAX_RANGE_DAYS) return null
  const logs: Record<string, DailyLog[]> = {}
  for (const p of storage.getProjects()) logs[p.id] = storage.getRangeByDates(from, to, p.id)
  return { from, to, logs }
}

export function buildLive(storage: StorageService, now: Date): LivePayload {
  const today = dateKey(now)
  const todayActive: Record<string, number> = {}
  for (const p of storage.getProjects()) {
    todayActive[p.id] = storage.getRangeByDates(today, today, p.id)[0].activeTime
  }
  return {
    today,
    projectId: storage.getCurrentProjectId(),
    log: storage.getToday(),
    todayActive,
    globalToday: storage.getGlobalToday().activeTime,
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `node scripts/test.js --suite payloads`
Expected: PASS, 8 tests.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

```bash
git add src/shared/types.ts src/tracker/storageService.ts src/dashboard/payloads.ts test/dashboard.payloads.test.ts scripts/test.js
git commit -m "Build per-project year, range and live payloads for the new webviews"
```

---

### Task 4: Send the new messages

**Files:**
- Modify: `src/dashboard/messageHandler.ts`
- Modify: `src/extension.ts:120-140` (10 s tick) and activation (config listener)

**Interfaces:**
- Consumes: `buildYear`, `buildRange`, `buildLive` (Task 3); `getCrtSettings` (Task 2).
- Produces: `export function sendSettings(storage, panel)` and `export function postYear(storage, panel)` from `messageHandler.ts`, used by `extension.ts` now and by the sidebar in phase 4.

This task is wiring around `vscode.window` and the panel; the logic it calls is tested in Tasks 2 and 3. It is verified by type-checking, the build, and the manual check in Step 6.

- [ ] **Step 1: Export the senders and add `postYear` and `tell`**

In `src/dashboard/messageHandler.ts`:

Add to the imports:

```ts
import { buildLive, buildRange, buildYear } from "./payloads"
```

Change `function sendSettings(` to `export function sendSettings(`.

Add after `sendSettings`:

```ts
export function postYear(storage: StorageService, panel: DashboardPanel): void {
  panel.postMessage({ type: "year", ...buildYear(storage, new Date(), getDailyTargetMs()) })
}

// Shows the result the way it always has, and also hands it to the dashboard's
// Settings output console so the user can see what an action actually did.
function tell(panel: DashboardPanel, ok: boolean, text: string): void {
  if (ok) vscode.window.showInformationMessage(text)
  else vscode.window.showErrorMessage(text)
  panel.postMessage({ type: "actionResult", ok, lines: [text.replace(/^Rabbit Hole: /, "")] })
}
```

- [ ] **Step 2: Send `year` and answer `requestDays`**

In the `ready` case, after `sendInit(storage, panel)`, add `postYear(storage, panel)`.

Add a case after `requestRange`:

```ts
    case "requestDays": {
      const range = buildRange(storage, msg.from, msg.to)
      panel.postMessage(range
        ? { type: "range", ...range }
        : { type: "rangeRefused", from: msg.from, to: msg.to })
      break
    }
```

In `updateSetting`'s `.then(...)`, after `sendSettings(storage, panel)`, add `postYear(storage, panel)` (the target changed, so every streak judgement changed).

In `updateProjectSetting`, after `sendInit(storage, panel)`, add `postYear(storage, panel)`.

In `refreshAfterWipe`, after `sendInit(storage, panel)`, add `postYear(storage, panel)`.

- [ ] **Step 3: Report action results**

In `clearProject` and `clearAll`, replace each `vscode.window.showInformationMessage(\`...\`)` with `tell(panel, true, \`...\`)`, keeping the same text.

Change `runBackup`'s signature to `async function runBackup(storage: StorageService, panel: DashboardPanel, scope: "projects" | "all")`, update its call to `runBackup(storage, panel, msg.scope)`, and:

- replace `vscode.window.showErrorMessage("Rabbit Hole: There are no projects to back up yet.")` with `tell(panel, false, "Rabbit Hole: There are no projects to back up yet.")`;
- after `const what = ...`, before the existing `showInformationMessage(..., "Reveal")` (which stays, for its Reveal button), add:

```ts
  panel.postMessage({ type: "actionResult", ok: true, lines: [`${what} backup saved to ${file}`] })
```

In `runImport`, replace the three `vscode.window.showErrorMessage(...)` calls with `tell(panel, false, ...)` and the final `vscode.window.showInformationMessage(...)` with `tell(panel, true, ...)`, keeping the same text.

- [ ] **Step 4: Post `live` every tick, `year` at midnight, settings on config change**

In `src/extension.ts`, change the messageHandler import to:

```ts
import { handleMessage, postYear, sendSettings } from "./dashboard/messageHandler"
import { buildLive } from "./dashboard/payloads"
```

Before `const interval = setInterval(`, add:

```ts
  // The year grid ends today; when the date changes the open dashboard needs a new one.
  let yearDay = dateKey(new Date())
```

Inside the interval, after the existing `postMessage({ type: "update", ... })` call (still inside `if (DashboardPanel.currentPanel) {`), add:

```ts
      const panel = DashboardPanel.currentPanel
      panel.postMessage({ type: "live", ...buildLive(storage, new Date()) })
      const day = dateKey(new Date())
      if (day !== yearDay) {
        yearDay = day
        postYear(storage, panel)
      }
```

After the interval's `context.subscriptions.push(...)`, add:

```ts
  // Settings edited in settings.json or the Settings UI (not just from the
  // dashboard) must reach the open webviews — the CRT settings especially.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("rabbithole") && DashboardPanel.currentPanel) {
        sendSettings(storage, DashboardPanel.currentPanel)
      }
    })
  )
```

- [ ] **Step 5: Type-check, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: no type errors, all suites pass, build succeeds.

- [ ] **Step 6: Manual check in the Extension Development Host**

Press F5 (or run "Run Extension"). Open the dashboard, then "Developer: Open Webview Developer Tools" and in its console run:

```js
addEventListener("message", e => console.log(e.data.type, e.data))
```

Expected within 10 s: `live` messages every tick, and the existing dashboard still renders and updates exactly as before. Re-open the dashboard and confirm a `year` message arrives with `days.length` between 365 and 371. Change `rabbithole.crt.strength` in Settings and confirm a `settings` message arrives with `crt.strength` updated. Create a backup from Settings and confirm an `actionResult` message arrives naming the file.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/messageHandler.ts src/extension.ts
git commit -m "Send the year, range and live payloads and report action results"
```

---

### Task 5: Filter CSV and JSON exports by range and project

**Files:**
- Modify: `src/tracker/storageService.ts:616-632` (`exportJSON`, `exportCSV`)
- Modify: `src/shared/types.ts` (`export` message)
- Modify: `src/dashboard/messageHandler.ts` (`export` case)
- Create: `test/storage.export.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Produces: `exportJSON(from?: string, to?: string, projectId?: string): string`, `exportCSV(from?: string, to?: string, projectId?: string): string`. No arguments = the long-standing export (last 90 days, all projects merged). `projectId` undefined or `"all"` = all projects merged.
- Message: `{ type: "export"; format: "csv" | "json"; from?: string; to?: string; projectId?: string }`

- [ ] **Step 1: Register the suite and write the failing test**

Add to `SUITES`:

```js
  {
    name: "export",
    entry: "test/storage.export.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", storage: "src/tracker/storageService.ts" },
  },
```

Create `test/storage.export.test.ts`:

```ts
import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import { MIN, PROJECTS_KEY, cleanupStorageRoot, daysAgo, log, makeStore, proj, today } from "./helpers/store"

after(cleanupStorageRoot)

function store() {
  return makeStore({
    [PROJECTS_KEY]: [proj("alpha"), proj("beta")],
    [`rabbithole:log:alpha:${today}`]: {
      ...log(30 * MIN),
      files: [{ path: "/a.ts", language: "typescript", linesAdded: 10, linesDeleted: 2, lastModified: 0 }],
      sessions: [{ id: "a1", startTime: 1, endTime: 2, duration: 1, activeTime: 30 * MIN, languages: { typescript: 30 * MIN } }],
    },
    [`rabbithole:log:beta:${today}`]: log(20 * MIN),
    [`rabbithole:log:alpha:${daysAgo(10)}`]: log(15 * MIN, daysAgo(10)),
    [`rabbithole:global:${today}`]: { date: today, activeTime: 50 * MIN, streak: 3 },
    [`rabbithole:global:${daysAgo(10)}`]: { date: daysAgo(10), activeTime: 15 * MIN, streak: 1 },
  }).s
}

const csvRows = (csv: string) => csv.split("\n").slice(1)

describe("exports", () => {
  it("with no arguments, export the last 90 days of all projects, as before", () => {
    const s = store()
    assert.strictEqual(s.exportJSON(), JSON.stringify(s.getAggregateRange(90), null, 2))
    const rows = csvRows(s.exportCSV())
    assert.strictEqual(rows.length, 90)
    assert.ok(rows[89].startsWith(`${today},`))
  })

  it("limits to a date range", () => {
    const s = store()
    const rows = csvRows(s.exportCSV(daysAgo(2), today))
    assert.strictEqual(rows.length, 3)
    assert.ok(rows[2].includes(`,${50 * MIN},`))
  })

  it("limits to one project", () => {
    const s = store()
    const days = JSON.parse(s.exportJSON(today, today, "beta"))
    assert.strictEqual(days.length, 1)
    assert.strictEqual(days[0].activeTime, 20 * MIN)
  })

  it("keeps per-session languages in JSON", () => {
    const s = store()
    const days = JSON.parse(s.exportJSON(today, today, "alpha"))
    assert.deepStrictEqual(days[0].sessions[0].languages, { typescript: 30 * MIN })
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node scripts/test.js --suite export`
Expected: the first test PASSES (it describes current behaviour); "limits to a date range", "limits to one project" and "keeps per-session languages in JSON" FAIL because the arguments are ignored (90 rows of all-project data, so `days[0]` is 89 days ago).

- [ ] **Step 3: Implement**

In `src/tracker/storageService.ts`, replace `exportJSON` and `exportCSV` with:

```ts
  // No arguments is the long-standing export: the last 90 days, all projects merged.
  exportJSON(from?: string, to?: string, projectId?: string): string {
    return JSON.stringify(this.exportLogs(from, to, projectId), null, 2)
  }

  exportCSV(from?: string, to?: string, projectId?: string): string {
    const logs = this.exportLogs(from, to, projectId)
    const rows: string[] = ["date,totalTime,activeTime,streak,linesAdded,linesDeleted"]
    for (const log of logs) {
      const linesAdded = log.files.reduce((s, f) => s + f.linesAdded, 0)
      const linesDeleted = log.files.reduce((s, f) => s + f.linesDeleted, 0)
      rows.push(
        `${log.date},${log.totalTime},${log.activeTime},${log.streak},${linesAdded},${linesDeleted}`
      )
    }
    return rows.join("\n")
  }

  private exportLogs(from?: string, to?: string, projectId?: string): DailyLog[] {
    const end = to ?? todayKey()
    let start = from
    if (!start) {
      const d = new Date()
      d.setDate(d.getDate() - 89)
      start = dateKey(d)
    }
    return projectId && projectId !== "all"
      ? this.getRangeByDates(start, end, projectId)
      : this.getAggregateRangeByDates(start, end)
  }
```

In `src/shared/types.ts`, change the `export` variant of `WebviewMessage` to:

```ts
  | { type: "export"; format: "csv" | "json"; from?: string; to?: string; projectId?: string }
```

In `src/dashboard/messageHandler.ts`, in the `export` case, change the content line to:

```ts
      const content = msg.format === "csv"
        ? storage.exportCSV(msg.from, msg.to, msg.projectId)
        : storage.exportJSON(msg.from, msg.to, msg.projectId)
```

- [ ] **Step 4: Run it and see it pass**

Run: `node scripts/test.js --suite export`
Expected: PASS, 4 tests.

- [ ] **Step 5: Negative control**

```bash
git show HEAD:src/tracker/storageService.ts > src/tracker/_negcontrol.ts
node scripts/test.js --suite export --alias storage=src/tracker/_negcontrol.ts
rm src/tracker/_negcontrol.ts
```

Expected: the three filter tests FAIL against the old service; the default-behaviour test passes.

- [ ] **Step 6: Full check and commit**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

```bash
git add src/tracker/storageService.ts src/shared/types.ts src/dashboard/messageHandler.ts test/storage.export.test.ts scripts/test.js
git commit -m "Let CSV and JSON exports take a date range and a project"
```

---

### Task 6: `model.ts` — day slices, views and line rows

**Files:**
- Create: `src/webview/model.ts`
- Create: `test/webview.model.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Consumes: `RangePayload`, `DailyLog`, `ActivitySession` types (Task 3).
- Produces:
  - `type Selection = "all" | string`
  - `type Focus = null | { kind: "project"; id: string } | { kind: "language"; id: string }`
  - `interface LangRow { name: string; ms: number; added: number; deleted: number }`
  - `interface FileRow { projectId: string; path: string; language: string; added: number; deleted: number }`
  - `interface DaySlice { date: string; activeMs: number; linesAdded: number; linesDeleted: number; sessions: ActivitySession[]; files: FileRow[]; languages: LangRow[] }`
  - `interface DayView { date: string; whole: DaySlice; shown: DaySlice }`
  - `interface View { from: string; to: string; days: DayView[]; totalMs: number; wholeMs: number; linesAdded: number; linesDeleted: number; languages: LangRow[]; wholeLanguages: LangRow[]; files: FileRow[] }`
  - `interface LineRow { from: string; to: string; added: number; deleted: number }`
  - `dayKey(d: Date): string`, `datesBetween(from: string, to: string): string[]`
  - `daySlice(range: RangePayload, date: string, sel: Selection, focus: Focus): DaySlice`
  - `buildView(range: RangePayload, sel: Selection, focus: Focus): View`
  - `lineRows(days: DayView[]): LineRow[]`

- [ ] **Step 1: Register the suite and write the failing test**

Add to `SUITES`:

```js
  {
    name: "model",
    entry: "test/webview.model.test.ts",
    alias: { model: "src/webview/model.ts" },
  },
```

Create `test/webview.model.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/model.ts
import { buildView, datesBetween, daySlice, lineRows } from "model"

const MIN = 60_000

function dlog(date: string, parts: { active?: number; sessions?: any[]; files?: any[]; languages?: Record<string, any> } = {}): any {
  return {
    date, totalTime: 0, activeTime: parts.active ?? 0, streak: 0,
    languages: parts.languages ?? {}, agents: {}, files: parts.files ?? [], sessions: parts.sessions ?? [],
  }
}
const file = (path: string, language: string, a: number, d: number) => ({ path, language, linesAdded: a, linesDeleted: d, lastModified: 0 })
const lang = (time: number, a = 0, d = 0) => ({ time, linesAdded: a, linesDeleted: d })
const sess = (id: string, start: number, active: number, languages?: Record<string, number>) =>
  ({ id, startTime: start, endTime: start + active, duration: active, activeTime: active, ...(languages ? { languages } : {}) })

const D1 = "2026-10-02", D2 = "2026-10-03"
const range: any = {
  from: D1, to: D2,
  logs: {
    alpha: [
      dlog(D1, { active: 10 * MIN, files: [file("/a.ts", "typescript", 5, 1)], languages: { typescript: lang(10 * MIN, 5, 1) },
        sessions: [sess("a0", 1000, 10 * MIN, { typescript: 10 * MIN })] }),
      dlog(D2, { active: 30 * MIN,
        files: [file("/a.ts", "typescript", 20, 4), file("/README.md", "markdown", 6, 0)],
        languages: { typescript: lang(20 * MIN, 20, 4), markdown: lang(10 * MIN, 6, 0) },
        sessions: [sess("a1", 5000, 30 * MIN, { typescript: 20 * MIN, markdown: 10 * MIN })] }),
    ],
    beta: [
      dlog(D1),
      dlog(D2, { active: 12 * MIN,
        files: [file("/a.ts", "typescript", 3, 3)],
        languages: { typescript: lang(12 * MIN, 3, 3) },
        // recorded before per-session languages existed
        sessions: [sess("b1", 2000, 12 * MIN)] }),
    ],
  },
}

describe("day slices", () => {
  it("merges all projects and tags sessions and files with their project", () => {
    const s = daySlice(range, D2, "all", null)
    assert.strictEqual(s.activeMs, 42 * MIN)
    assert.deepStrictEqual(s.sessions.map((x: any) => [x.id, x.projectId]), [["b1", "beta"], ["a1", "alpha"]])
    assert.deepStrictEqual(s.files.map((f: any) => f.projectId + f.path), ["alpha/a.ts", "alpha/README.md", "beta/a.ts"])
    assert.deepStrictEqual(s.languages.map((l: any) => [l.name, l.ms]), [["typescript", 32 * MIN], ["markdown", 10 * MIN]])
    assert.strictEqual(s.linesAdded, 29)
    assert.strictEqual(s.linesDeleted, 7)
  })

  it("a single-project selection ignores the others", () => {
    const s = daySlice(range, D2, "beta", null)
    assert.strictEqual(s.activeMs, 12 * MIN)
    assert.strictEqual(s.sessions.length, 1)
  })

  it("a project focus keeps only that project", () => {
    const s = daySlice(range, D2, "all", { kind: "project", id: "beta" })
    assert.strictEqual(s.activeMs, 12 * MIN)
    assert.deepStrictEqual(s.files.map((f: any) => f.projectId), ["beta"])
  })

  it("a language focus uses that language's time, files and session shares", () => {
    const s = daySlice(range, D2, "all", { kind: "language", id: "markdown" })
    assert.strictEqual(s.activeMs, 10 * MIN)
    assert.deepStrictEqual(s.files.map((f: any) => f.path), ["/README.md"])
    assert.deepStrictEqual(s.sessions.map((x: any) => [x.id, x.activeTime]), [["a1", 10 * MIN]])
    assert.strictEqual(s.linesAdded, 6)
  })

  it("sessions without per-session languages drop out of a language focus but the day total still counts them", () => {
    const s = daySlice(range, D2, "all", { kind: "language", id: "typescript" })
    assert.strictEqual(s.activeMs, 32 * MIN)
    assert.deepStrictEqual(s.sessions.map((x: any) => x.id), ["a1"])
  })

  it("a day or project with no log gives zeros, not an error", () => {
    const s = daySlice(range, "2026-09-01", "all", null)
    assert.strictEqual(s.activeMs, 0)
    assert.deepStrictEqual(s.sessions, [])
    assert.strictEqual(daySlice(range, D2, "gone", null).activeMs, 0)
  })
})

describe("views", () => {
  it("sums shown and whole totals and merges files across days per project", () => {
    const v = buildView(range, "all", { kind: "project", id: "alpha" })
    assert.strictEqual(v.totalMs, 40 * MIN)
    assert.strictEqual(v.wholeMs, 52 * MIN)
    const tsAlpha = v.files.find((f: any) => f.projectId === "alpha" && f.path === "/a.ts")
    assert.strictEqual(tsAlpha.added, 25)
    assert.strictEqual(v.files.some((f: any) => f.projectId === "beta"), false)
    assert.deepStrictEqual(v.wholeLanguages.map((l: any) => l.name), ["typescript", "markdown"])
  })

  it("keeps the same path in two projects as two rows", () => {
    const v = buildView(range, "all", null)
    assert.strictEqual(v.files.filter((f: any) => f.path === "/a.ts").length, 2)
  })
})

describe("dates and line rows", () => {
  it("lists every day across a month boundary", () => {
    assert.deepStrictEqual(datesBetween("2026-09-29", "2026-10-02"), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"])
  })

  it("one row per day up to 14 days", () => {
    const v = buildView(range, "all", null)
    assert.strictEqual(lineRows(v.days).length, 2)
  })

  it("beyond 14 days, 7-day rows counted back from the last day", () => {
    const days = datesBetween("2026-09-04", "2026-10-03").map((date: string) => ({
      date, whole: null, shown: { linesAdded: 1, linesDeleted: 0 },
    }))
    const rows = lineRows(days as any)
    assert.strictEqual(rows.length, 5)
    assert.deepStrictEqual([rows[0].from, rows[0].to, rows[0].added], ["2026-09-04", "2026-09-05", 2])
    assert.deepStrictEqual([rows[4].from, rows[4].to, rows[4].added], ["2026-09-27", "2026-10-03", 7])
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node scripts/test.js --suite model`
Expected: FAIL — esbuild cannot resolve `src/webview/model.ts`.

- [ ] **Step 3: Implement**

Create `src/webview/model.ts`:

```ts
// Pure view model for the TTY dashboard and sidebar. Every number a panel shows
// is computed here from the host's year/range/live payloads, so it is tested
// without a DOM. No vscode import and no DOM access, ever.
import type { ActivitySession, DailyLog, RangePayload } from "../shared/types"

export type Selection = "all" | string
export type Focus = null | { kind: "project"; id: string } | { kind: "language"; id: string }

export interface LangRow { name: string; ms: number; added: number; deleted: number }
export interface FileRow { projectId: string; path: string; language: string; added: number; deleted: number }
export interface DaySlice {
  date: string
  activeMs: number
  linesAdded: number
  linesDeleted: number
  sessions: ActivitySession[]   // projectId filled in; under a language focus, activeTime is that language's share
  files: FileRow[]
  languages: LangRow[]          // ms descending
}
export interface DayView { date: string; whole: DaySlice; shown: DaySlice }
export interface View {
  from: string
  to: string
  days: DayView[]
  totalMs: number               // shown (narrowed to the focus)
  wholeMs: number               // without the focus
  linesAdded: number
  linesDeleted: number
  languages: LangRow[]          // shown
  wholeLanguages: LangRow[]     // without the focus — the languages panel keeps these rows under a focus
  files: FileRow[]              // shown, merged across days per project + path, biggest change first
}
export interface LineRow { from: string; to: string; added: number; deleted: number }

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

// Local-date stepping (never 24h arithmetic) so DST days are not skipped or doubled.
export function datesBetween(from: string, to: string): string[] {
  const [y, m, d] = from.split("-").map(Number)
  const out: string[] = []
  for (const dt = new Date(y, m - 1, d); dayKey(dt) <= to; dt.setDate(dt.getDate() + 1)) out.push(dayKey(dt))
  return out
}

const byMsDesc = (a: LangRow, b: LangRow) => b.ms - a.ms || a.name.localeCompare(b.name)

function addLang(map: Map<string, LangRow>, name: string, ms: number, added: number, deleted: number): void {
  const row = map.get(name) ?? { name, ms: 0, added: 0, deleted: 0 }
  row.ms += ms
  row.added += added
  row.deleted += deleted
  map.set(name, row)
}

function logOn(range: RangePayload, projectId: string, date: string): DailyLog | undefined {
  return range.logs[projectId]?.find(l => l.date === date)
}

// One day for the selected projects, narrowed to a focus (null = everything).
export function daySlice(range: RangePayload, date: string, sel: Selection, focus: Focus): DaySlice {
  const only = focus?.kind === "project" ? focus.id : null
  const lang = focus?.kind === "language" ? focus.id : null
  const pids = Object.keys(range.logs).filter(id => (sel === "all" || id === sel) && (!only || id === only))

  const langs = new Map<string, LangRow>()
  const sessions: ActivitySession[] = []
  const files: DaySlice["files"] = []
  let activeMs = 0

  for (const pid of pids) {
    const log = logOn(range, pid, date)
    if (!log) continue
    for (const [name, st] of Object.entries(log.languages)) {
      if (lang && name !== lang) continue
      addLang(langs, name, st.time, st.linesAdded, st.linesDeleted)
    }
    for (const f of log.files) {
      if (lang && f.language !== lang) continue
      files.push({ projectId: pid, path: f.path, language: f.language, added: f.linesAdded, deleted: f.linesDeleted })
    }
    for (const s of log.sessions) {
      if (!lang) {
        sessions.push({ ...s, projectId: pid })
        continue
      }
      // Sessions recorded before per-session languages can't be split, so they
      // leave a language focus rather than being credited to a guess.
      const ms = s.languages?.[lang]
      if (ms) sessions.push({ ...s, projectId: pid, activeTime: ms, languages: { [lang]: ms } })
    }
    if (!lang) activeMs += log.activeTime
  }
  if (lang) activeMs = langs.get(lang)?.ms ?? 0

  sessions.sort((a, b) => a.startTime - b.startTime)
  return {
    date,
    activeMs,
    linesAdded: files.reduce((n, f) => n + f.added, 0),
    linesDeleted: files.reduce((n, f) => n + f.deleted, 0),
    sessions,
    files,
    languages: [...langs.values()].sort(byMsDesc),
  }
}

export function buildView(range: RangePayload, sel: Selection, focus: Focus): View {
  const days: DayView[] = datesBetween(range.from, range.to).map(date => {
    const whole = daySlice(range, date, sel, null)
    return { date, whole, shown: focus ? daySlice(range, date, sel, focus) : whole }
  })
  const shownLangs = new Map<string, LangRow>()
  const wholeLangs = new Map<string, LangRow>()
  const files = new Map<string, FileRow>()
  for (const d of days) {
    for (const l of d.shown.languages) addLang(shownLangs, l.name, l.ms, l.added, l.deleted)
    for (const l of d.whole.languages) addLang(wholeLangs, l.name, l.ms, l.added, l.deleted)
    for (const f of d.shown.files) {
      const key = f.projectId + "\u0000" + f.path
      const row = files.get(key) ?? { ...f, added: 0, deleted: 0 }
      row.added += f.added
      row.deleted += f.deleted
      files.set(key, row)
    }
  }
  return {
    from: range.from,
    to: range.to,
    days,
    totalMs: days.reduce((n, d) => n + d.shown.activeMs, 0),
    wholeMs: days.reduce((n, d) => n + d.whole.activeMs, 0),
    linesAdded: days.reduce((n, d) => n + d.shown.linesAdded, 0),
    linesDeleted: days.reduce((n, d) => n + d.shown.linesDeleted, 0),
    languages: [...shownLangs.values()].sort(byMsDesc),
    wholeLanguages: [...wholeLangs.values()].sort(byMsDesc),
    files: [...files.values()].sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted) || a.path.localeCompare(b.path)),
  }
}

// Lines per day up to 14 days; beyond that, 7-day rows counted back from the
// last day, so the newest row is always a whole week.
export function lineRows(days: DayView[]): LineRow[] {
  const row = (chunk: DayView[]): LineRow => ({
    from: chunk[0].date,
    to: chunk[chunk.length - 1].date,
    added: chunk.reduce((n, d) => n + d.shown.linesAdded, 0),
    deleted: chunk.reduce((n, d) => n + d.shown.linesDeleted, 0),
  })
  if (days.length <= 14) return days.map(d => row([d]))
  const rows: LineRow[] = []
  for (let end = days.length; end > 0; end -= 7) rows.unshift(row(days.slice(Math.max(0, end - 7), end)))
  return rows
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `node scripts/test.js --suite model`
Expected: PASS, 11 tests.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

```bash
git add src/webview/model.ts test/webview.model.test.ts scripts/test.js
git commit -m "Add the webview model: day slices, focus, views and line rows"
```

---

### Task 7: `model.ts` — series, streaks, the day tape, target time and live merges

**Files:**
- Modify: `src/webview/model.ts` (append)
- Create: `test/webview.model2.test.ts`
- Modify: `scripts/test.js` (`SUITES`)

**Interfaces:**
- Consumes: `YearPayload`, `RangePayload`, `LivePayload`, `ActivitySession`; `dayKey` (Task 6).
- Produces:
  - `interface Series { days: string[]; active: number[]; targetMs: number[] }`
  - `seriesFor(year: YearPayload, sel: Selection): Series`
  - `interface StreakInfo { current: number; todayMet: boolean; atRisk: boolean; todayRemainingMs: number; longest: number; longestEnd: string | null }`
  - `streakInfo(s: Series, current: number): StreakInfo`
  - `storedStreak(year: YearPayload, sel: Selection): number`
  - `interface YearStats { activeDays: number; totalMs: number; best: { date: string; ms: number } | null; longest: number; longestEnd: string | null }`
  - `yearStats(s: Series): YearStats`
  - `interface TapeWindow { startMin: number; endMin: number; cells: number; cellMin: number }`
  - `tapeWindow(sessions: ActivitySession[], cells: number, now: number): TapeWindow`
  - `interface TapeCell { startMin: number; ms: number; level: 0 | 1 | 2 | 3 | 4; language: string | null; projectId: string | null }`
  - `tapeCells(sessions: ActivitySession[], win: TapeWindow, now: number, opts?: { perDays?: number; base?: ActivitySession[] }): TapeCell[]`
  - `targetMetAt(sessions: ActivitySession[], targetMs: number, now: number): number | null`
  - `mergeLive(year: YearPayload, range: RangePayload | null, live: LivePayload): void`

- [ ] **Step 1: Register the suite and write the failing test**

Add to `SUITES`:

```js
  {
    name: "model2",
    entry: "test/webview.model2.test.ts",
    alias: { model: "src/webview/model.ts" },
  },
```

Create `test/webview.model2.test.ts`:

```ts
import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/model.ts
import { mergeLive, seriesFor, storedStreak, streakInfo, tapeCells, tapeWindow, targetMetAt, yearStats } from "model"

const MIN = 60_000
const T = 20 * MIN
const at = (h: number, m = 0) => new Date(2026, 9, 3, h, m).getTime()
const sess = (start: number, active: number, span = active, extra: any = {}) =>
  ({ id: String(start), startTime: start, endTime: start + span, duration: span, activeTime: active, ...extra })

// Five days; the second-to-last day met only its stamped (lower) target.
function year(): any {
  return {
    today: "2026-10-03",
    days: ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"],
    globalTargetMs: T,
    global: { streak: 2, active: [30 * MIN, 0, 25 * MIN, 15 * MIN, 5 * MIN], targetMs: [T, null, T, 10 * MIN, T] },
    projects: [
      { id: "alpha", name: "alpha", path: "/a", streak: 1, dailyTargetMinutes: 15,
        active: [20 * MIN, 0, 16 * MIN, 0, 18 * MIN], targetMs: [null, null, null, null, 30 * MIN] },
    ],
  }
}

describe("series and streaks", () => {
  it("all projects use the global records; unstamped days use the current target", () => {
    const s = seriesFor(year(), "all")
    assert.deepStrictEqual(s.targetMs, [T, T, T, 10 * MIN, T])
  })

  it("a project uses its own target, and today is judged against the live target, not its stamp", () => {
    const s = seriesFor(year(), "alpha")
    assert.deepStrictEqual(s.targetMs, [15 * MIN, 15 * MIN, 15 * MIN, 15 * MIN, 15 * MIN])
  })

  it("an unknown project is all zeros", () => {
    assert.deepStrictEqual(seriesFor(year(), "gone").active, [0, 0, 0, 0, 0])
  })

  it("at risk before today's target is met; the current count comes from storage", () => {
    const info = streakInfo(seriesFor(year(), "all"), storedStreak(year(), "all"))
    assert.strictEqual(info.current, 2)
    assert.strictEqual(info.todayMet, false)
    assert.strictEqual(info.atRisk, true)
    assert.strictEqual(info.todayRemainingMs, 15 * MIN)
  })

  it("the longest run honours each day's stamped target", () => {
    const info = streakInfo(seriesFor(year(), "all"), 0)
    assert.strictEqual(info.longest, 2)
    assert.strictEqual(info.longestEnd, "2026-10-02")
  })

  it("year stats count active days, total and the best day", () => {
    const st = yearStats(seriesFor(year(), "all"))
    assert.strictEqual(st.activeDays, 4)
    assert.strictEqual(st.totalMs, 75 * MIN)
    assert.deepStrictEqual(st.best, { date: "2026-09-29", ms: 30 * MIN })
  })
})

describe("day tape", () => {
  it("defaults to 07:00–19:00", () => {
    assert.deepStrictEqual(tapeWindow([sess(at(9), 30 * MIN)], 48, at(20)), { startMin: 420, endMin: 1140, cells: 48, cellMin: 15 })
  })

  it("widens to whole hours that cover night and early sessions", () => {
    const w = tapeWindow([sess(at(5, 10), 20 * MIN), sess(at(22, 30), 60 * MIN, 70 * MIN)], 48, at(23, 59))
    assert.strictEqual(w.startMin, 300)
    assert.strictEqual(w.endMin, 1440)
  })

  it("spreads active time evenly over the session's span", () => {
    const win = tapeWindow([], 48, at(20))
    const cells = tapeCells([sess(at(9), 30 * MIN, 60 * MIN, { languages: { typescript: 30 * MIN } })], win, at(20))
    const nine = cells.filter(c => c.startMin >= 540 && c.startMin < 600)
    assert.deepStrictEqual(nine.map(c => c.level), [3, 3, 3, 3])
    assert.strictEqual(nine[0].language, "typescript")
    assert.strictEqual(cells.find(c => c.startMin === 600)!.level, 0)
  })

  it("an open session runs up to now", () => {
    const open = { id: "o", startTime: at(10), endTime: null, duration: 0, activeTime: 30 * MIN, projectId: "alpha" }
    const cells = tapeCells([open], tapeWindow([open], 48, at(10, 30)), at(10, 30))
    assert.deepStrictEqual(cells.filter(c => c.level === 4).map(c => c.startMin), [600, 615])
    assert.strictEqual(cells[0].projectId, null)
    assert.strictEqual(cells.find(c => c.startMin === 600)!.projectId, "alpha")
  })

  it("an averaged range is scaled to the whole's busiest cell, so a focus reads as a share", () => {
    const whole = [sess(at(9), 15 * MIN), sess(at(9), 15 * MIN)]
    const focus = [whole[0]]
    const win = tapeWindow(whole, 48, at(20))
    const cells = tapeCells(focus, win, at(20), { perDays: 2, base: whole })
    assert.strictEqual(cells.find(c => c.startMin === 540)!.level, 3)
  })
})

describe("target time and live merges", () => {
  it("interpolates inside the session that crossed the target", () => {
    const met = targetMetAt([sess(at(8), 10 * MIN), sess(at(9), 20 * MIN, 40 * MIN)], T, at(20))
    assert.strictEqual(met, at(9, 20))
  })

  it("is null when the target was never reached, and uses now for an open session", () => {
    assert.strictEqual(targetMetAt([sess(at(8), 5 * MIN)], T, at(20)), null)
    const open = { id: "o", startTime: at(10), endTime: null, duration: 0, activeTime: 40 * MIN }
    assert.strictEqual(targetMetAt([open], T, at(10, 40)), at(10, 20))
  })

  it("replaces today's values instead of adding, however often it runs", () => {
    const y = year()
    const range: any = { from: "2026-10-02", to: "2026-10-03", logs: { alpha: [{ date: "2026-10-02", activeTime: 1 }] } }
    const live: any = { today: "2026-10-03", projectId: "alpha", log: { date: "2026-10-03", activeTime: 42 * MIN },
      todayActive: { alpha: 42 * MIN }, globalToday: 50 * MIN }
    mergeLive(y, range, live)
    mergeLive(y, range, live)
    assert.strictEqual(y.projects[0].active[4], 42 * MIN)
    assert.strictEqual(y.global.active[4], 50 * MIN)
    assert.strictEqual(range.logs.alpha.length, 2)
    assert.strictEqual(range.logs.alpha[1].activeTime, 42 * MIN)
  })

  it("leaves a range that doesn't include today alone", () => {
    const range: any = { from: "2026-09-01", to: "2026-09-02", logs: { alpha: [] } }
    mergeLive(year(), range, { today: "2026-10-03", projectId: "alpha", log: { date: "2026-10-03" }, todayActive: {}, globalToday: 0 } as any)
    assert.strictEqual(range.logs.alpha.length, 0)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `node scripts/test.js --suite model2`
Expected: FAIL — `seriesFor` and the others are not exported.

- [ ] **Step 3: Implement**

Change the type import at the top of `src/webview/model.ts` to:

```ts
import type { ActivitySession, DailyLog, LivePayload, RangePayload, YearPayload } from "../shared/types"
```

Append to `src/webview/model.ts`:

```ts
// ── Year series and streaks ─────────────────────────────────────────────────

export interface Series { days: string[]; active: number[]; targetMs: number[] }

// Daily active ms and the target each day is judged against: its stamped target,
// or the current one for days recorded before stamping. Today is always judged
// against the live target, since it is still being earned.
export function seriesFor(year: YearPayload, sel: Selection): Series {
  const n = year.days.length
  if (sel === "all") {
    const targetMs = year.global.targetMs.map(t => t ?? year.globalTargetMs)
    if (n) targetMs[n - 1] = year.globalTargetMs
    return { days: year.days, active: year.global.active, targetMs }
  }
  const p = year.projects.find(q => q.id === sel)
  const current = p?.dailyTargetMinutes !== undefined ? p.dailyTargetMinutes * 60_000 : year.globalTargetMs
  if (!p) return { days: year.days, active: year.days.map(() => 0), targetMs: year.days.map(() => current) }
  const targetMs = p.targetMs.map(t => t ?? current)
  if (n) targetMs[n - 1] = current
  return { days: year.days, active: p.active, targetMs }
}

// The current streak is storage's (it self-heals and isn't limited to a year).
export function storedStreak(year: YearPayload, sel: Selection): number {
  return sel === "all" ? year.global.streak : year.projects.find(p => p.id === sel)?.streak ?? 0
}

export interface StreakInfo {
  current: number
  todayMet: boolean
  atRisk: boolean
  todayRemainingMs: number
  longest: number
  longestEnd: string | null
}

export function streakInfo(s: Series, current: number): StreakInfo {
  const n = s.active.length
  const met = (i: number) => s.active[i] >= s.targetMs[i]
  const todayMet = n > 0 && met(n - 1)
  let run = 0
  let longest = 0
  let longestEnd: string | null = null
  for (let i = 0; i < n; i++) {
    run = met(i) ? run + 1 : 0
    if (run > longest) { longest = run; longestEnd = s.days[i] }
  }
  return {
    current,
    todayMet,
    atRisk: !todayMet && current > 0,
    todayRemainingMs: n ? Math.max(0, s.targetMs[n - 1] - s.active[n - 1]) : 0,
    longest,
    longestEnd,
  }
}

export interface YearStats {
  activeDays: number
  totalMs: number
  best: { date: string; ms: number } | null
  longest: number
  longestEnd: string | null
}

// Over the last 365 days of the series (the grid itself reaches back to a Monday).
export function yearStats(s: Series): YearStats {
  const from = Math.max(0, s.days.length - 365)
  const tail: Series = { days: s.days.slice(from), active: s.active.slice(from), targetMs: s.targetMs.slice(from) }
  let activeDays = 0
  let totalMs = 0
  let best: YearStats["best"] = null
  for (let i = 0; i < tail.active.length; i++) {
    const ms = tail.active[i]
    if (ms > 0) activeDays++
    totalMs += ms
    if (ms > 0 && (best === null || ms > best.ms)) best = { date: tail.days[i], ms }
  }
  const { longest, longestEnd } = streakInfo(tail, 0)
  return { activeDays, totalMs, best, longest, longestEnd }
}

// ── Day tape ────────────────────────────────────────────────────────────────

export interface TapeWindow { startMin: number; endMin: number; cells: number; cellMin: number }
export interface TapeCell { startMin: number; ms: number; level: 0 | 1 | 2 | 3 | 4; language: string | null; projectId: string | null }

// Minutes since local midnight that the session covers. An open session runs to now.
function spanOf(s: ActivitySession, now: number): [number, number] {
  const d = new Date(s.startTime)
  const start = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  const end = s.endTime ?? Math.max(s.startTime, now)
  return [start, Math.min(24 * 60, start + (end - s.startTime) / 60_000)]
}

// 07:00–19:00, widened to whole hours that cover every session shown, so night
// work is never cut off. Split into `cells` equal cells (48 wide, 24 narrow).
export function tapeWindow(sessions: ActivitySession[], cells: number, now: number): TapeWindow {
  let start = 7 * 60
  let end = 19 * 60
  for (const s of sessions) {
    const [a, b] = spanOf(s, now)
    start = Math.min(start, Math.floor(a / 60) * 60)
    end = Math.max(end, Math.ceil(b / 60) * 60)
  }
  return { startMin: start, endMin: end, cells, cellMin: (end - start) / cells }
}

function sumCells(sessions: ActivitySession[], win: TapeWindow, now: number) {
  const ms = new Array<number>(win.cells).fill(0)
  const byLang = Array.from({ length: win.cells }, () => new Map<string, number>())
  const byProj = Array.from({ length: win.cells }, () => new Map<string, number>())
  for (const s of sessions) {
    const [a, b] = spanOf(s, now)
    if (b <= a || s.activeTime <= 0) continue
    const perMin = s.activeTime / (b - a)
    const langTotal = Object.values(s.languages ?? {}).reduce((n, v) => n + v, 0)
    for (let i = 0; i < win.cells; i++) {
      const c0 = win.startMin + i * win.cellMin
      const overlap = Math.max(0, Math.min(b, c0 + win.cellMin) - Math.max(a, c0))
      if (!overlap) continue
      const v = overlap * perMin
      ms[i] += v
      if (s.projectId) byProj[i].set(s.projectId, (byProj[i].get(s.projectId) ?? 0) + v)
      if (langTotal > 0) {
        for (const [l, lm] of Object.entries(s.languages!)) byLang[i].set(l, (byLang[i].get(l) ?? 0) + v * lm / langTotal)
      }
    }
  }
  return { ms, byLang, byProj }
}

const top = (m: Map<string, number>): string | null => {
  let best: string | null = null
  let bestV = 0
  for (const [k, v] of m) if (v > bestV) { best = k; bestV = v }
  return best
}

// Active time per cell. A single day is measured against the cell's length; an
// averaged range (perDays > 1) against the busiest cell of `base` (the unfocused
// sessions), so a focused tape reads as a share of the whole.
export function tapeCells(
  sessions: ActivitySession[],
  win: TapeWindow,
  now: number,
  opts: { perDays?: number; base?: ActivitySession[] } = {}
): TapeCell[] {
  const per = Math.max(1, opts.perDays ?? 1)
  const { ms, byLang, byProj } = sumCells(sessions, win, now)
  let peak = win.cellMin * 60_000
  if (per > 1) {
    const base = opts.base ? sumCells(opts.base, win, now).ms : ms
    peak = Math.max(1, ...base.map(v => v / per))
  }
  return ms.map((v, i) => {
    const f = v / per / peak
    const level: TapeCell["level"] = f >= 0.75 ? 4 : f >= 0.5 ? 3 : f >= 0.25 ? 2 : f > 0 ? 1 : 0
    return { startMin: win.startMin + i * win.cellMin, ms: v / per, level, language: top(byLang[i]), projectId: top(byProj[i]) }
  })
}

// When the day's cumulative active time reached the target, interpolated inside
// the session that crossed it. Null if it never did.
export function targetMetAt(sessions: ActivitySession[], targetMs: number, now: number): number | null {
  let cum = 0
  for (const s of [...sessions].sort((a, b) => a.startTime - b.startTime)) {
    if (s.activeTime <= 0) continue
    if (cum + s.activeTime >= targetMs) {
      const end = s.endTime ?? Math.max(s.startTime, now)
      return Math.round(s.startTime + (targetMs - cum) / s.activeTime * (end - s.startTime))
    }
    cum += s.activeTime
  }
  return null
}

// Fold a 10-second live update into the cached payloads. It replaces today's
// values and never adds to them, so leaving the dashboard open can't inflate today.
export function mergeLive(year: YearPayload, range: RangePayload | null, live: LivePayload): void {
  const i = year.days.indexOf(live.today)
  if (i >= 0) {
    for (const p of year.projects) {
      if (live.todayActive[p.id] !== undefined) p.active[i] = live.todayActive[p.id]
    }
    year.global.active[i] = live.globalToday
  }
  if (range && live.today >= range.from && live.today <= range.to) {
    const logs: DailyLog[] = range.logs[live.projectId] ?? (range.logs[live.projectId] = [])
    const j = logs.findIndex(l => l.date === live.today)
    if (j >= 0) logs[j] = live.log
    else logs.push(live.log)
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `node scripts/test.js --suite model`
Expected: PASS, both `model` and `model2` suites (the filter is a substring match): 11 + 15 tests.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

```bash
git add src/webview/model.ts test/webview.model2.test.ts scripts/test.js
git commit -m "Add series, streaks, the day tape, target time and live merges to the webview model"
```

---

### Task 8: Phase wrap-up

**Files:**
- Modify: `docs/superpowers/specs/2026-10-04-tty-redesign-design.md` (the five planning deviations)
- Modify: `CLAUDE.md` (local, gitignored — not committed)

- [ ] **Step 1: Correct the spec**

In the spec:
- §1.2: rename the request to `requestDays`, add `rangeRefused`, add `streak` to `ProjectYear` and the `global` series (`{ streak; active; targetMs }`) to `YearPayload`, and add `globalToday` to the `live` payload.
- §1.3: add that the displayed streak comes from storage and that the tape window widens to whole hours covering every session.
- §4.3: replace "or all history (the current behaviour, kept as an option)" with "with no range chosen, the last 90 days of all projects (the current behaviour)".

- [ ] **Step 2: Update `CLAUDE.md`**

Add a short "TTY redesign — phase 1" note under "Line counting"/"Architecture" covering: `ActivitySession.languages` (credited by `flushLanguageTime` and the midnight split, absent on older sessions); the `year` / `requestDays`→`range` / `live` / `actionResult` messages built in `src/dashboard/payloads.ts`; the `rabbithole.crt.*` settings read through `getCrtSettings()`; `src/webview/model.ts` as the only place panel numbers are computed; and the CLI follow-up (add `languages` to `rabbithole doctor`'s known session fields). Update the test count and suite table (`languages`, `crt`, `payloads`, `export`, `model`, `model2`).

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: every suite passes (the nine existing plus six new), no type errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-04-tty-redesign-design.md
git commit -m "Record the phase 1 planning decisions in the redesign spec"
```

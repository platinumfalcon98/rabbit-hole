import { after, before, describe, it } from "node:test"
import * as assert from "node:assert"
import * as vscode from "vscode"
// @ts-ignore — esbuild alias to src/tracker/activityTracker.ts
import { ActivityTracker } from "tracker"

const v = vscode as any

const fileCalls: { path: string; added: number; deleted: number }[] = []

// Only the calls the capture model makes are stubbed; this suite is about what
// the tracker *measures*, not what storage does with it.
const storage: any = {
  registerProject: () => {},
  setCurrentProject: () => {},
  closeStaleSessions: () => {},
  appendSession: () => {},
  appendSessionToDate: () => {},
  updateLanguageTime: () => {},
  updateLanguageTimeForDate: () => {},
  appendFileActivity: (f: any) =>
    fileCalls.push({ path: f.path, added: f.linesAdded, deleted: f.linesDeleted }),
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const DEBOUNCE_WAIT = 2400 // EXTERNAL_DEBOUNCE_MS is 2000

let tracker: any

async function externalChange(path: string, content: string, isCreate = false) {
  v.__writeFile(path, content)
  if (isCreate) v.__fireCreate(path)
  else v.__fireChange(path)
  await sleep(DEBOUNCE_WAIT)
}

before(() => {
  tracker = new ActivityTracker({ subscriptions: [] } as any, storage)
  tracker.start()
})

after(() => tracker.stop())

// Registered first so it observes the tracker before the focus-gate suite
// blurs the window.
describe("session start", () => {
  it("session is active when the window starts focused", () =>
    assert.strictEqual(tracker.isActivelyTracking, true))
})

describe("focus gate — a blurred window must not accrue active time", () => {
  let beforeBlurWrite = 0

  before(async () => {
    v.__setFocused(false)
    beforeBlurWrite = fileCalls.length
    await externalChange("/repo/src/a.ts", "one\ntwo\nthree\n", true)
  })

  it("blur pauses the session", () =>
    assert.strictEqual(tracker.isActivelyTracking, false))

  // Without the gate a background agent writing files un-paused the clock and
  // nothing re-paused it — a minimised editor recorded hours of active time.
  it("an agent write while blurred does NOT resume the active clock", () =>
    assert.strictEqual(tracker.isActivelyTracking, false))

  it("an agent write while blurred STILL records file/line stats", () =>
    assert.ok(fileCalls.length > beforeBlurWrite, "expected an appendFileActivity call"))

  it("refocus resumes the session", () => {
    v.__setFocused(true)
    assert.strictEqual(tracker.isActivelyTracking, true)
  })
})

const callsFor = (path: string) => fileCalls.filter(c => c.path === path)
const sum = (path: string) => callsFor(path).reduce(
  (t, c) => ({ added: t.added + c.added, deleted: t.deleted + c.deleted }), { added: 0, deleted: 0 })

describe("net per day through the watcher", () => {
  before(async () => {
    v.__writeFile("/repo/src/b.ts", "a\nb\nc\nd\ne\n"); v.__fireCreate("/repo/src/b.ts")
    v.__writeFile("/repo/src/c.ts", "pre\nexisting\nfile\n"); v.__fireChange("/repo/src/c.ts")
    v.__writeFile("/repo/src/crlf.ts", "x\ny\n"); v.__fireChange("/repo/src/crlf.ts")
    await sleep(DEBOUNCE_WAIT)
    v.__writeFile("/repo/src/b.ts", "v\nw\nx\ny\nz\n"); v.__fireChange("/repo/src/b.ts")       // rewrite today's lines
    v.__writeFile("/repo/src/c.ts", "pre\nCHANGED\nfile\nplus\n"); v.__fireChange("/repo/src/c.ts")
    v.__writeFile("/repo/src/crlf.ts", "x\r\ny\r\n"); v.__fireChange("/repo/src/crlf.ts")     // EOL flip only
    await sleep(DEBOUNCE_WAIT)
  })

  it("create counts real lines (no phantom trailing line)", () =>
    assert.deepStrictEqual(callsFor("/repo/src/b.ts")[0], { path: "/repo/src/b.ts", added: 5, deleted: 0 }))
  it("rewriting lines added today records nothing more", () =>
    assert.strictEqual(callsFor("/repo/src/b.ts").length, 1))
  it("first sighting records nothing; the next edit is net vs that baseline", () =>
    assert.deepStrictEqual(sum("/repo/src/c.ts"), { added: 2, deleted: 1 }))
  it("a CRLF<->LF flip records nothing", () =>
    assert.strictEqual(callsFor("/repo/src/crlf.ts").length, 0))
})

describe("temp files and unseen deletes", () => {
  before(async () => {
    v.__writeFile("/repo/src/tmp.ts", "1\n2\n3\n"); v.__fireCreate("/repo/src/tmp.ts")
    await sleep(DEBOUNCE_WAIT)
    v.__fireDelete("/repo/src/tmp.ts")
    v.__fireDelete("/repo/src/never-seen.ts")
    await sleep(DEBOUNCE_WAIT)
  })
  it("a file created and deleted the same day nets to zero", () =>
    assert.deepStrictEqual(sum("/repo/src/tmp.ts"), { added: 0, deleted: 0 }))
  it("delete of unseen file records nothing", () =>
    assert.strictEqual(callsFor("/repo/src/never-seen.ts").length, 0))

  // VS Code keeps a deleted file's tab open ("(deleted)") with its old text, so
  // measuring the buffer would never see the deletion.
  describe("a temp file deleted while open in an editor", () => {
    before(async () => {
      v.__writeFile("/repo/src/opentmp.ts", "1\n2\n3\n"); v.__fireCreate("/repo/src/opentmp.ts")
      await sleep(DEBOUNCE_WAIT)
      v.__openDoc("/repo/src/opentmp.ts", "1\n2\n3\n")
      v.__fireDelete("/repo/src/opentmp.ts")
      await sleep(DEBOUNCE_WAIT)
    })
    it("still nets to zero", () =>
      assert.deepStrictEqual(sum("/repo/src/opentmp.ts"), { added: 0, deleted: 0 }))
  })
})

describe("open documents", () => {
  const TEN = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n"
  before(async () => {
    const reload = v.__openDoc("/repo/src/open.ts", TEN)
    const typed = v.__openDoc("/repo/src/typed.ts", "const a = 1\n")
    const both = v.__openDoc("/repo/src/both.ts", "x\n")
    await sleep(50)
    // Agent edits first and last line on disk; VS Code reloads (one span, ~10 lines).
    v.__editDoc(reload, TEN.replace("l1\n", "L1\n").replace("l10\n", "L10\n"), false)
    // Typing within a single line.
    v.__editDoc(typed, "const a = 2\n", true)
    // Agent writes an open file: watcher event AND reload both fire.
    v.__writeFile("/repo/src/both.ts", "x\ny\n"); v.__fireChange("/repo/src/both.ts")
    v.__editDoc(both, "x\ny\n", false)
    await sleep(DEBOUNCE_WAIT)
  })
  it("a reload of an open file counts only the changed lines (not the span)", () =>
    assert.deepStrictEqual(sum("/repo/src/open.ts"), { added: 2, deleted: 2 }))
  it("typing within a line counts 1/1 (it used to count 0/0)", () =>
    assert.deepStrictEqual(sum("/repo/src/typed.ts"), { added: 1, deleted: 1 }))
  it("open file written on disk counts once", () =>
    assert.deepStrictEqual(sum("/repo/src/both.ts"), { added: 1, deleted: 0 }))
})

describe("limits", () => {
  before(async () => {
    v.__writeFile("/repo/src/big.ts", "a\n"); v.__fireCreate("/repo/src/big.ts")
    await sleep(DEBOUNCE_WAIT)
    v.__writeFile("/repo/src/big.ts", "x".repeat(5 * 1024 * 1024 + 10)); v.__fireChange("/repo/src/big.ts")
    v.__writeFile("/repo/test/.out/import.js", "a\nb\n"); v.__fireCreate("/repo/test/.out/import.js")
    await sleep(DEBOUNCE_WAIT)
  })
  it("oversized file is skipped, not deleted", () =>
    assert.deepStrictEqual(sum("/repo/src/big.ts"), { added: 1, deleted: 0 }))
  it("dot-prefixed build output is not counted", () =>
    assert.strictEqual(callsFor("/repo/test/.out/import.js").length, 0))
})

describe("worktrees", () => {
  const WT = "/repo/.claude/worktrees/wt1"
  before(async () => {
    v.__writeFile("/repo/src/w.ts", "a\nb\n")                    // main checkout copy (never edited here)
    v.__writeFile(`${WT}/.git`, "gitdir: /repo/.git/worktrees/wt1\n")
    // `git worktree add`: same content as main
    v.__writeFile(`${WT}/src/w.ts`, "a\nb\n"); v.__fireCreate(`${WT}/src/w.ts`)
    v.__writeFile(`${WT}/node_modules/x/i.js`, "x\n"); v.__fireCreate(`${WT}/node_modules/x/i.js`)
    v.__writeFile("/repo/.claude/settings.local.json", "{}\n"); v.__fireChange("/repo/.claude/settings.local.json")
    // A second file the worktree never touches: its copy stays pristine.
    v.__writeFile("/repo/src/p.ts", "p1\np2\n")
    v.__writeFile(`${WT}/src/p.ts`, "p1\np2\n"); v.__fireCreate(`${WT}/src/p.ts`)
    v.__fireChange("/repo/src/p.ts") // main baseline (first sighting)
    await sleep(DEBOUNCE_WAIT)
  })

  // An untouched worktree copy equals main's original content, so a revert in
  // main (undo to clean, Discard Changes, `git checkout -- f`, `git stash`)
  // must not be mistaken for a merge — the redo would then be credited twice.
  describe("reverting main while a pristine worktree copy exists", () => {
    before(async () => {
      v.__writeFile("/repo/src/p.ts", "p1\np2\nx\ny\n"); v.__fireChange("/repo/src/p.ts")
      await sleep(DEBOUNCE_WAIT)
      v.__writeFile("/repo/src/p.ts", "p1\np2\n"); v.__fireChange("/repo/src/p.ts")
      await sleep(DEBOUNCE_WAIT)
      v.__writeFile("/repo/src/p.ts", "p1\np2\nx\ny\n"); v.__fireChange("/repo/src/p.ts")
      await sleep(DEBOUNCE_WAIT)
    })
    it("edit, revert, redo nets to one edit (+2), not +4", () =>
      assert.deepStrictEqual(sum("/repo/src/p.ts"), { added: 2, deleted: 0 }))
  })

  it("creating a worktree counts nothing", () =>
    assert.strictEqual(callsFor("/repo/src/w.ts").length, 0))
  it("a worktree's node_modules and the rest of .claude stay excluded", () => {
    assert.strictEqual(fileCalls.filter(c => c.path.includes("node_modules")).length, 0)
    assert.strictEqual(fileCalls.filter(c => c.path.includes("settings.local")).length, 0)
  })

  describe("editing in the worktree", () => {
    before(async () => {
      v.__writeFile(`${WT}/src/w.ts`, "a\nb\nc\nd\n"); v.__fireChange(`${WT}/src/w.ts`)
      v.__writeFile(`${WT}/src/new.ts`, "n1\nn2\nn3\n"); v.__fireCreate(`${WT}/src/new.ts`)
      await sleep(DEBOUNCE_WAIT)
    })
    it("counts live, credited under the main-checkout path", () =>
      assert.deepStrictEqual(sum("/repo/src/w.ts"), { added: 2, deleted: 0 }))
    it("a file new in the worktree counts as added", () =>
      assert.deepStrictEqual(sum("/repo/src/new.ts"), { added: 3, deleted: 0 }))
    it("no row uses the worktree path", () =>
      assert.strictEqual(fileCalls.filter(c => c.path.includes("worktrees")).length, 0))
  })

  describe("merging into main (no git signal, e.g. cherry-pick)", () => {
    let callsBefore = 0
    before(async () => {
      v.__fireChange("/repo/src/w.ts") // establish the main baseline first (first sighting)
      await sleep(DEBOUNCE_WAIT)
      callsBefore = callsFor("/repo/src/w.ts").length
      v.__writeFile("/repo/src/w.ts", "a\nb\nc\nd\n"); v.__fireChange("/repo/src/w.ts")
      await sleep(DEBOUNCE_WAIT)
    })
    it("the merged content is not counted a second time", () =>
      assert.strictEqual(callsFor("/repo/src/w.ts").length, callsBefore))
  })

  describe("removing the worktree", () => {
    let callsBefore = 0
    before(async () => {
      callsBefore = fileCalls.length
      v.__fireDelete(`${WT}/.git`)
      v.__fireDelete(`${WT}/src/w.ts`)
      v.__fireDelete(`${WT}/src/new.ts`)
      await sleep(DEBOUNCE_WAIT)
    })
    it("deleting the worktree's files counts nothing", () =>
      assert.strictEqual(fileCalls.length, callsBefore))
  })
})

// Must run LAST: the git-op window suppresses everything disk-originated for ~7s.
describe("git operations", () => {
  before(async () => {
    v.__writeFile("/repo/src/g.ts", "a\nb\n"); v.__fireChange("/repo/src/g.ts")          // first sighting
    const open = v.__openDoc("/repo/src/gopen.ts", "a\n")
    const typing = v.__openDoc("/repo/src/gtype.ts", "a\n")
    await sleep(DEBOUNCE_WAIT)
    v.__fireChange("/repo/.git/HEAD")                                                     // checkout
    v.__writeFile("/repo/src/g.ts", "a\nb\nc\nd\n"); v.__fireChange("/repo/src/g.ts")
    v.__editDoc(open, "a\nother\nbranch\n", false)                                         // reload of open file
    v.__editDoc(typing, "a\nmine\n", true)                                                 // user typing meanwhile
    await sleep(DEBOUNCE_WAIT)
  })
  it("a checkout's working-tree change is not counted", () =>
    assert.strictEqual(callsFor("/repo/src/g.ts").length, 0))
  it("a checkout's reload of an OPEN file is not counted either", () =>
    assert.strictEqual(callsFor("/repo/src/gopen.ts").length, 0))
  it("typing during the checkout window still counts", () =>
    assert.deepStrictEqual(sum("/repo/src/gtype.ts"), { added: 1, deleted: 0 }))
})

import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/tracker/pathRules.ts
import { isExcludedPath, isGitOpSignal, isGitPath, languageForFile, worktreeInfo } from "paths"

describe("worktreeInfo", () => {
  it("maps a Claude Code worktree file to the main checkout path (posix)", () =>
    assert.deepStrictEqual(worktreeInfo("/repo/.claude/worktrees/wt1/src/a.ts"), {
      root: "/repo/.claude/worktrees/wt1",
      gitFile: "/repo/.claude/worktrees/wt1/.git",
      mainPath: "/repo/src/a.ts",
    }))
  it("maps a .worktrees file (Windows separators)", () =>
    assert.deepStrictEqual(worktreeInfo("c:\\Users\\me\\repo\\.worktrees\\pre-fix\\lib\\email.ts"), {
      root: "c:\\Users\\me\\repo\\.worktrees\\pre-fix",
      gitFile: "c:\\Users\\me\\repo\\.worktrees\\pre-fix\\.git",
      mainPath: "c:\\Users\\me\\repo\\lib\\email.ts",
    }))
  it("a main-checkout path is not a worktree", () =>
    assert.strictEqual(worktreeInfo("/repo/src/a.ts"), null))
  it("the worktree directory itself (no file below it) is not a worktree file", () =>
    assert.strictEqual(worktreeInfo("/repo/.worktrees/wt1"), null))
})

describe("isExcludedPath", () => {
  it(".claude is still excluded outside worktrees", () =>
    assert.strictEqual(isExcludedPath("/repo/.claude/settings.local.json"), true))
  it("files inside a .claude worktree are NOT excluded", () =>
    assert.strictEqual(isExcludedPath("/repo/.claude/worktrees/wt1/src/a.ts"), false))
  it("a worktree's own node_modules is still excluded", () =>
    assert.strictEqual(isExcludedPath("/repo/.claude/worktrees/wt1/node_modules/x/i.js"), true))
  it("dot-prefixed build output is excluded (test/.out)", () =>
    assert.strictEqual(isExcludedPath("/repo/test/.out/import.js"), true))
  for (const dir of [".output", ".turbo", ".cache", ".parcel-cache", ".svelte-kit", ".vercel"])
    it(`${dir}/ is excluded`, () => assert.strictEqual(isExcludedPath(`/repo/${dir}/x.json`), true))
  it("next-env.d.ts is excluded", () =>
    assert.strictEqual(isExcludedPath("/repo/next-env.d.ts"), true))
  it("ordinary source and gitignored docs still count", () => {
    assert.strictEqual(isExcludedPath("/repo/src/a.ts"), false)
    assert.strictEqual(isExcludedPath("/repo/docs/LOGBOOK.md"), false)
    assert.strictEqual(isExcludedPath("/repo/.env.local"), false)
  })
  it("lockfiles and minified files stay excluded", () => {
    assert.strictEqual(isExcludedPath("/repo/package-lock.json"), true)
    assert.strictEqual(isExcludedPath("/repo/web/app.min.js"), true)
  })
})

describe("git signals", () => {
  it("anything under .git is a git path, including a worktree's .git file", () => {
    assert.strictEqual(isGitPath("/repo/.git/index"), true)
    assert.strictEqual(isGitPath("/repo/.claude/worktrees/wt1/.git"), true)
    assert.strictEqual(isGitPath("/repo/src/a.ts"), false)
  })
  for (const f of ["HEAD", "ORIG_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"])
    it(`.git/${f} signals a history-moving op`, () => assert.strictEqual(isGitOpSignal(`/repo/.git/${f}`), true))
  it("a linked worktree's HEAD signals too", () =>
    assert.strictEqual(isGitOpSignal("/repo/.git/worktrees/wt1/HEAD"), true))
  it("logs/HEAD and refs do not (plain commits must not suppress)", () => {
    assert.strictEqual(isGitOpSignal("/repo/.git/logs/HEAD"), false)
    assert.strictEqual(isGitOpSignal("/repo/.git/worktrees/wt1/logs/HEAD"), false)
    assert.strictEqual(isGitOpSignal("/repo/.git/refs/heads/main"), false)
    assert.strictEqual(isGitOpSignal("/repo/.git/index"), false)
  })
})

describe("languageForFile", () => {
  it("extension and basename maps still work", () => {
    assert.strictEqual(languageForFile("a.ts"), "typescript")
    assert.strictEqual(languageForFile("Dockerfile"), "dockerfile")
    assert.strictEqual(languageForFile("noext"), undefined)
  })
})

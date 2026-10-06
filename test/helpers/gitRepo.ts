import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
// Safely before local midnight whatever the time of the run.
export const yesterdayNoon = () => startOfToday() - 12 * 3_600_000

// A throwaway repo whose commits (and so reflog entries, which carry the
// committer date) can be dated yesterday or today.
export class TempRepo {
  readonly dir: string
  constructor(init = true) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-git-"))
    if (init) {
      this.git(["init", "-q", "-b", "main"])
      this.git(["config", "core.autocrlf", "false"])
    }
  }
  git(args: string[], whenMs?: number): string {
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (whenMs !== undefined) {
      const d = `${Math.floor(whenMs / 1000)} +0000`
      env.GIT_AUTHOR_DATE = d
      env.GIT_COMMITTER_DATE = d
    }
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: this.dir, env, encoding: "utf8" })
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
    return r.stdout
  }
  path(rel: string): string { return path.join(this.dir, ...rel.split("/")) }
  write(rel: string, content: string | Buffer, mtimeMs?: number): string {
    const p = this.path(rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
    if (mtimeMs !== undefined) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000)
    return p
  }
  commitAll(msg: string, whenMs: number): void {
    this.git(["add", "-A"], whenMs)
    this.git(["commit", "-q", "-m", msg], whenMs)
  }
  head(): string { return this.git(["rev-parse", "HEAD"]).trim() }
  cleanup(): void { fs.rmSync(this.dir, { recursive: true, force: true }) }
}

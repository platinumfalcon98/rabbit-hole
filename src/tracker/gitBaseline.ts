import { spawn } from "child_process"

// The morning store's git half: which commit stands for "this repo at local
// midnight" (the baseline B) and how to read files out of it. The parsers and
// chooseBaseline are pure; the Git runner below shells out with a timeout. No
// vscode import, so it is tested against real repositories.

export const MAX_BLOB_BYTES = 5 * 1024 * 1024

export interface ReflogEntry { sha: string; time: number; action: string }

// `git reflog show --date=unix --format=%H%x09%gd%x09%gs HEAD`, newest first.
export function parseReflog(out: string): ReflogEntry[] {
  const entries: ReflogEntry[] = []
  for (const raw of out.split("\n")) {
    const m = /^([0-9a-f]{40,64})\t[^\t]*@\{(\d+)\}\t(.*)$/.exec(raw.replace(/\r$/, ""))
    if (m) entries.push({ sha: m[1], time: Number(m[2]) * 1000, action: m[3] })
  }
  return entries
}

// A commit is today's authorship and keeps the baseline. Everything else HEAD's
// reflog records (checkout, merge, pull, reset, rebase, cherry-pick, revert,
// clone, am) rewrote the working tree — what the live tracker absorbs.
export function isAuthorship(action: string): boolean {
  const head = action.split(": ")[0]
  return head === "commit" || head === "commit (amend)" || head === "commit (initial)"
}

export function chooseBaseline(newestFirst: ReflogEntry[], midnightMs: number): string | null {
  const entries = [...newestFirst].reverse()
  if (entries.length === 0) return null
  let b: string | null = null
  let i = 0
  while (i < entries.length && entries[i].time < midnightMs) b = entries[i++].sha
  if (b === null) b = entries[i++].sha // cloned or initialised today
  for (; i < entries.length; i++) if (!isAuthorship(entries[i].action)) b = entries[i].sha
  return b
}

export interface StatusLists { tracked: string[]; untracked: string[]; ignored: string[] }

// `git status --porcelain=v1 -z`. A rename/copy is followed by its old path.
export function parseStatus(out: string): StatusLists {
  const lists: StatusLists = { tracked: [], untracked: [], ignored: [] }
  const parts = out.split("\0")
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4) continue
    const xy = p.slice(0, 2)
    const file = p.slice(3)
    if (xy === "??") lists.untracked.push(file)
    else if (xy === "!!") lists.ignored.push(file)
    else {
      lists.tracked.push(file)
      if ((xy[0] === "R" || xy[0] === "C") && i + 1 < parts.length) lists.tracked.push(parts[++i])
    }
  }
  return lists
}

export type BlobResult = Buffer | "missing" | "unknown"

const LFS_HEADER = Buffer.from("version https://git-lfs.github.com/spec/")
export function isLfsPointer(b: Buffer): boolean {
  return b.length < 1024 && b.subarray(0, LFS_HEADER.length).equals(LFS_HEADER)
}

// `git cat-file --batch` output for `count` requests, in order. Anything that
// is not a readable text blob within the limit is "unknown"; a path absent from
// the commit is "missing" (the file did not exist at midnight).
export function parseBatch(out: Buffer, count: number, maxBytes = MAX_BLOB_BYTES): BlobResult[] {
  const results: BlobResult[] = []
  let pos = 0
  while (results.length < count && pos < out.length) {
    const nl = out.indexOf(0x0a, pos)
    if (nl < 0) break
    const header = out.subarray(pos, nl).toString("utf8")
    pos = nl + 1
    if (header.endsWith(" missing")) { results.push("missing"); continue }
    if (header.endsWith(" ambiguous")) { results.push("unknown"); continue }
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header)
    if (!m) break
    const size = Number(m[2])
    if (pos + size > out.length) break
    const body = out.subarray(pos, pos + size)
    pos += size + 1
    results.push(m[1] !== "blob" || size > maxBytes || isLfsPointer(body) ? "unknown" : body)
  }
  while (results.length < count) results.push("unknown")
  return results
}

export const GIT_TIMEOUT_MS = 10_000
const BATCH_PATHS = 200
const COALESCE_MS = 20

export class Git {
  constructor(private gitPath = "git", private timeoutMs = GIT_TIMEOUT_MS) {}

  run(cwd: string, args: string[], input?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath, args, {
        cwd,
        windowsHide: true,
        // never take the index lock (VS Code's own git runs alongside); English messages
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      })
      const chunks: Buffer[] = []
      let stderr = ""
      const timer = setTimeout(() => { child.kill(); reject(new Error(`git ${args[0]} timed out`)) }, this.timeoutMs)
      child.stdout.on("data", (c: Buffer) => chunks.push(c))
      child.stderr.on("data", (c: Buffer) => { stderr += c.toString() })
      child.on("error", e => { clearTimeout(timer); reject(e) })
      child.on("close", code => {
        clearTimeout(timer)
        if (code === 0) resolve(Buffer.concat(chunks))
        else reject(new Error(`git ${args[0]} exited ${code}: ${stderr.trim()}`))
      })
      child.stdin.on("error", () => {}) // a process that exits early closes stdin under us
      child.stdin.end(input ?? "")
    })
  }

  async topLevel(dir: string): Promise<string | null> {
    try {
      return (await this.run(dir, ["rev-parse", "--show-toplevel"])).toString("utf8").trim() || null
    } catch (e) {
      if (e instanceof Error && /not a git repository/i.test(e.message)) return null
      throw e
    }
  }

  async reflog(top: string): Promise<ReflogEntry[]> {
    try {
      return parseReflog((await this.run(top, ["reflog", "show", "--date=unix", "--format=%H%x09%gd%x09%gs", "HEAD"])).toString("utf8"))
    } catch {
      return [] // no HEAD yet, or no reflog
    }
  }

  async baselineFor(top: string, reflog: ReflogEntry[], midnightMs: number): Promise<string | null> {
    const chosen = chooseBaseline(reflog, midnightMs)
    if (chosen) return chosen
    const text = async (args: string[]) => (await this.run(top, args).catch(() => Buffer.alloc(0))).toString("utf8").trim()
    return (await text(["rev-list", "-1", `--before=${Math.floor(midnightMs / 1000)}`, "HEAD"]))
      || (await text(["rev-parse", "--verify", "-q", "HEAD"]))
      || null
  }

  // Dirty tracked and untracked files individually; ignored ones collapsed to
  // their directory (individually would walk node_modules).
  async status(top: string): Promise<StatusLists> {
    const main = parseStatus((await this.run(top, ["status", "--porcelain=v1", "-z", "-uall"])).toString("utf8"))
    const ign = parseStatus((await this.run(top, ["status", "--porcelain=v1", "-z", "--ignored", "--untracked-files=normal"])).toString("utf8"))
    return { tracked: main.tracked, untracked: main.untracked, ignored: ign.ignored }
  }

  async submodules(top: string): Promise<string[]> {
    try {
      const out = (await this.run(top, ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"])).toString("utf8")
      return out.split("\n").map(l => l.replace(/\r$/, "").split(" ").slice(1).join(" ")).filter(Boolean)
    } catch {
      return []
    }
  }

  async diffNames(top: string, rev: string): Promise<string[]> {
    return (await this.run(top, ["diff", "--no-renames", "--name-only", "-z", rev, "--"])).toString("utf8").split("\0").filter(Boolean)
  }

  async readBlobs(top: string, rev: string, rels: string[]): Promise<BlobResult[]> {
    const results: BlobResult[] = new Array(rels.length).fill("unknown")
    const askable = rels.map((rel, i) => ({ rel, i })).filter(x => !x.rel.includes("\n"))
    for (let s = 0; s < askable.length; s += BATCH_PATHS) {
      const chunk = askable.slice(s, s + BATCH_PATHS)
      const out = await this.run(top, ["cat-file", "--batch"], chunk.map(x => `${rev}:${x.rel}\n`).join(""))
      parseBatch(out, chunk.length).forEach((r, k) => { results[chunk[k].i] = r })
    }
    return results
  }
}

// Live first sightings arrive one at a time; reading each with its own git
// process would cost a spawn per file. Requests for the same repo and commit
// made within a few ms share one `cat-file --batch`.
export class BlobQueue {
  private pending = new Map<string, { top: string; rev: string; items: { rel: string; resolve: (r: BlobResult) => void }[]; timer: ReturnType<typeof setTimeout> }>()

  constructor(private git: Git, private onError: (top: string, e: unknown) => void = () => {}, private delayMs = COALESCE_MS) {}

  read(top: string, rev: string, rel: string): Promise<BlobResult> {
    return new Promise(resolve => {
      const key = `${top}\0${rev}`
      let batch = this.pending.get(key)
      if (!batch) {
        batch = { top, rev, items: [], timer: setTimeout(() => this.flush(key), this.delayMs) }
        this.pending.set(key, batch)
      }
      batch.items.push({ rel, resolve })
      if (batch.items.length >= BATCH_PATHS) this.flush(key)
    })
  }

  private flush(key: string): void {
    const batch = this.pending.get(key)
    if (!batch) return
    this.pending.delete(key)
    clearTimeout(batch.timer)
    this.git.readBlobs(batch.top, batch.rev, batch.items.map(i => i.rel)).then(
      results => batch.items.forEach((it, i) => it.resolve(results[i])),
      e => {
        for (const it of batch.items) it.resolve("unknown")
        try { this.onError(batch.top, e) } catch { /* a reporter must not break tracking */ }
      },
    )
  }
}

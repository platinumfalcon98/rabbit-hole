// The morning store answers one question for a file the ledger has not seen
// today: its lines at local midnight (spec section 1). Sources, in order: the
// day-start capture, then the repo's baseline commit B for files git vouches
// were clean at day start. Anything else is "unknown", which keeps the old
// behaviour (the current content becomes the baseline; nothing is credited).
// Pure: no vscode import; git and the repo finder are injected.

import { BlobResult, ReflogEntry } from "./gitBaseline"
import { CaptureEntry, readCaptured } from "./captureStore"
import { LineHashes, hashLines } from "./lineLedger"
import { isUnder, normalizePath } from "./pathRules"

export type Morning = LineHashes | "unknown"
export type Classified = "exact" | "snapshot" | "useB" | "empty" | "unknown"

// Day-start classification of one capture candidate (spec section 2). Creation
// time is trusted only for files git does not track: temp-and-rename saves give
// a rewritten file a new creation time on macOS and Linux.
export function classify(
  stat: { mtimeMs: number; birthtimeMs: number }, midnightMs: number,
  tracked: boolean, inSnapshot: boolean, existedBefore: boolean,
): Classified {
  if (stat.mtimeMs < midnightMs) return "exact"
  if (inSnapshot) return "snapshot"
  if (tracked) return "useB"
  if (stat.birthtimeMs > 0 && stat.birthtimeMs >= midnightMs && !existedBefore) return "empty"
  return "unknown"
}

export interface Repo {
  top: string
  topRaw: string
  baseline: string | null
  worktree: boolean
  listed: Set<string>
  listedDirs: string[]
  reflog: ReflogEntry[]
  operation?: string
}

export function isListed(repo: Repo, key: string): boolean {
  return repo.listed.has(key) || repo.listedDirs.some(d => key.startsWith(d))
}

export interface StoreDeps {
  bin: { dir: string; name: string } | null
  findRepo(fsPath: string): Promise<Repo | null>
  readBlob(repo: Repo, rel: string): Promise<BlobResult>
}

interface Folder { root: string; kind: "git" | "plain"; ready: Promise<void>; markReady: () => void }

export class MorningStore {
  private folders: Folder[] = []
  private entries = new Map<string, { raw: string; entry: CaptureEntry }>()
  private pendingSnapshot: { paths: Set<string>; ready: Promise<unknown> } | undefined

  constructor(readonly day: string, private deps: StoreDeps) {}

  useBin(dir: string, name: string): void { this.deps.bin = { dir, name } }

  // Linked worktrees are discovered lazily rather than included in the capture.
  repoFor(fsPath: string): Promise<Repo | null> { return this.deps.findRepo(fsPath) }

  // A clean path may still have an overnight baseline in yesterday's snapshot.
  // Do not answer from B while that higher-priority source is being folded in.
  waitForSnapshot(paths: Iterable<string>, done: Promise<unknown>): void {
    const pending = { paths: new Set([...paths].map(p => normalizePath(p))), ready: done.catch(() => {}) }
    this.pendingSnapshot = pending
    void pending.ready.then(() => { if (this.pendingSnapshot === pending) this.pendingSnapshot = undefined })
  }

  addFolder(rootRaw: string): void {
    let markReady = () => {}
    const ready = new Promise<void>(r => { markReady = r })
    this.folders.push({ root: normalizePath(rootRaw), kind: "plain", ready, markReady })
    this.folders.sort((a, b) => b.root.length - a.root.length) // nearest folder first
  }

  // The folder's git status is known (git), or it is a plain folder. Until
  // then lookups in it wait.
  folderReady(rootRaw: string, kind: "git" | "plain"): void {
    const f = this.folders.find(x => x.root === normalizePath(rootRaw))
    if (!f) return
    f.kind = kind
    f.markReady()
  }

  put(raw: string, entry: CaptureEntry): void {
    this.entries.set(normalizePath(raw), { raw, entry })
  }

  has(raw: string): boolean {
    return this.entries.has(normalizePath(raw))
  }

  index(): Record<string, CaptureEntry> {
    const out: Record<string, CaptureEntry> = {}
    for (const { raw, entry } of this.entries.values()) out[raw] = entry
    return out
  }

  async lookup(fsPath: string): Promise<Morning> {
    const key = normalizePath(fsPath)
    const folder = this.folders.find(f => isUnder(key, f.root))
    if (!folder) return "unknown"
    await folder.ready
    const pending = this.pendingSnapshot
    if (pending?.paths.has(key)) await pending.ready
    const hit = this.entries.get(key)?.entry
    if (hit === "empty") return []
    if (hit === "unknown") return "unknown"
    if (Array.isArray(hit)) return (this.deps.bin && readCaptured(this.deps.bin.dir, this.deps.bin.name, hit)) ?? "unknown"
    if (folder.kind === "plain") return "unknown" // every countable file gets an entry once captured
    const repo = await this.deps.findRepo(fsPath)
    if (!repo) return "unknown"
    // Listed by git at day start but not captured (yet, or past the cap):
    // comparing against B would credit yesterday's uncommitted work to today.
    if (hit === undefined && !repo.worktree && isListed(repo, key)) return "unknown"
    return this.fromGit(fsPath, repo)
  }

  private async fromGit(fsPath: string, repo: Repo): Promise<Morning> {
    // a repo whose top is not a prefix of the path cannot give a repo-relative path
    if (!isUnder(fsPath, repo.topRaw)) return "unknown"
    if (!repo.baseline) return "unknown"
    const top = repo.topRaw.replace(/\\/g, "/").replace(/\/+$/, "")
    const rel = fsPath.replace(/\\/g, "/").slice(top.length + 1)
    const r = await this.deps.readBlob(repo, rel)
    if (r === "missing") return []
    if (r === "unknown") return "unknown"
    return hashLines(r.toString("utf8"))
  }
}

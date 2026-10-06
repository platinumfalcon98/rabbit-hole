// Takes (or loads) the day's capture and fills the morning store as it goes
// (spec section 2). Pure node — no vscode import — so it runs against real git
// and real directories in tests. Never throws: a failure falls back to
// "unknown" for the files it affects and adds a note.

import * as fs from "fs"
import * as path from "path"
import { BlobQueue, Git, ReflogEntry } from "./gitBaseline"
import { Capture, CaptureEntry, CaptureFolder, CaptureWriter, loadCapture, saveCapture } from "./captureStore"
import { LineHashes, hashLines } from "./lineLedger"
import { Yesterday } from "./ledgerStore"
import { MorningStore, Repo, classify, isListed } from "./morningStore"
import { isExcludedPath, isUnder, languageForFile, normalizePath, worktreeInfo } from "./pathRules"

export const CAPTURE_CAP = 20_000
const MAX_FILE_BYTES = 5 * 1024 * 1024
const BUDGET_MS = 8

export interface DayDeps {
  git: Git | null
  jsonPath: string
  yesterday: Yesterday | null
  note(text: string): void
  cap?: number
  budgetMs?: number
}
export interface DayOutcome { changed: string[]; saved: boolean }
export interface Day { store: MorningStore; done: Promise<DayOutcome> }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]

// Yields to the event loop once `ms` of work has accumulated, so a large
// capture never stalls the shared extension host.
export class Budget {
  private start = Date.now()
  constructor(private ms: number) {}
  async tick(): Promise<void> {
    if (Date.now() - this.start < this.ms) return
    await new Promise(r => setImmediate(r))
    this.start = Date.now()
  }
}

interface Scan { files: { raw: string; tracked: boolean }[]; ignoredDirs: string[]; nested: string[] }

// Every repo the window touches, read once a day: baseline, reflog and (for
// non-worktrees) git status. Nested repos, submodules and worktrees found at
// lookup time are loaded lazily the same way.
export class Repos {
  private byTop = new Map<string, Promise<(Repo & { scan: Scan | null }) | null>>()
  private byDir = new Map<string, Promise<(Repo & { scan: Scan | null }) | null>>()

  constructor(private git: Git, private midnightMs: number, private note: (t: string) => void) {}

  seed(repo: Repo, scan: Scan | null = null): void {
    this.byTop.set(repo.top, Promise.resolve({ ...repo, scan }))
  }

  load(topRaw: string, worktree: boolean, keepBaseline?: string | null): Promise<(Repo & { scan: Scan | null }) | null> {
    const top = normalizePath(topRaw)
    let p = this.byTop.get(top)
    if (!p) {
      p = this.read(topRaw, worktree, keepBaseline).catch(e => { this.note(`git unavailable in ${topRaw}: ${message(e)}`); return null })
      this.byTop.set(top, p)
    }
    return p
  }

  // The nearest repo above a file: walks up looking for `.git`.
  find(fsPath: string): Promise<Repo | null> {
    return this.findDir(path.dirname(fsPath))
  }

  private findDir(dir: string): Promise<(Repo & { scan: Scan | null }) | null> {
    const key = normalizePath(dir)
    let p = this.byDir.get(key)
    if (!p) {
      const dotGit = path.join(dir, ".git")
      if (fs.existsSync(dotGit)) {
        const wt = worktreeInfo(path.join(dir, "x"))
        p = this.load(dir, !!wt && normalizePath(wt.root) === key)
      } else {
        const parent = path.dirname(dir)
        p = parent === dir ? Promise.resolve(null) : this.findDir(parent)
      }
      this.byDir.set(key, p)
    }
    return p
  }

  private async read(topRaw: string, worktree: boolean, keepBaseline?: string | null): Promise<Repo & { scan: Scan | null }> {
    const reflog: ReflogEntry[] = await this.git.reflog(topRaw)
    const baseline = keepBaseline !== undefined ? keepBaseline : await this.git.baselineFor(topRaw, reflog, this.midnightMs)
    let scan: Scan | null = null
    const listed = new Set<string>()
    const listedDirs: string[] = []
    if (!worktree) {
      const st = await this.git.status(topRaw)
      const join = (rel: string) => path.join(topRaw, ...rel.replace(/\/$/, "").split("/"))
      scan = {
        files: [
          ...st.tracked.map(rel => ({ raw: join(rel), tracked: true })),
          ...st.untracked.filter(r => !r.endsWith("/")).map(rel => ({ raw: join(rel), tracked: false })),
          ...st.ignored.filter(r => !r.endsWith("/")).map(rel => ({ raw: join(rel), tracked: false })),
        ],
        ignoredDirs: st.ignored.filter(r => r.endsWith("/")).map(join),
        // -uall lists untracked files one by one, so a directory here is a nested repo
        nested: [...st.untracked.filter(r => r.endsWith("/")).map(join), ...(await this.git.submodules(topRaw)).map(join)]
          .filter(d => fs.existsSync(path.join(d, ".git")))
          // a linked worktree (its own `.git` file) is not a nested repo: Repos.find loads it as a worktree
          .filter(d => normalizePath(worktreeInfo(path.join(d, "x"))?.root ?? "") !== normalizePath(d)),
      }
      for (const f of scan.files) listed.add(normalizePath(f.raw))
      for (const d of scan.ignoredDirs) listedDirs.push(normalizePath(d) + "/")
    }
    return { top: normalizePath(topRaw), topRaw, baseline, worktree, listed, listedDirs, reflog, scan }
  }
}

async function walk(dir: string, visit: (raw: string) => Promise<boolean>, budget: Budget): Promise<boolean> {
  let entries: fs.Dirent[]
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return true }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || isExcludedPath(path.join(p, "x"))) continue
      if (!(await walk(p, visit, budget))) return false
    } else if (e.isFile()) {
      if (!(await visit(p))) return false
    }
    await budget.tick()
  }
  return true
}

const countable = (raw: string) => !worktreeInfo(raw) && !isExcludedPath(raw) && !!languageForFile(path.basename(raw))

export function startDay(rootsRaw: string[], day: string, midnightMs: number, deps: DayDeps): Day {
  const loaded = loadCapture(deps.jsonPath, day)
  const dir = path.dirname(deps.jsonPath)
  const git = deps.git
  const repos = git ? new Repos(git, midnightMs, deps.note) : null
  const queue = git ? new BlobQueue(git, (top, e) => deps.note(`git unavailable in ${top}: ${message(e)}`)) : null
  let writer: CaptureWriter | null = null
  let writerFailed: unknown = null
  if (loaded.kind !== "today") {
    try { writer = new CaptureWriter(deps.jsonPath, day) } catch (e) { writerFailed = e } // e.g. storage not writable
  }
  const store = new MorningStore(day, {
    bin: loaded.kind === "today" ? { dir, name: loaded.capture.bin } : writer ? { dir, name: writer.name } : null,
    findRepo: async p => (repos ? repos.find(p) : null),
    readBlob: async (repo, rel) => (queue && repo.baseline ? queue.read(repo.topRaw, repo.baseline, rel) : "unknown"),
  })
  for (const root of rootsRaw) store.addFolder(root)

  let done: Promise<DayOutcome>
  if (loaded.kind === "today") done = reload(loaded.capture, rootsRaw, midnightMs, store, repos, git)
  else if (writer) done = capture(rootsRaw, day, midnightMs, deps, store, repos, git, writer, new Set(loaded.kind === "stale" ? loaded.paths.map(p => normalizePath(p)) : []))
  else {
    for (const root of rootsRaw) store.folderReady(root, "plain") // before the note: a throwing note must not leave lookups waiting
    done = Promise.resolve({ changed: [], saved: false })
    try { deps.note(`line capture failed: ${message(writerFailed)}`) } catch { /* a reporter must not break tracking */ }
  }
  return { store, done }
}

async function reload(cap: Capture, rootsRaw: string[], midnightMs: number, store: MorningStore, repos: Repos | null, git: Git | null): Promise<DayOutcome> {
  const changed = new Set<string>()
  try {
    for (const f of cap.folders) {
      if (!f.repo || !repos) continue
      // B is fixed for the day; a partial capture re-reads status to know what is listed now
      if (f.partial) await repos.load(f.repo.top, false, f.repo.baseline)
      else repos.seed({ top: normalizePath(f.repo.top), topRaw: f.repo.top, baseline: f.repo.baseline, worktree: false, listed: new Set(), listedDirs: [], reflog: [] })
    }
    for (const [raw, entry] of Object.entries(cap.index)) store.put(raw, entry as CaptureEntry)
    for (const root of rootsRaw) {
      const f = cap.folders.find(x => normalizePath(x.root) === normalizePath(root))
      store.folderReady(root, f?.repo ? "git" : "plain")
      if (git && f?.repo?.baseline) {
        const top = f.repo.top
        for (const rel of await git.diffNames(top, f.repo.baseline).catch(() => [] as string[])) {
          const raw = path.join(top, ...rel.split("/"))
          if (isUnder(raw, root)) changed.add(raw)
        }
      }
    }
    for (const raw of Object.keys(cap.index)) {
      try { if ((await fs.promises.stat(raw)).mtimeMs >= midnightMs) changed.add(raw) } catch { changed.add(raw) /* deleted since */ }
    }
  } catch {
    for (const root of rootsRaw) store.folderReady(root, "plain")
  }
  return { changed: [...changed], saved: true }
}

async function capture(
  rootsRaw: string[], day: string, midnightMs: number, deps: DayDeps, store: MorningStore,
  repos: Repos | null, git: Git | null, writer: CaptureWriter, previous: Set<string>,
): Promise<DayOutcome> {
  const cap = deps.cap ?? CAPTURE_CAP
  const budget = new Budget(deps.budgetMs ?? BUDGET_MS)
  const changed = new Set<string>()
  const folders: CaptureFolder[] = []
  let count = 0
  let full = false

  const snapshotUsable = (repo: Repo | null) => {
    const y = deps.yesterday
    if (!y) return false
    return !repo || !repo.reflog.some(e => e.time > y.savedAt && e.time < midnightMs)
  }
  const snapshotByKey = new Map<string, LineHashes>()
  for (const [p, hashes] of deps.yesterday?.files ?? []) snapshotByKey.set(normalizePath(p), hashes)
  const snapshotFor = (raw: string, repo: Repo | null): LineHashes | undefined =>
    snapshotUsable(repo) ? snapshotByKey.get(normalizePath(raw)) : undefined

  // One candidate. False once the cap is reached.
  const consider = async (raw: string, tracked: boolean, repo: Repo | null): Promise<boolean> => {
    if (!countable(raw) || store.has(raw)) return true
    if (count >= cap) { full = true; return false }
    const snap = snapshotFor(raw, repo)
    let st: fs.Stats
    try {
      st = await fs.promises.stat(raw)
    } catch {
      // A dirty tracked file that is gone at day start. Its parent directory's
      // mtime tells when: unchanged since before midnight means it was deleted
      // before today (morning content []), otherwise B. A missing parent is a
      // recent deletion too.
      if (tracked) {
        let entry: CaptureEntry
        if (snap) entry = writer.add(snap)
        else {
          let parentBefore = false
          try { parentBefore = (await fs.promises.stat(path.dirname(raw))).mtimeMs < midnightMs } catch { /* parent gone */ }
          entry = parentBefore ? "empty" : "useB"
        }
        store.put(raw, entry)
        count++
        changed.add(raw)
      }
      return true
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return true
    // existence does not depend on the snapshot being usable for content
    const key = normalizePath(raw)
    const existedBefore = previous.has(key) || snapshotByKey.has(key)
    const c = classify({ mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs }, midnightMs, tracked, snap !== undefined, existedBefore)
    if (c === "exact") {
      let text: string
      try { text = await fs.promises.readFile(raw, "utf8") } catch { return true }
      store.put(raw, writer.add(hashLines(text)))
    } else if (c === "snapshot") {
      store.put(raw, writer.add(snap!))
    } else {
      store.put(raw, c)
    }
    count++
    // Catch-up wants files whose content may differ from the capture. Not by
    // creation time: setting a file's mtime back leaves its birthtime at "now" on
    // Windows and Linux, and an exact entry is the current content anyway.
    if (st.mtimeMs >= midnightMs) changed.add(raw)
    await budget.tick()
    return true
  }

  const captureRepo = async (repo: Repo & { scan: Scan | null }, rootRaw: string): Promise<void> => {
    if (!repo.scan) return
    for (const f of repo.scan.files) {
      if (isUnder(f.raw, rootRaw) && !(await consider(f.raw, f.tracked, repo))) return
      await budget.tick() // also for entries consider() rejects: a huge status list must still yield
    }
    for (const d of repo.scan.ignoredDirs) {
      if (!isUnder(d, rootRaw) && normalizePath(d) !== normalizePath(rootRaw)) continue
      if (!(await walk(d, raw => consider(raw, false, repo), budget))) return
    }
    for (const n of repo.scan.nested) {
      if (!isUnder(n, rootRaw)) continue
      const inner = await repos!.load(n, false)
      if (inner) {
        const entry: CaptureFolder = { root: n, repo: { top: inner.topRaw, baseline: inner.baseline }, partial: false }
        folders.push(entry)
        await captureRepo(inner, n)
        entry.partial = full
        if (entry.partial) deps.note(`line counts in ${n} start from each file's first edit: more than 20,000 files to capture`)
      }
    }
  }

  try {
    // First pass: every folder's kind (and, for git, its status) before any
    // hashing, so a lookup in one folder never waits for another folder's capture.
    const plan: { rootRaw: string; entry: CaptureFolder; repo: (Repo & { scan: Scan | null }) | null; missing: boolean }[] = []
    for (const rootRaw of rootsRaw) {
      const entry: CaptureFolder = { root: rootRaw, partial: false }
      folders.push(entry)
      if (!fs.existsSync(rootRaw)) {
        store.folderReady(rootRaw, "plain")
        plan.push({ rootRaw, entry, repo: null, missing: true })
        continue
      }
      let repo: (Repo & { scan: Scan | null }) | null = null
      if (git && repos) {
        try {
          const top = await git.topLevel(rootRaw)
          if (top) {
            // spelled as the workspace folder spells it when they match, so catch-up
            // paths equal the ledger's keys
            const topRaw = normalizePath(top) === normalizePath(rootRaw) ? rootRaw : path.normalize(top)
            repo = await repos.load(topRaw, false) // null: Repos already added the note
          }
        } catch (e) {
          deps.note(`git unavailable in ${rootRaw}: ${message(e)}`)
          repo = null
        }
      }
      if (repo) entry.repo = { top: repo.topRaw, baseline: repo.baseline }
      store.folderReady(rootRaw, repo ? "git" : "plain") // git: clean files resolve through git from now on
      plan.push({ rootRaw, entry, repo, missing: false })
    }

    // Second pass: capture and hash.
    for (const { rootRaw, entry, repo, missing } of plan) {
      if (missing) continue
      if (repo) {
        await captureRepo(repo, rootRaw)
        if (repo.baseline && git) {
          for (const rel of await git.diffNames(repo.topRaw, repo.baseline).catch(() => [] as string[])) {
            const raw = path.join(repo.topRaw, ...rel.split("/"))
            if (isUnder(raw, rootRaw)) changed.add(raw)
          }
        }
      } else {
        await walk(rootRaw, raw => consider(raw, false, null), budget)
      }
      entry.partial = full // once the cap is reached, every later folder is partial too
      if (entry.partial) deps.note(`line counts in ${rootRaw} start from each file's first edit: more than 20,000 files to capture`)
    }

    // Clean tracked files changed overnight: yesterday's snapshot beats B.
    if (deps.yesterday && !full) {
      for (const [raw, hashes] of deps.yesterday.files) {
        if (store.has(raw) || !countable(raw) || !rootsRaw.some(r => isUnder(raw, r))) continue
        const repo = repos ? await repos.find(raw) : null
        if (repo?.worktree || (repo && isListed(repo, normalizePath(raw))) || !snapshotUsable(repo)) continue
        if (count >= cap) break
        store.put(raw, writer.add(hashes))
        count++
        changed.add(raw) // e.g. dirty at midnight, restored this morning: catch-up credits the difference
      }
    }

    writer.close() // before the json names the bin
    saveCapture(deps.jsonPath, { version: 1, day, bin: writer.name, folders, index: store.index() })
    return { changed: [...changed], saved: true }
  } catch (e) {
    for (const root of rootsRaw) store.folderReady(root, "plain") // before the note, which may itself throw
    deps.note(`line capture failed: ${message(e)}`)
    return { changed: [...changed], saved: false }
  } finally {
    writer.close() // idempotent; also covers a throwing add() (ENOSPC) or note()
  }
}

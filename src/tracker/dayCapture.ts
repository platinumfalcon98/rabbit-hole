// Takes (or loads) the day's capture and fills the morning store as it goes
// (spec section 2). Pure node — no vscode import — so it runs against real git
// and real directories in tests. Never throws: a failure falls back to
// "unknown" for the files it affects and adds a note.

import * as fs from "fs"
import * as path from "path"
import { BlobQueue, Git, ReflogEntry, isAuthorship, operationMark } from "./gitBaseline"
import { Capture, CaptureEntry, CaptureFolder, CaptureWriter, loadCapture, readCaptured, saveCapture } from "./captureStore"
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
export interface DayOutcome { changed: string[]; saved: boolean; gitMarks?: Record<string, string>; uncertainRoots?: string[] }
export interface Day { store: MorningStore; done: Promise<DayOutcome>; restarting?: boolean }

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
    const operation = operationMark(reflog)
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
    return { top: normalizePath(topRaw), topRaw, baseline, worktree, listed, listedDirs, reflog, scan, operation }
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
  if (loaded.kind === "today") done = reload(loaded.capture, rootsRaw, midnightMs, store, repos, git, deps)
  else if (writer) done = capture(rootsRaw, day, midnightMs, deps, store, repos, git, writer, new Set(loaded.kind === "stale" ? loaded.paths.map(p => normalizePath(p)) : []))
  else {
    for (const root of rootsRaw) store.folderReady(root, "plain") // before the note: a throwing note must not leave lookups waiting
    // No capture at all: every root is uncertain (see capture()'s failure path).
    done = Promise.resolve({ changed: [], saved: false, uncertainRoots: [...rootsRaw] })
    try { deps.note(`line capture failed: ${message(writerFailed)}`) } catch { /* a reporter must not break tracking */ }
  }
  if (loaded.kind !== "today" && deps.yesterday) store.waitForSnapshot(deps.yesterday.files.keys(), done)
  return { store, done, restarting: loaded.kind === "today" }
}

const marksOf = (folders: CaptureFolder[]): Record<string, string> => Object.fromEntries(
  folders.filter(f => f.repo?.operation).map(f => [normalizePath(f.repo!.top), f.repo!.operation!]))

async function changedInRepos(folders: CaptureFolder[], git: Git | null, changed: Set<string>): Promise<void> {
  if (!git) return
  const diffs = new Map<string, Promise<string[]>>()
  for (const f of folders) {
    if (!f.repo?.baseline) continue
    const { top, baseline } = f.repo
    const key = `${normalizePath(top)}\0${baseline}`
    let diff = diffs.get(key)
    if (!diff) { diff = git.diffNames(top, baseline).catch(() => [] as string[]); diffs.set(key, diff) }
    for (const rel of await diff) {
      const raw = path.join(top, ...rel.split("/"))
      if (isUnder(raw, f.root)) changed.add(raw)
    }
  }
}

async function reload(cap: Capture, rootsRaw: string[], midnightMs: number, store: MorningStore, repos: Repos | null, git: Git | null, deps: DayDeps): Promise<DayOutcome> {
  const changed = new Set<string>()
  const uncertainRoots: string[] = []
  let saved = true
  const reset = new Map<string, (Repo & { scan: Scan | null }) | null>()
  try {
    for (const f of cap.folders) {
      if (!f.repo) continue
      const top = normalizePath(f.repo.top)
      const current = await repos?.load(f.repo.top, false, f.repo.baseline) ?? null
      if (!current?.operation || current.operation !== f.repo.operation) reset.set(top, current)
      if (!current?.operation) { uncertainRoots.push(f.repo.top); delete f.repo.operation }
      else f.repo.operation = current.operation
    }
    // A complete capture already accounted for its original dirty list. Today's
    // status is needed to detect recovery candidates, not to reclassify files
    // that were clean at capture time as unknown after ordinary closed edits.
    for (const f of cap.folders) {
      if (!f.repo || reset.has(normalizePath(f.repo.top)) || cap.folders.some(x => x.repo?.top === f.repo!.top && x.partial)) continue
      const current = await repos?.load(f.repo.top, false, f.repo.baseline)
      if (current) { current.listed.clear(); current.listedDirs.length = 0 }
    }
    if (reset.size) {
      cap = await recaptureAfterGit(cap, rootsRaw, reset, git, deps)
      store.useBin(path.dirname(deps.jsonPath), cap.bin)
      saved = saveCapture(deps.jsonPath, cap)
      deps.note("Git changed since the saved baseline; uncertain closed-period edits were skipped, recorded totals are retained")
      if (!saved) deps.note("line capture could not be saved; restart recovery will retry")
    }
    for (const [raw, entry] of Object.entries(cap.index)) store.put(raw, entry as CaptureEntry)
    for (const root of rootsRaw) {
      const f = cap.folders.find(x => normalizePath(x.root) === normalizePath(root))
      store.folderReady(root, f?.repo ? "git" : "plain")
    }
    await changedInRepos(cap.folders, git, changed)
    await discoverSinceCapture(cap, rootsRaw, midnightMs, store, git, deps, changed)
    for (const raw of Object.keys(cap.index)) {
      try { if ((await fs.promises.stat(raw)).mtimeMs >= midnightMs) changed.add(raw) } catch { changed.add(raw) /* deleted since */ }
    }
  } catch {
    saved = false
    // Never fall back to stale recorded contents after a failed recovery.
    for (const top of reset.keys()) uncertainRoots.push(top)
    for (const root of rootsRaw) store.folderReady(root, "plain")
  }
  return { changed: [...changed], saved, gitMarks: marksOf(cap.folders), uncertainRoots }
}

// Rebuild only repositories whose operation marker changed. Existing capture
// entries in other repositories keep their exact original baseline. Affected
// clean files use current HEAD; affected dirty/untracked files use current disk.
// The ledger separately absorbs this transition without changing credited totals.
async function recaptureAfterGit(
  cap: Capture, roots: string[], reset: Map<string, (Repo & { scan: Scan | null }) | null>,
  git: Git | null, deps: DayDeps,
): Promise<Capture> {
  const writer = new CaptureWriter(deps.jsonPath, cap.day)
  const index: Record<string, CaptureEntry> = {}
  const budget = new Budget(deps.budgetMs ?? BUDGET_MS)
  const folders = cap.folders.map(f => ({ ...f, repo: f.repo ? { ...f.repo } : undefined }))
  const tops = [...new Set(folders.flatMap(f => f.repo ? [normalizePath(f.repo.top)] : []))].sort((a, b) => b.length - a.length)
  const owner = (raw: string) => tops.find(top => isUnder(raw, top))
  let count = 0
  const limit = deps.cap ?? CAPTURE_CAP
  try {
    for (const [raw, entry] of Object.entries(cap.index)) {
      if (reset.has(owner(raw) ?? "")) continue
      const hashes = Array.isArray(entry) ? readCaptured(path.dirname(deps.jsonPath), cap.bin, entry) : null
      index[raw] = Array.isArray(entry) ? (hashes ? writer.add(hashes) : "unknown") : entry
      count++
      await budget.tick()
    }
    for (const [top, repo] of reset) {
      const affected = folders.filter(f => f.repo && normalizePath(f.repo.top) === top)
      const head = repo && git ? (await git.run(repo.topRaw, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => Buffer.alloc(0))).toString("utf8").trim() || null : null
      if (repo) repo.baseline = head
      for (const f of affected) { f.repo!.baseline = head; f.partial = false }
      const visit = async (raw: string): Promise<boolean> => {
        if (owner(raw) !== top || !roots.some(r => isUnder(raw, r)) || !countable(raw) || Object.prototype.hasOwnProperty.call(index, raw)) return true
        if (count >= limit) { for (const f of affected) f.partial = true; return false }
        try {
          const st = await fs.promises.stat(raw)
          if (!st.isFile() || st.size > MAX_FILE_BYTES) return true
          index[raw] = writer.add(hashLines(await fs.promises.readFile(raw, "utf8")))
        } catch {
          // Missing now says nothing about its morning: a dirty tracked file
          // deleted while closed would get [] and a later restore would count
          // as the whole file added.
          index[raw] = "unknown"
        }
        count++
        await budget.tick()
        return true
      }
      if (repo?.scan) {
        for (const f of repo.scan.files) if (!(await visit(f.raw))) break
        for (const d of repo.scan.ignoredDirs) {
          for (const root of roots) {
            const from = isUnder(root, d) ? root : isUnder(d, root) || normalizePath(d) === normalizePath(root) ? d : null
            if (from && !isExcludedPath(path.join(from, "x"))) await walk(from, visit, budget)
          }
        }
      } else {
        for (const f of affected) await walk(f.root, visit, budget)
      }
      if (affected.some(f => f.partial)) deps.note(`line capture partial during Git recovery in ${top}: more than 20,000 files`)
    }
    return { ...cap, folders, bin: writer.name, index }
  } finally { writer.close() }
}

// The saved index cannot name files created later while VS Code was closed.
// Re-scan candidates without replacing any captured morning content. Only a
// previously uncaptured file whose creation time is today gets an empty base;
// otherwise leave it unknown rather than crediting old uncommitted content.
async function discoverSinceCapture(
  cap: Capture, roots: string[], midnightMs: number, store: MorningStore,
  git: Git | null, deps: DayDeps, changed: Set<string>,
): Promise<void> {
  const budget = new Budget(deps.budgetMs ?? BUDGET_MS)
  let remaining = Math.max(0, (deps.cap ?? CAPTURE_CAP) - Object.keys(cap.index).length)
  let noted = false
  const visit = async (raw: string): Promise<boolean> => {
    if (!countable(raw) || !roots.some(root => isUnder(raw, root))) return true
    // Captured already: the mtime pass in reload decides whether it changed.
    if (store.has(raw)) return true
    if (remaining === 0) {
      if (!noted) deps.note("line capture partial on reload: more than 20,000 files to capture")
      noted = true
      return false
    }
    try {
      const st = await fs.promises.stat(raw)
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return true
      const createdToday = st.birthtimeMs >= midnightMs && st.mtimeMs >= midnightMs
      store.put(raw, createdToday ? "empty" : "unknown")
      remaining--
      if (createdToday) changed.add(raw)
    } catch { /* missing/unreadable: no invented deletion */ }
    await budget.tick()
    return true
  }
  const seen = new Set<string>()
  for (const f of cap.folders) {
    if (f.repo && git) {
      const key = normalizePath(f.repo.top)
      if (seen.has(key)) continue
      seen.add(key)
      const status = await git.status(f.repo.top)
      for (const rel of [...status.untracked, ...status.ignored]) {
        const raw = path.join(f.repo.top, ...rel.replace(/\/$/, "").split("/"))
        if (rel.endsWith("/")) {
          // A nested repository has its own B and is handled through cap.folders.
          // Walking its clean tracked files here would misclassify them as new.
          if (fs.existsSync(path.join(raw, ".git"))) continue
          // A workspace may itself be inside a collapsed ignored directory.
          for (const root of roots) {
            const walkRoot = isUnder(root, raw) ? root : isUnder(raw, root) || normalizePath(root) === normalizePath(raw) ? raw : null
            if (walkRoot && !worktreeInfo(path.join(walkRoot, "x")) && !isExcludedPath(path.join(walkRoot, "x"))) await walk(walkRoot, visit, budget)
          }
        } else if (!(await visit(raw))) break
        await budget.tick()
      }
    } else {
      await walk(f.root, visit, budget)
    }
  }
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
    return !repo || !repo.reflog.some(e => e.time >= Math.floor(y.savedAt / 1000) * 1000 &&
      (e.time < midnightMs || !isAuthorship(e.action)))
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
        const entry: CaptureFolder = { root: n, repo: { top: inner.topRaw, baseline: inner.baseline, operation: inner.operation }, partial: false }
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
      if (repo) entry.repo = { top: repo.topRaw, baseline: repo.baseline, operation: repo.operation }
      store.folderReady(rootRaw, repo ? "git" : "plain") // git: clean files resolve through git from now on
      plan.push({ rootRaw, entry, repo, missing: false })
    }

    // Second pass: capture and hash.
    for (const { rootRaw, entry, repo, missing } of plan) {
      if (missing) continue
      if (repo) {
        await captureRepo(repo, rootRaw)
      } else {
        await walk(rootRaw, raw => consider(raw, false, null), budget)
      }
      entry.partial = full // once the cap is reached, every later folder is partial too
      if (entry.partial) deps.note(`line counts in ${rootRaw} start from each file's first edit: more than 20,000 files to capture`)
    }
    await changedInRepos(folders, git, changed)

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
    const saved = saveCapture(deps.jsonPath, { version: 1, day, bin: writer.name, folders, index: store.index() })
    if (!saved) deps.note("line capture could not be saved; yesterday's snapshot will be retained")
    // No reflog, no operation mark: a reset or checkout while closed is
    // unobservable, so restored ledger entries in these repos must recover.
    const uncertainRoots = folders.filter(f => f.repo && !f.repo.operation).map(f => f.repo!.top)
    return { changed: [...changed], saved, gitMarks: marksOf(folders), uncertainRoots }
  } catch (e) {
    for (const root of rootsRaw) store.folderReady(root, "plain") // before the note, which may itself throw
    // Nothing about any folder's Git history is known: every root (and every
    // repo found so far) is uncertain, so restored entries recover, not measure raw.
    const uncertainRoots = [...rootsRaw, ...folders.flatMap(f => f.repo ? [f.repo.top] : [])]
    try { deps.note(`line capture failed: ${message(e)}`) } catch { /* a reporter must not break tracking */ }
    return { changed: [...changed], saved: false, uncertainRoots }
  } finally {
    writer.close() // idempotent; also covers a throwing add() (ENOSPC) or note()
  }
}

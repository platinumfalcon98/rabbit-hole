import * as vscode from "vscode"
import { ActivitySession } from "../shared/types"
import { SESSION_EXPIRY_MS, getIdleThresholdMs } from "../shared/config"
import { StorageService, dateKey } from "./storageService"
import { detectProject, clearDetectionCache } from "./projectDetector"
import { LineHashes, LineLedger, hashLines } from "./lineLedger"
import { ledgerFile, loadLedger, pruneLedgers, saveLedger } from "./ledgerStore"
import {
  EXCLUDED_LANGUAGE_IDS, WorktreeInfo, isExcludedPath, isGitOpSignal, isGitPath, languageForFile, worktreeInfo,
} from "./pathRules"

// Language for a document open in an editor, or undefined if it should not be
// counted. The FileSystemWatcher path applies these same exclusions before
// recording; without this the editor path would silently credit time to
// generated files and to anything under node_modules/dist/out.
function trackableLanguage(doc: vscode.TextDocument): string | undefined {
  // Only documents backed by a real file on disk. VS Code opens virtual ones
  // for diff views, output panels, settings editors and untitled buffers, and
  // onDidChangeTextDocument fires for them exactly like any other document.
  //
  // The git extension's diff views are the case that made this necessary: they
  // use scheme "git" with a path of "<realfile>.git", so opening a diff
  // recorded churn against a file named "README.md.git" that has never existed.
  // Every such row also carried language "plaintext", which is what a
  // git-scheme document reports. The FileSystemWatcher path has always had this
  // check (see onWatcherEvent); the editor path never did.
  if (doc.uri.scheme !== "file") return undefined
  if (EXCLUDED_LANGUAGE_IDS.has(doc.languageId)) return undefined
  if (isExcludedPath(doc.uri.fsPath)) return undefined
  return doc.languageId
}

const MEASURE_DEBOUNCE_MS = 2_000      // let agents finish streaming writes; let typing pause
const GIT_OP_SUPPRESS_MS = 5_000       // ignore file churn around checkout/pull/merge
const EXTERNAL_MAX_FILE_BYTES = 5 * 1024 * 1024

function uuidSimple(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export class ActivityTracker {
  private currentSession: ActivitySession | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private checkpointInterval: ReturnType<typeof setInterval> | null = null

  // Active time tracking
  private activeTimeAccumulated = 0  // ms from completed active intervals
  private activeIntervalStart = 0    // start of current active interval
  private isPaused = false           // true when idle/blur has paused the session
  private isWindowFocused = false    // blur pauses once; without this, later background events would resume

  // Language time tracking
  private languageCurrent = ""
  private languageIntervalStart = 0

  private lastLanguage = ""

  // Line accounting (typing, agent edits, worktrees) — see lineLedger.ts
  private ledger = new LineLedger()
  private measureTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingCreates = new Set<string>()
  private worktreeCopies = new Map<string, Set<string>>() // main-checkout path → worktree paths seen
  private lastGitOpTime = 0
  private ledgerPath: string | undefined   // today's snapshots on disk (see restoreLedger)
  private ledgerSaved = -1                 // ledger.changes() at the last save

  // Project tracking
  private currentProjectId = ""
  private folderProjects = new Map<string, string>() // folder URI → projectId

  private readonly subscriptions: vscode.Disposable[] = []

  constructor(
    private context: vscode.ExtensionContext,
    private storage: StorageService
  ) {}

  get isActivelyTracking(): boolean {
    return this.currentSession !== null && !this.isPaused
  }

  start(): void {
    this.initProjects()
    this.storage.closeStaleSessions()
    // Before any priming or measuring: a restored morning photo must win over
    // the current content an open document would prime with.
    this.restoreLedger()

    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(e => this.onTextChange(e)),
      vscode.workspace.onDidOpenTextDocument(d => this.primeDocument(d)),
      vscode.window.onDidChangeWindowState(s => this.onWindowState(s)),
      vscode.window.onDidChangeActiveTextEditor(e => this.onEditorChange(e)),
      vscode.window.onDidChangeActiveTerminal(() => this.onActivity()),
      vscode.window.onDidChangeTextEditorVisibleRanges(() => this.onActivity()),
      vscode.workspace.onDidChangeWorkspaceFolders(e => this.onWorkspaceFoldersChange(e)),
    )
    this.initExternalWatcher()
    for (const d of vscode.workspace.textDocuments) this.primeDocument(d)
    this.context.subscriptions.push(
      ...this.subscriptions,
      { dispose: () => this.stop() }
    )

    // Checkpoint every 10s so storage stays fresh for status bar / dashboard.
    // The snapshot save sits outside saveCheckpoint, which skips paused
    // sessions — exactly when a background agent is editing files.
    this.checkpointInterval = setInterval(() => {
      this.persistLedger()
      this.saveCheckpoint()
    }, 10_000)

    this.isWindowFocused = vscode.window.state.focused
    if (vscode.window.state.focused) {
      this.startSession()
    }
  }

  stop(): void {
    if (this.checkpointInterval !== null) {
      clearInterval(this.checkpointInterval)
      this.checkpointInterval = null
    }
    for (const timer of this.measureTimers.values()) clearTimeout(timer)
    this.measureTimers.clear()
    this.persistLedger()
    this.endSession()
    for (const d of this.subscriptions) d.dispose()
  }

  private initProjects(): void {
    const folders = vscode.workspace.workspaceFolders ?? []
    for (const folder of folders) {
      const meta = detectProject(folder)
      this.storage.registerProject(meta)
      this.folderProjects.set(folder.uri.toString(), meta.id)
    }
    // Primary project is the first folder (or stays empty if no folders)
    const primary = folders[0]
    if (primary) {
      const meta = detectProject(primary)
      this.currentProjectId = meta.id
      this.storage.setCurrentProject(meta.id)
    }
  }

  private resolveProjectForUri(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri)
    if (folder) {
      const key = folder.uri.toString()
      if (this.folderProjects.has(key)) return this.folderProjects.get(key)!
      // New folder not yet registered (edge case)
      const meta = detectProject(folder)
      this.storage.registerProject(meta)
      this.folderProjects.set(key, meta.id)
      return meta.id
    }
    // File outside any workspace folder — fall back to current project
    return this.currentProjectId
  }

  private onWorkspaceFoldersChange(e: vscode.WorkspaceFoldersChangeEvent): void {
    for (const folder of e.added) {
      const meta = detectProject(folder)
      this.storage.registerProject(meta)
      this.folderProjects.set(folder.uri.toString(), meta.id)
    }
    // Removed folders: keep historical data, just clean the in-memory map
    for (const folder of e.removed) {
      this.folderProjects.delete(folder.uri.toString())
    }
    // Update primary project if the active editor's project is no longer valid
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor) {
      const pid = this.resolveProjectForUri(activeEditor.document.uri)
      if (pid !== this.currentProjectId) {
        this.endSession()
        this.currentProjectId = pid
        this.storage.setCurrentProject(pid)
      }
    }
  }

  private onActivity(): void {
    // Background agents writing files (and disk rewrites of open documents) fire
    // activity events while the window is blurred; counting them would accrue
    // active time for a minimised editor. File/line stats are recorded separately.
    if (!this.isWindowFocused) return
    this.clearIdleTimer()
    if (!this.currentSession) {
      this.startSession()
      return
    }
    if (this.isPaused) {
      // Resume from pause — clear expiry, restart active + language intervals
      this.clearExpiryTimer()
      const now = Date.now()
      this.activeIntervalStart = now
      this.languageIntervalStart = now
      this.isPaused = false
    }
    this.resetIdleTimer()
  }

  private onTextChange(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0) return
    this.onActivity()
    const language = trackableLanguage(e.document)
    // Typing still counts as activity (above), but generated and excluded files
    // contribute no language time and no file stats.
    if (!language) return
    this.lastLanguage = language
    // Measured from the document text after a pause, never from contentChanges:
    // VS Code reports a reload from disk as ONE replace spanning the first to the
    // last changed line, which scored a two-line agent edit as thousands.
    this.scheduleMeasure(e.document.uri, language)
  }

  // An opened document's content is its baseline, so its first edit is measurable.
  private primeDocument(doc: vscode.TextDocument): void {
    if (!trackableLanguage(doc)) return
    const path = doc.uri.fsPath
    if (this.pendingCreates.has(path)) return // a just-created file: let the create be counted
    this.ledger.prime(path, hashLines(doc.getText()), dateKey(new Date()))
  }

  private onWindowState(state: vscode.WindowState): void {
    // Must precede the dispatch below — onActivity() bails out on a stale false.
    this.isWindowFocused = state.focused
    if (!state.focused) {
      this.pauseSession()
    } else {
      this.onActivity()
    }
  }

  private onEditorChange(editor: vscode.TextEditor | undefined): void {
    if (editor) {
      // Empty when the document is excluded — flushLanguageTime treats that as
      // "credit nothing", so time on a generated file stays unattributed.
      const newLanguage = trackableLanguage(editor.document) ?? ""
      const newProjectId = this.resolveProjectForUri(editor.document.uri)

      if (newProjectId !== this.currentProjectId && this.currentProjectId !== "") {
        // Project changed — close current session, switch project, start fresh
        this.endSession()
        this.currentProjectId = newProjectId
        this.storage.setCurrentProject(newProjectId)
      } else if (newLanguage !== this.languageCurrent && this.currentSession && !this.isPaused) {
        this.flushLanguageTime(Date.now())
        this.languageCurrent = newLanguage
      }

      this.lastLanguage = newLanguage
      this.onActivity()
    }
  }

  private startSession(): void {
    if (this.currentSession) return
    if (!this.currentProjectId) return
    const now = Date.now()
    this.activeIntervalStart = now
    this.activeTimeAccumulated = 0
    this.isPaused = false
    const activeDoc = vscode.window.activeTextEditor?.document
    const activeLang = activeDoc ? (trackableLanguage(activeDoc) ?? "") : this.lastLanguage
    this.languageCurrent = activeLang
    this.lastLanguage = activeLang
    this.languageIntervalStart = now
    this.currentSession = {
      id: uuidSimple(),
      startTime: now,
      endTime: null,
      duration: 0,
      activeTime: 0,
    }
    this.resetIdleTimer()
  }

  // Pause: freeze active time accumulation, start expiry countdown.
  // Called by idle timer firing OR window blur.
  private pauseSession(): void {
    this.clearIdleTimer()
    if (!this.currentSession || this.isPaused) return
    this.splitAtMidnight()
    const now = Date.now()
    this.flushLanguageTime(now)
    this.activeTimeAccumulated += now - this.activeIntervalStart
    this.isPaused = true
    this.currentSession!.activeTime = this.activeTimeAccumulated
    this.storage.appendSession(this.currentSession!)
    // After the full expiry period, close the session entirely
    this.expiryTimer = setTimeout(() => this.expireSession(), SESSION_EXPIRY_MS)
  }

  // Expiry: session stayed idle for the full expiry duration — close it.
  // Next activity will open a fresh session.
  private expireSession(): void {
    if (!this.currentSession) return
    this.splitAtMidnight()
    const now = Date.now()
    const session = this.currentSession!
    session.endTime = now
    session.duration = now - session.startTime
    // activeTime already set: either flushed by pauseSession, or set by splitAtMidnight
    this.storage.appendSession(session)
    this.currentSession = null
    this.isPaused = false
    this.activeTimeAccumulated = 0
  }

  // End: explicitly close an active or paused session (extension deactivate or project switch).
  private endSession(): void {
    this.clearIdleTimer()
    this.clearExpiryTimer()
    if (!this.currentSession) return
    this.splitAtMidnight()
    const now = Date.now()
    const session = this.currentSession!
    session.endTime = now
    session.duration = now - session.startTime
    if (!this.isPaused) {
      this.flushLanguageTime(now)
      this.activeTimeAccumulated += now - this.activeIntervalStart
    }
    session.activeTime = this.activeTimeAccumulated
    this.storage.appendSession(session)
    this.currentSession = null
    this.isPaused = false
    this.activeTimeAccumulated = 0
  }

  // Drop the in-memory session WITHOUT writing it. Called when the user deletes
  // the data that session belongs to: endSession() would flush the very
  // activeTime they just cleared, and saveCheckpoint() re-creates today's log
  // from it within 10s — which is why clearing the currently-open project
  // appeared to clear past dates but not today. Already-written time is
  // untouched; this only ends the session, and the next activity opens a fresh one.
  discardCurrentSession(): void {
    this.clearIdleTimer()
    this.clearExpiryTimer()
    this.currentSession = null
    this.isPaused = false
    this.activeTimeAccumulated = 0
    this.activeIntervalStart = 0
    this.languageCurrent = ""
    this.languageIntervalStart = 0
  }

  // Write live activeTime + language time to storage so status bar / dashboard stays fresh.
  private saveCheckpoint(): void {
    if (!this.currentSession || this.isPaused) return
    this.splitAtMidnight()
    const now = Date.now()
    this.flushLanguageTime(now)
    this.currentSession!.activeTime = this.activeTimeAccumulated + (now - this.activeIntervalStart)
    this.storage.appendSession(this.currentSession!)
  }

  // If the current session started on a previous calendar day, close it at midnight
  // and open a fresh session for today.
  private splitAtMidnight(): void {
    if (!this.currentSession) return

    const now = Date.now()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const midnight = todayStart.getTime()

    const sessionDay = new Date(this.currentSession.startTime)
    sessionDay.setHours(0, 0, 0, 0)
    if (sessionDay.getTime() >= midnight) return

    const sd = new Date(this.currentSession.startTime)
    const sessionDateStr = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}-${String(sd.getDate()).padStart(2, "0")}`

    if (!this.isPaused && this.languageCurrent && this.languageIntervalStart < midnight) {
      const langMs = midnight - this.languageIntervalStart
      if (langMs > 0) {
        this.storage.updateLanguageTimeForDate(this.languageCurrent, langMs, sessionDateStr)
        this.creditSessionLanguage(this.languageCurrent, langMs)
      }
      this.languageIntervalStart = midnight
    }

    const activeBeforeMidnight = this.isPaused
      ? this.activeTimeAccumulated
      : this.activeTimeAccumulated + (this.activeIntervalStart < midnight
          ? midnight - this.activeIntervalStart
          : 0)

    this.storage.appendSessionToDate(
      {
        ...this.currentSession,
        endTime: midnight,
        duration: midnight - this.currentSession.startTime,
        activeTime: activeBeforeMidnight,
      },
      sessionDateStr
    )

    this.currentSession = {
      id: uuidSimple(),
      startTime: midnight,
      endTime: null,
      duration: 0,
      activeTime: 0,
    }
    this.activeTimeAccumulated = 0
    this.activeIntervalStart = Math.max(this.activeIntervalStart, midnight)
    if (!this.isPaused) {
      this.languageIntervalStart = Math.max(this.languageIntervalStart, midnight)
    }
  }

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

  // ── Line measurement ──────────────────────────────────────────────────────
  // Every content change — typing, an agent editing an open or unopened file,
  // a file appearing or disappearing — goes through one debounced measure(),
  // which diffs the file's current lines against its start-of-day content.
  // The watcher exists because onDidChangeTextDocument only fires for open
  // documents: agents (Claude Code, etc.) edit files without opening them.

  private initExternalWatcher(): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*")
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate(uri => this.onWatcherEvent(uri, true)),
      watcher.onDidChange(uri => this.onWatcherEvent(uri, false)),
      watcher.onDidDelete(uri => this.onWatcherEvent(uri, false)),
    )
  }

  private onWatcherEvent(uri: vscode.Uri, isCreate: boolean): void {
    if (uri.scheme !== "file") return
    if (isGitPath(uri.path)) {
      if (isGitOpSignal(uri.path)) this.lastGitOpTime = Date.now()
      return
    }
    if (isExcludedPath(uri.fsPath)) return
    const language = languageForFile(uri.path.slice(uri.path.lastIndexOf("/") + 1))
    if (!language) return
    if (isCreate) this.pendingCreates.add(uri.fsPath)
    this.scheduleMeasure(uri, language)
  }

  private scheduleMeasure(uri: vscode.Uri, language: string): void {
    const key = uri.fsPath
    const existing = this.measureTimers.get(key)
    if (existing) clearTimeout(existing)
    this.measureTimers.set(key, setTimeout(() => {
      this.measureTimers.delete(key)
      void this.measure(uri, language)
    }, MEASURE_DEBOUNCE_MS))
  }

  private async measure(uri: vscode.Uri, language: string): Promise<void> {
    const path = uri.fsPath
    const isCreate = this.pendingCreates.delete(path)
    const uriStr = uri.toString()
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uriStr && !d.isClosed)

    let hashes: LineHashes
    let fromDisk: boolean // false only for unsaved typing in an open buffer
    if (doc) {
      const docLanguage = trackableLanguage(doc)
      if (!docLanguage) return
      language = docLanguage
      // VS Code keeps a deleted file's tab open ("(deleted)") with its old
      // text; measuring that buffer would never record the deletion, and a temp
      // file an agent created, you opened, and the agent deleted kept its lines.
      hashes = (await this.exists(path)) ? hashLines(doc.getText()) : []
      fromDisk = !doc.isDirty
    } else {
      const text = await this.readText(uri)
      if (text === null) return                                // too large or unreadable: skip, never "delete"
      if (text === undefined && !this.ledger.has(path)) return // deleted, and never seen
      hashes = text === undefined ? [] : hashLines(text)
      fromDisk = true
    }

    const wt = worktreeInfo(path)
    if (wt) this.rememberWorktreeCopy(wt.mainPath, path)
    // A file appearing in a worktree starts as the main checkout's copy, so
    // `git worktree add` itself is not authorship.
    const seed = isCreate && wt ? await this.readHashes(wt.mainPath) : undefined
    const suppress = fromDisk && await this.isNonAuthored(path, hashes, wt)

    if (!doc && !suppress) this.onActivity()

    const delta = this.ledger.observe(path, hashes, { day: dateKey(new Date()), isCreate, seed, suppress })
    if (!delta) return
    this.storage.appendFileActivity(
      {
        path: wt?.mainPath ?? path, // worktree work is credited to the main-checkout file
        language,
        linesAdded: delta.added,
        linesDeleted: delta.deleted,
        lastModified: Date.now(),
      },
      this.resolveProjectForUri(uri)
    )
  }

  // A disk-originated change that nobody authored: a checkout/merge/rebase in
  // progress, a worktree being removed, or a worktree's work landing in the main
  // checkout (merge, cherry-pick, fast-forward) — already credited live.
  private async isNonAuthored(path: string, hashes: LineHashes, wt: WorktreeInfo | null): Promise<boolean> {
    if (Date.now() - this.lastGitOpTime < GIT_OP_SUPPRESS_MS + MEASURE_DEBOUNCE_MS) return true
    if (wt) return !(await this.exists(wt.gitFile))
    if (hashes.length === 0) return false
    for (const copy of this.worktreeCopies.get(path) ?? []) {
      // Only a copy that was actually worked on is evidence of a merge. After
      // `git worktree add` every untouched copy equals main's original content,
      // so matching it would mistake an ordinary revert (undo to clean, Discard
      // Changes, `git stash`) for a merge — and credit the redo twice.
      if (!this.ledger.wasEdited(copy)) continue
      const theirs = this.ledger.lastPresent(copy)
      if (theirs && theirs.length === hashes.length && theirs.every((x, i) => x === hashes[i])) return true
    }
    return false
  }

  private rememberWorktreeCopy(mainPath: string, worktreePath: string): void {
    let set = this.worktreeCopies.get(mainPath)
    if (!set) this.worktreeCopies.set(mainPath, (set = new Set()))
    set.add(worktreePath)
  }

  // Today's line snapshots survive a restart, so the first agent edit to each
  // unopened file after reopening VS Code is still measured. Only a snapshot
  // written today is used — comparing against an older one would credit days of
  // changes to today. Edits made today while VS Code was closed DO count: they
  // happened today.
  private restoreLedger(): void {
    const dir = this.context.globalStorageUri?.fsPath
    const folders = vscode.workspace.workspaceFolders ?? []
    if (!dir || folders.length === 0) return
    this.ledgerPath = ledgerFile(dir, folders.map(f => f.uri.toString()))
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    pruneLedgers(this.ledgerPath, midnight.getTime())
    this.ledger.restore(loadLedger(this.ledgerPath), dateKey(new Date()))
    this.ledgerSaved = this.ledger.changes()
  }

  private persistLedger(): void {
    if (!this.ledgerPath || this.ledger.changes() === this.ledgerSaved) return
    saveLedger(this.ledgerPath, this.ledger.export(dateKey(new Date())))
    this.ledgerSaved = this.ledger.changes()
  }

  // undefined = the file does not exist; null = exists but too large/unreadable.
  private async readText(uri: vscode.Uri): Promise<string | undefined | null> {
    let size: number
    try {
      size = (await vscode.workspace.fs.stat(uri)).size
    } catch {
      return undefined
    }
    if (size > EXTERNAL_MAX_FILE_BYTES) return null
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8")
    } catch {
      return null
    }
  }

  private async readHashes(fsPath: string): Promise<LineHashes | undefined> {
    const text = await this.readText(vscode.Uri.file(fsPath))
    return typeof text === "string" ? hashLines(text) : undefined
  }

  private async exists(fsPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
      return true
    } catch {
      return false
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => this.pauseSession(), getIdleThresholdMs())
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer)
      this.expiryTimer = null
    }
  }
}

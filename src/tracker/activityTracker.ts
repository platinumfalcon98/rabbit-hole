import * as vscode from "vscode"
import { ActivitySession, FileActivity } from "../shared/types"
import { StorageService } from "./storageService"
import { detectProject, clearDetectionCache } from "./projectDetector"

// Map file extensions to VS Code languageIds so external (agent/CLI) edits merge
// with stats recorded from open editors, which use document.languageId.
const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  kt: "kotlin", kts: "kotlin", c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  cs: "csharp", php: "php", swift: "swift", scala: "scala",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  ps1: "powershell", psm1: "powershell", bat: "bat",
  sql: "sql", html: "html", htm: "html", css: "css", scss: "scss", less: "less",
  vue: "vue", svelte: "svelte", json: "json", jsonc: "jsonc",
  md: "markdown", yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml",
  graphql: "graphql", gql: "graphql", dart: "dart", lua: "lua", r: "r",
  ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell",
  clj: "clojure", zig: "zig", tf: "terraform", ini: "ini",
  proto: "proto", astro: "astro", prisma: "prisma", sol: "solidity",
  cmake: "cmake", groovy: "groovy", gradle: "groovy", pl: "perl",
  m: "objective-c", mm: "objective-cpp", fs: "fsharp", nim: "nim",
  tex: "latex", env: "dotenv",
}

// Well-known files without a (meaningful) extension. Keys are lowercase.
const BASENAME_LANGUAGES: Record<string, string> = {
  dockerfile: "dockerfile", makefile: "makefile", gnumakefile: "makefile",
  rakefile: "ruby", gemfile: "ruby", vagrantfile: "ruby",
  jenkinsfile: "groovy", ".env": "dotenv",
}

function languageForFile(basename: string): string | undefined {
  const byName = BASENAME_LANGUAGES[basename.toLowerCase()]
  if (byName) return byName
  const ext = basename.includes(".") ? basename.slice(basename.lastIndexOf(".") + 1).toLowerCase() : ""
  return EXTENSION_LANGUAGES[ext]
}

// Directory segments whose contents never count as coding activity.
const EXCLUDED_SEGMENTS = new Set([
  ".git", "node_modules", "dist", "out", "build", "coverage", "vendor",
  "target", "bin", "obj", "__pycache__", ".venv", "venv",
  ".next", ".nuxt", ".idea", ".vscode", ".claude", "tmp",
])

// Generated files that churn in bulk without representing hand/agent-written code.
const EXCLUDED_BASENAMES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "composer.lock",
])

const EXTERNAL_DEBOUNCE_MS = 2_000     // let agents finish streaming writes to a file
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

  // Language time tracking
  private languageCurrent = ""
  private languageIntervalStart = 0

  private lastLanguage = ""
  private fileLastChange = new Map<string, number>()

  // External change tracking (agent/CLI edits to files not open in an editor)
  private externalDebounce = new Map<string, ReturnType<typeof setTimeout>>()
  private externalLineCounts = new Map<string, number>()
  private externalCreated = new Set<string>()
  private lastGitOpTime = 0

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

    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(e => this.onTextChange(e)),
      vscode.window.onDidChangeWindowState(s => this.onWindowState(s)),
      vscode.window.onDidChangeActiveTextEditor(e => this.onEditorChange(e)),
      vscode.window.onDidChangeActiveTerminal(() => this.onActivity()),
      vscode.window.onDidChangeTextEditorVisibleRanges(() => this.onActivity()),
      vscode.workspace.onDidChangeWorkspaceFolders(e => this.onWorkspaceFoldersChange(e)),
    )
    this.initExternalWatcher()
    this.context.subscriptions.push(
      ...this.subscriptions,
      { dispose: () => this.stop() }
    )

    // Checkpoint every 10s so storage stays fresh for status bar / dashboard
    this.checkpointInterval = setInterval(() => this.saveCheckpoint(), 10_000)

    if (vscode.window.state.focused) {
      this.startSession()
    }
  }

  stop(): void {
    if (this.checkpointInterval !== null) {
      clearInterval(this.checkpointInterval)
      this.checkpointInterval = null
    }
    for (const timer of this.externalDebounce.values()) clearTimeout(timer)
    this.externalDebounce.clear()
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

  private getIdleThresholdMs(): number {
    const config = vscode.workspace.getConfiguration("rabbithole")
    const minutes = config.get<number>("idleThresholdMinutes") ?? 5
    return minutes * 60 * 1000
  }

  private getSessionExpiryMs(): number {
    const config = vscode.workspace.getConfiguration("rabbithole")
    const minutes = config.get<number>("sessionExpiryMinutes") ?? 60
    return minutes * 60 * 1000
  }

  private onActivity(): void {
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

    const doc = e.document
    const filePath = doc.uri.fsPath
    const language = doc.languageId
    this.lastLanguage = language

    const now = Date.now()
    const prevChangeTime = this.fileLastChange.get(filePath) ?? now

    let linesAdded = 0
    let linesDeleted = 0
    let totalCharsChanged = 0
    let isMultiSite = false
    let isAtomic = false

    const timeMs = now - prevChangeTime

    if (e.contentChanges.length >= 3) isMultiSite = true
    if (timeMs < 50) isAtomic = true

    for (const change of e.contentChanges) {
      const addedLines = change.text.split("\n").length - 1
      const removedLines = change.range.end.line - change.range.start.line
      linesAdded += addedLines
      linesDeleted += removedLines
      totalCharsChanged += Math.abs(change.text.length - (change.rangeLength ?? 0))
    }

    const addedText = e.contentChanges.map(c => c.text).join("")
    const isSyntaxComplete = this.checkSyntaxComplete(addedText)
    const changeRatio = doc.lineCount > 0 ? (linesAdded + linesDeleted) / doc.lineCount : 0

    this.fileLastChange.set(filePath, now)

    const profile = {
      linesAdded, linesDeleted, fileCount: 1, totalCharsChanged, timeMs,
      changeRatio, isMultiSite, isAtomic, isSyntaxComplete, language, filePath,
    }

    if (linesAdded > 0 || linesDeleted > 0) {
      const fileActivity: FileActivity = {
        path: filePath, language, linesAdded, linesDeleted, lastModified: now,
      }
      this.storage.appendFileActivity(fileActivity)
    }
  }

  private onWindowState(state: vscode.WindowState): void {
    if (!state.focused) {
      this.pauseSession()
    } else {
      this.onActivity()
    }
  }

  private onEditorChange(editor: vscode.TextEditor | undefined): void {
    if (editor) {
      const newLanguage = editor.document.languageId
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
    const activeLang = vscode.window.activeTextEditor?.document.languageId ?? this.lastLanguage
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
    this.expiryTimer = setTimeout(() => this.expireSession(), this.getSessionExpiryMs())
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

  // Credit elapsed time to the current language and advance the interval start.
  private flushLanguageTime(now: number): void {
    if (!this.languageCurrent || this.languageIntervalStart === 0) return
    const elapsed = now - this.languageIntervalStart
    if (elapsed > 0) this.storage.updateLanguageTime(this.languageCurrent, elapsed)
    this.languageIntervalStart = now
  }

  // ── External change tracking ─────────────────────────────────────────────
  // Agents (Claude Code, etc.) and other CLI tools edit files without opening
  // them in an editor, so onDidChangeTextDocument never fires. Watch the
  // workspace directly and record those edits as file/line/language activity.

  private initExternalWatcher(): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*")
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate(uri => this.onExternalFileEvent(uri, true)),
      watcher.onDidChange(uri => this.onExternalFileEvent(uri, false)),
      watcher.onDidDelete(uri => this.onExternalFileDelete(uri)),
    )
  }

  private onExternalFileEvent(uri: vscode.Uri, isCreate: boolean): void {
    if (uri.scheme !== "file") return

    const segments = uri.path.split("/")
    const basename = segments[segments.length - 1]

    // .git internals: not activity, but refs directly under .git/ signal a
    // history-moving operation (checkout → HEAD, merge → MERGE_HEAD,
    // pull/rebase/reset → ORIG_HEAD) whose working-tree churn we must not
    // count. Deliberately NOT index/logs/refs: plain commits touch those, and
    // agents that auto-commit after every edit (Aider) would suppress their
    // own contributions. Note .git/logs/HEAD shares the HEAD basename, hence
    // the direct-child check.
    const gitIdx = segments.indexOf(".git")
    if (gitIdx >= 0) {
      if (gitIdx === segments.length - 2 &&
          (basename === "HEAD" || basename === "MERGE_HEAD" || basename === "ORIG_HEAD")) {
        this.lastGitOpTime = Date.now()
      }
      return
    }
    if (segments.some(s => EXCLUDED_SEGMENTS.has(s))) return
    if (EXCLUDED_BASENAMES.has(basename) || basename.includes(".min.")) return

    const language = languageForFile(basename)
    if (!language) return

    // Files open in an editor are already tracked via onDidChangeTextDocument
    const uriStr = uri.toString()
    if (vscode.workspace.textDocuments.some(d => d.uri.toString() === uriStr)) return

    if (isCreate) this.externalCreated.add(uri.fsPath)

    const existing = this.externalDebounce.get(uri.fsPath)
    if (existing) clearTimeout(existing)
    this.externalDebounce.set(uri.fsPath, setTimeout(() => {
      this.externalDebounce.delete(uri.fsPath)
      const wasCreated = this.externalCreated.delete(uri.fsPath)
      void this.processExternalChange(uri, language, wasCreated)
    }, EXTERNAL_DEBOUNCE_MS))
  }

  private async processExternalChange(uri: vscode.Uri, language: string, isCreate: boolean): Promise<void> {
    let lineCount: number
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.size > EXTERNAL_MAX_FILE_BYTES) return
      const bytes = await vscode.workspace.fs.readFile(uri)
      const text = Buffer.from(bytes).toString("utf8")
      lineCount = text.length === 0 ? 0 : text.split("\n").length
    } catch {
      return // deleted or unreadable between event and processing
    }

    const prev = this.externalLineCounts.get(uri.fsPath)
    this.externalLineCounts.set(uri.fsPath, lineCount)

    // Around a git operation, keep the baseline fresh but record nothing —
    // a branch switch is not coding activity.
    if (Date.now() - this.lastGitOpTime < GIT_OP_SUPPRESS_MS + EXTERNAL_DEBOUNCE_MS) return

    // First sighting of an existing file: no baseline, so no line delta —
    // record the touch with zero lines; subsequent edits diff properly.
    const delta = prev === undefined ? (isCreate ? lineCount : 0) : lineCount - prev

    this.onActivity()
    this.storage.appendFileActivity(
      {
        path: uri.fsPath,
        language,
        linesAdded: Math.max(0, delta),
        linesDeleted: Math.max(0, -delta),
        lastModified: Date.now(),
      },
      this.resolveProjectForUri(uri)
    )
  }

  private onExternalFileDelete(uri: vscode.Uri): void {
    const pending = this.externalDebounce.get(uri.fsPath)
    if (pending) {
      clearTimeout(pending)
      this.externalDebounce.delete(uri.fsPath)
    }
    this.externalCreated.delete(uri.fsPath)
    const prev = this.externalLineCounts.get(uri.fsPath)
    this.externalLineCounts.delete(uri.fsPath)
    if (prev === undefined || prev === 0) return
    if (Date.now() - this.lastGitOpTime < GIT_OP_SUPPRESS_MS) return

    const segments = uri.path.split("/")
    const basename = segments[segments.length - 1]
    const language = languageForFile(basename)
    if (!language) return

    this.onActivity()
    this.storage.appendFileActivity(
      { path: uri.fsPath, language, linesAdded: 0, linesDeleted: prev, lastModified: Date.now() },
      this.resolveProjectForUri(uri)
    )
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => this.pauseSession(), this.getIdleThresholdMs())
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

  private checkSyntaxComplete(text: string): boolean {
    if (text.length === 0) return false
    let braces = 0, brackets = 0, parens = 0
    for (const ch of text) {
      if (ch === "{") braces++
      else if (ch === "}") braces--
      else if (ch === "[") brackets++
      else if (ch === "]") brackets--
      else if (ch === "(") parens++
      else if (ch === ")") parens--
    }
    return braces === 0 && brackets === 0 && parens === 0 && text.trim().length > 0
  }
}

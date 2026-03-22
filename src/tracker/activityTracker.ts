import * as vscode from "vscode"
import { ActivitySession, FileActivity } from "../shared/types"
import { StorageService } from "./storageService"
import { AgentDetector } from "./agentDetector"

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

  private lastLanguage = ""
  private fileLineCounts = new Map<string, number>()
  private fileLastChange = new Map<string, number>()

  private readonly subscriptions: vscode.Disposable[] = []

  constructor(
    private context: vscode.ExtensionContext,
    private storage: StorageService,
    private detector: AgentDetector
  ) {}

  start(): void {
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(e => this.onTextChange(e)),
      vscode.window.onDidChangeWindowState(s => this.onWindowState(s)),
      vscode.window.onDidChangeActiveTextEditor(e => this.onEditorChange(e)),
      vscode.window.onDidChangeActiveTerminal(() => this.onActivity()),
      vscode.window.onDidChangeTextEditorVisibleRanges(() => this.onActivity()),
    )
    this.context.subscriptions.push(
      ...this.subscriptions,
      { dispose: () => this.stop() }
    )
    // Checkpoint every 30s so storage stays fresh for status bar / dashboard
    this.checkpointInterval = setInterval(() => this.saveCheckpoint(), 30_000)

    if (vscode.window.state.focused) {
      this.startSession()
    }
  }

  stop(): void {
    if (this.checkpointInterval !== null) {
      clearInterval(this.checkpointInterval)
      this.checkpointInterval = null
    }
    this.endSession()
    for (const d of this.subscriptions) d.dispose()
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
      // Resume from pause — clear expiry, restart active interval
      this.clearExpiryTimer()
      this.activeIntervalStart = Date.now()
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
    const prevLineCount = this.fileLineCounts.get(filePath) ?? doc.lineCount
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

    this.fileLineCounts.set(filePath, doc.lineCount)
    this.fileLastChange.set(filePath, now)

    const profile = {
      linesAdded, linesDeleted, fileCount: 1, totalCharsChanged, timeMs,
      changeRatio, isMultiSite, isAtomic, isSyntaxComplete, language, filePath,
    }

    const agentEvent = this.detector.detect(profile)
    if (agentEvent) this.storage.appendAgentEvent(agentEvent)

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
      this.lastLanguage = editor.document.languageId
      this.onActivity()
    }
  }

  private startSession(): void {
    if (this.currentSession) return
    const now = Date.now()
    this.activeIntervalStart = now
    this.activeTimeAccumulated = 0
    this.isPaused = false
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
    const now = Date.now()
    this.activeTimeAccumulated += now - this.activeIntervalStart
    this.isPaused = true
    // Persist snapshot so storage stays consistent
    this.currentSession.activeTime = this.activeTimeAccumulated
    this.storage.appendSession(this.currentSession)
    // After the full expiry period, close the session entirely
    this.expiryTimer = setTimeout(() => this.expireSession(), this.getSessionExpiryMs())
  }

  // Expiry: session stayed idle for the full expiry duration — close it.
  // Next activity will open a fresh session.
  private expireSession(): void {
    if (!this.currentSession) return
    const now = Date.now()
    const session = this.currentSession
    session.endTime = now
    session.duration = now - session.startTime
    // activeTime already flushed in pauseSession
    this.storage.appendSession(session)
    this.currentSession = null
    this.isPaused = false
    this.activeTimeAccumulated = 0
  }

  // End: explicitly close an active or paused session (extension deactivate).
  private endSession(): void {
    this.clearIdleTimer()
    this.clearExpiryTimer()
    if (!this.currentSession) return
    const now = Date.now()
    const session = this.currentSession
    session.endTime = now
    session.duration = now - session.startTime
    if (!this.isPaused) {
      this.activeTimeAccumulated += now - this.activeIntervalStart
    }
    session.activeTime = this.activeTimeAccumulated
    this.storage.appendSession(session)
    this.currentSession = null
    this.isPaused = false
    this.activeTimeAccumulated = 0
  }

  // Write live activeTime to storage so the status bar / dashboard sees fresh data.
  private saveCheckpoint(): void {
    if (!this.currentSession || this.isPaused) return
    const now = Date.now()
    this.currentSession.activeTime = this.activeTimeAccumulated + (now - this.activeIntervalStart)
    this.storage.appendSession(this.currentSession)
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

import * as vscode from "vscode"
import { ActivitySession, FileActivity } from "../shared/types"
import { StorageService } from "./storageService"
import { AgentDetector } from "./agentDetector"

function uuidSimple(): string {
  // UUID v4-like without external dependency
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export class ActivityTracker {
  private currentSession: ActivitySession | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private sessionStartTime = 0
  private lastActiveTime = 0
  private lastLanguage = ""

  // Per-file last-seen line counts for delta computation
  private fileLineCounts = new Map<string, number>()
  // Per-file last-change timestamp
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
      vscode.window.onDidChangeActiveTerminal(() => this.onActivity())
    )
    // Register disposables with extension context
    this.context.subscriptions.push(
      ...this.subscriptions,
      { dispose: () => this.stop() }
    )
    // Start initial session if window is focused
    if (vscode.window.state.focused) {
      this.startSession()
    }
  }

  stop(): void {
    this.pauseSession(false)
    for (const d of this.subscriptions) d.dispose()
  }

  private getIdleThresholdMs(): number {
    const config = vscode.workspace.getConfiguration("rabbithole")
    const minutes = config.get<number>("idleThresholdMinutes") ?? 5
    return minutes * 60 * 1000
  }

  private onActivity(): void {
    this.clearIdleTimer()
    if (!this.currentSession) {
      this.startSession()
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

    if (e.contentChanges.length >= 3) {
      isMultiSite = true
    }
    if (timeMs < 50) {
      isAtomic = true
    }

    for (const change of e.contentChanges) {
      const addedLines = change.text.split("\n").length - 1
      const removedLines = change.range.end.line - change.range.start.line
      linesAdded += addedLines
      linesDeleted += removedLines
      totalCharsChanged += Math.abs(change.text.length - (change.rangeLength ?? 0))
    }

    // isSyntaxComplete: heuristic — added text contains balanced braces/brackets
    const addedText = e.contentChanges.map(c => c.text).join("")
    const isSyntaxComplete = this.checkSyntaxComplete(addedText)

    const changeRatio = doc.lineCount > 0
      ? (linesAdded + linesDeleted) / doc.lineCount
      : 0

    this.fileLineCounts.set(filePath, doc.lineCount)
    this.fileLastChange.set(filePath, now)

    const profile = {
      linesAdded,
      linesDeleted,
      fileCount: 1,
      totalCharsChanged,
      timeMs,
      changeRatio,
      isMultiSite,
      isAtomic,
      isSyntaxComplete,
      language,
      filePath,
    }

    const agentEvent = this.detector.detect(profile)
    if (agentEvent) {
      this.storage.appendAgentEvent(agentEvent)
    }

    if (linesAdded > 0 || linesDeleted > 0) {
      const fileActivity: FileActivity = {
        path: filePath,
        language,
        linesAdded,
        linesDeleted,
        lastModified: now,
      }
      this.storage.appendFileActivity(fileActivity)
    }
  }

  private onWindowState(state: vscode.WindowState): void {
    if (!state.focused) {
      this.pauseSession(false)
    } else {
      this.startSession()
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
    this.sessionStartTime = now
    this.lastActiveTime = now
    this.currentSession = {
      id: uuidSimple(),
      startTime: now,
      endTime: null,
      duration: 0,
      idle: false,
    }
    this.resetIdleTimer()
  }

  private pauseSession(idle: boolean): void {
    this.clearIdleTimer()
    if (!this.currentSession) return
    const now = Date.now()
    const session = this.currentSession
    session.endTime = now
    session.duration = now - session.startTime
    session.idle = idle
    this.storage.appendSession(session)
    this.currentSession = null
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.pauseSession(true)
    }, this.getIdleThresholdMs())
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private checkSyntaxComplete(text: string): boolean {
    if (text.length === 0) return false
    let braces = 0
    let brackets = 0
    let parens = 0
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

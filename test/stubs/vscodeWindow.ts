// Fuller `vscode` stub — enough surface for ActivityTracker.start(), plus __
// hooks so a suite can drive real editor and file-watcher events.
//
// The capture-model suite needs this rather than the plain config stub because
// it exercises the external-edit path end to end: watcher event → debounce →
// workspace.fs.readFile → line-bag diff → appendFileActivity.

type Listener = (arg: any) => void

const listeners: Record<string, Listener[]> = {
  textChange: [], windowState: [], activeEditor: [], activeTerminal: [],
  visibleRanges: [], workspaceFolders: [], openDoc: [],
}

// Disposing unregisters, so a stopped tracker stops hearing events — the persist
// suite runs a second tracker after the first one stops, like a restart.
function register(bucket: Listener[]) {
  return (fn: Listener) => {
    bucket.push(fn)
    return { dispose() { const i = bucket.indexOf(fn); if (i >= 0) bucket.splice(i, 1) } }
  }
}

// Files the stubbed workspace.fs will serve, keyed by fsPath
const fileContents = new Map<string, string>()

const watcherHandlers: Record<string, Listener[]> = { create: [], change: [], delete: [] }

function makeUri(fsPath: string) {
  const posix = fsPath.replace(/\\/g, "/")
  const withRoot = posix.startsWith("/") ? posix : "/" + posix
  return {
    scheme: "file",
    path: withRoot,
    fsPath,
    toString: () => "file://" + withRoot,
  }
}

const folder = { uri: makeUri("/repo"), name: "repo", index: 0 }

// Long idle threshold so the timer never fires mid-test.
const config: Record<string, unknown> = {
  idleThresholdMinutes: 60,
  dailyTargetMinutes: 0,
}

export const Uri = { file: makeUri }

export const window = {
  state: { focused: true },
  activeTextEditor: undefined as unknown,
  onDidChangeWindowState: register(listeners.windowState),
  onDidChangeActiveTextEditor: register(listeners.activeEditor),
  onDidChangeActiveTerminal: register(listeners.activeTerminal),
  onDidChangeTextEditorVisibleRanges: register(listeners.visibleRanges),
}

export const workspace = {
  workspaceFolders: [folder],
  textDocuments: [] as unknown[],
  getWorkspaceFolder: () => folder,
  getConfiguration: () => ({ get: (key: string) => config[key] }),
  onDidChangeTextDocument: register(listeners.textChange),
  onDidOpenTextDocument: register(listeners.openDoc),
  onDidChangeWorkspaceFolders: register(listeners.workspaceFolders),
  createFileSystemWatcher: () => ({
    onDidCreate: register(watcherHandlers.create),
    onDidChange: register(watcherHandlers.change),
    onDidDelete: register(watcherHandlers.delete),
    dispose() {},
  }),
  fs: {
    stat: async (uri: { fsPath: string }) => {
      const c = fileContents.get(uri.fsPath)
      if (c === undefined) throw new Error("ENOENT")
      return { size: Buffer.byteLength(c, "utf8") }
    },
    readFile: async (uri: { fsPath: string }) => {
      const c = fileContents.get(uri.fsPath)
      if (c === undefined) throw new Error("ENOENT")
      return Buffer.from(c, "utf8")
    },
  },
}

// ── harness controls ────────────────────────────────────────────────────────

export function __setFocused(focused: boolean): void {
  window.state.focused = focused
  for (const fn of listeners.windowState) fn({ focused })
}

export function __writeFile(fsPath: string, content: string): void {
  fileContents.set(fsPath, content)
}

export function __fireCreate(fsPath: string): void {
  for (const fn of watcherHandlers.create) fn(makeUri(fsPath))
}

export function __fireChange(fsPath: string): void {
  for (const fn of watcherHandlers.change) fn(makeUri(fsPath))
}

export function __fireDelete(fsPath: string): void {
  fileContents.delete(fsPath)
  for (const fn of watcherHandlers.delete) fn(makeUri(fsPath))
}

// An open editor document. `isDirty` false means the buffer matches disk — what
// VS Code reports after it reloads a file an agent or git rewrote.
export function __openDoc(fsPath: string, content: string, languageId = "typescript") {
  const doc = {
    uri: makeUri(fsPath),
    languageId,
    isDirty: false,
    isClosed: false,
    text: content,
    getText() { return this.text },
  }
  ;(workspace.textDocuments as any[]).push(doc)
  fileContents.set(fsPath, content)
  for (const fn of listeners.openDoc) fn(doc)
  return doc
}

// Change an open document. dirty=false simulates a reload from disk (the file
// on disk is updated too); dirty=true simulates typing.
//
// The event carries ONE change spanning the first to the last differing line —
// exactly what VS Code's ModelService._computeEdits emits for a reload. That is
// the shape that made the old contentChanges arithmetic score a two-line edit
// as the whole span, so the negative control has to see it too.
export function __editDoc(doc: any, content: string, dirty: boolean): void {
  const before = doc.text.split("\n")
  const after = content.split("\n")
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
         before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  let changes: any[] = [{
    range: { start: { line: prefix, character: 0 }, end: { line: before.length - suffix, character: 0 } },
    rangeLength: 0,
    text: after.slice(prefix, after.length - suffix).map((l: string) => l + "\n").join(""),
  }]
  // Typing that keeps the line count arrives as in-line edits with no newline —
  // the shape the old arithmetic scored as 0/0.
  if (dirty && before.length === after.length) {
    changes = []
    for (let i = 0; i < after.length; i++) {
      if (before[i] === after[i]) continue
      changes.push({
        range: { start: { line: i, character: 0 }, end: { line: i, character: before[i].length } },
        rangeLength: before[i].length,
        text: after[i],
      })
    }
  }
  doc.text = content
  doc.isDirty = dirty
  if (!dirty) fileContents.set(doc.uri.fsPath, content)
  for (const fn of listeners.textChange) fn({ document: doc, contentChanges: changes })
}

// Fuller `vscode` stub — enough surface for ActivityTracker.start(), plus __
// hooks so a suite can drive real editor and file-watcher events.
//
// The capture-model suite needs this rather than the plain config stub because
// it exercises the external-edit path end to end: watcher event → debounce →
// workspace.fs.readFile → line-bag diff → appendFileActivity.

type Listener = (arg: any) => void

const listeners: Record<string, Listener[]> = {
  textChange: [], windowState: [], activeEditor: [], activeTerminal: [],
  visibleRanges: [], workspaceFolders: [],
}

function register(bucket: Listener[]) {
  return (fn: Listener) => { bucket.push(fn); return { dispose() {} } }
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
  onDidChangeWorkspaceFolders: register(listeners.workspaceFolders),
  createFileSystemWatcher: () => ({
    onDidCreate: (fn: Listener) => { watcherHandlers.create.push(fn); return { dispose() {} } },
    onDidChange: (fn: Listener) => { watcherHandlers.change.push(fn); return { dispose() {} } },
    onDidDelete: (fn: Listener) => { watcherHandlers.delete.push(fn); return { dispose() {} } },
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

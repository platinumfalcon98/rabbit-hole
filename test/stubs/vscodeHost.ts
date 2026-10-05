// `vscode` stub for the message-handler suite: records what the handler shows
// the user, what it offers to save and what it writes; keeps configuration
// writes in memory, and nothing else.

export const calls = {
  info: [] as string[],
  error: [] as string[],
  saveDialogs: 0,
  saveOptions: [] as any[],
  writes: [] as { path: string; bytes: Uint8Array }[],
}
const config: Record<string, unknown> = {}
let saveTo: string | undefined

export const window = {
  showInformationMessage: async (text: string) => { calls.info.push(text); return undefined },
  showErrorMessage: async (text: string) => { calls.error.push(text); return undefined },
  showWarningMessage: async () => undefined,
  showSaveDialog: async (options: unknown) => {
    calls.saveDialogs++
    calls.saveOptions.push(options)
    return saveTo === undefined ? undefined : { fsPath: saveTo }
  },
  showQuickPick: async () => undefined,
  showOpenDialog: async () => undefined,
}

export const workspace = {
  workspaceFolders: undefined as unknown,
  getConfiguration: () => ({
    get: (key: string) => config[key],
    update: async (key: string, value: unknown) => { config[key] = value },
  }),
  fs: { writeFile: async (uri: { fsPath: string }, bytes: Uint8Array) => { calls.writes.push({ path: uri.fsPath, bytes }) } },
}

export const ConfigurationTarget = { Global: 1 }
export const commands = { executeCommand: async () => undefined }
export const Uri = {
  file: (p: string) => ({ fsPath: p }),
  joinPath: (...parts: unknown[]) => ({ fsPath: parts.slice(1).join("/") }),
}
export const ViewColumn = { One: 1 }

// Where the next save dialog "saves"; undefined is the user pressing cancel.
export function __saveTo(path: string | undefined): void {
  saveTo = path
}

export function __reset(): void {
  calls.info.length = 0
  calls.error.length = 0
  calls.saveDialogs = 0
  calls.saveOptions.length = 0
  calls.writes.length = 0
  saveTo = undefined
}

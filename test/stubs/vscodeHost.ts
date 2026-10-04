// `vscode` stub for the message-handler suite: records what the handler shows
// the user, keeps configuration writes in memory, and nothing else.

export const calls = { info: [] as string[], error: [] as string[], saveDialogs: 0 }
const config: Record<string, unknown> = {}

export const window = {
  showInformationMessage: async (text: string) => { calls.info.push(text); return undefined },
  showErrorMessage: async (text: string) => { calls.error.push(text); return undefined },
  showWarningMessage: async () => undefined,
  showSaveDialog: async () => { calls.saveDialogs++; return undefined },
  showQuickPick: async () => undefined,
  showOpenDialog: async () => undefined,
}

export const workspace = {
  workspaceFolders: undefined as unknown,
  getConfiguration: () => ({
    get: (key: string) => config[key],
    update: async (key: string, value: unknown) => { config[key] = value },
  }),
  fs: { writeFile: async () => undefined },
}

export const ConfigurationTarget = { Global: 1 }
export const commands = { executeCommand: async () => undefined }
export const Uri = {
  file: (p: string) => ({ fsPath: p }),
  joinPath: (...parts: unknown[]) => ({ fsPath: parts.slice(1).join("/") }),
}
export const ViewColumn = { One: 1 }

export function __reset(): void {
  calls.info.length = 0
  calls.error.length = 0
  calls.saveDialogs = 0
}

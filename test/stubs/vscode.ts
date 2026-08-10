// Minimal `vscode` stub for the storageService / config suites: a settable
// configuration and nothing else. Everything that matters (globalState) is
// injected through the ExtensionContext the tests build themselves.

const configValues: Record<string, unknown> = {}

export const workspace = {
  getConfiguration: () => ({
    get: (key: string) => configValues[key],
  }),
}

export const ConfigurationTarget = { Global: 1 }

export function __setConfig(key: string, value: unknown): void {
  if (value === undefined) delete configValues[key]
  else configValues[key] = value
}

export function __resetConfig(): void {
  for (const key of Object.keys(configValues)) delete configValues[key]
}

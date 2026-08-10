import * as fs from "fs"
import * as os from "os"
import * as path from "path"
// @ts-ignore — esbuild alias to src/tracker/storageService.ts
import { StorageService, dateKey, PROJECTS_KEY } from "storage"

export const MIN = 60_000
export const today: string = dateKey(new Date())

export function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return dateKey(d)
}

// Real directory on disk: backupToDisk() genuinely writes files, and several
// tests read them back to prove a backup was taken before a destructive write.
export const STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-test-"))

export function cleanupStorageRoot(): void {
  fs.rmSync(STORAGE_ROOT, { recursive: true, force: true })
}

export function proj(id: string, streak = 3): Record<string, unknown> {
  return {
    id,
    name: id,
    path: `/${id}`,
    detectionMethod: "folder-hash",
    streak,
    dailyTargetMinutes: 45,
  }
}

export function log(activeTime: number, date: string = today): Record<string, unknown> {
  return {
    date,
    activeTime,
    streak: 2,
    totalTime: activeTime,
    languages: {},
    agents: {},
    files: [],
    sessions: [],
  }
}

export interface TestStore {
  s: any
  store: Map<string, unknown>
}

// Map-backed globalState, matching the Memento contract the service relies on:
// update(k, undefined) deletes, keys() lists everything.
export function makeStore(
  entries: Record<string, unknown>,
  currentProjectId = "alpha"
): TestStore {
  const store = new Map<string, unknown>(Object.entries(entries))
  const ctx: any = {
    globalStorageUri: { fsPath: STORAGE_ROOT },
    globalState: {
      get: (k: string) => store.get(k),
      update: (k: string, val: unknown) => {
        if (val === undefined) store.delete(k)
        else store.set(k, val)
        return Promise.resolve()
      },
      keys: () => [...store.keys()],
    },
  }
  const s = new StorageService(ctx)
  if (currentProjectId) s.setCurrentProject(currentProjectId)
  return { s, store }
}

// Two projects on one machine, 30m + 20m today, with the global day and the
// one-shot UI flags present — the shape most storage scenarios start from.
export function populated(): Record<string, unknown> {
  return {
    [PROJECTS_KEY]: [proj("alpha"), proj("beta")],
    [`rabbithole:log:alpha:${today}`]: log(30 * MIN),
    [`rabbithole:log:beta:${today}`]: log(20 * MIN),
    [`rabbithole:global:${today}`]: { date: today, activeTime: 50 * MIN, streak: 7 },
    "rabbithole:targetPrompted": true,
    "rabbithole:targetDefaultMigrated": true,
  }
}

export { PROJECTS_KEY, dateKey, StorageService }

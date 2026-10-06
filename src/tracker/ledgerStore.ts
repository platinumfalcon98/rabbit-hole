// On-disk home for today's line snapshots (see LineLedger.export). Pure node —
// no vscode import — so it is tested directly.
//
// One file per workspace, because every VS Code window runs its own tracker
// and they all share globalStorage: a single shared file would be clobbered by
// whichever window saved last.

import * as fs from "fs"
import * as path from "path"
import { hashLine, type LineHashes } from "./lineLedger"

export function ledgerFile(storageDir: string, workspaceFolders: string[]): string {
  const key = hashLine([...workspaceFolders].sort().join("|")).toString(16)
  return path.join(storageDir, "ledger", `today-${key}.json`)
}

// Snapshot persistence is best-effort: a failed read or write costs at most the
// first edit per file after a restart, and must never break tracking.

export function loadLedger(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

// Synchronous so it also works from deactivate(), and written to a temp file
// then renamed so a crash mid-write never leaves a truncated snapshot.
export function saveLedger(file: string, snapshot: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(snapshot))
    fs.renameSync(tmp, file)
  } catch {
    // best-effort
  }
}

// Today's snapshots only matter on the day they were written; yesterday's only
// until the next capture folds it in.
export function pruneLedgers(file: string, since: number): void {
  const dir = path.dirname(file)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const today = /^today-[0-9a-f]+\.json(\.tmp)?$/.test(name)
    const yday = /^yesterday-[0-9a-f]+\.json$/.test(name)
    if (!today && !yday) continue
    const p = path.join(dir, name)
    try {
      if (fs.statSync(p).mtimeMs < (today ? since : since - 86_400_000)) fs.unlinkSync(p)
    } catch {
      // best-effort
    }
  }
}

// Yesterday's snapshot holds the last content the tracker saw for every file it
// measured yesterday. The morning capture uses it for files changed overnight,
// where the baseline commit would credit yesterday's uncommitted work to today.
export function yesterdayFile(file: string): string {
  return path.join(path.dirname(file), path.basename(file).replace(/^today-/, "yesterday-"))
}

// At start-up, before pruning: a snapshot last written yesterday is kept aside.
export function keepYesterday(file: string, yesterdayKey: string): void {
  const raw = loadLedger(file) as { day?: unknown } | undefined
  if (!raw || raw.day !== yesterdayKey) return
  try { fs.renameSync(file, yesterdayFile(file)) } catch { /* best-effort */ }
}

export interface Yesterday { savedAt: number; files: Map<string, LineHashes> }

export function loadYesterday(file: string, yesterdayKey: string): Yesterday | null {
  const raw = loadLedger(file) as { version?: unknown; day?: unknown; files?: unknown } | undefined
  if (!raw || raw.version !== 1 || raw.day !== yesterdayKey || typeof raw.files !== "object" || raw.files === null) return null
  let savedAt: number
  try { savedAt = fs.statSync(file).mtimeMs } catch { return null }
  const files = new Map<string, LineHashes>()
  for (const [p, v] of Object.entries(raw.files as Record<string, unknown>)) {
    const last = (v as { last?: unknown } | null)?.last
    if (Array.isArray(last) && last.every(x => Number.isInteger(x))) files.set(p, last as LineHashes)
  }
  return { savedAt, files }
}

export function dropYesterday(file: string): void {
  try { fs.unlinkSync(file) } catch { /* gone */ }
}

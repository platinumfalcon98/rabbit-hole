// On-disk home for today's line snapshots (see LineLedger.export). Pure node —
// no vscode import — so it is tested directly.
//
// One file per workspace, because every VS Code window runs its own tracker
// and they all share globalStorage: a single shared file would be clobbered by
// whichever window saved last.

import * as fs from "fs"
import * as path from "path"
import { hashLine } from "./lineLedger"

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

// Snapshots only ever matter on the day they were written, so any not written
// since `since` (local midnight) is dead weight — including those of
// workspaces that may never be opened again.
export function pruneLedgers(file: string, since: number): void {
  const dir = path.dirname(file)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (!/^today-[0-9a-f]+\.json(\.tmp)?$/.test(name)) continue
    const p = path.join(dir, name)
    try {
      if (fs.statSync(p).mtimeMs < since) fs.unlinkSync(p)
    } catch {
      // best-effort
    }
  }
}

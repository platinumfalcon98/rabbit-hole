// On-disk home of the day-start capture (morning store, spec section 2).
// Pure node — no vscode import. The .json holds the index (raw path → entry)
// and names the .bin, which holds every captured file's line hashes as packed
// little-endian uint32. The bin is written first under a name unique to the
// capture and the json last, so a crash between them leaves the previous
// consistent pair (or none), never a json pointing into the wrong bin.

import * as fs from "fs"
import * as path from "path"
import { LineHashes, hashLine } from "./lineLedger"

export type CaptureEntry = [number, number] | "empty" | "useB" | "unknown"
export interface CaptureFolder { root: string; repo?: { top: string; baseline: string | null }; partial: boolean }
export interface Capture { version: 1; day: string; bin: string; folders: CaptureFolder[]; index: Record<string, CaptureEntry> }
export type Loaded = { kind: "today"; capture: Capture } | { kind: "stale"; paths: string[] } | { kind: "none" }

export function captureFile(storageDir: string, workspaceFolders: string[]): string {
  const key = hashLine([...workspaceFolders].sort().join("|")).toString(16)
  return path.join(storageDir, "ledger", `morning-${key}.json`)
}

const stem = (jsonPath: string) => path.basename(jsonPath, ".json")

export class CaptureWriter {
  readonly name: string
  private fd: number
  private lines = 0

  constructor(jsonPath: string, day: string) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    this.name = `${stem(jsonPath)}-${day}-${Math.random().toString(36).slice(2, 10)}.bin`
    this.fd = fs.openSync(path.join(path.dirname(jsonPath), this.name), "w")
  }

  add(hashes: LineHashes): [number, number] {
    const buf = Buffer.alloc(hashes.length * 4)
    for (let i = 0; i < hashes.length; i++) buf.writeUInt32LE(hashes[i] >>> 0, i * 4)
    if (buf.length > 0) fs.writeSync(this.fd, buf, 0, buf.length, this.lines * 4)
    const entry: [number, number] = [this.lines, hashes.length]
    this.lines += hashes.length
    return entry
  }

  close(): void {
    try { fs.closeSync(this.fd) } catch { /* already closed */ }
  }
}

function binsOf(jsonPath: string): string[] {
  try {
    return fs.readdirSync(path.dirname(jsonPath)).filter(f => f.startsWith(stem(jsonPath) + "-") && f.endsWith(".bin"))
  } catch {
    return []
  }
}

function removeAll(jsonPath: string, keepBin?: string): void {
  for (const f of binsOf(jsonPath)) if (f !== keepBin) try { fs.unlinkSync(path.join(path.dirname(jsonPath), f)) } catch { /* best-effort */ }
}

export function saveCapture(jsonPath: string, capture: Capture): void {
  try {
    const tmp = `${jsonPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(capture))
    fs.renameSync(tmp, jsonPath)
    removeAll(jsonPath, capture.bin)
  } catch {
    // best-effort: the next start-up retakes the capture
  }
}

function isEntry(v: unknown): v is CaptureEntry {
  return v === "empty" || v === "useB" || v === "unknown" ||
    (Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] >= 0 && v[1] >= 0)
}

export function loadCapture(jsonPath: string, day: string): Loaded {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" }
    removeAll(jsonPath); try { fs.unlinkSync(jsonPath) } catch { /* gone */ }
    return { kind: "stale", paths: [] }
  }
  const c = raw as Partial<Capture>
  const indexOk = typeof c.index === "object" && c.index !== null
  const usable = c.version === 1 && c.day === day && typeof c.bin === "string" && Array.isArray(c.folders) && indexOk &&
    fs.existsSync(path.join(path.dirname(jsonPath), c.bin)) && Object.values(c.index!).every(isEntry)
  if (usable) return { kind: "today", capture: c as Capture }
  const paths = c.version === 1 && indexOk ? Object.keys(c.index!) : []
  removeAll(jsonPath); try { fs.unlinkSync(jsonPath) } catch { /* gone */ }
  return { kind: "stale", paths }
}

export function readCaptured(dir: string, bin: string, entry: [number, number]): LineHashes | null {
  const [offset, count] = entry
  if (count === 0) return []
  let fd: number | undefined
  try {
    fd = fs.openSync(path.join(dir, bin), "r")
    const buf = Buffer.alloc(count * 4)
    if (fs.readSync(fd, buf, 0, buf.length, offset * 4) < buf.length) return null
    const out: LineHashes = new Array(count)
    for (let i = 0; i < count; i++) out[i] = buf.readUInt32LE(i * 4)
    return out
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch { /* closed */ }
  }
}

// Captures of workspaces not opened for a long time.
export function pruneCaptures(dir: string, olderThanMs: number): void {
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return }
  for (const name of names) {
    if (!/^morning-[0-9a-f]+(\.json|\.json\.tmp|-.+\.bin)$/.test(name)) continue
    const p = path.join(dir, name)
    try { if (fs.statSync(p).mtimeMs < olderThanMs) fs.unlinkSync(p) } catch { /* best-effort */ }
  }
}
